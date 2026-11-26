import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { chatJSON } from "@/lib/ai";
import { OBJECTIVE_KEYS, type Objective } from "@/lib/domain";
import { activeRules, learningBlock } from "./learning";

/**
 * Classification at scale (Gate 1).
 * 1. A fixed topic list (taxonomy) keeps labels consistent, so "compare by topic" works.
 * 2. Posts are tagged in batches with the fast model. Objectives stay "inferred" until a person approves.
 */

export type Topic = { label: string; description: string };

export async function getTopics(db: SupabaseClient): Promise<Topic[]> {
  const { data } = await db.from("settings").select("value").eq("key", "topics").maybeSingle();
  return (data?.value?.topics ?? []) as Topic[];
}

/** Ask the model for 6–9 topics that cover the page's posts. Stored in settings.topics; editable later. */
export async function proposeTopics(db: SupabaseClient, sample: string[]): Promise<Topic[]> {
  const out = await chatJSON<{ topics: Topic[] }>([
    {
      role: "system",
      content:
        "You design a topic list for a company's LinkedIn posts. Propose 6 to 9 topics that together cover almost every post, " +
        "do not overlap, and would be useful for comparing performance. Labels are 1-3 words, Title Case. " +
        'Return JSON {"topics":[{"label":"…","description":"one sentence: what belongs here"}]}',
    },
    { role: "user", content: sample.map((s, i) => `${i + 1}. ${s.slice(0, 300).replace(/\s+/g, " ")}`).join("\n") },
  ]);
  const topics = (out.topics ?? []).slice(0, 9);
  await db.from("settings").upsert({ key: "topics", value: { topics } });
  return topics;
}

export type Tagged = { topic: string; objective: Objective; why: string };

/** Tag up to ~15 texts in one call. Unknown labels fall back to "Other". */
export async function tagBatch(db: SupabaseClient, topics: Topic[], texts: string[]): Promise<Tagged[]> {
  const rules = await activeRules(db, "classification");
  const out = await chatJSON<{ items: { i: number; topic: string; objective: string; why: string }[] }>(
    [
      {
        role: "system",
        content: [
          "Classify LinkedIn posts from a tech-talent company page.",
          `TOPICS (use the label exactly):\n${topics.map((t) => `- ${t.label}: ${t.description}`).join("\n")}\n- Other: fits none of the above`,
          `OBJECTIVES (the post's most likely intent): ${OBJECTIVE_KEYS.join(", ")}.`,
          "awareness = visibility, thought_leadership = expertise/opinion, engagement = invites interaction, lead_generation = drives enquiries or applications, campaign = promotes a specific event, intake or hiring drive.",
          learningBlock(rules, []),
          'Return JSON {"items":[{"i":<post number>,"topic":"<label>","objective":"<key>","why":"max 12 words"}]} with one item per post.',
        ].filter(Boolean).join("\n\n"),
      },
      { role: "user", content: texts.map((t, i) => `#${i} ${t.slice(0, 600).replace(/\s+/g, " ")}`).join("\n\n") },
    ],
    { tier: "fast", maxTokens: 2500, temperature: 0.2 },
  );
  const labels = new Set(topics.map((t) => t.label));
  return texts.map((_, i) => {
    const r = out.items?.find((x) => Number(x.i) === i);
    return {
      topic: r && labels.has(r.topic) ? r.topic : "Other",
      objective: (r && OBJECTIVE_KEYS.includes(r.objective as Objective) ? r.objective : "awareness") as Objective,
      why: r?.why ?? "",
    };
  });
}
