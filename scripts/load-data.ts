/**
 * Load data/clean/ (real LinkedIn export) into Supabase.
 *   npm run load:data            → posts, metrics, daily stats, demographics, brand profile
 *   npm run load:data -- --embed → also add every post to the library with embeddings (~2 min)
 * Safe to re-run: rows are upserted, library posts are skipped if already present.
 * The same column schema is what make.com posts to /api/ingest.
 */
import fs from "node:fs";
import path from "node:path";
import Papa from "papaparse";
import { adminClient, log } from "./_env";
import { embed, toPgVector } from "@/lib/ai";

const DIR = "data/clean";
const AS_OF = process.env.DATA_AS_OF ?? "2026-11-26"; // date the export was pulled

const read = <T>(file: string): T[] =>
  Papa.parse<T>(fs.readFileSync(path.join(DIR, file), "utf8"), { header: true, skipEmptyLines: true, dynamicTyping: false }).data;
const int = (v: string | undefined) => (v === undefined || v === "" ? null : Math.round(Number(v)));
const bool = (v: string | undefined) => v === "True" || v === "true" || v === "1";
// Postgres rejects NUL bytes and half-emoji (lone surrogates) that some LinkedIn posts contain.
const clean = (s: string | undefined) => (s ?? "").replace(/\u0000/g, "").toWellFormed();

async function upsert(db: ReturnType<typeof adminClient>, table: string, rows: object[], onConflict: string) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from(table).upsert(rows.slice(i, i + 500), { onConflict });
    if (error) throw new Error(`${table}: ${error.message}`);
  }
  log(`${table}: ${rows.length} rows`);
}

async function main() {
  if (!fs.existsSync(DIR)) {
    console.error(`No ${DIR}/ folder. Ask the team lead for the export (it is not in GitHub).`);
    process.exit(1);
  }
  const db = adminClient();
  type P = Record<string, string>;

  const posts: P[] = read<P>("posts.csv").map((p) => ({ ...p, text: clean(p.text) }));
  await upsert(
    db,
    "posts",
    posts.map((p) => ({
      post_id: p.post_id, url: p.url, published_date: p.published_date, format: p.format, is_repost: bool(p.is_repost),
      text: p.text ?? "", char_count: int(p.char_count), hashtag_count: int(p.hashtag_count), has_link: bool(p.has_link),
      source: p.source || "real",
    })),
    "post_id",
  );
  await upsert(
    db,
    "post_metrics",
    posts
      .filter((p) => bool(p.stats_available))
      .map((p) => ({
        post_id: p.post_id, as_of: AS_OF, impressions: int(p.impressions), unique_impressions: int(p.unique_impressions),
        clicks: int(p.clicks), likes: int(p.likes), comments: int(p.comments), shares: int(p.shares),
        source: p.source || "real", imported_via: "csv",
      })),
    "post_id,as_of",
  );

  // Merge the three daily files on date.
  const daily = new Map<string, Record<string, unknown>>();
  for (const r of read<P>("page_daily_post_stats.csv"))
    daily.set(r.date, { date: r.date, impressions: int(r.impressions), unique_impressions: int(r.unique_impressions), clicks: int(r.clicks), likes: int(r.likes), comments: int(r.comments), shares: int(r.shares), source: r.source || "real" });
  for (const r of read<P>("followers_daily.csv")) {
    const k = Object.keys(r).find((c) => /follow/i.test(c) && c !== "source") ?? "";
    daily.set(r.date, { ...(daily.get(r.date) ?? { date: r.date, source: "real" }), new_followers: int(r[k]) });
  }
  for (const r of read<P>("page_views_daily.csv")) {
    const k = Object.keys(r).find((c) => /view/i.test(c) && c !== "source") ?? "";
    daily.set(r.date, { ...(daily.get(r.date) ?? { date: r.date, source: "real" }), page_views: int(r[k]) });
  }
  await upsert(db, "page_daily", [...daily.values()], "date");

  await upsert(
    db,
    "follower_demographics",
    read<P>("follower_demographics.csv").map((r) => ({
      dimension: r.dimension, value: r.value, raw_id: r.raw_id, organic_followers: int(r.organic_followers) ?? 0,
      paid_followers: int(r.paid_followers) ?? 0, as_of: AS_OF, source: r.source || "real",
    })),
    "dimension,value,as_of",
  );

  const profile = JSON.parse(fs.readFileSync(path.join(DIR, "page_profile.json"), "utf8"));
  const { data: existing } = await db.from("settings").select("value").eq("key", "brand").maybeSingle();
  await db.from("settings").upsert({ key: "brand", value: { ...profile, voice: existing?.value?.voice ?? "" } });
  log("settings: brand profile");

  if (process.argv.includes("--embed")) {
    // Every original (non-repost) post with real text becomes an approved library item.
    const { data: have } = await db.from("materials").select("post_id").not("post_id", "is", null);
    const done = new Set((have ?? []).map((m) => m.post_id));
    const todo = posts.filter((p) => !bool(p.is_repost) && (p.text ?? "").length >= 60 && !done.has(p.post_id));
    log(`library: embedding ${todo.length} posts…`);
    for (let i = 0; i < todo.length; i += 20) {
      const batch = todo.slice(i, i + 20);
      const vecs = await embed(batch.map((p) => p.text));
      const { data: mats, error } = await db
        .from("materials")
        .insert(
          batch.map((p) => ({
            kind: "linkedin_post",
            title: `${p.published_date} · ${p.format} · ${p.text.split("\n")[0].slice(0, 70)}`.toWellFormed(),
            body: p.text, post_id: p.post_id, published_date: p.published_date,
            library_status: "approved", source: p.source || "real",
          })),
        )
        .select("id, post_id");
      if (error) throw error;
      const byPost = new Map(mats!.map((m) => [m.post_id, m.id]));
      const { error: e2 } = await db.from("material_chunks").insert(
        batch.map((p, j) => ({ material_id: byPost.get(p.post_id), chunk_index: 0, content: p.text, embedding: toPgVector(vecs[j]) })),
      );
      if (e2) throw e2;
      process.stdout.write(`\r› library: ${Math.min(i + 20, todo.length)}/${todo.length}`);
    }
    console.log();
  }
  log("done");
}

main().catch((e) => {
  console.error("✗", e.message ?? e);
  process.exit(1);
});
