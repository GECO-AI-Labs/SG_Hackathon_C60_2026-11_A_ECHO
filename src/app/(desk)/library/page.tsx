import type { Metadata } from "next";
import { requireUser } from "@/lib/supabase/server";
import { LibraryView } from "@/components/echo/library-view";

export const metadata: Metadata = { title: "Library" };

export default async function LibraryPage() {
  const { supabase } = await requireUser();
  const [{ data: kinds }, { data: recent }] = await Promise.all([
    supabase.from("materials").select("kind, library_status, source"),
    supabase
      .from("materials")
      .select("id, title, kind, topic, tags, objective, objective_status, library_status, source, created_at, published_date")
      .neq("kind", "linkedin_post")
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  const summary = new Map<string, { total: number; pending: number; synthetic: number }>();
  (kinds ?? []).forEach((m) => {
    const s = summary.get(m.kind) ?? { total: 0, pending: 0, synthetic: 0 };
    s.total++;
    if (m.library_status === "pending") s.pending++;
    if (m.source === "synthetic") s.synthetic++;
    summary.set(m.kind, s);
  });

  return <LibraryView summary={[...summary.entries()].map(([kind, s]) => ({ kind, ...s }))} documents={recent ?? []} />;
}
