import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * One ingest path for LinkedIn performance data, whichever way it arrives:
 *   (a) CSV/XLSX upload on the Signals page (ECHO's CSV or LinkedIn's own export)
 *   (b) make.com scenario POSTing JSON to /api/ingest
 * Both use the column schema of data/clean/posts.csv. Each upload is one reporting period
 * (`as_of`): known posts get a new metrics snapshot, unknown posts are added.
 *
 * Matching a row to a known post, in order:
 *   1. same post_id (URN)   2. same URL   3. same day (±1) and same opening text
 * (3) matters because LinkedIn's export links use activity URNs, while the API uses share URNs.
 */
export type PostRowIn = Record<string, string | number | boolean | null | undefined>;

const int = (v: unknown) => (v === undefined || v === null || v === "" || isNaN(Number(v)) ? null : Math.round(Number(v)));
const bool = (v: unknown) => v === true || v === "True" || v === "true" || v === 1 || v === "1";
const text = (v: unknown) => String(v ?? "").replace(/\u0000/g, "").toWellFormed();
const normText = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
/** Same post if the shorter text is a prefix of the longer one (exports often keep only the first line). */
const sameOpening = (a: string, b: string) => {
  const [x, y] = [normText(a), normText(b)];
  const k = Math.min(x.length, y.length, 60);
  return k >= 15 && x.slice(0, k) === y.slice(0, k);
};
const dayDiff = (a: string, b: string) => Math.abs(+new Date(a) - +new Date(b)) / 864e5;

export type IngestReport = {
  received: number; matched: number; matched_by_text: number; added: number; metrics: number; skipped: number; as_of: string; dry_run: boolean;
  drafts_linked?: number;
};

export async function ingestPosts(
  db: SupabaseClient,
  rows: PostRowIn[],
  opts: { asOf?: string; via: "csv" | "make"; source?: "real" | "synthetic" | "demo"; dryRun?: boolean },
): Promise<IngestReport> {
  const asOf = opts.asOf ?? new Date().toISOString().slice(0, 10);
  const valid = rows.filter((r) => r.published_date && (r.post_id || r.url || r.text));
  const base = { received: rows.length, skipped: rows.length - valid.length, as_of: asOf, dry_run: !!opts.dryRun };
  if (!valid.length) return { ...base, matched: 0, matched_by_text: 0, added: 0, metrics: 0 };

  // Candidates: every known post in the report's date range (±1 day).
  const dates = valid.map((r) => String(r.published_date).slice(0, 10)).sort();
  const from = new Date(+new Date(dates[0]) - 864e5).toISOString().slice(0, 10);
  const to = new Date(+new Date(dates.at(-1)!) + 864e5).toISOString().slice(0, 10);
  // Demo-profile posts and real-page posts never match each other.
  const demo = opts.source === "demo";
  const knownQ = db.from("posts").select("post_id, url, published_date, text").gte("published_date", from).lte("published_date", to);
  const { data: known } = await (demo ? knownQ.eq("source", "demo") : knownQ.neq("source", "demo"));
  const byId = new Map((known ?? []).map((k) => [k.post_id, k]));
  const byUrl = new Map((known ?? []).filter((k) => k.url).map((k) => [k.url, k]));

  let matched = 0, matchedByText = 0;
  const resolved = valid.map((r) => {
    const id = String(r.post_id ?? "");
    const url = String(r.url ?? "");
    const date = String(r.published_date).slice(0, 10);
    let hit = (id && byId.get(id)) || (url && byUrl.get(url)) || null;
    if (hit) matched++;
    if (!hit && r.text) {
      hit = (known ?? []).find((k) => dayDiff(k.published_date, date) <= 1 && sameOpening(String(r.text), k.text)) ?? null;
      if (hit) { matched++; matchedByText++; }
    }
    const postId = hit?.post_id ?? (id || `${demo ? "demo" : "ext"}:${date}:${normText(String(r.text ?? url)).replace(/ /g, "-").slice(0, 30)}`);
    return { r, postId, isNew: !hit };
  });

  const withStats = resolved.filter(({ r }) => int(r.impressions) !== null);
  const report = { ...base, matched, matched_by_text: matchedByText, added: resolved.filter((x) => x.isNew).length, metrics: withStats.length };
  if (opts.dryRun) return report;

  const fresh = resolved.filter((x) => x.isNew);
  if (fresh.length) {
    const { error } = await db.from("posts").upsert(
      fresh.map(({ r, postId }) => ({
        post_id: postId, url: r.url ? String(r.url) : null, published_date: String(r.published_date).slice(0, 10),
        format: String(r.format || "text"), is_repost: bool(r.is_repost), text: text(r.text),
        char_count: int(r.char_count), hashtag_count: int(r.hashtag_count), has_link: bool(r.has_link),
        source: demo ? "demo" : (r.source as string) || opts.source || "real",
      })),
      { onConflict: "post_id" },
    );
    if (error) throw error;
  }
  if (withStats.length) {
    const { error } = await db.from("post_metrics").upsert(
      withStats.map(({ r, postId }) => ({
        post_id: postId, as_of: asOf, impressions: int(r.impressions), unique_impressions: int(r.unique_impressions),
        clicks: int(r.clicks), likes: int(r.likes), comments: int(r.comments), shares: int(r.shares),
        source: demo ? "demo" : (r.source as string) || opts.source || "real", imported_via: opts.via,
      })),
      { onConflict: "post_id,as_of" },
    );
    if (error) throw error;
  }
  // Demo posts never link back to drafts: their results must not feed learning.
  const linked = demo ? 0 : await linkPublishedDrafts(db);
  return { ...report, drafts_linked: linked };
}

/**
 * Close the loop: find which approved drafts were actually published, by matching the
 * approved text against posts published after the decision. Linked drafts carry the post's
 * results, so learning can favour edits whose posts performed well (results-weighted examples).
 */
export async function linkPublishedDrafts(db: SupabaseClient) {
  const { data: drafts } = await db
    .from("review_items")
    .select("id, final, decided_at")
    .eq("item_type", "post_draft")
    .in("status", ["approved", "edited"])
    .is("post_id", null)
    .not("final", "is", null);
  if (!drafts?.length) return 0;
  const since = drafts.map((d) => d.decided_at).sort()[0]?.slice(0, 10) ?? "2000-01-01";
  const { data: posts } = await db.from("posts").select("post_id, text, published_date").gte("published_date", since).neq("source", "demo");
  const words = (s: string) => new Set(normText(s).split(" ").filter((w) => w.length > 3));
  let linked = 0;
  for (const d of drafts) {
    const dw = words(d.final);
    const hit = (posts ?? []).find((p) => {
      if (p.published_date < d.decided_at.slice(0, 10)) return false;
      if (sameOpening(d.final, p.text)) return true;
      const pw = words(p.text);
      const overlap = [...dw].filter((w) => pw.has(w)).length / Math.max(1, Math.min(dw.size, pw.size));
      return overlap >= 0.6; // the manager may tweak wording before posting
    });
    if (hit) {
      await db.from("review_items").update({ post_id: hit.post_id }).eq("id", d.id);
      linked++;
    }
  }
  return linked;
}
