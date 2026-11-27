"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { materialAction, searchAction, uploadMaterialAction } from "@/app/actions";
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

type Item = Awaited<ReturnType<typeof materialAction>>;
type Sort = "relevance" | "newest" | "performance";
type Kind = "all" | "posts" | "docs";
type Since = "any" | "2025" | "12m";

export function LibraryView({ summary, documents, topics }: {
  summary: { kind: string; total: number; pending: number; synthetic: number }[]; documents: Doc[]; topics: string[];
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [kind, setKind] = useState<Kind>("all");
  const [topic, setTopic] = useState("all");
  const [since, setSince] = useState<Since>("any");
  const [sort, setSort] = useState<Sort>("relevance");
  const [openId, setOpenId] = useState<string | null>(null);
  const [searching, start] = useTransition();
  const total = summary.reduce((s, k) => s + k.total, 0);

  const search = (query = q, f = { kind, topic, since }) =>
    start(async () => {
      if (!query.trim()) return;
      try {
        const fromDate = f.since === "2025" ? "2025-01-01" : f.since === "12m" ? new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10) : null;
        setHits(
          await searchAction(query, {
            kinds: f.kind === "posts" ? ["linkedin_post"] : f.kind === "docs" ? ["article", "brochure", "campaign_brief", "deck", "transcript", "brand_voice", "other"] : null,
            topics: f.topic === "all" ? null : [f.topic],
            fromDate,
          }),
        );
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  // Changing a filter re-runs the current search.
  const refilter = (next: Partial<{ kind: Kind; topic: string; since: Since }>) => {
    const f = { kind, topic, since, ...next };
    if (next.kind) setKind(next.kind);
    if (next.topic) setTopic(next.topic);
    if (next.since) setSince(next.since);
    if (hits) search(q, f);
  };

  const sorted = hits
    ? [...hits].sort((a, b) =>
        sort === "newest" ? (b.published_date ?? "9999").localeCompare(a.published_date ?? "9999")
        : sort === "performance" ? (b.impressions ?? -1) - (a.impressions ?? -1)
        : b.similarity - a.similarity,
      ).slice(0, 20)
    : null;

  return (
    <div className="space-y-10">
      <header className="grid gap-6 lg:grid-cols-[1fr_auto] lg:items-end">
        <div>
          <p className="kicker">Gate 1 · what we know</p>
          <h1 className="mt-2 text-4xl font-medium">The Library</h1>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">
            Everything ECHO may draw on: {total.toLocaleString()} items. Search works by meaning, exactly the way ECHO finds sources for a draft. Open any result to read it
            in full or turn it into a new post.
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
        <form onSubmit={(e) => { e.preventDefault(); search(); }} className="flex gap-2">
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

        <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3">
          <Tabs value={kind} onChange={(v) => refilter({ kind: v })} options={{ all: "Everything", posts: "Posts", docs: "Documents" }} />
          <Tabs value={since} onChange={(v) => refilter({ since: v })} options={{ any: "Any time", "2025": "2025 onwards", "12m": "Last 12 months" }} />
          {topics.length > 0 && (
            <Select value={topic} onValueChange={(v) => refilter({ topic: v })}>
              <SelectTrigger size="sm" className="w-48 bg-card text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All topics</SelectItem>
                {topics.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <span className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
            Sort
            <Tabs value={sort} onChange={setSort} options={{ relevance: "Best match", newest: "Newest", performance: "Most seen" }} />
          </span>
        </div>

        {sorted && (
          <ol className="mt-4 divide-y divide-border border-t border-border">
            {sorted.length === 0 && <li className="py-6 text-sm text-muted-foreground">No matches with these filters.</li>}
            {sorted.map((h, i) => (
              <li key={h.chunk_id}>
                <button onClick={() => setOpenId(h.material_id)} className="grid w-full gap-3 py-4 text-left transition-colors hover:bg-card/60 sm:grid-cols-[3rem_1fr_7rem]">
                  <span className="num pl-1 text-sm text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="kicker">{KIND_LABEL[h.kind] ?? h.kind}</span>
                      {h.topic && <span className="kicker">· {h.topic}</span>}
                      <SourceTag source={h.source} />
                    </div>
                    <p className="mt-1 font-serif text-[1.05rem] leading-snug">{h.title}</p>
                    <p className="mt-1 line-clamp-2 text-sm text-muted-foreground"><Highlight text={h.content} query={q} /></p>
                  </div>
                  <div className="sm:text-right">
                    <Match value={h.similarity} />
                    {h.impressions != null && <p className="num mt-2 text-[0.7rem] text-muted-foreground">{h.impressions.toLocaleString()} impr. · {h.clicks ?? 0} clicks</p>}
                  </div>
                </button>
              </li>
            ))}
          </ol>
        )}
        {sorted && <p className="mt-2 text-xs text-muted-foreground">Very short posts (mostly hashtags) are skipped. Recent posts and curated documents get a small boost.</p>}
      </section>

      {documents.length > 0 && (
        <section>
          <p className="kicker">Reference documents</p>
          <ul className="mt-3 divide-y divide-border border-y border-border">
            {documents.map((d) => (
              <li key={d.id}>
                <button onClick={() => setOpenId(d.id)} className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 py-3 text-left hover:bg-card/60">
                  <span className="kicker w-32 shrink-0">{KIND_LABEL[d.kind] ?? d.kind}</span>
                  <span className="min-w-0 flex-1 font-serif text-[1.02rem]">{d.title}</span>
                  <SourceTag source={d.source} />
                  {d.library_status === "pending" ? <span className="text-xs text-inferred">Awaiting Gate 1</span> : <ObjectiveTag objective={d.objective} status={d.objective_status} />}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <ItemPanel id={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}

/** Side panel: the full item, its labels, its LinkedIn results, and what you can do with it. */
function ItemPanel({ id, onClose }: { id: string | null; onClose: () => void }) {
  const router = useRouter();
  const [loaded, setLoaded] = useState<Item | null>(null);
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    materialAction(id)
      .then((r) => { if (!cancelled) setLoaded(r); })
      .catch((e) => toast.error((e as Error).message));
    return () => { cancelled = true; };
  }, [id]);
  const item = loaded && loaded.id === id ? loaded : null; // never show the previous item
  const p = item?.post;
  const pct = (v: number | null | undefined) => (v == null ? "–" : `${(v * 100).toFixed(1)}%`);
  return (
    <Sheet open={!!id} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <p className="kicker">{item ? `${KIND_LABEL[item.kind] ?? item.kind}${item.published_date ? ` · ${item.published_date}` : ""}` : "Loading…"}</p>
          <SheetTitle className="font-serif text-2xl leading-snug font-medium">{item?.title ?? " "}</SheetTitle>
          <SheetDescription className="sr-only">Library item details</SheetDescription>
        </SheetHeader>
        {item && (
          <div className="space-y-6 px-4 pb-8">
            <div className="flex flex-wrap items-center gap-2">
              {item.topic && <span className="num rounded-sm bg-muted px-1.5 py-0.5 text-[0.7rem]">{item.topic}</span>}
              <ObjectiveTag objective={item.objective as Objective | null} status={item.objective_status} />
              <SourceTag source={item.source} />
              {item.library_status === "pending" && <span className="text-xs text-inferred">Awaiting Gate 1</span>}
            </div>

            {p && (
              <dl className="grid grid-cols-3 gap-y-3 border-y border-border py-3 text-sm">
                {[["Impressions", p.impressions?.toLocaleString() ?? "–"], ["Clicks", p.clicks ?? "–"], ["CTR", pct(p.ctr)], ["Reactions", p.likes ?? "–"], ["Comments", p.comments ?? "–"], ["Reposts", p.shares ?? "–"]].map(([k, v]) => (
                  <div key={k as string}><dt className="kicker">{k}</dt><dd className="num mt-0.5">{v}</dd></div>
                ))}
                {!p.comparable && p.impressions != null && <p className="col-span-3 text-xs text-muted-foreground">Under 30 impressions: left out of comparisons.</p>}
              </dl>
            )}

            <div className="flex flex-wrap gap-2">
              <Button onClick={() => router.push(`/write?source=${item.id}`)}>Write a post from this</Button>
              {p?.url && <Button variant="outline" asChild><a href={p.url} target="_blank" rel="noreferrer">Open on LinkedIn</a></Button>}
            </div>
            {item.cited_in > 0 && <p className="text-xs text-muted-foreground">Cited as a source in {item.cited_in} draft{item.cited_in === 1 ? "" : "s"}.</p>}

            <div>
              <p className="kicker">Full text</p>
              <p className="mt-2 font-serif text-[1.02rem] leading-relaxed whitespace-pre-wrap">{item.body}</p>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Tabs<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: Record<T, string> }) {
  return (
    <div className="inline-flex gap-4">
      {(Object.keys(options) as T[]).map((k) => (
        <button key={k} onClick={() => onChange(k)} className={cn("border-b-2 pb-1 text-xs transition-colors", value === k ? "border-pencil text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
          {options[k]}
        </button>
      ))}
    </div>
  );
}

/** Marks the query's words in a snippet so you can see why it matched (meaning matches may have none). */
function Highlight({ text, query }: { text: string; query: string }) {
  const words = query.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
  if (!words.length) return <>{text}</>;
  const re = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  return <>{text.split(re).map((part, i) => (words.includes(part.toLowerCase()) ? <mark key={i} className="bg-pencil-soft text-foreground">{part}</mark> : <span key={i}>{part}</span>))}</>;
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
