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
  sourceId?: string | null;       // repurpose: a library item that must be used as source [1]
  withLearning?: boolean;         // false = baseline, used for the before/after proof
  parentId?: string | null;       // "request another angle"
  actor?: string | null;
  heldOut?: boolean;
  imagePath?: string | null;      // optional image (post-images bucket), travels with the draft
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

  // 1. Retrieve: top library matches for the brief. When repurposing, the chosen item comes first.
  let hits: Hit[] = await searchLibrary(db, input.brief, { k: 6 });
  let sourceTitle = "";
  if (input.sourceId) {
    const { data: src } = await db.from("materials").select("id, title, kind, source, post_id, published_date").eq("id", input.sourceId).single();
    const { data: chunks } = await db.from("material_chunks").select("id, content").eq("material_id", input.sourceId).order("chunk_index").limit(4);
    if (src && chunks?.length) {
      sourceTitle = src.title;
      const pinned: Hit[] = chunks.map((c) => ({
        chunk_id: c.id, material_id: src.id, title: src.title, kind: src.kind, source: src.source,
        post_id: src.post_id, published_date: src.published_date, content: c.content, similarity: 1,
      }));
      hits = [...pinned, ...hits.filter((h) => h.material_id !== src.id)].slice(0, 8);
    }
  }

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
      reason: sourceTitle ? `Repurposed from: ${clip(sourceTitle, 70)}` : input.recommendationId ? "Drafted from an approved recommendation" : "Drafted from your brief",
      brief: input.brief,
      draft: versions[0].clean,
      payload: {
        versions,
        objective,
        objective_status: input.objective ? "confirmed" : "inferred",
        objective_reason: out.objective_reason,
        format: input.format ?? null,
        recommendation_id: input.recommendationId ?? null,
        source_id: input.sourceId ?? null,
      },
      citations,
      context: { topic: out.topic, objective, format: input.format ?? null },
      learning: { with_learning: withLearning, rule_ids: rules.map((r) => r.id), example_ids: examples.map((e) => e.id) },
      parent_id: input.parentId ?? null,
      image_path: input.imagePath ?? null,
      held_out: input.heldOut ?? false,
      created_by: input.actor ?? null,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

/**
 * Conversational refinement: rewrite one version following the reviewer's instruction
 * ("shorter", "warmer", "new angle"…). Uses the SAME sources and active rules, keeps [n]
 * citations, and adds the result as a new version on the same Gate 2 item.
 */
export async function refineDraft(db: SupabaseClient, itemId: string, versionIndex: number, instruction: string, actor?: string) {
  const { data: item, error } = await db.from("review_items").select("*").eq("id", itemId).single();
  if (error || !item) throw new Error("Draft not found");
  if (item.status !== "pending" || item.item_type !== "post_draft") throw new Error("Only drafts waiting on the Desk can be refined.");

  const versions = (item.payload?.versions ?? []) as { angle: string; marked: string; clean: string }[];
  const base = versions[versionIndex] ?? versions[0];
  const cites = (item.citations ?? []) as { n: number; title: string; snippet: string }[];
  const rules = item.learning?.with_learning === false ? [] : await activeRules(db, "post_draft");

  const out = await chatJSON<{ text: string; angle: string }>(
    [
      {
        role: "system",
        content: [
          "You revise a LinkedIn post draft exactly as the reviewer asks. Change only what the instruction needs.",
          "Keep the [n] source markers on sentences that still use a source. Never add facts that are not in the SOURCES.",
          learningBlock(rules, []),
          'Return JSON {"text":"revised post with [n] markers","angle":"3-6 words describing this version"}',
        ].filter(Boolean).join("\n\n"),
      },
      {
        role: "user",
        content: `INSTRUCTION: ${instruction}\n\nDRAFT:\n${base.marked}\n\nSOURCES:\n${cites.map((c) => `[${c.n}] ${c.title}: ${c.snippet}`).join("\n")}`,
      },
    ],
    { tier: "fast", maxTokens: 2000, temperature: 0.6 },
  );
  if (!out.text?.trim()) throw new Error("The model returned an empty revision. Try again.");

  const next = { angle: clip(out.angle || instruction, 60), marked: out.text, clean: stripCitations(out.text), refined_from: versionIndex, instruction };
  const refinements = [...((item.payload?.refinements ?? []) as unknown[]), { instruction, from: versionIndex, to: versions.length, by: actor ?? null, at: new Date().toISOString() }];
  const { error: e2 } = await db
    .from("review_items")
    .update({ payload: { ...item.payload, versions: [...versions, next], refinements } })
    .eq("id", itemId);
  if (e2) throw e2;
  return versions.length; // index of the new version
}
