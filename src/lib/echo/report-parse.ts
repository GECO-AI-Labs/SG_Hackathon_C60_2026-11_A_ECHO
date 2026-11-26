/**
 * Turn any LinkedIn performance report into ECHO's post columns (the schema of data/clean/posts.csv).
 * Accepts: ECHO's own CSV, LinkedIn's Page Analytics XLSX export ("All posts" sheet, which has a
 * title row above the header), or any CSV with similar headers. Runs in the browser and in Node.
 */
import * as XLSX from "xlsx";

export type ReportRow = Record<string, string>;

// ECHO column → header names seen in the wild (lower-case, punctuation removed), in priority order.
// LinkedIn's "Post type" means organic/sponsored, so "content type" wins for format.
const ALIASES: Record<string, string[]> = {
  post_id: ["post id", "post_id", "urn", "share urn"],
  url: ["post link", "post url", "url", "link", "permalink"],
  published_date: ["created date", "published date", "published_date", "date", "posted on", "post date"],
  text: ["post title", "title", "text", "content", "commentary", "post text"],
  format: ["content type", "media type", "format", "post type"],
  impressions: ["impressions"],
  unique_impressions: ["unique impressions", "unique_impressions", "reach", "members reached"],
  clicks: ["clicks"],
  likes: ["likes", "reactions"],
  comments: ["comments"],
  shares: ["reposts", "shares"],
};

const FORMAT_MAP: Record<string, string> = {
  image: "image", photo: "image", video: "video", document: "document", pdf: "document", article: "article",
  poll: "poll", text: "text", "text only": "text", carousel: "multiImage", "multi image": "multiImage",
  multiimage: "multiImage", "multi-image": "multiImage", event: "reference", link: "reference", reference: "reference",
};

const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9 _]/g, " ").replace(/\s+/g, " ").trim();

/** Find the header row: the first row that has an impressions column and a link/date column. */
function findHeader(rows: unknown[][]): number {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const cells = rows[i].map(norm);
    if (cells.includes("impressions") && cells.some((c) => ALIASES.url.includes(c) || ALIASES.published_date.includes(c) || ALIASES.post_id.includes(c))) return i;
  }
  return 0;
}

function toISODate(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/); // LinkedIn exports use MM/DD/YYYY
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  const d = new Date(s);
  return isNaN(+d) ? "" : d.toISOString().slice(0, 10);
}

/** The URN inside a LinkedIn post URL, e.g. urn:li:activity:123 or urn:li:share:123. */
export const urnFromUrl = (url: string) => url.match(/urn:li:(?:share|ugcPost|activity):\d+/)?.[0] ?? "";

export function parseReport(data: ArrayBuffer): { rows: ReportRow[]; mapped: Record<string, string>; sheet: string } {
  const wb = XLSX.read(data, { type: "array", cellDates: true });
  // Prefer the sheet that looks like per-post data.
  const sheetName = wb.SheetNames.find((n) => /post|update|content/i.test(n)) ?? wb.SheetNames[0];
  const raw = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], { header: 1, raw: true, defval: "" });
  const h = findHeader(raw);
  const header = raw[h].map(norm);

  const col: Record<string, number> = {};
  const mapped: Record<string, string> = {};
  for (const [field, names] of Object.entries(ALIASES)) {
    const i = names.map((n) => header.indexOf(n)).find((x) => x >= 0) ?? -1;
    if (i >= 0) { col[field] = i; mapped[field] = String(raw[h][i]); }
  }

  const rows = raw.slice(h + 1).filter((r) => r.some((c) => c !== "" && c !== null)).map((r) => {
    const get = (f: string) => (col[f] !== undefined ? r[col[f]] : "");
    const url = String(get("url") ?? "").trim();
    const fmt = norm(get("format"));
    const text = String(get("text") ?? "");
    return {
      post_id: String(get("post_id") || urnFromUrl(url) || ""),
      url,
      published_date: toISODate(get("published_date")),
      text,
      format: FORMAT_MAP[fmt] ?? (fmt || "text"),
      impressions: String(get("impressions") ?? ""),
      unique_impressions: String(get("unique_impressions") ?? ""),
      clicks: String(get("clicks") ?? ""),
      likes: String(get("likes") ?? ""),
      comments: String(get("comments") ?? ""),
      shares: String(get("shares") ?? ""),
      has_link: String(/https?:\/\//.test(text)),
      char_count: String(text.length),
      hashtag_count: String((text.match(/#\w+/g) ?? []).length),
      source: "real",
    } satisfies ReportRow;
  });
  return { rows, mapped, sheet: sheetName };
}
