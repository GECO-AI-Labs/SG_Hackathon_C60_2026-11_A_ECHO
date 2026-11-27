"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { decide, decideMany, refineAction, setDraftImageAction } from "@/app/actions";
import type { RecentRow } from "@/app/(desk)/page";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AUTONOMY, GATES, METRICS, OBJECTIVES, OBJECTIVE_KEYS, REJECT_REASONS, type Gate, type Objective, type RejectReason } from "@/lib/domain";
import { runChecks } from "@/lib/echo/checks";
import { cn } from "@/lib/utils";
import { Footnoted, ProofMarks } from "./text-marks";
import { ObjectiveTag, SourceTag } from "./tags";
import { PostImagePicker, type PostImage } from "./post-image";

// payload/context are JSON columns whose shape differs per gate (see lib/echo/*.ts).
/* eslint-disable @typescript-eslint/no-explicit-any */
export type QueueItem = {
  id: string; gate: Gate; item_type: string; status: string; title: string; reason: string | null; brief: string | null;
  draft: string | null; payload: Record<string, any>; citations: Citation[]; context: Record<string, any>;
  learning: { with_learning?: boolean; rule_ids?: string[]; example_ids?: string[] }; source: string; created_at: string;
  parent_id: string | null;
  image_path?: string | null;
  image_url?: string | null;
  parent?: { title: string; final: string | null; draft: string | null } | null;
  material?: { body: string; kind: string } | null;
};
/* eslint-enable @typescript-eslint/no-explicit-any */
type Citation = { n: number; material_id: string; title: string; kind: string; source: string; published_date: string | null; snippet: string; similarity: number; used: boolean };

const FILTERS = [{ key: 0, label: "All" }, ...([1, 2, 3, 4] as Gate[]).map((g) => ({ key: g, label: `G${g} ${GATES[g].name}` }))];

export function DeskQueue({ items, recent, initialId, batchTypes, topics, classificationProgress }: {
  items: QueueItem[]; recent: RecentRow[]; initialId?: string; batchTypes: string[]; topics: string[];
  classificationProgress: { decided: number; unedited: number };
}) {
  const [filter, setFilter] = useState<number>(0);
  const visible = useMemo(() => items.filter((i) => !filter || i.gate === filter), [items, filter]);
  const [selectedId, setSelectedId] = useState<string | undefined>(initialId ?? visible[0]?.id);
  const selected = visible.find((i) => i.id === selectedId) ?? visible[0];

  // j / k move through the queue (fast review is a brief requirement).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input, textarea, [role=combobox], [contenteditable]")) return;
      const idx = visible.findIndex((i) => i.id === selected?.id);
      const go = (id: string) => {
        setSelectedId(id);
        document.querySelector(`[data-item="${id}"]`)?.scrollIntoView({ block: "nearest" });
      };
      if (e.key === "j" && idx < visible.length - 1) go(visible[idx + 1].id);
      if (e.key === "k" && idx > 0) go(visible[idx - 1].id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, selected]);

  const counts = useMemo(() => {
    const c: Record<number, number> = { 0: items.length };
    items.forEach((i) => (c[i.gate] = (c[i.gate] ?? 0) + 1));
    return c;
  }, [items]);

  return (
    <div className="grid gap-8 lg:grid-cols-[22rem_1fr]">
      {/* The queue scrolls on its own, so a long queue never stretches the page. */}
      <aside className="lg:sticky lg:top-6 lg:flex lg:max-h-[calc(100dvh-3rem)] lg:flex-col lg:self-start">
        <div className="flex items-baseline justify-between">
          <h1 className="text-3xl font-medium">The Desk</h1>
          <span className="kicker">j / k to move</span>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {items.length ? `${items.length} item${items.length > 1 ? "s" : ""} waiting for your decision.` : "Nothing waiting. Brief a post or ask for insights."}
        </p>

        <div className="mt-5 flex flex-wrap gap-x-4 gap-y-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                "num border-b-2 pb-1 text-[0.72rem] transition-colors",
                filter === f.key ? "border-pencil text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {f.label} <span className={cn(counts[f.key] ? "text-pencil" : "opacity-50")}>{counts[f.key] ?? 0}</span>
            </button>
          ))}
        </div>

        {!batchTypes.includes("classification") && items.some((i) => i.item_type === "classification") && (
          <LadderHint {...classificationProgress} />
        )}
        {batchTypes.map((t) => {
          const ids = items.filter((i) => i.item_type === t).map((i) => i.id);
          return ids.length > 1 ? <BatchApprove key={t} itemType={t} ids={ids} /> : null;
        })}

        <ol className="mt-5 max-h-[60dvh] divide-y divide-border overflow-y-auto overscroll-contain border-y border-border lg:max-h-none lg:min-h-0 lg:flex-1">
          {visible.map((i) => (
            <li key={i.id} data-item={i.id}>
              <button
                onClick={() => setSelectedId(i.id)}
                className={cn(
                  "group relative block w-full py-3 pr-2 pl-4 text-left transition-colors",
                  selected?.id === i.id ? "bg-card" : "hover:bg-card/60",
                )}
              >
                <span className={cn("absolute top-3 bottom-3 left-0 w-[3px]", selected?.id === i.id ? "bg-pencil" : "bg-transparent")} />
                <span className="kicker">
                  Gate {i.gate} · {GATES[i.gate].name}
                  {i.parent_id && i.item_type === "post_draft" && " · new angle"}
                </span>
                <span className="mt-1 line-clamp-2 block font-serif text-[1.05rem] leading-snug">{i.title}</span>
                <span className="mt-1 block text-xs text-muted-foreground" suppressHydrationWarning>{timeAgo(i.created_at)}</span>
              </button>
            </li>
          ))}
        </ol>

        {recent.length > 0 && visible.length < 6 && (
          <div className="mt-8">
            <p className="kicker">Recently decided</p>
            <ul className="mt-2 space-y-1.5 text-xs">
              {recent.map((r) => (
                <li key={r.id} className="flex items-baseline gap-2">
                  <StatusMark status={r.status} />
                  <span className="line-clamp-1 flex-1 text-muted-foreground">{r.title}</span>
                  <span className="num shrink-0 text-[0.65rem] text-muted-foreground">{r.profiles?.display_name ?? (r.source === "synthetic" ? "seed" : "")}</span>
                </li>
              ))}
            </ul>
            <Link href="/ledger" className="kicker mt-3 inline-block underline-offset-4 hover:underline">
              Full audit trail →
            </Link>
          </div>
        )}
      </aside>

      <section className="min-w-0">{selected ? <ReviewCard key={selected.id} item={selected} topics={topics} /> : <EmptyDesk />}</section>
    </div>
  );
}

/* ───────────────────────── Review card ───────────────────────── */

function ReviewCard({ item, topics }: { item: QueueItem; topics: string[] }) {
  const router = useRouter();
  const [openedAt] = useState(() => Date.now()); // for 'time to decide'
  const [mode, setMode] = useState<"view" | "edit" | "reject">("view");
  const [version, setVersion] = useState(0);
  const [pending, start] = useTransition();
  const versions = (item.payload.versions ?? []) as { angle: string; marked: string; clean: string }[];
  const baseText = versions[version]?.clean ?? item.draft ?? "";
  const [final, setFinal] = useState(baseText);
  const [objective, setObjective] = useState<Objective | undefined>(item.payload.objective ?? item.context.objective);
  const [reason, setReason] = useState<RejectReason>("wrong_angle");
  const [note, setNote] = useState("");
  const [hoverFn, setHoverFn] = useState<number | null>(null);

  const [refining, startRefine] = useTransition();
  const refine = (instruction: string) =>
    startRefine(async () => {
      try {
        const idx = await refineAction(item.id, version, instruction);
        setVersion(idx);
        router.refresh();
        toast.success(`Version ${idx + 1} added`, { description: instruction });
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  const startEdit = () => {
    setFinal(baseText);
    setMode("edit");
  };
  const selectVersion = (i: number) => {
    setVersion(i);
    setFinal(versions[i]?.clean ?? "");
  };

  const run = (d: Parameters<typeof decide>[1], msg: string) =>
    start(async () => {
      try {
        await decide(item.id, d, openedAt);
        const approvedText = d.kind === "edit" ? d.final : d.kind === "approve" ? (versions[version]?.clean ?? item.draft ?? "") : "";
        toast.success(msg, {
          description: "Logged with your name and the time.",
          action:
            item.item_type === "post_draft" && approvedText
              ? { label: "Copy post", onClick: () => navigator.clipboard.writeText(approvedText).then(() => toast("Copied. Paste it into LinkedIn.")) }
              : item.item_type === "insight" && (d.kind === "approve" || d.kind === "edit")
                ? { label: "Write a post from it", onClick: () => router.push(`/write?rec=${item.id}`) }
                : undefined,
          duration: item.item_type === "post_draft" || item.item_type === "insight" ? 10000 : 4000,
        });
        router.refresh();
      } catch (e) {
        toast.error((e as Error).message);
      }
    });

  // a / e / r shortcuts while viewing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (mode !== "view" || pending || (e.target as HTMLElement)?.closest("input, textarea, [role=combobox]")) return;
      if (e.key === "a") run({ kind: "approve", versionIndex: version }, "Approved");
      if (e.key === "e") startEdit();
      if (e.key === "r") setMode("reject");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const isPost = item.item_type === "post_draft";
  const checks = isPost ? runChecks(mode === "edit" ? final : baseText) : [];

  return (
    <article>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="kicker text-foreground">
            Gate {item.gate} · {GATES[item.gate].verb}
          </span>
          {item.source === "synthetic" && <SourceTag source="synthetic" />}
        </div>
        <span className="kicker">{item.reason}</span>
      </header>

      <p className="mt-2 text-sm text-foreground/80">{GATES[item.gate].question}</p>
      <h2 className="mt-4 text-[clamp(1.6rem,3vw,2.3rem)] leading-tight font-medium">
        {item.item_type === "objective_metrics" ? item.parent?.title ?? item.title.replace(/^Success metrics:\s*/, "") : item.title}
      </h2>
      {item.brief && item.brief !== item.title && <p className="mt-2 text-sm text-muted-foreground">Brief: {item.brief.split("\n")[0]}</p>}

      {isPost && (
        <PostBody
          item={item}
          versions={versions}
          version={version}
          setVersion={selectVersion}
          mode={mode}
          final={final}
          setFinal={setFinal}
          baseText={baseText}
          hoverFn={hoverFn}
          setHoverFn={setHoverFn}
          objective={objective}
          setObjective={setObjective}
          checks={checks}
          onRefine={refine}
          refining={refining}
        />
      )}
      {item.item_type === "classification" && <ClassificationBody item={item} mode={mode} objective={objective} setObjective={setObjective} final={final} setFinal={setFinal} topics={topics} />}
      {item.item_type === "objective_metrics" && <MetricsBody item={item} mode={mode} objective={objective} setObjective={setObjective} />}
      {item.item_type === "objective_metrics" && (item.parent?.final ?? item.parent?.draft) && (
        <details className="mt-6 max-w-3xl text-sm">
          <summary className="kicker cursor-pointer">The approved post</summary>
          <p className="mt-2 font-serif text-[1.02rem] leading-relaxed whitespace-pre-wrap text-foreground/80">{item.parent?.final ?? item.parent?.draft}</p>
        </details>
      )}
      {item.item_type === "insight" && <InsightBody item={item} mode={mode} final={final} setFinal={setFinal} />}

      {/* Decision bar */}
      <footer className="sticky bottom-0 mt-10 bg-background/95 py-4 backdrop-blur">
        {mode === "reject" ? (
          <div className="space-y-3">
            <p className="kicker">Why reject? ECHO learns from the reason.</p>
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(REJECT_REASONS) as RejectReason[])
                .filter((r) => r !== "already_known" || item.item_type === "insight")
                .map((r) => (
                  <button
                    key={r}
                    onClick={() => setReason(r)}
                    className={cn("rounded-sm border px-2.5 py-1 text-xs", reason === r ? "border-pencil bg-pencil-soft text-pencil" : "border-border hover:border-foreground/40")}
                  >
                    {REJECT_REASONS[r]}
                  </button>
                ))}
            </div>
            <Input placeholder="Note (optional): what was wrong?" value={note} onChange={(e) => setNote(e.target.value)} className="bg-card" />
            <div className="flex flex-wrap gap-2">
              <Button variant="destructive" disabled={pending} onClick={() => run({ kind: "reject", reason, note }, "Rejected")}>
                Reject
              </Button>
              {isPost && (
                <Button variant="outline" disabled={pending} onClick={() => run({ kind: "another_angle", note }, "Rejected. Drafting another angle…")}>
                  Reject &amp; request another angle
                </Button>
              )}
              <Button variant="ghost" onClick={() => setMode("view")}>
                Cancel
              </Button>
            </div>
          </div>
        ) : mode === "edit" ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button disabled={pending} onClick={() => run({ kind: "edit", final, versionIndex: version, objective }, "Saved with your edits")}>
              {item.gate === 3 ? "Confirm new objective" : item.gate === 1 ? "Save classification" : "Approve with edits"}
            </Button>
            <Button variant="ghost" onClick={() => { setMode("view"); setFinal(baseText); }}>
              Discard edits
            </Button>
            <span className="ml-auto text-xs text-muted-foreground">ECHO stores the original, your version and the difference.</span>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Button disabled={pending} onClick={() => run({ kind: "approve", versionIndex: version }, item.gate === 3 ? "Confirmed" : "Approved")}>
              {GATES[item.gate].approve} <Kbd>A</Kbd>
            </Button>
            <Button variant="outline" disabled={pending} onClick={startEdit}>
              {GATES[item.gate].edit} <Kbd>E</Kbd>
            </Button>
            <Button variant="outline" disabled={pending} onClick={() => setMode("reject")} className="text-pencil">
              Reject <Kbd>R</Kbd>
            </Button>
            {pending && <span className="kicker ml-2 animate-pulse">Recording…</span>}
            {item.item_type === "post_draft" && (
              <span className="ml-auto text-xs text-muted-foreground">Approving does not publish. You post on LinkedIn yourself.</span>
            )}
          </div>
        )}
      </footer>
    </article>
  );
}

/* ───────────────────────── Bodies per gate ───────────────────────── */

function PostBody(p: {
  item: QueueItem; versions: { angle: string; marked: string; clean: string }[]; version: number; setVersion: (n: number) => void;
  mode: string; final: string; setFinal: (s: string) => void; baseText: string; hoverFn: number | null; setHoverFn: (n: number | null) => void;
  objective?: Objective; setObjective: (o: Objective) => void; checks: ReturnType<typeof runChecks>;
  onRefine: (instruction: string) => void; refining: boolean;
}) {
  const { item, versions, version } = p;
  const cites = (item.citations ?? []).filter((c) => c.used);
  const unused = (item.citations ?? []).filter((c) => !c.used);
  const learning = item.learning ?? {};
  return (
    <div className="mt-6 grid gap-8 xl:grid-cols-[1fr_17rem]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          {p.mode === "edit" ? (
            <ObjectivePicker value={p.objective} onChange={p.setObjective} />
          ) : (
            <ObjectiveTag objective={item.payload.objective} status={item.payload.objective_status} />
          )}
          {item.payload.format && <span className="kicker">Format: {item.payload.format}</span>}
        </div>
        {item.payload.objective_reason && item.payload.objective_status !== "confirmed" && (
          <p className="mt-1 text-xs text-muted-foreground italic">Why: {item.payload.objective_reason}</p>
        )}

        {versions.length > 1 && (
          <div className="mt-5 flex flex-wrap gap-x-1 border-b border-border">
            {versions.map((v, i) => (
              <button
                key={i}
                disabled={p.mode === "edit"}
                onClick={() => p.setVersion(i)}
                className={cn("-mb-px border-b-2 px-3 py-2 text-left text-sm", version === i ? "border-pencil text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
              >
                <span className="kicker block">{"refined_from" in v ? `Version ${i + 1} · refined` : `Version ${i + 1}`}</span>
                <span className="line-clamp-1 max-w-56">{v.angle}</span>
              </button>
            ))}
          </div>
        )}

        <div className="mt-5 rounded-sm border border-border bg-card px-6 py-6 shadow-[0_1px_0_var(--border)] sm:px-8">
          {p.mode === "edit" ? (
            <div className="space-y-5">
              <Textarea value={p.final} onChange={(e) => p.setFinal(e.target.value)} className="min-h-64 border-0 bg-transparent p-0 font-serif text-[1.1rem] leading-relaxed shadow-none focus-visible:ring-0" autoFocus />
              {p.final !== p.baseText && (
                <div className="border-t border-dashed border-border pt-4">
                  <p className="kicker mb-2">Your marks</p>
                  <ProofMarks draft={p.baseText} final={p.final} className="font-serif text-[0.95rem] text-foreground/85" />
                </div>
              )}
            </div>
          ) : (
            <Footnoted text={versions[version]?.marked ?? item.draft ?? ""} onHover={p.setHoverFn} className="font-serif text-[1.1rem] text-foreground" />
          )}
        </div>

        <DraftImage key={item.id} item={item} />

        <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5">
          {p.checks.map((c) => (
            <li key={c.id} className={cn("flex items-center gap-1.5 text-xs", c.pass ? "text-muted-foreground" : "text-pencil")} title={c.detail}>
              <span aria-hidden>{c.pass ? "✓" : "✗"}</span> {c.label}
            </li>
          ))}
        </ul>
        {p.mode !== "edit" && <RefineBar onRefine={p.onRefine} refining={p.refining} />}
        <p className="mt-3 text-xs text-muted-foreground">
          {learning.with_learning === false
            ? "Drafted without learning (baseline)."
            : `ECHO applied ${learning.rule_ids?.length ?? 0} house rule${learning.rule_ids?.length === 1 ? "" : "s"} and ${learning.example_ids?.length ?? 0} of your past edits.`}{" "}
          <Link href="/ledger" className="underline underline-offset-4">
            See rules
          </Link>
        </p>
      </div>

      {/* Margin notes: the sources this draft stands on */}
      <aside className="xl:border-l xl:border-border xl:pl-5">
        <p className="kicker">Sources cited</p>
        {cites.length === 0 && <p className="mt-2 text-xs text-pencil">No library source cited. Treat every claim as unverified.</p>}
        <ol className="mt-3 space-y-4">
          {cites.map((c) => (
            <li key={c.n} className={cn("text-xs leading-relaxed transition-colors", p.hoverFn === c.n ? "text-foreground" : "text-muted-foreground")}>
              <span className="num mr-1.5 text-pencil">{c.n}</span>
              <span className="font-medium text-foreground">{c.title}</span>
              <span className="mt-1 block">
                {c.kind.replace("_", " ")} {c.source === "synthetic" && "· synthetic"} · match {Math.round(c.similarity * 100)}%
              </span>
              <span className={cn("mt-1 line-clamp-3 block italic", p.hoverFn === c.n && "line-clamp-none")}>“{c.snippet}”</span>
            </li>
          ))}
        </ol>
        {unused.length > 0 && <p className="mt-4 text-[0.7rem] text-muted-foreground">{unused.length} more retrieved but not used.</p>}
      </aside>
    </div>
  );
}

/** The draft's optional image. The reviewer can add, swap or remove it while Gate 2 is open. */
function DraftImage({ item }: { item: QueueItem }) {
  const router = useRouter();
  const [image, setImage] = useState<PostImage | null>(item.image_path ? { path: item.image_path, url: item.image_url ?? null } : null);
  return (
    <div className="mt-4">
      <p className="kicker mb-2">Image</p>
      <PostImagePicker
        compact
        value={image}
        onChange={async (img) => {
          await setDraftImageAction(item.id, img?.path ?? null);
          setImage(img);
          toast.success(img ? "Image saved on this draft" : "Image removed");
          router.refresh();
        }}
      />
    </div>
  );
}

function ClassificationBody({ item, mode, objective, setObjective, final, setFinal, topics }: { item: QueueItem; mode: string; objective?: Objective; setObjective: (o: Objective) => void; final: string; setFinal: (s: string) => void; topics: string[] }) {
  const p = item.payload as { topic: string; tags: string[]; objective: Objective; why: string };
  return (
    <div className="mt-6 max-w-2xl space-y-5">
      {item.material?.body && (
        <blockquote className="max-h-56 overflow-y-auto border-l-2 border-border pl-4 font-serif text-[1.02rem] leading-relaxed whitespace-pre-wrap text-foreground/85">
          {item.material.body.slice(0, 1200)}{item.material.body.length > 1200 && "…"}
        </blockquote>
      )}
      <p className="text-sm text-muted-foreground">ECHO suggests how to file it. Approving confirms the topic and goal, and lets drafts cite it.</p>
      <dl className="grid grid-cols-[8rem_1fr] gap-y-3 border-y border-border py-4 text-sm">
        <dt className="kicker pt-0.5">Topic</dt>
        <dd>
          {mode !== "edit" ? p.topic : topics.length ? (
            <Select value={final.split(" · ")[0]} onValueChange={(t) => setFinal(`${t} · ${objective}`)}>
              <SelectTrigger className="h-8 w-56 bg-card text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>{[...topics, "Other"].map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          ) : (
            <Input value={final.split(" · ")[0]} onChange={(e) => setFinal(`${e.target.value} · ${objective}`)} className="h-8 bg-card" />
          )}
        </dd>
        <dt className="kicker pt-0.5">Tags</dt>
        <dd className="flex flex-wrap gap-1.5">{p.tags?.map((t) => <span key={t} className="num rounded-sm bg-muted px-1.5 py-0.5 text-[0.7rem]">{t}</span>)}</dd>
        <dt className="kicker pt-0.5">Objective</dt>
        <dd>{mode === "edit" ? <ObjectivePicker value={objective} onChange={(o) => { setObjective(o); setFinal(`${final.split(" · ")[0]} · ${o}`); }} /> : <ObjectiveTag objective={p.objective} status="inferred" />}</dd>
      </dl>
      <p className="text-xs text-muted-foreground italic">Why: {p.why}</p>
    </div>
  );
}

function MetricsBody({ item, mode, objective, setObjective }: { item: QueueItem; mode: string; objective?: Objective; setObjective: (o: Objective) => void }) {
  const p = item.payload as { objective: Objective; primary: string[]; supporting: string[]; why: string; objective_status: string };
  const o = (mode === "edit" ? objective : p.objective) ?? p.objective;
  const primary = mode === "edit" ? OBJECTIVES[o].primary : p.primary;
  const supporting = mode === "edit" ? OBJECTIVES[o].supporting : p.supporting;
  return (
    <div className="mt-6 max-w-3xl space-y-6">
      <div>
        <p className="kicker">The post&apos;s goal</p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          {mode === "edit" ? <ObjectivePicker value={o} onChange={setObjective} /> : <ObjectiveTag objective={p.objective} status={p.objective_status} />}
          <span className="text-sm text-muted-foreground">{OBJECTIVES[o].purpose}</span>
        </div>
        {p.objective_status !== "confirmed" && mode !== "edit" && (
          <p className="mt-2 text-xs text-muted-foreground">ECHO guessed this goal from the brief. Confirm it, or change it if the post is meant to do something else.</p>
        )}
      </div>
      <div className="grid gap-6 sm:grid-cols-2">
        <MetricList title="Judge it mainly by" keys={primary} />
        <MetricList title="Also watch" keys={supporting} />
      </div>
      <p className="border-l-2 border-pencil pl-4 font-serif text-[1.05rem] italic">{p.why}</p>
    </div>
  );
}

function MetricList({ title, keys }: { title: string; keys: readonly string[] }) {
  return (
    <div>
      <p className="kicker">{title}</p>
      <ul className="mt-2 space-y-2">
        {keys.map((k) => (
          <li key={k} className="text-sm">
            <span className="font-medium">{METRICS[k as keyof typeof METRICS]?.label ?? k}</span>
            <span className="block text-xs text-muted-foreground">{METRICS[k as keyof typeof METRICS]?.def}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function InsightBody({ item, mode, final, setFinal }: { item: QueueItem; mode: string; final: string; setFinal: (s: string) => void }) {
  const p = item.payload as { observed_trend: string; evidence: string[]; possible_explanation: string; recommendation: string; caveat: string; objective: Objective };
  return (
    <div className="mt-6 space-y-6">
      <div className="grid gap-0 md:grid-cols-2">
        <div className="py-5 md:pr-6">
          <p className="kicker text-foreground">Observed · what the data shows</p>
          <p className="mt-2 font-serif text-[1.1rem] leading-relaxed">{p.observed_trend}</p>
          <ul className="mt-3 space-y-1">
            {p.evidence?.map((e, i) => (
              <li key={i} className="num text-[0.75rem] text-muted-foreground">— {e}</li>
            ))}
          </ul>
        </div>
        <div className="border-t border-dashed border-border py-5 md:border-t-0 md:border-l md:pl-6">
          <p className="kicker">Possible explanation · not proven</p>
          <p className="mt-2 font-serif text-[1.05rem] leading-relaxed text-foreground/75 italic">{p.possible_explanation}</p>
        </div>
      </div>
      <div>
        <p className="kicker">Recommendation for the next round</p>
        {mode === "edit" ? (
          <Textarea value={final} onChange={(e) => setFinal(e.target.value)} className="mt-2 min-h-24 bg-card" />
        ) : (
          <p className="mt-2 text-[1.05rem]">{item.draft}</p>
        )}
        <div className="mt-2"><ObjectiveTag objective={p.objective} status="inferred" /></div>
      </div>
      <p className="text-xs text-muted-foreground">Caveat: {p.caveat}</p>
    </div>
  );
}

/* ───────────────────────── Small pieces ───────────────────────── */

function ObjectivePicker({ value, onChange }: { value?: Objective; onChange: (o: Objective) => void }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as Objective)}>
      <SelectTrigger className="h-8 w-56 bg-card text-xs">
        <SelectValue placeholder="Choose objective" />
      </SelectTrigger>
      <SelectContent>
        {OBJECTIVE_KEYS.map((k) => (
          <SelectItem key={k} value={k}>
            {OBJECTIVES[k].label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function BatchApprove({ itemType, ids }: { itemType: string; ids: string[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div className="mt-4 rounded-sm border border-approve/40 bg-approve-soft px-3 py-2.5 text-xs">
      <p>
        <span className="font-medium">Level 1 earned</span> for {itemType}. Approve all {ids.length} in one go.
      </p>
      <Button
        size="sm"
        className="mt-2"
        disabled={pending}
        onClick={() => start(async () => { const n = await decideMany(ids); toast.success(`Approved ${n} items in one go`, { description: "Each one is still logged with your name." }); router.refresh(); })}
      >
        Approve {ids.length} {itemType} items
      </Button>
    </div>
  );
}

/** Conversational refinement: one-tap instructions or your own words. Each creates a new version. */
function RefineBar({ onRefine, refining }: { onRefine: (s: string) => void; refining: boolean }) {
  const [text, setText] = useState("");
  const QUICK = ["Shorter", "Warmer", "More concrete", "Add a call to action", "Different angle"];
  return (
    <div className="mt-5 rounded-sm border border-dashed border-border px-4 py-3">
      <p className="kicker">Ask for changes</p>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
        {QUICK.map((q) => (
          <button key={q} disabled={refining} onClick={() => onRefine(q)} className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline disabled:opacity-40">
            {q}
          </button>
        ))}
      </div>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) { onRefine(text); setText(""); }
        }}
      >
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Mention the mentor programme, drop the second paragraph" className="h-9 bg-card" disabled={refining} />
        <Button type="submit" variant="outline" className="h-9" disabled={refining || !text.trim()}>
          {refining ? "Rewriting…" : "Refine"}
        </Button>
      </form>
    </div>
  );
}

/** Shows how close classification is to earning batch approval (autonomy Level 1). */
function LadderHint({ decided, unedited }: { decided: number; unedited: number }) {
  const need = AUTONOMY.level1MinItems;
  const rate = decided ? unedited / decided : 0;
  const ok = decided >= need && rate >= AUTONOMY.level1MinUneditedRate;
  return (
    <div className="mt-4 text-xs text-muted-foreground">
      <p>
        <span className="font-medium text-foreground">Batch approval for classifications:</span>{" "}
        {ok ? "earned. Switch it on in the Ledger." : `${Math.min(decided, need)}/${need} decided, ${Math.round(rate * 100)}% unedited (needs ${Math.round(AUTONOMY.level1MinUneditedRate * 100)}%).`}
      </p>
      <div className="mt-1.5 h-[3px] bg-muted">
        <div className="h-full bg-approve transition-all" style={{ width: `${Math.min(100, (decided / need) * 100)}%` }} />
      </div>
    </div>
  );
}

function StatusMark({ status }: { status: string }) {
  const map: Record<string, [string, string]> = { approved: ["✓", "text-approve"], edited: ["✎", "text-inferred"], rejected: ["✗", "text-pencil"] };
  const [sym, cls] = map[status] ?? ["·", ""];
  return <span className={cn("num w-3 shrink-0", cls)} title={status}>{sym}</span>;
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="num ml-1 rounded-[2px] border border-current/30 px-1 text-[0.6rem] opacity-60">{children}</kbd>;
}

function EmptyDesk() {
  return (
    <div className="pt-6">
      <p className="font-serif text-3xl italic">The desk is clear.</p>
      <p className="mt-3 max-w-md text-sm text-muted-foreground">Brief a new post, add material to the library, or ask ECHO what the numbers say.</p>
      <div className="mt-6 flex gap-2">
        <Button asChild><Link href="/write">Brief a post</Link></Button>
        <Button asChild variant="outline"><Link href="/signals">Read the signals</Link></Button>
      </div>
    </div>
  );
}

function timeAgo(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}
