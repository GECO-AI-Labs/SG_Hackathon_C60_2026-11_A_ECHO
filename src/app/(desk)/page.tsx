import type { Metadata } from "next";
import { requireUser } from "@/lib/supabase/server";
import { DeskQueue, type QueueItem } from "@/components/echo/desk-queue";

export const metadata: Metadata = { title: "Desk" };

export default async function DeskPage({ searchParams }: { searchParams: Promise<{ item?: string }> }) {
  const { supabase } = await requireUser();
  const { item } = await searchParams;

  const [{ data: pending }, { data: recent }, { data: autonomy }, { data: topics }, { data: cls }] = await Promise.all([
    supabase
      .from("review_items")
      .select("*, parent:parent_id(title, final, draft), material:material_id(body, kind)")
      .eq("status", "pending")
      .eq("held_out", false)
      .order("created_at", { ascending: false })
      .limit(500),
    supabase
      .from("review_items")
      .select("id, title, gate, item_type, status, decided_at, edit_ratio, source, profiles:decided_by(display_name)")
      .in("status", ["approved", "edited", "rejected"])
      .eq("held_out", false)
      .order("decided_at", { ascending: false })
      .limit(8),
    supabase.from("autonomy").select("item_type, level"),
    supabase.from("settings").select("value").eq("key", "topics").maybeSingle(),
    supabase.from("trust_stats").select("decided, approved_unedited").eq("item_type", "classification").maybeSingle(),
  ]);

  return (
    <DeskQueue
      items={(pending ?? []) as QueueItem[]}
      recent={(recent ?? []) as unknown as RecentRow[]}
      initialId={item}
      batchTypes={(autonomy ?? []).filter((a) => a.level >= 1).map((a) => a.item_type)}
      topics={((topics?.value?.topics ?? []) as { label: string }[]).map((t) => t.label)}
      classificationProgress={{ decided: Number(cls?.decided ?? 0), unedited: Number(cls?.approved_unedited ?? 0) }}
    />
  );
}

export type RecentRow = {
  id: string; title: string; gate: number; item_type: string; status: string; decided_at: string;
  edit_ratio: number | null; source: string; profiles: { display_name: string } | null;
};
