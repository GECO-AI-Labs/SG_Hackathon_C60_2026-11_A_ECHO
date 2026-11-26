/**
 * Proof that ECHO improves: for each HELD-OUT seeded decision, draft the same brief
 * twice (without learning, then with rules + examples). Count the pre-flight checks
 * each draft fails (question opener, >3 hashtags, hype words, no link, too long),
 * i.e. the corrections the reviewer kept making. Fewer = less reviewer work.
 * Result is saved to settings.learning_proof and charted on the Ledger page.
 *   npm run proof
 */
import { adminClient, log } from "./_env";
import { generateDraft } from "@/lib/echo/draft";
import { extractRules } from "@/lib/echo/learning";
import { runChecks } from "@/lib/echo/checks";

async function main() {
  const db = adminClient();

  const { count } = await db.from("rules").select("id", { count: "exact", head: true });
  if (!count) {
    log("no rules yet → extracting from review history…");
    const r = await extractRules(db, "post_draft");
    log(`extracted ${r.added} rules`);
  }

  const { data: held } = await db
    .from("review_items")
    .select("id, title, brief, final, context")
    .eq("held_out", true)
    .eq("status", "edited");
  if (!held?.length) throw new Error("No held-out decisions. Run npm run seed:synthetic first.");

  // Whole-number tallies for the Ledger: drafts written and rule breaks per check type.
  const tally = { without: { drafts: 0, breaks: {} as Record<string, number> }, with: { drafts: 0, breaks: {} as Record<string, number> } };
  const rows: { topic: string; pattern?: string; without: number; with: number; item_ids: Record<string, string> }[] = [];
  // LLM output varies, so each brief is drafted RUNS times per mode and averaged.
  const RUNS = Number(process.env.PROOF_RUNS ?? 3);
  await db.from("review_items").delete().eq("held_out", true).eq("status", "superseded"); // previous proof drafts

  for (const h of held) {
    const jobs = [false, true].flatMap((withLearning) =>
      Array.from({ length: RUNS }, () =>
        generateDraft(db, { brief: h.brief!, withLearning, heldOut: true }).then((id) => ({ id, withLearning })),
      ),
    );
    const made = await Promise.all(jobs);
    const ids = made.map((m) => m.id);
    const { data: drafts } = await db.from("review_items").select("id, payload").in("id", ids);
    // Average failed checks across every version of every run in that mode.
    const fails = (withLearning: boolean) => {
      const vs = made
        .filter((m) => m.withLearning === withLearning)
        .flatMap((m) => (drafts!.find((x) => x.id === m.id)!.payload.versions ?? []) as { clean: string }[]);
      const t = tally[withLearning ? "with" : "without"];
      let total = 0;
      for (const v of vs) {
        t.drafts++;
        for (const c of runChecks(v.clean)) if (!c.pass) { t.breaks[c.id] = (t.breaks[c.id] ?? 0) + 1; total++; }
      }
      return total / Math.max(1, vs.length);
    };
    const without = fails(false);
    const withL = fails(true);
    rows.push({ topic: h.title, pattern: h.context?.pattern, without: +without.toFixed(2), with: +withL.toFixed(2), item_ids: Object.fromEntries(made.map((m, i) => [`${m.withLearning}-${i}`, m.id])) });
    log(`${h.title.slice(0, 40).padEnd(40)} failed checks without ${without.toFixed(2)}  with ${withL.toFixed(2)}`);
    // These proof drafts are not for the queue.
    await db.from("review_items").update({ status: "superseded" }).in("id", ids);
  }

  const avg = (k: "with" | "without") => +(rows.reduce((s, r) => s + r[k], 0) / rows.length).toFixed(2);
  const result = { run_at: new Date().toISOString(), metric: "failed pre-flight checks per draft (0-5)", runs_per_brief: RUNS, briefs: rows.length,
    drafts: tally.without.drafts,
    breaks_without: Object.values(tally.without.breaks).reduce((a, b) => a + b, 0),
    breaks_with: Object.values(tally.with.breaks).reduce((a, b) => a + b, 0),
    by_check: runChecks("").map((c) => ({ id: c.id, label: c.label, without: tally.without.breaks[c.id] ?? 0, with: tally.with.breaks[c.id] ?? 0 })),
    avg_without: avg("without"), avg_with: avg("with"), rows };
  await db.from("settings").upsert({ key: "learning_proof", value: result });
  log(`average failed checks: without ${result.avg_without} → with ${result.avg_with}`);
}

main().catch((e) => {
  console.error("✗", e.message ?? e);
  process.exit(1);
});
