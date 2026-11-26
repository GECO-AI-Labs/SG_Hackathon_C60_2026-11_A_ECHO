import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * One ingest path for LinkedIn performance data, whichever way it arrives:
 *   (a) CSV/XLSX upload on the Signals page
 *   (b) make.com scenario POSTing JSON to /api/ingest
 * Both use the column schema of data/clean/posts.csv. Unknown posts are added;
 * known posts get a new metrics snapshot for `as_of` (multi-period support).
 */
export type PostRowIn = Record<string, string | number | boolean | null | undefined>;

const int = (v: unknown) => (v === undefined || v === null || v === "" ? null : Math.round(Number(v)));
const bool = (v: unknown) => v === true || v === "True" || v === "true" || v === 1 || v === "1";
const text = (v: unknown) => String(v ?? "").replace(/\u0000/g, "").toWellFormed();

export async function ingestPosts(db: SupabaseClient, rows: PostRowIn[], opts: { asOf?: string; via: "csv" | "make"; source?: "real" | "synthetic" }) {
  const asOf = opts.asOf ?? new Date().toISOString().slice(0, 10);
  const valid = rows.filter((r) => r.post_id && r.published_date);
  if (!valid.length) return { received: rows.length, matched: 0, added: 0, metrics: 0, skipped: rows.length };

  const ids = valid.map((r) => String(r.post_id));
  const { data: existing } = await db.from("posts").select("post_id").in("post_id", ids);
  const known = new Set((existing ?? []).map((e) => e.post_id));

  const { error: e1 } = await db.from("posts").upsert(
    valid.map((r) => ({
      post_id: String(r.post_id), url: r.url ? String(r.url) : null, published_date: String(r.published_date).slice(0, 10),
      format: String(r.format ?? "text"), is_repost: bool(r.is_repost), text: text(r.text),
      char_count: int(r.char_count), hashtag_count: int(r.hashtag_count), has_link: bool(r.has_link),
      source: (r.source as string) || opts.source || "real",
    })),
    { onConflict: "post_id" },
  );
  if (e1) throw e1;

  const withStats = valid.filter((r) => r.impressions !== undefined && r.impressions !== "" && r.impressions !== null);
  if (withStats.length) {
    const { error: e2 } = await db.from("post_metrics").upsert(
      withStats.map((r) => ({
        post_id: String(r.post_id), as_of: asOf, impressions: int(r.impressions), unique_impressions: int(r.unique_impressions),
        clicks: int(r.clicks), likes: int(r.likes), comments: int(r.comments), shares: int(r.shares),
        source: (r.source as string) || opts.source || "real", imported_via: opts.via,
      })),
      { onConflict: "post_id,as_of" },
    );
    if (e2) throw e2;
  }
  return {
    received: rows.length,
    matched: valid.filter((r) => known.has(String(r.post_id))).length,
    added: valid.filter((r) => !known.has(String(r.post_id))).length,
    metrics: withStats.length,
    skipped: rows.length - valid.length,
  };
}
