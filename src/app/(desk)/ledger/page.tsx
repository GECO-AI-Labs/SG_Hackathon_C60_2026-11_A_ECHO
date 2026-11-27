import type { Metadata } from "next";
import { requireUser } from "@/lib/supabase/server";
import { earnedLevel } from "@/lib/echo/learning";
import { LedgerView } from "@/components/echo/ledger-view";

export const metadata: Metadata = { title: "Ledger" };

export default async function LedgerPage() {
  const { supabase } = await requireUser();
  const [{ data: stats }, { data: autonomy }, { data: rules }, { data: proof }, { data: decisions }, { data: events }] = await Promise.all([
    supabase.from("trust_stats").select("*"),
    supabase.from("autonomy").select("*"),
    // Rules extracted together share a timestamp: order by id as well so the list never reshuffles.
    supabase.from("rules").select("id, item_type, rule, rationale, active, origin, evidence_ids, created_at").order("created_at").order("id"),
    supabase.from("settings").select("value").eq("key", "learning_proof").maybeSingle(),
    supabase
      .from("review_items")
      .select("item_type, status, edit_ratio, decided_at")
      .in("status", ["approved", "edited", "rejected"])
      .eq("held_out", false)
      .order("decided_at"),
    supabase
      .from("events")
      .select("id, action, target_type, target_id, detail, at, profiles:actor(display_name)")
      .order("at", { ascending: false })
      .limit(40),
  ]);

  // Approval trend for post drafts: share approved WITHOUT edits, per week.
  const weeks = new Map<string, { week: string; decided: number; unedited: number; edit: number; editN: number }>();
  for (const d of decisions ?? []) {
    if (d.item_type !== "post_draft" || !d.decided_at) continue;
    const dt = new Date(d.decided_at);
    dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7));
    const k = dt.toISOString().slice(0, 10);
    const w = weeks.get(k) ?? { week: k, decided: 0, unedited: 0, edit: 0, editN: 0 };
    w.decided++;
    if (d.status === "approved") w.unedited++;
    if (d.edit_ratio != null) { w.edit += Number(d.edit_ratio); w.editN++; }
    weeks.set(k, w);
  }
  const trend = [...weeks.values()].map((w) => ({
    week: w.week,
    approval: w.decided ? w.unedited / w.decided : 0,
    edit: w.editN ? w.edit / w.editN : 0,
    n: w.decided,
  }));

  const types = (autonomy ?? []).map((a) => {
    const s = (stats ?? []).find((x) => x.item_type === a.item_type) ?? { decided: 0, approved_unedited: 0, edited: 0, rejected: 0, avg_edit_ratio: null, avg_seconds: null };
    return { ...a, ...s, earned: earnedLevel({ decided: Number(s.decided), approved_unedited: Number(s.approved_unedited) }, a.max_level) };
  });

  return <LedgerView types={types} rules={rules ?? []} proof={proof?.value ?? null} trend={trend} events={(events ?? []) as never} />;
}
