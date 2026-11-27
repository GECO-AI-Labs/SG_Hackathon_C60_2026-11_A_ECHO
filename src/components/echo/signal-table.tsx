"use client";

import { ArrowDown, ArrowUp, Download } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { postDetailAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { DATA_RULES, FORMATS, METRICS, OBJECTIVES, type MetricKey } from "@/lib/domain";
import { median, objectiveBaselines, type PostRow, type Range } from "@/lib/echo/stats";
import { cn } from "@/lib/utils";

const pct = (v: number | null | undefined, d = 1) => (v == null ? "–" : `${(v * 100).toFixed(d)}%`);
const PAGE = 15;

type NumKey = "impressions" | "clicks" | "ctr" | "engagement_rate";
type SortKey = "published_date" | NumKey;
const COLUMNS: { key: NumKey; label: string; ratio: boolean }[] = [
  { key: "impressions", label: "Impr.", ratio: true },
  { key: "clicks", label: "Clicks", ratio: true },
  { key: "ctr", label: "CTR", ratio: true },
  { key: "engagement_rate", label: "Eng. rate", ratio: true },
];

/** Every post in view: sortable on each number, paged, searchable, exportable to CSV. */
export function SignalTable({ posts, allPosts, perPost, previous, showSinceLast, range, onSelect }: {
  posts: PostRow[];
  allPosts: PostRow[];
  perPost: Record<string, boolean>;
  previous: Record<string, { as_of: string; impressions: number }>;
  showSinceLast: boolean;
  range: Range;
  onSelect: (id: string) => void;
}) {
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "impressions", desc: true });
  const [pageRaw, setPage] = useState(0);
  const [q, setQ] = useState("");
  const [includeSmall, setIncludeSmall] = useState(false);

  // "High / low" compares with the page's all-time median for the sorted metric (impressions when sorted by date).
  const med = useMemo(() => {
    const c = allPosts.filter((p) => p.comparable);
    return Object.fromEntries(COLUMNS.map((col) => [col.key, median(c.map((p) => p[col.key] ?? 0))])) as Record<NumKey, number>;
  }, [allPosts]);
  const ratioKey: NumKey = sort.key === "published_date" ? "impressions" : sort.key;

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const r = posts.filter((p) => (includeSmall || p.comparable) && (!needle || p.text.toLowerCase().includes(needle) || (p.topic ?? "").toLowerCase().includes(needle)));
    const val = (p: PostRow) => (sort.key === "published_date" ? p.published_date : (p[sort.key] ?? -1));
    return r.sort((a, b) => (val(a) < val(b) ? 1 : val(a) > val(b) ? -1 : 0) * (sort.desc ? 1 : -1));
  }, [posts, includeSmall, q, sort]);

  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const page = Math.min(pageRaw, pages - 1); // filters can shrink the list under the current page
  const shown = rows.slice(page * PAGE, page * PAGE + PAGE);
  const small = posts.filter((p) => !p.comparable).length;

  const toggleSort = (key: SortKey) => { setPage(0); setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: true })); };

  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="kicker">Posts</p>
          <h2 className="text-2xl font-medium">Every post in view</h2>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder="Search text or topic" className="h-8 w-52 bg-card text-xs" aria-label="Search posts" />
          {small > 0 && (
            <label className="flex cursor-pointer items-center gap-1.5 text-muted-foreground">
              <input type="checkbox" checked={includeSmall} onChange={(e) => { setIncludeSmall(e.target.checked); setPage(0); }} className="accent-[var(--pencil)]" />
              Show {small} under {DATA_RULES.minImpressions} impressions
            </label>
          )}
          <Button size="sm" variant="outline" onClick={() => downloadCsv(rows, perPost, range)} disabled={!rows.length}>
            <Download className="size-3.5" /> CSV ({rows.length})
          </Button>
        </div>
      </div>

      {shown.length ? (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-foreground text-left">
                <Th onClick={() => toggleSort("published_date")} active={sort.key === "published_date"} desc={sort.desc}>Date</Th>
                <th className="kicker py-2 pr-3 font-normal">Post</th>
                <th className="kicker py-2 pr-3 font-normal">Format · topic</th>
                <th className="kicker py-2 pr-3 font-normal">Goal</th>
                {COLUMNS.map((c) => (
                  <Th key={c.key} right onClick={() => toggleSort(c.key)} active={sort.key === c.key} desc={sort.desc}>{c.label}</Th>
                ))}
                {showSinceLast && <th className="kicker py-2 pr-3 text-right font-normal">Since last</th>}
                <th className="kicker py-2 text-right font-normal" title={`Against the page's all-time median ${METRICS[ratioKey as MetricKey].label}`}>vs median</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => {
                const ratio = med[ratioKey] ? (p[ratioKey] ?? 0) / med[ratioKey] : 0;
                return (
                  <tr key={p.post_id} onClick={() => onSelect(p.post_id)} className={cn("cursor-pointer border-b border-border align-top hover:bg-muted/50", !p.comparable && "text-muted-foreground")}>
                    <td className="num py-2.5 pr-3 text-xs whitespace-nowrap text-muted-foreground">{p.published_date}</td>
                    <td className="py-2.5 pr-3"><span className="line-clamp-2 max-w-md">{p.text.split("\n")[0]}</span></td>
                    <td className="py-2.5 pr-3 text-xs">
                      {FORMATS[p.format] ?? p.format}
                      {p.topic && <span className="block text-muted-foreground">{p.topic}</span>}
                    </td>
                    <td className="py-2.5 pr-3 text-xs whitespace-nowrap" title={p.objective_status === "confirmed" ? "Confirmed by a reviewer" : "Inferred by ECHO, not confirmed"}>
                      {p.objective ? (
                        <>
                          {p.post_id in perPost ? (
                            <span className={perPost[p.post_id] ? "text-approve" : "text-pencil"}>{perPost[p.post_id] ? "✓ met" : "✗ missed"}</span>
                          ) : (
                            <span>not judged</span>
                          )}
                          <span className="block text-muted-foreground">{OBJECTIVES[p.objective].label}{p.objective_status !== "confirmed" && " (inferred)"}</span>
                        </>
                      ) : "–"}
                    </td>
                    <td className="num py-2.5 pr-3 text-right">{p.impressions?.toLocaleString()}</td>
                    <td className="num py-2.5 pr-3 text-right">{p.clicks}</td>
                    <td className="num py-2.5 pr-3 text-right">{pct(p.ctr)}</td>
                    <td className="num py-2.5 pr-3 text-right">{pct(p.engagement_rate)}</td>
                    {showSinceLast && (
                      <td className="num py-2.5 pr-3 text-right text-xs text-muted-foreground" title={previous[p.post_id] ? `Impressions on ${previous[p.post_id].as_of}` : "First report for this post"}>
                        {previous[p.post_id] ? `+${((p.impressions ?? 0) - previous[p.post_id].impressions).toLocaleString()}` : "new"}
                      </td>
                    )}
                    <td className={cn("num py-2.5 text-right text-xs", !p.comparable ? "text-muted-foreground" : ratio >= 1.5 ? "text-approve" : ratio < 0.5 ? "text-pencil" : "text-muted-foreground")}>
                      {!p.comparable ? `under ${DATA_RULES.minImpressions}` : <>{ratio >= 1.5 ? "▲ high" : ratio < 0.5 ? "▼ low" : ""} {ratio.toFixed(1)}×</>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-4 rounded-sm border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">No posts match.</p>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
        <p>
          Click a row for its full text and history. High = 1.5× the page&apos;s all-time median {METRICS[ratioKey as MetricKey].label.toLowerCase()} or more, low = under half.
          Posts under {DATA_RULES.minImpressions} impressions are never judged or compared.
        </p>
        {pages > 1 && (
          <span className="flex items-center gap-3">
            <button disabled={page === 0} onClick={() => setPage(page - 1)} className="underline-offset-4 hover:text-foreground hover:underline disabled:opacity-40">← Prev</button>
            <span className="num">{page + 1} / {pages}</span>
            <button disabled={page >= pages - 1} onClick={() => setPage(page + 1)} className="underline-offset-4 hover:text-foreground hover:underline disabled:opacity-40">Next →</button>
          </span>
        )}
      </div>
    </section>
  );
}

function Th({ children, onClick, active, desc, right }: { children: React.ReactNode; onClick: () => void; active: boolean; desc: boolean; right?: boolean }) {
  return (
    <th className={cn("py-2 pr-3 font-normal", right && "text-right")} aria-sort={active ? (desc ? "descending" : "ascending") : "none"}>
      <button onClick={onClick} className={cn("kicker inline-flex items-center gap-1 hover:text-foreground", active && "text-foreground")}>
        {children}
        {active && (desc ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />)}
      </button>
    </th>
  );
}

/* ───────────────────────── CSV ───────────────────────── */

function downloadCsv(rows: PostRow[], perPost: Record<string, boolean>, range: Range) {
  // A leading = + - @ makes Excel run the cell as a formula; prefix those with an apostrophe.
  const cell = (v: unknown) => {
    const s = v == null ? "" : String(v);
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const head = ["published_date", "url", "format", "topic", "objective", "objective_status", "goal_met", "impressions", "unique_impressions", "clicks", "reactions", "comments", "reposts", "ctr", "engagement_rate", "comparable", "has_link", "opening"];
  const lines = rows.map((p) => [
    p.published_date, p.url, FORMATS[p.format] ?? p.format, p.topic, p.objective ? OBJECTIVES[p.objective].label : "", p.objective ? p.objective_status : "",
    p.post_id in perPost ? (perPost[p.post_id] ? "met" : "missed") : "", p.impressions, p.unique_impressions, p.clicks, p.likes, p.comments, p.shares,
    p.ctr == null ? "" : p.ctr.toFixed(4), p.engagement_rate == null ? "" : p.engagement_rate.toFixed(4), p.comparable, !!p.has_link, p.text.split("\n")[0],
  ].map(cell).join(","));
  const blob = new Blob(["﻿" + [head.join(","), ...lines].join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `echo-posts-${range.from}-to-${range.to}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ───────────────────────── Post drawer ───────────────────────── */

type Detail = Awaited<ReturnType<typeof postDetailAction>>;

/** One post in full: text, numbers, goal verdict with the bar it had to beat, and its history across reporting periods. */
export function PostDrawer({ post, allPosts, perPost, onClose }: { post: PostRow | null; allPosts: PostRow[]; perPost: Record<string, boolean>; onClose: () => void }) {
  const router = useRouter();
  const [detail, setDetail] = useState<{ id: string; data: Detail } | null>(null);
  const baselines = useMemo(() => objectiveBaselines(allPosts), [allPosts]);

  useEffect(() => {
    if (!post) return;
    let live = true;
    postDetailAction(post.post_id)
      .then((data) => { if (live) setDetail({ id: post.post_id, data }); })
      .catch((e) => toast.error((e as Error).message));
    return () => { live = false; };
  }, [post]);

  const d = detail?.id === post?.post_id ? detail?.data : null;
  const goal = post?.objective ? OBJECTIVES[post.objective] : null;
  const goalMetric = goal?.primary[0];
  const snaps = d?.snapshots ?? [];

  return (
    <Sheet open={!!post} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        {post && (
          <>
            <SheetHeader>
              <p className="kicker">{post.published_date} · {FORMATS[post.format] ?? post.format}{post.topic ? ` · ${post.topic}` : ""}</p>
              <SheetTitle className="font-serif text-2xl leading-snug font-medium">{post.text.split("\n")[0]}</SheetTitle>
              <SheetDescription className="sr-only">Post details, goal result and history</SheetDescription>
            </SheetHeader>
            <div className="space-y-6 px-4 pb-8">
              <dl className="grid grid-cols-3 gap-x-4 gap-y-3 border-y border-border py-4">
                {([
                  ["Impressions", post.impressions?.toLocaleString()],
                  ["Unique", post.unique_impressions?.toLocaleString() ?? "–"],
                  ["Clicks", post.clicks],
                  ["CTR", pct(post.ctr)],
                  ["Eng. rate", pct(post.engagement_rate)],
                  ["Reactions · comments · reposts", `${post.likes ?? 0} · ${post.comments ?? 0} · ${post.shares ?? 0}`],
                ] as const).map(([k, v]) => (
                  <div key={k}><dt className="kicker">{k}</dt><dd className="num mt-0.5">{v ?? "–"}</dd></div>
                ))}
              </dl>

              <div>
                <p className="kicker">The post&apos;s goal</p>
                {goal && goalMetric ? (
                  <p className="mt-1 text-sm">
                    {goal.label}
                    <span className={post.objective_status === "confirmed" ? "text-muted-foreground" : "text-inferred"}>{post.objective_status === "confirmed" ? " · confirmed" : " · inferred, not confirmed"}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      Judged on {METRICS[goalMetric as MetricKey].label.toLowerCase()}. Bar to beat: {goalMetric === "engagement_rate" ? pct(baselines[goalMetric]) : Math.round(baselines[goalMetric]).toLocaleString()} (the page&apos;s all-time median).{" "}
                      {post.post_id in perPost ? (
                        <span className={perPost[post.post_id] ? "text-approve" : "text-pencil"}>{perPost[post.post_id] ? "✓ Met" : "✗ Missed"}</span>
                      ) : `Not judged: under ${DATA_RULES.minImpressions} impressions.`}
                    </span>
                  </p>
                ) : (
                  <p className="mt-1 text-sm text-muted-foreground">No goal yet. Classify it on the Desk (Gate 1).</p>
                )}
              </div>

              <div>
                <p className="kicker">History across reporting periods</p>
                {!d ? (
                  <p className="kicker mt-2 animate-pulse">Loading…</p>
                ) : snaps.length > 1 ? (
                  <>
                    <ChartContainer config={{ impressions: { label: "Impressions", color: "var(--chart-1)" } } satisfies ChartConfig} className="mt-2 h-36 w-full">
                      <LineChart data={snaps} margin={{ left: 0, right: 8, top: 8 }}>
                        <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                        <XAxis dataKey="as_of" tickLine={false} axisLine={false} className="num" tickFormatter={(v) => new Date(v).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })} />
                        <YAxis tickLine={false} axisLine={false} width={44} className="num" />
                        <ChartTooltip content={<ChartTooltipContent />} />
                        <Line dataKey="impressions" stroke="var(--chart-1)" strokeWidth={2} dot={{ r: 3 }} />
                      </LineChart>
                    </ChartContainer>
                    <table className="mt-2 w-full text-xs">
                      <thead><tr className="border-b border-border text-left"><th className="kicker py-1 font-normal">Report</th><th className="kicker py-1 text-right font-normal">Impr.</th><th className="kicker py-1 text-right font-normal">Clicks</th><th className="kicker py-1 text-right font-normal">Reactions</th></tr></thead>
                      <tbody>
                        {snaps.map((s) => (
                          <tr key={s.as_of} className="border-b border-border"><td className="num py-1">{s.as_of}</td><td className="num py-1 text-right">{s.impressions?.toLocaleString()}</td><td className="num py-1 text-right">{s.clicks}</td><td className="num py-1 text-right">{s.likes}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                ) : (
                  <p className="mt-1 text-xs text-muted-foreground">One report so far ({snaps[0]?.as_of ?? "–"}). Upload another LinkedIn report to see how this post kept growing.</p>
                )}
              </div>

              <div>
                <p className="kicker">Full text</p>
                <p className="mt-2 font-serif leading-relaxed whitespace-pre-line">{d?.text ?? post.text}</p>
              </div>

              <div className="flex flex-wrap gap-2">
                {d?.materialId && <Button onClick={() => router.push(`/write?source=${d.materialId}`)}>Write a post from this</Button>}
                <Button variant="outline" asChild><a href={post.url} target="_blank" rel="noreferrer">Open on LinkedIn</a></Button>
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
