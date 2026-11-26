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
    id: string; draft: string; final: string; context: { topic?: string; impressions?: number }; edit_ratio: number;
  }[];
  const score = (r: (typeof rows)[number]) =>
    (topic && r.context?.topic?.toLowerCase() === topic.toLowerCase() ? 2 : 0) +
    Math.min(1, (r.context?.impressions ?? 0) / 1000) + // results-weighted
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

  const log = decisions
    .map((d, i) =>
      d.status === "edited"
        ? `#${i} EDITED\nDRAFT: ${d.draft}\nFINAL: ${d.final}`
        : `#${i} REJECTED reason=${d.decision_reason} note=${d.decision_note ?? ""}\nDRAFT: ${d.draft}`,
    )
    .join("\n\n---\n\n");

  const out = await chatJSON<{ rules: { rule: string; rationale: string; evidence: number[] }[] }>([
    {
      role: "system",
      content:
        "You study how a marketing manager corrects AI-written LinkedIn drafts and turn REPEATED corrections into house rules. " +
        "Only propose a rule if at least 2 decisions support it. Look at structural edits as well as wording: " +
        "length (count words in DRAFT vs FINAL), the opening line, the ending, hashtags, links, claims and tone. " +
        "Each rule is one short imperative sentence a writer can follow, with a number where the reviewer was consistent " +
        '(e.g. "Do not open with a question."). Never duplicate an existing rule. ' +
        'Return JSON: {"rules":[{"rule":"…","rationale":"what the reviewer kept doing, in one sentence","evidence":[decision numbers, e.g. 3, 7]}]}. ' +
        'Return {"rules":[]} if nothing repeats.',
    },
    {
      role: "user",
      content: `EXISTING RULES:\n${(existing ?? []).map((r) => "- " + r.rule).join("\n") || "(none)"}\n\nDECISIONS:\n${log}`,
    },
  ], { maxTokens: 10000 });

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
