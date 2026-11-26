/**
 * Classify every LinkedIn post in the library by topic and objective (Gate 1, at scale).
 *   npm run classify             → tag untagged posts, queue Gate 1 items for posts with stats
 *   npm run classify -- --retopic → propose a fresh topic list first (re-tags everything)
 * Objectives are saved as "inferred". A reviewer approves them on the Desk, which is what
 * lets the "classification" item type earn Level 1 (batch approval) on the autonomy ladder.
 */
import { adminClient, log } from "./_env";
import { getTopics, proposeTopics, tagBatch } from "@/lib/echo/classify";

const BATCH = 15;

async function main() {
  const db = adminClient();
  const retopic = process.argv.includes("--retopic");

  const { data: mats } = await db
    .from("materials")
    .select("id, title, body, post_id, topic")
    .eq("kind", "linkedin_post")
    .order("published_date", { ascending: false });
  if (!mats?.length) throw new Error("No posts in the library. Run npm run load:data -- --embed first.");

  let topics = retopic ? [] : await getTopics(db);
  if (!topics.length) {
    const step = Math.max(1, Math.floor(mats.length / 80));
    topics = await proposeTopics(db, mats.filter((_, i) => i % step === 0).map((m) => m.body));
    log(`topics: ${topics.map((t) => t.label).join(" · ")}`);
  }

  const todo = retopic ? mats : mats.filter((m) => !m.topic);
  log(`tagging ${todo.length} posts…`);
  const { data: withStats } = await db.from("post_metrics").select("post_id");
  const statIds = new Set((withStats ?? []).map((r) => r.post_id));

  // Run 4 batches at a time.
  const batches = Array.from({ length: Math.ceil(todo.length / BATCH) }, (_, i) => todo.slice(i * BATCH, (i + 1) * BATCH));
  let done = 0;
  for (let i = 0; i < batches.length; i += 4) {
    await Promise.all(
      batches.slice(i, i + 4).map(async (batch) => {
        const tags = await tagBatch(db, topics, batch.map((m) => m.body));
        for (let j = 0; j < batch.length; j++) {
          const m = batch[j], t = tags[j];
          await db.from("materials").update({ topic: t.topic, objective: t.objective, objective_status: "inferred", tags: [t.topic.toLowerCase()] }).eq("id", m.id);
          if (m.post_id) await db.from("posts").update({ topic: t.topic, objective: t.objective, objective_status: "inferred" }).eq("post_id", m.post_id);
          // Only posts with performance data go to the Desk: those are the ones the dashboard compares.
          if (m.post_id && statIds.has(m.post_id)) {
            await db.from("review_items").delete().eq("material_id", m.id).eq("item_type", "classification").eq("status", "pending");
            await db.from("review_items").insert({
              gate: 1, item_type: "classification", title: m.title, reason: "Bulk classification of past posts",
              draft: `${t.topic} · ${t.objective}`, payload: { topic: t.topic, tags: [t.topic.toLowerCase()], objective: t.objective, why: t.why },
              context: { topic: t.topic, objective: t.objective, kind: "linkedin_post" }, material_id: m.id, post_id: m.post_id,
            });
          }
        }
        done += batch.length;
        process.stdout.write(`\r› tagged ${done}/${todo.length}`);
      }),
    );
  }
  console.log();
  const { data: counts } = await db.from("posts").select("topic");
  const c: Record<string, number> = {};
  (counts ?? []).forEach((p) => p.topic && (c[p.topic] = (c[p.topic] ?? 0) + 1));
  log(Object.entries(c).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(" · "));
}

main().catch((e) => {
  console.error("✗", e.message ?? e);
  process.exit(1);
});
