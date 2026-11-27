/**
 * Signals maths shared by the server (pages, Ask ECHO, report) and the browser
 * (instant filtering): filters, periods, medians, group comparisons and results
 * against objectives. Plain code only: no AI, no database, no "server-only".
 */
import { DATA_RULES, FORMATS, OBJECTIVES, OBJECTIVE_KEYS, type Objective } from "@/lib/domain";

export type PostRow = {
  post_id: string; url: string; published_date: string; format: string; is_repost: boolean; text: string;
  char_count: number | null; hashtag_count: number | null; has_link: boolean | null; topic: string | null;
  objective: Objective | null; objective_status: string;
  impressions: number | null; unique_impressions: number | null; clicks: number | null; likes: number | null;
  comments: number | null; shares: number | null; ctr: number | null; engagement_rate: number | null; comparable: boolean;
};

export type DailyRow = { date: string; impressions: number | null; clicks: number | null; new_followers: number | null; page_views: number | null };

export const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/* ───────────────────────── Filters ───────────────────────── */

export const PERIODS = {
  all: "All time",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  "3m": "Last 3 full months",
  qtr: "This quarter",
  ytd: "Year to date",
  "12m": "Last 12 months",
  custom: "Custom dates",
} as const;
export type PeriodKey = keyof typeof PERIODS;

export const COMPARES = { prev: "Previous period", yoy: "Same period last year", none: "No comparison" } as const;
export type CompareKey = keyof typeof COMPARES;

export const GRAINS = { day: "Day", week: "Week", month: "Month" } as const;
export type Grain = keyof typeof GRAINS;

export type Filters = {
  period: PeriodKey;
  from: string | null; // custom only, ISO date
  to: string | null;
  compare: CompareKey;
  grain: Grain;
  formats: string[];
  topics: string[];
  objectives: Objective[];
  status: "all" | "confirmed" | "inferred";
  link: "all" | "yes" | "no";
};

export const DEFAULT_FILTERS: Filters = {
  period: "all", from: null, to: null, compare: "prev", grain: "week",
  formats: [], topics: [], objectives: [], status: "all", link: "all",
};

type Params = Record<string, string | string[] | undefined> | URLSearchParams;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

function read(sp: Params, key: string): string[] {
  if (sp instanceof URLSearchParams) return sp.getAll(key);
  const v = sp[key];
  return v == null ? [] : Array.isArray(v) ? v : [v];
}
const one = <T extends string>(sp: Params, key: string, allowed: readonly T[], fallback: T): T => {
  const v = read(sp, key)[0];
  return allowed.includes(v as T) ? (v as T) : fallback;
};

/** URL search params → filters. Unknown values fall back to defaults, so a bad link never breaks the page. */
export function parseFilters(sp: Params): Filters {
  const date = (k: string) => { const v = read(sp, k)[0]; return v && ISO.test(v) ? v : null; };
  return {
    period: one(sp, "p", Object.keys(PERIODS) as PeriodKey[], DEFAULT_FILTERS.period),
    from: date("from"),
    to: date("to"),
    compare: one(sp, "cmp", Object.keys(COMPARES) as CompareKey[], DEFAULT_FILTERS.compare),
    grain: one(sp, "g", Object.keys(GRAINS) as Grain[], DEFAULT_FILTERS.grain),
    formats: read(sp, "fmt").filter(Boolean),
    topics: read(sp, "topic").filter(Boolean),
    objectives: read(sp, "obj").filter((o): o is Objective => (OBJECTIVE_KEYS as string[]).includes(o)),
    status: one(sp, "goal", ["all", "confirmed", "inferred"] as const, "all"),
    link: one(sp, "link", ["all", "yes", "no"] as const, "all"),
  };
}

/** Filters → query string with only the non-default values (short, shareable URLs). */
export function filtersToQuery(f: Filters): string {
  const q = new URLSearchParams();
  if (f.period !== DEFAULT_FILTERS.period) q.set("p", f.period);
  if (f.period === "custom") { if (f.from) q.set("from", f.from); if (f.to) q.set("to", f.to); }
  if (f.compare !== DEFAULT_FILTERS.compare) q.set("cmp", f.compare);
  if (f.grain !== DEFAULT_FILTERS.grain) q.set("g", f.grain);
  f.formats.forEach((v) => q.append("fmt", v));
  f.topics.forEach((v) => q.append("topic", v));
  f.objectives.forEach((v) => q.append("obj", v));
  if (f.status !== "all") q.set("goal", f.status);
  if (f.link !== "all") q.set("link", f.link);
  return q.toString();
}

export const isDefault = (f: Filters) => filtersToQuery(f) === "";

/** The post filters (everything except time) in words, for labels, reports and the AI. */
export function describePostFilters(f: Filters): string[] {
  const out: string[] = [];
  if (f.formats.length) out.push(`Format: ${f.formats.map((k) => FORMATS[k] ?? k).join(", ")}`);
  if (f.topics.length) out.push(`Topic: ${f.topics.join(", ")}`);
  if (f.objectives.length) out.push(`Goal: ${f.objectives.map((o) => OBJECTIVES[o].label).join(", ")}`);
  if (f.status !== "all") out.push(f.status === "confirmed" ? "Confirmed goals only" : "Inferred goals only");
  if (f.link !== "all") out.push(f.link === "yes" ? "Posts with a link" : "Posts without a link");
  return out;
}

/* ───────────────────────── Periods ───────────────────────── */

export type Range = { from: string; to: string; label: string }; // inclusive ISO dates

const d = (iso: string) => new Date(iso + "T00:00:00Z");
const iso = (dt: Date) => dt.toISOString().slice(0, 10);
export const addDays = (s: string, n: number) => { const t = d(s); t.setUTCDate(t.getUTCDate() + n); return iso(t); };
const addMonths = (s: string, n: number) => { const t = d(s); t.setUTCMonth(t.getUTCMonth() + n); return iso(t); };
const daysBetween = (a: string, b: string) => Math.round((d(b).getTime() - d(a).getTime()) / 864e5);

export function rangeLabel(from: string, to: string) {
  const f = (s: string, withYear: boolean) => d(s).toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(withYear && { year: "numeric" }), timeZone: "UTC" });
  return from === to ? f(from, true) : `${f(from, from.slice(0, 4) !== to.slice(0, 4))} – ${f(to, true)}`;
}
const range = (from: string, to: string): Range => ({ from, to, label: rangeLabel(from, to) });

/**
 * Resolves the selected period against `anchor`, the latest date we have data for,
 * so "last 30 days" means the last 30 days of DATA (a stale export still shows numbers).
 */
export function resolvePeriod(f: Filters, anchor: string): { cur: Range; cmp: Range | null } {
  const y = anchor.slice(0, 4);
  let from: string;
  let to = anchor;
  switch (f.period) {
    case "30d": from = addDays(anchor, -29); break;
    case "90d": from = addDays(anchor, -89); break;
    case "12m": from = addDays(anchor, -364); break;
    case "ytd": from = `${y}-01-01`; break;
    case "qtr": from = `${y}-${String(Math.floor((Number(anchor.slice(5, 7)) - 1) / 3) * 3 + 1).padStart(2, "0")}-01`; break;
    case "3m": {
      // Last 3 FULL calendar months: easy to explain and stable when one day is added.
      const monthStart = `${anchor.slice(0, 7)}-01`;
      const endExcl = addDays(anchor, 1).slice(8) === "01" ? addMonths(monthStart, 1) : monthStart;
      from = addMonths(endExcl, -3);
      to = addDays(endExcl, -1);
      break;
    }
    case "custom": {
      const a = f.from ?? DATA_RULES.statsFrom;
      const b = f.to ?? anchor;
      [from, to] = a <= b ? [a, b] : [b, a];
      break;
    }
    default: from = DATA_RULES.statsFrom;
  }
  const cur = range(from, to);
  if (f.compare === "none" || f.period === "all") return { cur, cmp: null };
  if (f.compare === "yoy") return { cur, cmp: range(addMonths(from, -12), addMonths(to, -12)) };
  if (f.period === "3m") return { cur, cmp: range(addMonths(from, -3), addDays(from, -1)) };
  const len = daysBetween(from, to) + 1;
  return { cur, cmp: range(addDays(from, -len), addDays(from, -1)) };
}

export const inRange = (date: string, r: Range) => date >= r.from && date <= r.to;

/** Posts in the period that match every post filter. */
export function filterPosts(rows: PostRow[], f: Filters, cur: Range) {
  return rows.filter((p) =>
    inRange(p.published_date, cur) &&
    (!f.formats.length || f.formats.includes(p.format)) &&
    (!f.topics.length || f.topics.includes(p.topic ?? "Unclassified")) &&
    (!f.objectives.length || (!!p.objective && f.objectives.includes(p.objective))) &&
    (f.status === "all" || (f.status === "confirmed" ? p.objective_status === "confirmed" : !!p.objective && p.objective_status !== "confirmed")) &&
    (f.link === "all" || !!p.has_link === (f.link === "yes")),
  );
}

/* ───────────────────────── Time buckets ───────────────────────── */

/** Start date of the bucket a date falls in: the day, its Monday, or the 1st of its month. */
export function bucketOf(date: string, grain: Grain) {
  if (grain === "day") return date;
  if (grain === "month") return `${date.slice(0, 7)}-01`;
  const t = d(date);
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
  return iso(t);
}

export type DailyMetric = "impressions" | "clicks" | "new_followers" | "page_views";
export type Bucket = { key: string; days: number } & Record<DailyMetric, number | null>;

/**
 * Page-level daily rows summed into buckets over a range. Days with no data are
 * not counted as zero: a bucket with no covered days gets null (a gap, not a dip).
 */
export function bucketDaily(daily: DailyRow[], r: Range, grain: Grain): Bucket[] {
  const byDate = new Map(daily.map((x) => [x.date, x]));
  const out = new Map<string, Bucket>();
  for (let day = r.from; day <= r.to; day = addDays(day, 1)) {
    const key = bucketOf(day, grain);
    const b = out.get(key) ?? { key, days: 0, impressions: null, clicks: null, new_followers: null, page_views: null };
    const row = byDate.get(day);
    if (row) {
      b.days++;
      for (const m of ["impressions", "clicks", "new_followers", "page_views"] as const) b[m] = (b[m] ?? 0) + (row[m] ?? 0);
    }
    out.set(key, b);
  }
  return [...out.values()];
}

/** Page-level totals over a range, and whether page data covers every day of it. */
export function sumDaily(daily: DailyRow[], r: Range) {
  const rows = daily.filter((x) => inRange(x.date, r));
  const total = (k: DailyMetric) => rows.reduce((s, x) => s + (x[k] ?? 0), 0);
  return {
    covered: rows.length >= daysBetween(r.from, r.to) + 1,
    days: rows.length,
    impressions: total("impressions"), clicks: total("clicks"), new_followers: total("new_followers"), page_views: total("page_views"),
  };
}

/** The range clipped to the days page data exists for (null when they do not overlap). */
export function clipToData(r: Range, daily: DailyRow[]): Range | null {
  if (!daily.length) return null;
  const from = r.from > daily[0].date ? r.from : daily[0].date;
  const to = r.to < daily[daily.length - 1].date ? r.to : daily[daily.length - 1].date;
  return from <= to ? range(from, to) : null;
}

/* ───────────────────────── Comparisons ───────────────────────── */

/** Per-format comparison over comparable posts (≥ 30 impressions). Medians, not means: a few viral posts skew means. */
export function byFormat(rows: PostRow[]) {
  return byGroup(rows, (r) => r.format, (k) => FORMATS[k] ?? k);
}

/** Same comparison grouped by topic (topics come from bulk classification). */
export function byTopic(rows: PostRow[]) {
  return byGroup(rows, (r) => r.topic ?? "Unclassified", (k) => k);
}

export type GroupRow = ReturnType<typeof byGroup>[number];

function byGroup(rows: PostRow[], key: (r: PostRow) => string, label: (k: string) => string) {
  const comp = rows.filter((r) => r.comparable);
  const groups = new Map<string, PostRow[]>();
  comp.forEach((r) => groups.set(key(r), [...(groups.get(key(r)) ?? []), r]));
  return [...groups.entries()]
    .map(([format, rs]) => ({
      format,
      label: label(format),
      posts: rs.length,
      lowSample: rs.length < DATA_RULES.lowSampleMin,
      median_impressions: Math.round(median(rs.map((r) => r.impressions ?? 0))),
      median_ctr: median(rs.map((r) => r.ctr ?? 0)),
      median_er: median(rs.map((r) => r.engagement_rate ?? 0)),
      median_clicks: median(rs.map((r) => r.clicks ?? 0)),
    }))
    .sort((a, b) => b.posts - a.posts);
}

/* ───────────────────────── Results against objectives ───────────────────────── */

const value = (r: PostRow, m: string) => Number((r as Record<string, unknown>)[m] ?? 0);

/**
 * The bar each goal must beat: the page's typical post, i.e. the median of the goal's
 * primary metric across ALL comparable posts. Always computed from the full history,
 * so a post's met/missed label does not change when filters change.
 */
export function objectiveBaselines(allRows: PostRow[]) {
  const comp = allRows.filter((r) => r.comparable);
  const baselines: Record<string, number> = {};
  for (const o of OBJECTIVE_KEYS) {
    const m = OBJECTIVES[o].primary[0];
    baselines[m] ??= median(comp.map((r) => value(r, m)));
  }
  return baselines;
}

/**
 * Did each post hit ITS objective? A post "met" its goal when its primary metric
 * (impressions for awareness, clicks for lead generation, …) reached the baseline.
 * `rows` are the posts to judge; `allRows` set the fixed baseline.
 */
export function objectiveResults(rows: PostRow[], allRows: PostRow[] = rows) {
  const baselines = objectiveBaselines(allRows);
  const comp = rows.filter((r) => r.comparable && r.objective);
  const perPost = new Map<string, boolean>();
  const byObjective = OBJECTIVE_KEYS.map((o) => {
    const metric = OBJECTIVES[o].primary[0];
    const rs = comp.filter((r) => r.objective === o);
    let met = 0;
    rs.forEach((r) => {
      const ok = value(r, metric) >= baselines[metric];
      perPost.set(r.post_id, ok);
      if (ok) met++;
    });
    return {
      objective: o, metric, baseline: baselines[metric], posts: rs.length, met,
      confirmed: rs.filter((r) => r.objective_status === "confirmed").length,
    };
  }).filter((x) => x.posts > 0);
  const total = byObjective.reduce((s, x) => s + x.posts, 0);
  const met = byObjective.reduce((s, x) => s + x.met, 0);
  return { total, met, byObjective, perPost: Object.fromEntries(perPost) };
}

export type ObjectiveResults = ReturnType<typeof objectiveResults>;
