import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { chatJSON } from "@/lib/ai";
import { DATA_RULES, FORMATS, METRICS, OBJECTIVES, OBJECTIVE_KEYS, type Objective } from "@/lib/domain";
import { activeRules, learningBlock } from "./learning";

/* ───────────────────────── Aggregates (plain code, no AI) ───────────────────────── */

export type PostRow = {
  post_id: string; url: string; published_date: string; format: string; is_repost: boolean; text: string;
  char_count: number | null; hashtag_count: number | null; has_link: boolean | null; topic: string | null;
  objective: Objective | null; objective_status: string;
  impressions: number | null; unique_impressions: number | null; clicks: number | null; likes: number | null;
  comments: number | null; shares: number | null; ctr: number | null; engagement_rate: number | null; comparable: boolean;
};

export async function loadPerformance(db: SupabaseClient, from = DATA_RULES.statsFrom) {
  const { data, error } = await db
    .from("post_performance")
    .select("*")
    .gte("published_date", from)
    .not("impressions", "is", null)
    .order("published_date", { ascending: false });
  if (error) throw error;
  return (data ?? []) as PostRow[];
}

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Per-format comparison over comparable posts (≥ 30 impressions). Medians, not means: a few viral posts skew means. */
export function byFormat(rows: PostRow[]) {
  const comp = rows.filter((r) => r.comparable);
  const groups = new Map<string, PostRow[]>();
  comp.forEach((r) => groups.set(r.format, [...(groups.get(r.format) ?? []), r]));
  return [...groups.entries()]
    .map(([format, rs]) => ({
      format,
      label: FORMATS[format] ?? format,
      posts: rs.length,
      lowSample: rs.length < DATA_RULES.lowSampleMin,
      median_impressions: Math.round(median(rs.map((r) => r.impressions ?? 0))),
      median_ctr: median(rs.map((r) => r.ctr ?? 0)),
      median_er: median(rs.map((r) => r.engagement_rate ?? 0)),
      median_clicks: median(rs.map((r) => r.clicks ?? 0)),
    }))
    .sort((a, b) => b.posts - a.posts);
}

/* ───────────────────────── Gate 4: insights ───────────────────────── */

/** JSON replacer: rates become "12.1%", other decimals are rounded, so the model quotes clean figures. */
function readable(key: string, v: unknown) {
  if (typeof v !== "number" || Number.isInteger(v)) return v;
  if (/ctr|_er$|engagement_rate/.test(key)) return `${(v * 100).toFixed(1)}%`;
  return Math.round(v * 10) / 10;
}

type InsightJSON = {
  insights: {
    title: string;
    observed_trend: string;       // what the numbers show
    evidence: string[];           // specific figures backing it
    possible_explanation: string; // a hypothesis, never stated as cause
    recommendation: string;       // what to try next
    caveat: string;
    objective: Objective;
  }[];
};

/** Writes 1–3 insight cards to the review queue (Gate 4). The model sees aggregates only. */
export async function generateInsights(db: SupabaseClient, actor?: string, question?: string) {
  const rows = await loadPerformance(db);
  const comp = rows.filter((r) => r.comparable);
  const formats = byFormat(rows);
  const top = [...comp].sort((a, b) => (b.ctr ?? 0) - (a.ctr ?? 0)).slice(0, 5);
  const reachNoClicks = [...comp]
    .filter((r) => (r.impressions ?? 0) > median(comp.map((c) => c.impressions ?? 0)) && (r.ctr ?? 0) < median(comp.map((c) => c.ctr ?? 0)))
    .slice(0, 5);
  const linkVsNo = [true, false].map((hasLink) => {
    const g = comp.filter((r) => !!r.has_link === hasLink);
    return { has_link: hasLink, posts: g.length, median_ctr: median(g.map((r) => r.ctr ?? 0)), median_impr: median(g.map((r) => r.impressions ?? 0)) };
  });

  const facts = {
    window: `${DATA_RULES.statsFrom} to today`,
    posts_with_stats: rows.length,
    comparable_posts: comp.length,
    excluded_under_30_impressions: rows.length - comp.length,
    by_format: formats,
    link_vs_no_link: linkVsNo,
    top_ctr_posts: top.map((r) => ({ date: r.published_date, format: r.format, impressions: r.impressions, ctr: r.ctr, opening: r.text.slice(0, 120) })),
    reach_but_few_clicks: reachNoClicks.map((r) => ({ date: r.published_date, format: r.format, impressions: r.impressions, ctr: r.ctr, opening: r.text.slice(0, 120) })),
    metric_definitions: Object.fromEntries(Object.entries(METRICS).map(([k, v]) => [k, v.def])),
  };

  const rules = await activeRules(db, "insight");
  const out = await chatJSON<InsightJSON>([
    {
      role: "system",
      content: [
        "You are a careful marketing analyst. Use ONLY the numbers in FACTS. Each evidence item is one short plain-English line with exact figures (e.g. \"Carousels: median CTR 12.1% across 24 posts\"), never raw field names.",
        "Keep observed_trend (what the data shows) strictly separate from possible_explanation (a hypothesis). Never present correlation as cause. Never promise future results.",
        `Formats with fewer than ${DATA_RULES.lowSampleMin} posts are low-sample: say so if you use them.`,
        `Audience caveat: ${DATA_RULES.audienceCaveat}`,
        "Comments are near zero across the page, so engagement is a weak signal; prefer impressions and clicks.",
        learningBlock(rules, []),
        `Return JSON: {"insights":[{"title":"short headline","observed_trend":"…","evidence":["…"],"possible_explanation":"…","recommendation":"one concrete next post idea","caveat":"…","objective":"one of ${OBJECTIVE_KEYS.join("|")}"}]} with 1 to 3 insights.`,
      ].join("\n\n"),
    },
    { role: "user", content: `${question ? `QUESTION FROM THE MANAGER: ${question}\n\n` : ""}FACTS:\n${JSON.stringify(facts, readable, 1)}` },
  ]);

  const items = (out.insights ?? []).slice(0, 3).map((ins) => ({
    gate: 4,
    item_type: "insight",
    title: ins.title,
    reason: question ? `Answer to: “${question}”` : "Periodic performance review",
    brief: question ?? null,
    draft: ins.recommendation,
    payload: ins,
    context: { objective: ins.objective },
    learning: { rule_ids: rules.map((r) => r.id) },
    created_by: actor ?? null,
  }));
  if (!items.length) return 0;
  const { error } = await db.from("review_items").insert(items);
  if (error) throw error;
  return items.length;
}

/* ───────────────────────── Gate 1: classification ───────────────────────── */

/** Tag one library material with topic, tags and an INFERRED objective. Creates a Gate 1 item. */
export async function classifyMaterial(db: SupabaseClient, materialId: string, actor?: string) {
  const { data: m } = await db.from("materials").select("id, title, kind, body").eq("id", materialId).single();
  if (!m) throw new Error("Material not found");
  const rules = await activeRules(db, "classification");
  const out = await chatJSON<{ topic: string; tags: string[]; objective: Objective; why: string }>(
    [
      {
        role: "system",
        content:
          "Classify marketing material for a LinkedIn content library. topic = 2-4 words. tags = 3-6 lowercase tags. " +
          `objective = most likely intent, one of ${OBJECTIVE_KEYS.join(", ")}. why = one sentence.\n` +
          learningBlock(rules, []) +
          '\nReturn JSON: {"topic":"…","tags":["…"],"objective":"…","why":"…"}',
      },
      { role: "user", content: `${m.kind.toUpperCase()}: ${m.title}\n\n${m.body.slice(0, 4000)}` },
    ],
    { tier: "fast", maxTokens: 300 },
  );
  await db.from("materials").update({ topic: out.topic, tags: out.tags, objective: out.objective, objective_status: "inferred" }).eq("id", m.id);
  const { error } = await db.from("review_items").insert({
    gate: 1,
    item_type: "classification",
    title: m.title,
    reason: "New material added to the library",
    draft: `${out.topic} · ${out.objective}`,
    payload: out,
    context: { topic: out.topic, objective: out.objective, kind: m.kind },
    material_id: m.id,
    created_by: actor ?? null,
  });
  if (error) throw error;
}

/* ───────────────────────── Gate 3: objective + metrics ───────────────────────── */

/** Recommend primary + supporting metrics for an objective. Rule-based, with the reason spelled out. */
export function recommendMetrics(objective: Objective) {
  const o = OBJECTIVES[objective];
  const why: Record<Objective, string> = {
    awareness: "Awareness is about being seen, so impressions lead. Engagement is not used because some of it may be internal.",
    thought_leadership: "Credibility shows up as reach among the right people and as reposts. Reaction types and saves are not available to us.",
    engagement: "Engagement posts aim for interaction, so engagement rate leads. Comments are near zero on this page, so treat results with care.",
    lead_generation: "Enquiries start with a click. Clicks and CTR are the closest tracked signal; conversions are not tracked.",
    campaign: "A campaign needs people to act on a link. Clicks lead, impressions show whether enough people saw it.",
  };
  return { objective, primary: [...o.primary], supporting: [...o.supporting], why: why[objective] };
}
