import { Masthead } from "@/components/echo/masthead";
import { requireUser } from "@/lib/supabase/server";

// AI drafting and insights can take 20–40 s. Allow up to 60 s per request on Vercel.
export const maxDuration = 60;

export default async function DeskLayout({ children }: { children: React.ReactNode }) {
  const { supabase, user } = await requireUser();
  const [{ data: profile }, { count }] = await Promise.all([
    supabase.from("profiles").select("display_name").eq("id", user.id).single(),
    supabase.from("review_items").select("id", { count: "exact", head: true }).eq("status", "pending").eq("held_out", false),
  ]);
  const dateline = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date());

  return (
    <>
      <Masthead name={profile?.display_name ?? user.email ?? ""} pending={count ?? 0} dateline={dateline} />
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">{children}</main>
    </>
  );
}
