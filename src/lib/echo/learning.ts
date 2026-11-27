import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { chatJSON } from "@/lib/ai";
import { AUTONOMY, type ItemType } from "@/lib/domain";

/**
 * ECHO learns through prompt context, not model training:
 *   1. active rules      → injected into every prompt of that item type
 *   2. before/after pairs → 2–3 reviewer edits shown to the model as examples
 *   3. autonomy ladder   → computed from approval rate + edit size
 */

export type Rule = { id: string; rule: string; rationale: string | null; active: boolean };
export type Example = { id: string; draft: string; final: string; topic?: string };

export async function activeRules(db: SupabaseClient, itemType: ItemType): Promise<Rule[]> {
  const { data } = await db
    .from("rules")
    .select("id, rule, rationale, active")
    .eq("item_type", itemType)
    .eq("active", true)
    .order("created_at");
  return (data ?? []) as Rule[];
}

/**
 * Best before/after examples: edited post drafts. Prefer ones on the same topic,
 * then ones whose published post performed well (results-weighted).
 */
export async function beforeAfterExamples(db: SupabaseClient, topic?: string, n = 3): Promise<Example[]> {
  const { data } = await db
    .from("review_items")
    .select("id, draft, final, context, post_id, edit_ratio, decided_at")
    .eq("item_type", "post_draft")
    .eq("status", "edited")
    .eq("held_out", false)
    .not("final", "is", null)
    .order("decided_at", { ascending: false })
    .limit(40);
  const rows = (data ?? []) as {
    id: string; draft: string; final: string; context: { topic?: string }; edit_ratio: number; post_id: string | null;
  }[];
  // Results-weighted: drafts that were published (linked on import) carry their post's impressions,
  // compared with the page's typical post. A well-performing edit is a better example.
  const linked = rows.map((r) => r.post_id).filter(Boolean) as string[];
  const perf = new Map<string, number>();
  let typical = 1;
  if (linked.length) {
    const { data: p } = await db.from("post_performance").select("post_id, impressions").in("post_id", linked);
    (p ?? []).forEach((x) => perf.set(x.post_id, x.impressions ?? 0));
    const { data: all } = await db.from("post_performance").select("impressions").eq("comparable", true).gte("published_date", "2025-01-01");
    const s = (all ?? []).map((x) => x.impressions ?? 0).sort((a, b) => a - b);
    typical = Math.max(1, s[Math.floor(s.length / 2)] ?? 1);
  }
  const score = (r: (typeof rows)[number]) =>
    (topic && r.context?.topic?.toLowerCase() === topic.toLowerCase() ? 2 : 0) +
    (r.post_id && perf.has(r.post_id) ? Math.min(1.5, perf.get(r.post_id)! / typical) : 0) + // results-weighted
    Math.min(0.5, r.edit_ratio ?? 0); // bigger edits teach more
  return rows
    .sort((a, b) => score(b) - score(a))
    .slice(0, n)
    .map((r) => ({ id: r.id, draft: r.draft, final: r.final, topic: r.context?.topic }));
}

/**
 * Rule extraction: an LLM reads recent edits and rejections and groups repeated
 * corrections into short, testable rules. Existing rules are passed in so it
 * does not duplicate them. New rules start active; the reviewer can switch them off.
 */
export async function extractRules(db: SupabaseClient, itemType: ItemType = "post_draft", actor?: string) {
  const { data: decisions } = await db
    .from("review_items")
    .select("id, status, draft, final, decision_reason, decision_note")
    .eq("item_type", itemType)
    .in("status", ["edited", "rejected"])
    .eq("held_out", false)
    .order("decided_at", { ascending: false })
    .limit(40);
  if (!decisions?.length) return { added: 0 };

  const { data: existing } = await db.from("rules").select("rule").eq("item_type", itemType);

  const SUBJECT: Record<ItemType, string> = {
    post_draft: "AI-written LinkedIn drafts",
    classification: 'AI-suggested labels for library material (written as "topic · objective")',
    objective_metrics: "AI-suggested objectives and success metrics for posts",
    insight: "AI-written performance insights",
  };
  const words = (s: string | null) => (s ?? "").trim().split(/\s+/).filter(Boolean).length;
  const tags = (s: string | null) => ((s ?? "").match(/#[\p{L}\p{N}_]+/gu) ?? []).length;
  const log = decisions
    .map((d, i) =>
      d.status === "edited"
        ? `#${i} EDITED (words ${words(d.draft)} → ${words(d.final)}, hashtags ${tags(d.draft)} → ${tags(d.final)})\nDRAFT: ${d.draft}\nFINAL: ${d.final}`
        : `#${i} REJECTED reason=${d.decision_reason} note=${d.decision_note ?? ""}\nDRAFT: ${d.draft}`,
    )
    .join("\n\n---\n\n");

  const out = await chatJSON<{ rules: { rule: string; rationale: string; evidence: number[] }[] }>([
    {
      role: "system",
      content:
        `You study how a marketing manager corrects ${SUBJECT[itemType]} and turn REPEATED corrections into house rules. ` +
        "Only propose a rule if at least 2 decisions support it. Look at structural edits as well as wording: " +
        "length (count words in DRAFT vs FINAL), the opening line, the ending, hashtags, links, claims, tone and labels. " +
        'Each rule is one short imperative sentence (e.g. "Do not open with a question."). ' +
        "For a rule about a quantity, use the FINAL counts (in brackets) of the decisions that support THAT rule: the number the reviewer cut down to " +
        "(e.g. drafts with 8-10 hashtags cut to 3 → \"at most 3 hashtags\"; drafts of 300 words cut to 110-140 → \"under 150 words\"). Never use the draft's numbers. " +
        "Never duplicate an existing rule. " +
        'Return JSON: {"rules":[{"rule":"…","rationale":"what the reviewer kept doing, in one sentence","evidence":[decision numbers, e.g. 3, 7]}]}. ' +
        'Return {"rules":[]} if nothing repeats.',
    },
    {
      role: "user",
      content: `EXISTING RULES:\n${(existing ?? []).map((r) => "- " + r.rule).join("\n") || "(none)"}\n\nDECISIONS:\n${log}`,
    },
  ], { maxTokens: 6000, thinking: false }); // strong model, no thinking: keeps this under Vercel's time limit

  const fresh = (out.rules ?? []).filter((r) => r.rule && (r.evidence?.length ?? 0) >= 2).slice(0, 8);
  if (!fresh.length) return { added: 0 };
  const { data: inserted } = await db
    .from("rules")
    .insert(
      fresh.map((r) => ({
        item_type: itemType,
        rule: r.rule,
        rationale: r.rationale,
        evidence_ids: r.evidence.map((n) => decisions[Number(n)]?.id).filter(Boolean),
        origin: "extracted",
      })),
    )
    .select("id, rule");
  await db.from("events").insert({
    actor: actor ?? null,
    action: "rules.extracted",
    target_type: "rules",
    detail: { count: inserted?.length ?? 0, rules: inserted?.map((r) => r.rule) },
  });
  return { added: inserted?.length ?? 0 };
}

/** Which ladder level an item type has EARNED (the reviewer still decides whether to move it). */
export function earnedLevel(stats: { decided: number; approved_unedited: number }, maxLevel: number) {
  const rate = stats.decided ? stats.approved_unedited / stats.decided : 0;
  const level1 = stats.decided >= AUTONOMY.level1MinItems && rate >= AUTONOMY.level1MinUneditedRate;
  return { rate, eligible: Math.min(level1 ? 1 : 0, maxLevel) };
}

/** Prompt block: active rules + examples. Empty string when learning is off. */
export function learningBlock(rules: Rule[], examples: Example[]): string {
  const parts: string[] = [];
  if (rules.length)
    parts.push("HOUSE RULES (learned from the reviewer, follow all of them):\n" + rules.map((r) => `- ${r.rule}`).join("\n"));
  if (examples.length)
    parts.push(
      "HOW THE REVIEWER EDITS YOUR DRAFTS (match the FINAL style, not the DRAFT):\n" +
        examples.map((e, i) => `Example ${i + 1}\nDRAFT: ${e.draft}\nFINAL: ${e.final}`).join("\n\n"),
    );
  return parts.join("\n\n");
}
