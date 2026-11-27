import type { Metadata } from "next";
import { requireUser } from "@/lib/supabase/server";
import { WriteForm } from "@/components/echo/write-form";

export const metadata: Metadata = { title: "Write" };

export default async function WritePage({ searchParams }: { searchParams: Promise<{ rec?: string; brief?: string; source?: string }> }) {
  const { supabase } = await requireUser();
  const { rec, brief, source: sourceId } = await searchParams;
  const { data: source } = sourceId
    ? await supabase.from("materials").select("id, title, kind, body").eq("id", sourceId).maybeSingle()
    : { data: null };
  const [{ data: recs }, { count: rules }, { count: library }] = await Promise.all([
    supabase
      .from("review_items")
      .select("id, title, final, draft, payload")
      .eq("item_type", "insight")
      .in("status", ["approved", "edited"])
      .order("decided_at", { ascending: false })
      .limit(10),
    supabase.from("rules").select("id", { count: "exact", head: true }).eq("active", true).eq("item_type", "post_draft"),
    supabase.from("materials").select("id", { count: "exact", head: true }).eq("library_status", "approved"),
  ]);

  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_20rem]">
      <section>
        <p className="kicker">Gate 2 starts here</p>
        <h1 className="mt-2 text-4xl font-medium">Brief a post</h1>
        <p className="mt-2 max-w-xl text-sm text-muted-foreground">
          Say what the post is about. ECHO searches {library ?? 0} approved library items, applies {rules ?? 0} house rules learned from your edits, and writes two
          versions with numbered sources. The drafts land on your Desk.
        </p>
        <WriteForm
          recommendations={(recs ?? []).map((r) => ({ id: r.id, title: r.title, text: r.final ?? r.draft ?? "", objective: r.payload?.objective }))}
          initialRec={rec}
          initialBrief={brief}
          source={source ? { id: source.id, title: source.title, kind: source.kind, excerpt: source.body.slice(0, 280) } : null}
        />
      </section>
      <aside className="space-y-6 text-sm lg:border-l lg:border-border lg:pl-6">
        <div>
          <p className="kicker">How a draft is built</p>
          <ol className="mt-3 space-y-3 text-muted-foreground">
            <li><span className="num mr-2 text-pencil">1</span>Your brief is turned into a search and matched against the library.</li>
            <li><span className="num mr-2 text-pencil">2</span>The best matches, the brand voice, active house rules and 3 of your past edits go into the prompt.</li>
            <li><span className="num mr-2 text-pencil">3</span>The model writes two angles and must cite a source for every claim.</li>
            <li><span className="num mr-2 text-pencil">4</span>You approve, edit or reject on the Desk. That decision teaches the next draft.</li>
          </ol>
        </div>
        <div className="border-t border-border pt-4 text-xs text-muted-foreground">
          ECHO never publishes. After approval, copy the post and publish it on LinkedIn yourself.
        </div>
      </aside>
    </div>
  );
}
