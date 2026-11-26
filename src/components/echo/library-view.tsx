"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { searchAction, uploadMaterialAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { ObjectiveTag, SourceTag } from "./tags";
import type { Objective } from "@/lib/domain";

const KIND_LABEL: Record<string, string> = {
  linkedin_post: "LinkedIn posts", article: "Articles", brochure: "Brochures", campaign_brief: "Campaign briefs",
  deck: "Decks", transcript: "Talks & transcripts", brand_voice: "Brand voice", other: "Other",
};

type Hit = Awaited<ReturnType<typeof searchAction>>[number];
type Doc = { id: string; title: string; kind: string; topic: string | null; tags: string[]; objective: Objective | null; objective_status: string; library_status: string; source: string; created_at: string };

export function LibraryView({ summary, documents }: { summary: { kind: string; total: number; pending: number; synthetic: number }[]; documents: Doc[] }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [searching, start] = useTransition();
  const total = summary.reduce((s, k) => s + k.total, 0);

  const search = (query = q) =>
    start(async () => {
      try {
        setHits(await searchAction(query));
      } catch (e) {
        toast.error((e as Error).message);
      }
    });

  return (
    <div className="space-y-10">
      <header className="grid gap-6 lg:grid-cols-[1fr_auto] lg:items-end">
        <div>
          <p className="kicker">Gate 1 · what we know</p>
          <h1 className="mt-2 text-4xl font-medium">The Library</h1>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">
            Everything ECHO may draw on: {total.toLocaleString()} items. Search by meaning, not just keywords. New material waits for your approval before drafts can use it.
          </p>
        </div>
        <AddMaterial />
      </header>

      <dl className="grid grid-cols-2 border-y border-border sm:grid-cols-3 lg:grid-cols-6">
        {summary.map((s) => (
          <div key={s.kind} className="border-border py-4 pr-4 [&:not(:last-child)]:border-r sm:pl-4 sm:first:pl-0">
            <dt className="kicker">{KIND_LABEL[s.kind] ?? s.kind}</dt>
            <dd className="num mt-1 text-2xl">{s.total}</dd>
            <dd className="text-[0.7rem] text-muted-foreground">
              {s.pending > 0 && <span className="text-inferred">{s.pending} awaiting Gate 1 · </span>}
              {s.synthetic > 0 ? `${s.synthetic} synthetic` : "real"}
            </dd>
          </div>
        ))}
      </dl>

      <section>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            search();
          }}
          className="flex gap-2"
        >
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by meaning, e.g. ‘career switchers who doubt they can code’"
            className="h-11 bg-card font-serif text-[1.05rem]"
          />
          <Button type="submit" className="h-11 px-5" disabled={searching || !q.trim()}>
            {searching ? "Searching…" : "Search"}
          </Button>
        </form>
        <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
          Try:
          {["awards and recognition", "welcome new cohort", "Java training", "hiring partners in the Philippines"].map((s) => (
            <button key={s} className="underline-offset-4 hover:text-foreground hover:underline" onClick={() => { setQ(s); search(s); }}>
              {s}
            </button>
          ))}
        </div>

        {hits && (
          <ol className="mt-6 divide-y divide-border border-t border-border">
            {hits.length === 0 && <li className="py-6 text-sm text-muted-foreground">No matches.</li>}
            {hits.map((h, i) => (
              <li key={h.chunk_id} className="grid gap-3 py-4 sm:grid-cols-[3rem_1fr_6rem]">
                <span className="num text-sm text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="kicker">{KIND_LABEL[h.kind] ?? h.kind}</span>
                    <SourceTag source={h.source} />
                  </div>
                  <p className="mt-1 font-serif text-[1.05rem] leading-snug">{h.title}</p>
                  <p className="mt-1 line-clamp-3 text-sm text-muted-foreground">{h.content}</p>
                </div>
                <Match value={h.similarity} />
              </li>
            ))}
          </ol>
        )}
      </section>

      {documents.length > 0 && (
        <section>
          <p className="kicker">Reference documents</p>
          <ul className="mt-3 divide-y divide-border border-y border-border">
            {documents.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3">
                <span className="kicker w-32 shrink-0">{KIND_LABEL[d.kind] ?? d.kind}</span>
                <span className="min-w-0 flex-1 font-serif text-[1.02rem]">{d.title}</span>
                <SourceTag source={d.source} />
                {d.library_status === "pending" ? (
                  <span className="text-xs text-inferred">Awaiting Gate 1</span>
                ) : (
                  <ObjectiveTag objective={d.objective} status={d.objective_status} />
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Match({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, Math.round(value * 100)));
  return (
    <div className="sm:text-right" title="Semantic similarity between your query and this item">
      <span className="num text-sm">{pct}%</span>
      <div className="mt-1 h-[3px] w-full bg-muted">
        <div className="h-full bg-chart-2" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function AddMaterial() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState("brochure");
  const [pending, start] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline">Add material</Button>
      </SheetTrigger>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="font-serif text-2xl font-medium">Add to the library</SheetTitle>
          <SheetDescription>Upload a PDF, Word, PowerPoint or text file, or paste text. ECHO extracts it, makes it searchable and suggests tags. You approve them at Gate 1.</SheetDescription>
        </SheetHeader>
        <form
          ref={formRef}
          className="space-y-4 px-4 pb-6"
          action={(fd) => {
            fd.set("kind", kind);
            start(async () => {
              try {
                await uploadMaterialAction(fd);
                toast.success("Added. Classification is waiting on your Desk (Gate 1).");
                setOpen(false);
                router.refresh();
              } catch (e) {
                toast.error((e as Error).message);
              }
            });
          }}
        >
          <div className="space-y-1.5">
            <Label>Type</Label>
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(KIND_LABEL).filter(([k]) => k !== "linkedin_post").map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="title">Title</Label>
            <Input id="title" name="title" placeholder="Optional for files" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="file">File</Label>
            <Input id="file" name="file" type="file" accept=".pdf,.docx,.pptx,.txt,.md" className={cn("cursor-pointer")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="body">…or paste text</Label>
            <Textarea id="body" name="body" className="min-h-40" />
          </div>
          <Button type="submit" disabled={pending} className="w-full">
            {pending ? "Reading and indexing…" : "Add and classify"}
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
