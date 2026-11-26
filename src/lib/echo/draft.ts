import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { chatJSON } from "@/lib/ai";
import { OBJECTIVES, OBJECTIVE_KEYS, type Objective } from "@/lib/domain";
import { clip, headline } from "@/lib/edit";
import { searchLibrary, type Hit } from "./library";
import { activeRules, beforeAfterExamples, learningBlock } from "./learning";

export type DraftInput = {
  brief: string;
  objective?: Objective | null;   // null = let ECHO infer it (labelled "inferred")
  format?: string;                // e.g. "image", "multiImage", "text"
  recommendationId?: string | null; // an approved Gate 4 insight that shaped this post
  withLearning?: boolean;         // false = baseline, used for the before/after proof
  parentId?: string | null;       // "request another angle"
  actor?: string | null;
  heldOut?: boolean;
};

type Version = { angle: string; text: string };
type DraftJSON = {
  versions: Version[];
  suggested_objective: Objective;
  objective_reason: string;
  topic: string;
};

/** Strip [1] style markers for the copy the manager will actually post. */
export const stripCitations = (s: string) => s.replace(/\s?\[(\d+(?:,\s*\d+)*)\]/g, "").replace(/[ \t]+\n/g, "\n").trim();

export async function generateDraft(db: SupabaseClient, input: DraftInput) {
  const withLearning = input.withLearning ?? true;

  // 1. Retrieve: top library matches for the brief.
  const hits: Hit[] = await searchLibrary(db, input.brief, { k: 6 });

  // 2. Brand voice + optional recommendation that shaped this post.
  const { data: brand } = await db.from("settings").select("value").eq("key", "brand").maybeSingle();
  let recommendation = "";
  if (input.recommendationId) {
    const { data: rec } = await db.from("review_items").select("final, draft, title").eq("id", input.recommendationId).single();
    recommendation = rec ? `APPROVED RECOMMENDATION TO APPLY: ${rec.title}\n${rec.final ?? rec.draft}` : "";
  }

  // 3. Learning context (rules + before/after examples).
  const rules = withLearning ? await activeRules(db, "post_draft") : [];
  const examples = withLearning ? await beforeAfterExamples(db) : [];

  const sources = hits
    .map((h, i) => `[${i + 1}] (${h.kind}${h.published_date ? ", " + h.published_date : ""}) ${h.title}\n${h.content}`)
    .join("\n\n");

  const objectiveLine = input.objective
    ? `Objective (confirmed by the manager): ${OBJECTIVES[input.objective].label}: ${OBJECTIVES[input.objective].purpose}.`
    : `Objective: not given. Pick the best one from: ${OBJECTIVE_KEYS.join(", ")}.`;

  const system = [
    `You write LinkedIn posts for the company page "${brand?.value?.name ?? "our page"}".`,
    brand?.value?.description ? `About the company:\n${brand.value.description}` : "",
    brand?.value?.voice ? `Brand voice notes:\n${brand.value.voice}` : "",
    "Ground every factual statement in the SOURCES. After each sentence that uses a source, add its marker, e.g. [2]. " +
      "Never invent numbers, names, dates, awards, quotes or links that are not in the SOURCES. If the sources are thin, write a shorter post.",
    "Write 2 versions with clearly different angles. Plain text only, LinkedIn-ready, no markdown headings.",
    withLearning ? learningBlock(rules, examples) : "",
    'Return JSON: {"versions":[{"angle":"one line","text":"post with [n] markers"}],' +
      '"suggested_objective":"<objective key>","objective_reason":"one sentence","topic":"2-4 word topic"}',
  ]
    .filter(Boolean)
    .join("\n\n");

  const user = [
    `BRIEF: ${input.brief}`,
    objectiveLine,
    input.format ? `Format: ${input.format}` : "",
    recommendation,
    `SOURCES:\n${sources || "(no matching library material)"}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const out = await chatJSON<DraftJSON>([{ role: "system", content: system }, { role: "user", content: user }], {
    maxTokens: 8000,
  });

  const versions = (out.versions ?? []).slice(0, 3).map((v) => ({ angle: v.angle, marked: v.text, clean: stripCitations(v.text) }));
  if (!versions.length) throw new Error("The model returned no draft. Try again.");

  const usedNumbers = new Set(
    versions.flatMap((v) => [...v.marked.matchAll(/\[(\d+(?:,\s*\d+)*)\]/g)].flatMap((m) => m[1].split(/,\s*/).map(Number))),
  );
  const citations = hits.map((h, i) => ({
    n: i + 1,
    material_id: h.material_id,
    title: h.title,
    kind: h.kind,
    source: h.source,
    published_date: h.published_date,
    snippet: clip(h.content, 280),
    similarity: Number(h.similarity.toFixed(3)),
    used: usedNumbers.has(i + 1),
  }));

  const objective = input.objective ?? (OBJECTIVE_KEYS.includes(out.suggested_objective) ? out.suggested_objective : null);

  const { data, error } = await db
    .from("review_items")
    .insert({
      gate: 2,
      item_type: "post_draft",
      title: headline(input.brief),
      reason: input.recommendationId ? "Drafted from an approved recommendation" : "Drafted from your brief",
      brief: input.brief,
      draft: versions[0].clean,
      payload: {
        versions,
        objective,
        objective_status: input.objective ? "confirmed" : "inferred",
        objective_reason: out.objective_reason,
        format: input.format ?? null,
        recommendation_id: input.recommendationId ?? null,
      },
      citations,
      context: { topic: out.topic, objective, format: input.format ?? null },
      learning: { with_learning: withLearning, rule_ids: rules.map((r) => r.id), example_ids: examples.map((e) => e.id) },
      parent_id: input.parentId ?? null,
      held_out: input.heldOut ?? false,
      created_by: input.actor ?? null,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}
