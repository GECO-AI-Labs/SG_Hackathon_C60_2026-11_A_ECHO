import type { Metadata } from "next";
import { requireUser } from "@/lib/supabase/server";
import { DeskQueue, type QueueItem } from "@/components/echo/desk-queue";

export const metadata: Metadata = { title: "Desk" };

export default async function DeskPage({ searchParams }: { searchParams: Promise<{ item?: string }> }) {
  const { supabase } = await requireUser();
  const { item } = await searchParams;

  const [{ data: pending }, { data: recent }, { data: autonomy }] = await Promise.all([
    supabase
      .from("review_items")
      .select("*")
      .eq("status", "pending")
      .eq("held_out", false)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("review_items")
      .select("id, title, gate, item_type, status, decided_at, edit_ratio, source, profiles:decided_by(display_name)")
      .in("status", ["approved", "edited", "rejected"])
      .eq("held_out", false)
      .order("decided_at", { ascending: false })
      .limit(8),
    supabase.from("autonomy").select("item_type, level"),
  ]);

  return (
    <DeskQueue
      items={(pending ?? []) as QueueItem[]}
      recent={(recent ?? []) as unknown as RecentRow[]}
      initialId={item}
      batchTypes={(autonomy ?? []).filter((a) => a.level >= 1).map((a) => a.item_type)}
    />
  );
}

export type RecentRow = {
  id: string; title: string; gate: number; item_type: string; status: string; decided_at: string;
  edit_ratio: number | null; source: string; profiles: { display_name: string } | null;
};
