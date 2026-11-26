"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient, requireUser } from "@/lib/supabase/server";
import { editRatio, levenshtein } from "@/lib/edit";
import { generateDraft } from "@/lib/echo/draft";
import { extractRules } from "@/lib/echo/learning";
import { classifyMaterial, generateInsights, recommendMetrics } from "@/lib/echo/analyse";
import { addMaterial, searchLibrary } from "@/lib/echo/library";
import { OBJECTIVE_KEYS, type Objective, type RejectReason } from "@/lib/domain";

/* ───────────── Auth ───────────── */

export async function signIn(_: unknown, form: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: String(form.get("email")),
    password: String(form.get("password")),
  });
  // Return the email so the form can keep it (React resets forms after an action).
  if (error) return { error: "That email and password don't match.", email: String(form.get("email") ?? "") };
  redirect("/");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

/* ───────────── Library ───────────── */

export async function searchAction(query: string) {
  const { supabase } = await requireUser();
  return searchLibrary(supabase, query, { k: 12, approvedOnly: false });
}

/** Add pasted text or an uploaded file's extracted text to the library, then classify it (Gate 1). */
export async function addMaterialAction(input: { title: string; kind: string; body: string; filePath?: string | null }) {
  const { supabase, user } = await requireUser();
  const id = await addMaterial(supabase, {
    kind: input.kind,
    title: input.title,
    body: input.body,
    file_path: input.filePath ?? null,
    created_by: user.id,
    library_status: "pending",
  });
  await supabase.from("events").insert({ actor: user.id, action: "library.added", target_type: "material", target_id: id, detail: { title: input.title } });
  await classifyMaterial(supabase, id, user.id);
  revalidatePath("/library");
  revalidatePath("/");
  return id;
}

/* ───────────── Drafting (Gate 2) ───────────── */

export async function draftAction(input: { brief: string; objective: string | null; format: string | null; recommendationId?: string | null }) {
  const { supabase, user } = await requireUser();
  const objective = input.objective && OBJECTIVE_KEYS.includes(input.objective as Objective) ? (input.objective as Objective) : null;
  const id = await generateDraft(supabase, {
    brief: input.brief,
    objective,
    format: input.format ?? undefined,
    recommendationId: input.recommendationId ?? null,
    actor: user.id,
  });
  await supabase.from("events").insert({ actor: user.id, action: "draft.created", target_type: "review_item", target_id: id });
  revalidatePath("/");
  return id;
}

/* ───────────── Decisions (all gates) ───────────── */

type Decision =
  | { kind: "approve"; versionIndex?: number }
  | { kind: "edit"; final: string; versionIndex?: number; objective?: Objective }
  | { kind: "reject"; reason: RejectReason; note?: string }
  | { kind: "another_angle"; note?: string };

/**
 * One function records every reviewer decision: who, when, what changed, why.
 * This row IS the learning signal.
 */
export async function decide(itemId: string, decision: Decision, openedAt: number) {
  const { supabase, user } = await requireUser();
  const { data: item, error } = await supabase.from("review_items").select("*").eq("id", itemId).single();
  if (error || !item) throw new Error("Item not found");
  if (item.status !== "pending") throw new Error("This item was already decided.");

  const seconds = Math.max(1, Math.round((Date.now() - openedAt) / 1000));
  const versions = (item.payload?.versions ?? []) as { clean: string }[];
  const vi = "versionIndex" in decision ? (decision.versionIndex ?? 0) : 0;
  const draft = versions[vi]?.clean ?? item.draft ?? "";

  let patch: Record<string, unknown> = { decided_by: user.id, decided_at: new Date().toISOString(), seconds_to_decide: seconds, draft };

  if (decision.kind === "approve") {
    patch = { ...patch, status: "approved", final: draft, edit_distance: 0, edit_ratio: 0 };
  } else if (decision.kind === "edit") {
    const final = decision.final.trim();
    const unchanged = final === draft.trim();
    patch = {
      ...patch,
      status: unchanged ? "approved" : "edited",
      final,
      edit_distance: levenshtein(draft, final),
      edit_ratio: Number(editRatio(draft, final).toFixed(4)),
    };
    // The reviewer picked a different objective while editing: that counts as confirming it.
    if (decision.objective && decision.objective !== item.payload?.objective)
      patch.payload = { ...item.payload, objective: decision.objective, objective_status: "confirmed" };
  } else {
    patch = {
      ...patch,
      status: "rejected",
      decision_reason: decision.kind === "another_angle" ? "wrong_angle" : decision.reason,
      decision_note: decision.note ?? null,
    };
  }

  const { error: upErr } = await supabase.from("review_items").update(patch).eq("id", itemId);
  if (upErr) throw upErr;
  await supabase.from("events").insert({
    actor: user.id,
    action: `review.${patch.status}`,
    target_type: item.item_type,
    target_id: itemId,
    detail: { gate: item.gate, title: item.title, seconds, edit_ratio: patch.edit_ratio ?? null, reason: patch.decision_reason ?? null },
  });

  // Side effects per gate, applied only after a person approved.
  const approved = patch.status === "approved" || patch.status === "edited";
  if (approved && item.item_type === "classification" && item.material_id) {
    // final is "topic · objective"; an edit may have changed either.
    const [topic] = String(patch.final ?? item.draft ?? "").split(" · ");
    const objective = (decision.kind === "edit" && decision.objective) || item.payload?.objective;
    const labels = { topic: topic || item.payload?.topic, objective, objective_status: "confirmed" };
    await supabase.from("materials").update({ ...labels, library_status: "approved" }).eq("id", item.material_id);
    if (item.post_id) await supabase.from("posts").update(labels).eq("post_id", item.post_id);
  }
  if (approved && item.item_type === "post_draft") {
    // Gate 2 passed → ask the manager to confirm objective + success metrics (Gate 3).
    const objective = ((decision.kind === "edit" && decision.objective) || item.payload?.objective || "awareness") as Objective;
    const rec = recommendMetrics(objective);
    await supabase.from("review_items").insert({
      gate: 3,
      item_type: "objective_metrics",
      title: `Success metrics: ${item.title}`,
      reason: item.payload?.objective_status === "confirmed" ? "Objective set in the brief" : "Objective inferred by ECHO",
      draft: `${objective}: ${rec.primary.join(", ")} (+ ${rec.supporting.join(", ")})`,
      payload: {
        ...rec,
        objective_status: (patch.payload as { objective_status?: string } | undefined)?.objective_status ?? item.payload?.objective_status ?? "inferred",
        post_item_id: itemId,
      },
      context: item.context,
      parent_id: itemId,
      created_by: user.id,
    });
  }
  if (decision.kind === "another_angle" && item.item_type === "post_draft") {
    await generateDraft(supabase, {
      brief: `${item.brief}\n\nThe reviewer rejected the previous angle${decision.note ? `: ${decision.note}` : ""}. Try a clearly different angle.`,
      objective: item.payload?.objective_status === "confirmed" ? item.payload.objective : null,
      format: item.payload?.format ?? undefined,
      parentId: itemId,
      actor: user.id,
    });
  }

  revalidatePath("/");
  revalidatePath("/ledger");
}

/* ───────────── Learning ───────────── */

export async function extractRulesAction() {
  const { supabase, user } = await requireUser();
  // Learn from post edits and from classification corrections.
  const a = await extractRules(supabase, "post_draft", user.id);
  const b = await extractRules(supabase, "classification", user.id);
  revalidatePath("/ledger");
  return { added: a.added + b.added };
}

export async function toggleRule(id: string, active: boolean) {
  const { supabase, user } = await requireUser();
  await supabase.from("rules").update({ active, updated_by: user.id, updated_at: new Date().toISOString() }).eq("id", id);
  await supabase.from("events").insert({ actor: user.id, action: active ? "rule.enabled" : "rule.disabled", target_type: "rule", target_id: id });
  revalidatePath("/ledger");
}

export async function setAutonomy(itemType: string, level: number) {
  const { supabase, user } = await requireUser();
  const { error } = await supabase.from("autonomy").update({ level, updated_by: user.id, updated_at: new Date().toISOString() }).eq("item_type", itemType);
  if (error) throw new Error("That level is not allowed for this item type.");
  await supabase.from("events").insert({ actor: user.id, action: "autonomy.changed", target_type: "autonomy", target_id: itemType, detail: { level } });
  revalidatePath("/ledger");
}

/* ───────────── Insights (Gate 4) ───────────── */

export async function insightsAction(question?: string) {
  const { supabase, user } = await requireUser();
  const n = await generateInsights(supabase, user.id, question);
  revalidatePath("/");
  return n;
}

/** Level 1 autonomy: approve several low-risk items in one tap. Each still gets its own audit row. */
export async function decideMany(ids: string[]) {
  const { supabase, user } = await requireUser();
  const { data: auto } = await supabase.from("autonomy").select("item_type, level");
  const allowed = (auto ?? []).filter((a) => a.level >= 1 && a.item_type !== "post_draft").map((a) => a.item_type); // posts: always one by one
  const { data: rows } = await supabase
    .from("review_items")
    .select("id, item_type, title, draft, payload, material_id, post_id")
    .in("id", ids)
    .eq("status", "pending")
    .in("item_type", allowed);
  if (!rows?.length) return 0;

  // One bulk update for the queue, one audit row per item (each decision is still traceable).
  const at = new Date().toISOString();
  await supabase
    .from("review_items")
    .update({ status: "approved", decided_by: user.id, decided_at: at, edit_distance: 0, edit_ratio: 0, seconds_to_decide: null })
    .in("id", rows.map((r) => r.id));
  await supabase.from("events").insert(
    rows.map((r) => ({ actor: user.id, action: "review.approved", target_type: r.item_type, target_id: r.id, detail: { gate: 1, title: r.title, batch: true } })),
  );

  // Apply the approved labels, grouped so it is a handful of calls, not hundreds.
  const groups = new Map<string, { topic: string; objective: string; materials: string[]; posts: string[] }>();
  for (const r of rows.filter((x) => x.item_type === "classification")) {
    const k = `${r.payload?.topic}|${r.payload?.objective}`;
    const g = groups.get(k) ?? { topic: r.payload?.topic, objective: r.payload?.objective, materials: [] as string[], posts: [] as string[] };
    if (r.material_id) g.materials.push(r.material_id);
    if (r.post_id) g.posts.push(r.post_id);
    groups.set(k, g);
  }
  for (const g of groups.values()) {
    const labels = { topic: g.topic, objective: g.objective, objective_status: "confirmed" };
    if (g.materials.length) await supabase.from("materials").update({ ...labels, library_status: "approved" }).in("id", g.materials);
    if (g.posts.length) await supabase.from("posts").update(labels).in("post_id", g.posts);
  }
  revalidatePath("/");
  revalidatePath("/ledger");
  return rows.length;
}

/** Upload a file (PDF, DOCX, PPTX, TXT, MD) or pasted text into the library. Text is extracted, embedded, then classified (Gate 1). */
export async function uploadMaterialAction(form: FormData) {
  const { supabase, user } = await requireUser();
  const kind = String(form.get("kind") || "other");
  const file = form.get("file") as File | null;
  let title = String(form.get("title") || "").trim();
  let body = String(form.get("body") || "").trim();
  let filePath: string | null = null;

  if (file && file.size > 0) {
    if (file.size > 10 * 1024 * 1024) throw new Error("Files up to 10 MB, please.");
    const buf = Buffer.from(await file.arrayBuffer());
    const name = file.name.toLowerCase();
    if (name.endsWith(".pdf")) {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(buf));
      body = (await extractText(pdf, { mergePages: true })).text as string;
    } else if (name.endsWith(".docx")) {
      const mammoth = await import("mammoth");
      body = (await mammoth.extractRawText({ buffer: buf })).value;
    } else if (name.endsWith(".pptx")) {
      // Decks: officeparser reads every slide's text (and speaker notes).
      const { parseOffice } = await import("officeparser");
      const ast = await parseOffice(buf);
      body = String((await ast.to("text")).value ?? "");
    } else if (/\.(txt|md|markdown|csv)$/.test(name)) {
      body = buf.toString("utf8");
    } else {
      throw new Error("Supported files: PDF, Word (DOCX), PowerPoint (PPTX), TXT, MD.");
    }
    filePath = `${user.id}/${Date.now()}-${file.name.replace(/[^\w.-]+/g, "_")}`;
    await supabase.storage.from("library").upload(filePath, buf, { contentType: file.type || undefined });
    title ||= file.name.replace(/\.[^.]+$/, "");
  }
  body = body.replace(/\u0000/g, "").toWellFormed().trim();
  if (body.length < 40) throw new Error("Not enough text to add. Paste at least a few sentences.");
  return addMaterialAction({ title: title || body.slice(0, 60), kind, body, filePath });
}

/* ───────────── Performance upload (CSV) ───────────── */

/** dryRun = true returns the match report without saving, so the manager can check before importing. */
export async function uploadPerformanceAction(rows: Record<string, string>[], asOf: string, dryRun = false) {
  const { supabase, user } = await requireUser();
  const { ingestPosts } = await import("@/lib/echo/ingest");
  const report = await ingestPosts(supabase, rows, { asOf, via: "csv", dryRun });
  if (!dryRun) {
    await supabase.from("events").insert({ actor: user.id, action: "ingest.csv", target_type: "posts", detail: report });
    revalidatePath("/signals");
  }
  return report;
}

/* ───────────── Conversational refinement (Gate 2) ───────────── */

export async function refineAction(itemId: string, versionIndex: number, instruction: string) {
  const { supabase, user } = await requireUser();
  const { refineDraft } = await import("@/lib/echo/draft");
  const idx = await refineDraft(supabase, itemId, versionIndex, instruction.trim().slice(0, 300), user.id);
  await supabase.from("events").insert({ actor: user.id, action: "draft.refined", target_type: "review_item", target_id: itemId, detail: { instruction } });
  revalidatePath("/");
  return idx;
}

/* ───────────── Ask ECHO (Signals) ───────────── */

export async function askAction(question: string) {
  const { supabase, user } = await requireUser();
  const { answerQuestion } = await import("@/lib/echo/analyse");
  const a = await answerQuestion(supabase, question.slice(0, 500));
  await supabase.from("events").insert({ actor: user.id, action: "question.asked", detail: { question } });
  return a;
}

/** Turn an answer into a Gate 4 insight card, without another AI call. */
export async function saveAnswerAsInsight(question: string, a: Awaited<ReturnType<typeof askAction>>) {
  const { supabase, user } = await requireUser();
  const { headline } = await import("@/lib/edit");
  const { error } = await supabase.from("review_items").insert({
    gate: 4, item_type: "insight", title: headline(a.observed_trend || a.answer, 110), reason: `Answer to: “${question}”`, brief: question,
    draft: a.recommendation, payload: a, context: { objective: a.objective }, created_by: user.id,
  });
  if (error) throw error;
  revalidatePath("/");
}
