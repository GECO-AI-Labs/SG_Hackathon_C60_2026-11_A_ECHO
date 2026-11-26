/**
 * Load SYNTHETIC data (data/synthetic/) into Supabase. Every row gets source = 'synthetic'.
 *   - reference materials (brochure, campaign brief, founder talk) → library, approved
 *   - 36 reviewer decisions → review history that seeds the learning loop
 *     5 of them are "held out": kept back for the before/after learning proof.
 * Safe to re-run: it deletes previous synthetic rows first.
 *   npm run seed:synthetic
 */
import fs from "node:fs";
import path from "node:path";
import { adminClient, log } from "./_env";
import { addMaterial } from "@/lib/echo/library";
import { editRatio, levenshtein } from "@/lib/edit";

const DIR = "data/synthetic";

function frontmatter(md: string) {
  const m = md.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return { meta: {} as Record<string, string>, body: md };
  const meta = Object.fromEntries(
    m[1].split("\n").map((l) => {
      const i = l.indexOf(":");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")];
    }),
  );
  return { meta, body: m[2].trim() };
}

async function main() {
  const db = adminClient();

  // Clean previous synthetic rows (materials cascade to chunks).
  await db.from("review_items").delete().eq("source", "synthetic");
  await db.from("materials").delete().eq("source", "synthetic");

  for (const f of fs.readdirSync(path.join(DIR, "materials")).filter((f) => f.endsWith(".md"))) {
    const { meta, body } = frontmatter(fs.readFileSync(path.join(DIR, "materials", f), "utf8"));
    await addMaterial(db, {
      kind: meta.kind ?? "other",
      title: meta.title ?? f,
      body,
      source: "synthetic",
      library_status: "approved",
      file_path: `synthetic/${f}`,
    });
    log(`material: ${meta.title}`);
  }

  const { decisions } = JSON.parse(fs.readFileSync(path.join(DIR, "review_decisions.json"), "utf8")) as {
    decisions: { topic: string; pattern: string; status: string; draft: string; final: string | null; decision_reason: string | null; decision_note: string | null }[];
  };

  // Spread decisions over the last 6 weeks, oldest first. Hold out one per edit pattern (5 total).
  const heldPatterns = new Set<string>();
  const now = Date.now();
  const rows = decisions.map((d, i) => {
    const held = d.status === "edited" && !heldPatterns.has(d.pattern) && heldPatterns.add(d.pattern) !== undefined;
    const decidedAt = new Date(now - (42 - i) * 86_400_000 + (i % 5) * 3_600_000);
    return {
      gate: 2,
      item_type: "post_draft",
      status: d.status,
      title: d.topic.charAt(0).toUpperCase() + d.topic.slice(1),
      reason: "Seed history (synthetic)",
      brief: `Write a LinkedIn post about ${d.topic}.`,
      draft: d.draft,
      final: d.final,
      edit_distance: d.final ? levenshtein(d.draft, d.final) : null,
      edit_ratio: d.final ? Number(editRatio(d.draft, d.final).toFixed(4)) : null,
      decision_reason: d.decision_reason,
      decision_note: d.decision_note,
      decided_at: decidedAt.toISOString(),
      created_at: new Date(decidedAt.getTime() - 3_600_000).toISOString(),
      seconds_to_decide: 40 + ((i * 37) % 200),
      context: { topic: d.topic, pattern: d.pattern },
      payload: { versions: [{ angle: "seed", marked: d.draft, clean: d.draft }] },
      held_out: held,
      source: "synthetic",
    };
  });
  const { error } = await db.from("review_items").insert(rows);
  if (error) throw error;
  log(`review history: ${rows.length} decisions (${rows.filter((r) => r.held_out).length} held out for the learning proof)`);

  // Brand voice seed (editable later in the app).
  const { data: brand } = await db.from("settings").select("value").eq("key", "brand").maybeSingle();
  if (brand && !brand.value.voice) {
    await db.from("settings").update({
      value: {
        ...brand.value,
        voice: "Warm, direct and confident. Speak to career switchers as capable adults. Plain words over hype. Celebrate people, not the company. At most 3 hashtags.",
      },
    }).eq("key", "brand");
    log("brand voice: seeded");
  }
  log("done");
}

main().catch((e) => {
  console.error("✗", e.message ?? e);
  process.exit(1);
});
