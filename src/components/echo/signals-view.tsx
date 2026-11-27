"use client";

import NumberFlow from "@number-flow/react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, LabelList, Line, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { askAction, insightsAction, saveAnswerAsInsight, uploadPerformanceAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { DATA_RULES, FORMATS, METRICS, OBJECTIVES, type Objective } from "@/lib/domain";
import {
  addDays, bucketDaily, bucketOf, byFormat, byTopic, clipToData, describePostFilters, filterPosts, filtersToQuery, objectiveResults, rangeLabel, resolvePeriod, sumDaily,
  type DailyMetric, type DailyRow, type Filters, type PostRow,
} from "@/lib/echo/stats";
import { cn } from "@/lib/utils";
import { SignalFilters } from "./signal-filters";
import { SignalScatter } from "./signal-scatter";
import { PostDrawer, SignalTable } from "./signal-table";

const pct = (v: number | null | undefined, d = 1) => (v == null ? "–" : `${(v * 100).toFixed(d)}%`);
const shortDate = (v: string) => new Date(v).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

const COMPARE = {
  median_impressions: { label: "Median impressions", fmt: (v: number) => v.toLocaleString() },
  median_ctr: { label: "Median CTR", fmt: (v: number) => pct(v) },
  median_er: { label: "Median engagement rate", fmt: (v: number) => pct(v) },
} as const;
type CompareKey = keyof typeof COMPARE;

const KPI_LABELS = [
  ["impressions", "Impressions"],
  ["clicks", "Clicks"],
  ["new_followers", "New followers"],
  ["page_views", "Page views"],
] as const;

export function SignalsView(props: {
  initialFilters: Filters;
  anchor: string;
  daily: DailyRow[];
  reportPeriods: string[];
  previous: Record<string, { as_of: string; impressions: number; clicks: number }>;
  posts: PostRow[];
  audience: { total: number; employees: number; seniority: { value: string; n: number }[]; fn: { value: string; n: number }[] };
}) {
  const [filters, setFilters] = useState(props.initialFilters);
  const [trendMetric, setTrendMetric] = useState<"impressions" | "clicks" | "new_followers">("impressions");
  const [compare, setCompare] = useState<CompareKey>("median_impressions");
  const [selected, setSelected] = useState<string | null>(null);
  const [groupBy, setGroupBy] = useState<"format" | "topic">("format");

  // Filters live in the URL so a view can be bookmarked or shared. replaceState avoids a server round trip.
  useEffect(() => {
    const q = filtersToQuery(filters);
    window.history.replaceState(null, "", q ? `?${q}` : window.location.pathname);
  }, [filters]);

  const { cur, cmp } = useMemo(() => resolvePeriod(filters, props.anchor), [filters, props.anchor]);
  const inView = useMemo(() => filterPosts(props.posts, filters, cur), [props.posts, filters, cur]);
  const comparable = useMemo(() => inView.filter((p) => p.comparable), [inView]);
  const groups = useMemo(() => (groupBy === "format" ? byFormat(inView) : byTopic(inView)), [inView, groupBy]);
  // Bar to beat stays the all-time median, so a post's met/missed label never changes with filters.
  const results = useMemo(() => objectiveResults(inView, props.posts), [inView, props.posts]);
  const options = useMemo(() => ({
    formats: [...new Set(props.posts.map((p) => p.format))].sort((a, b) => (FORMATS[a] ?? a).localeCompare(FORMATS[b] ?? b)),
    topics: [...new Set(props.posts.map((p) => p.topic ?? "Unclassified"))].sort(),
  }), [props.posts]);

  // Page-level numbers: LinkedIn gives these per day for the whole page, so only the period applies.
  const pageFrom = props.daily[0]?.date;
  const kpiNow = sumDaily(props.daily, cur);
  const kpiBefore = cmp ? sumDaily(props.daily, cmp) : null;
  const trend = useMemo(() => {
    const curB = bucketDaily(props.daily, cur, filters.grain);
    const cmpB = cmp ? bucketDaily(props.daily, cmp, filters.grain) : [];
    const rows = curB.map((b, i) => ({
      key: b.key, days: b.days, value: b[trendMetric as DailyMetric],
      prevKey: cmpB[i]?.key ?? null, prev: cmpB[i]?.[trendMetric as DailyMetric] ?? null,
    }));
    // Trim the stretch before page data starts and after it ends: no data is not zero.
    let a = 0, z = rows.length;
    while (a < z && rows[a].value == null) a++;
    while (z > a && rows[z - 1].value == null) z--;
    return rows.slice(a, z);
  }, [props.daily, cur, cmp, filters.grain, trendMetric]);
  const trendShown = clipToData(cur, props.daily);

  const selectedPost = useMemo(() => props.posts.find((p) => p.post_id === selected) ?? null, [props.posts, selected]);
  const scope = [cur.label, ...describePostFilters(filters)].join(" · ");

  return (
    <div className="space-y-14">
      <header className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="kicker">Stage 03 · how it performs</p>
          <h1 className="mt-2 text-4xl font-medium">Signals</h1>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">
            Upskill Today page. Post stats from {DATA_RULES.statsFrom.slice(0, 4)}, page-wide stats from {pageFrom ? rangeLabel(pageFrom, pageFrom) : "–"}, both up to{" "}
            {rangeLabel(props.anchor, props.anchor)}. Periods end at the latest data, not today.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Reporting periods: {props.reportPeriods.map((d) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })).join(" · ") || "none"}
            {props.reportPeriods.length < 2 && ". Upload another report to see change over time."}
          </p>
        </div>
        <UploadReport />
      </header>

      <div className="-mt-6 !mb-8">
        <SignalFilters
          value={filters} onChange={setFilters} formats={options.formats} topics={options.topics}
          cur={cur} cmp={cmp} anchor={props.anchor} posts={inView.length} comparable={comparable.length}
        />
      </div>

      {/* KPI row: page-wide totals for the period, against the comparison period */}
      <section>
        <div className="grid grid-cols-2 lg:grid-cols-4">
          {KPI_LABELS.map(([k, label], i) => {
            const now = kpiNow[k];
            const before = kpiBefore?.[k] ?? 0;
            const showDelta = !!kpiBefore?.covered && before > 0;
            const delta = showDelta ? (now - before) / before : 0;
            return (
              <div key={k} className={cn("py-5 pr-4", i > 0 && "lg:border-l lg:pl-5", i % 2 === 1 && "border-l pl-4", "border-border")}>
                <p className="kicker">{label}</p>
                <p className="mt-2 font-serif text-[2.6rem] leading-none font-medium">
                  <NumberFlow value={now} />
                </p>
                {showDelta ? (
                  <p className={cn("num mt-2 text-xs", delta >= 0 ? "text-approve" : "text-pencil")}>
                    {delta >= 0 ? "▲" : "▼"} {Math.abs(delta * 100).toFixed(0)}% <span className="text-muted-foreground">vs {cmp!.label}</span>
                  </p>
                ) : (
                  <p className="mt-2 text-xs text-muted-foreground">{cmp ? `No full page data for ${cmp.label}` : "No comparison"}</p>
                )}
              </div>
            );
          })}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Page-wide totals{kpiNow.covered ? ` for ${cur.label}` : `: page data covers ${kpiNow.days} of the days in ${cur.label}`}. LinkedIn reports these for the whole page, so format, topic and goal filters do not apply here.
        </p>
      </section>

      {/* Trend */}
      <section>
        <SectionHead kicker="Trend · page-wide" title={`${filters.grain === "day" ? "Day" : filters.grain === "week" ? "Week" : "Month"} by ${filters.grain}`}>
          <Segmented value={trendMetric} onChange={setTrendMetric} options={{ impressions: "Impressions", clicks: "Clicks", new_followers: "New followers" }} />
        </SectionHead>
        {trend.length ? (
          <ChartContainer
            config={{ value: { label: trendShown?.label ?? cur.label, color: "var(--chart-1)" }, prev: { label: cmp?.label ?? "Comparison", color: "var(--chart-5)" } } satisfies ChartConfig}
            className="mt-4 h-64 w-full"
          >
            <ComposedChart data={trend} margin={{ left: 0, right: 8, top: 8 }}>
              <defs>
                <linearGradient id="fillTrend" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.18} />
                  <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
              <XAxis dataKey="key" tickLine={false} axisLine={false} tickMargin={8} minTickGap={40} tickFormatter={(v) => (filters.grain === "month" ? new Date(v).toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" }) : shortDate(v))} className="num" />
              <YAxis tickLine={false} axisLine={false} width={44} className="num" />
              <ChartTooltip
                cursor={{ stroke: "var(--muted-foreground)", strokeDasharray: "3 3" }}
                content={
                  <ChartTooltipContent
                    labelFormatter={(_, items) => {
                      const r = items?.[0]?.payload as (typeof trend)[number] | undefined;
                      if (!r) return "";
                      const what = filters.grain === "day" ? rangeLabel(r.key, r.key) : `${filters.grain === "week" ? "Week" : "Month"} of ${rangeLabel(r.key, r.key)}`;
                      const full = filters.grain === "day" ? 1 : filters.grain === "week" ? 7 : new Date(Date.UTC(+r.key.slice(0, 4), +r.key.slice(5, 7), 0)).getUTCDate();
                      return `${what}${r.days < full ? ` (partial: ${r.days} days)` : ""}`;
                    }}
                    formatter={(v, name, item) => (
                      <span className="flex w-full justify-between gap-4">
                        <span className="text-muted-foreground">{name === "prev" ? `Compare: ${item.payload.prevKey ? shortDate(item.payload.prevKey) : "–"}` : "This period"}</span>
                        <span className="num">{Number(v).toLocaleString()}</span>
                      </span>
                    )}
                  />
                }
              />
              <Area dataKey="value" type="monotone" stroke="var(--chart-1)" strokeWidth={2} fill="url(#fillTrend)" connectNulls={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--background)" }} />
              {cmp && <Line dataKey="prev" type="monotone" stroke="var(--chart-5)" strokeWidth={1.5} strokeDasharray="4 4" dot={false} connectNulls={false} />}
            </ComposedChart>
          </ChartContainer>
        ) : (
          <p className="mt-4 rounded-sm border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">No page-wide data in {cur.label}. Page data starts {pageFrom ? rangeLabel(pageFrom, pageFrom) : "later"}.</p>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          {METRICS[trendMetric].def} {filters.grain === "week" ? "Weeks run Monday to Sunday." : ""} {cmp && "Dashed line: the comparison period, lined up bucket by bucket."} Gaps mean no data, not zero.
        </p>
      </section>

      {/* Results against objectives */}
      <ObjectiveResults results={results} />
      <HitRateTrend posts={inView} perPost={results.perPost} grain={filters.grain} from={cur.from} to={cur.to} />

      {/* Format / topic comparison */}
      <section className="grid gap-10 lg:grid-cols-[1.4fr_1fr]">
        <div>
          <SectionHead kicker="Compare" title={groupBy === "format" ? "Which formats work" : "Which topics work"}>
            <div className="flex flex-wrap items-center gap-6">
              <Segmented value={groupBy} onChange={setGroupBy} options={{ format: "By format", topic: "By topic" }} />
              <Segmented value={compare} onChange={setCompare} options={{ median_impressions: "Impressions", median_ctr: "CTR", median_er: "Engagement" }} />
            </div>
          </SectionHead>
          {groups.length ? (
            <ChartContainer config={{ v: { label: COMPARE[compare].label, color: "var(--chart-2)" } }} className="mt-4 w-full" style={{ height: Math.max(120, groups.length * 30 + 24) }}>
              <BarChart data={groups} layout="vertical" margin={{ left: 8, right: 56 }}>
                <CartesianGrid horizontal={false} stroke="var(--chart-grid)" />
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="label" width={140} tickLine={false} axisLine={false} tick={{ fontSize: 12 }} />
                <ChartTooltip cursor={{ fill: "var(--muted)" }} content={<ChartTooltipContent formatter={(v, _n, item) => `${COMPARE[compare].fmt(Number(v))} · ${item.payload.posts} posts${item.payload.lowSample ? " (low sample)" : ""}`} hideIndicator />} />
                <Bar dataKey={compare} radius={[0, 3, 3, 0]} barSize={16}>
                  {groups.map((f) => (
                    <Cell key={f.format} fill="var(--chart-2)" fillOpacity={f.lowSample ? 0.35 : 1} />
                  ))}
                  <LabelList dataKey={compare} position="right" className="num fill-foreground" fontSize={11} formatter={(v: unknown) => COMPARE[compare].fmt(Number(v))} />
                </Bar>
              </BarChart>
            </ChartContainer>
          ) : (
            <Empty />
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            Medians over comparable posts in view. Faded bars have fewer than {DATA_RULES.lowSampleMin} posts: too few to trust.
          </p>
        </div>

        <aside className="space-y-6 border-t border-border pt-6 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-8">
          <p className="kicker">Read before you conclude</p>
          <Rule n="1" title={`${DATA_RULES.minImpressions}-impression floor`}>{DATA_RULES.minImpressionsWhy}</Rule>
          <Rule n="2" title="Who is engaging?">
            {DATA_RULES.audienceCaveat} {props.audience.employees} of {props.audience.total.toLocaleString()} followers are listed as employees.
          </Rule>
          <Rule n="3" title="Comments are near zero">So engagement is a weak signal here. Judge awareness by impressions, conversion by clicks.</Rule>
          <details className="text-xs text-muted-foreground">
            <summary className="kicker cursor-pointer">Metric definitions</summary>
            <dl className="mt-3 space-y-2">
              {Object.values(METRICS).map((m) => (
                <div key={m.label}>
                  <dt className="font-medium text-foreground">{m.label}</dt>
                  <dd>{m.def}</dd>
                </div>
              ))}
            </dl>
          </details>
        </aside>
      </section>

      {/* Reach vs clicks, engagement vs clicks (brief §8E) */}
      <SignalScatter posts={inView} allPosts={props.posts} onSelect={setSelected} />

      {/* Every post in view */}
      <SignalTable
        posts={inView} allPosts={props.posts} perPost={results.perPost} previous={props.previous}
        showSinceLast={props.reportPeriods.length > 1} range={cur} onSelect={setSelected}
      />

      <section className="grid gap-10 lg:grid-cols-[1.4fr_1fr]">
        <AskEcho query={filtersToQuery(filters)} scope={scope} />
        <div>
          <p className="kicker">Who follows the page</p>
          <p className="mt-1 text-xs text-muted-foreground">Page-wide only. LinkedIn does not say who saw or engaged with a given post.</p>
          <div className="mt-4 grid grid-cols-2 gap-6 text-xs">
            {[["Seniority", props.audience.seniority], ["Function", props.audience.fn]].map(([label, rows]) => (
              <div key={label as string}>
                <p className="font-medium">{label as string}</p>
                <ul className="mt-2 space-y-1.5">
                  {(rows as { value: string; n: number }[]).map((r) => (
                    <li key={r.value}>
                      <div className="flex justify-between gap-2"><span className="truncate">{r.value}</span><span className="num">{r.n}</span></div>
                      <div className="mt-0.5 h-[3px] bg-muted"><div className="h-full bg-chart-2" style={{ width: `${(r.n / Math.max(1, props.audience.total)) * 100}%` }} /></div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      <PostDrawer post={selectedPost} allPosts={props.posts} perPost={results.perPost} onClose={() => setSelected(null)} />
    </div>
  );
}

function Empty() {
  return <p className="mt-4 rounded-sm border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">No comparable posts match these filters. Widen the period or clear a filter.</p>;
}

/* ───────────────────────── pieces ───────────────────────── */

function SectionHead({ kicker, title, children }: { kicker: string; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="kicker">{kicker}</p>
        <h2 className="text-2xl font-medium">{title}</h2>
      </div>
      {children}
    </div>
  );
}

function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: Record<T, string> }) {
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

function Rule({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[1.5rem_1fr] text-sm">
      <span className="num text-pencil">{n}</span>
      <div>
        <p className="font-medium">{title}</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{children}</p>
      </div>
    </div>
  );
}

type Answer = Awaited<ReturnType<typeof askAction>>;

function AskEcho({ query, scope }: { query: string; scope: string }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [asked, setAsked] = useState("");
  const [askedScope, setAskedScope] = useState("");
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [pending, start] = useTransition();
  const [saving, startSave] = useTransition();

  const ask = (question: string) =>
    start(async () => {
      try {
        setAsked(question);
        setAnswer(await askAction(question, query));
        setAskedScope(scope);
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  const review = () =>
    start(async () => {
      try {
        const n = await insightsAction(undefined, query);
        toast.success(`${n} insight${n === 1 ? "" : "s"} on your Desk for Gate 4`);
        router.push("/");
      } catch (e) {
        toast.error((e as Error).message);
      }
    });

  return (
    <div>
      <p className="kicker">Stage 04 · what next</p>
      <h2 className="mt-1 text-2xl font-medium">Ask ECHO</h2>
      <p className="mt-1 text-sm text-muted-foreground">Ask about the numbers above. ECHO answers from the aggregates only and keeps what it saw apart from why it might be.</p>
      <p className="mt-2 text-xs"><span className="kicker mr-2">Answers from</span>{scope}</p>
      <form onSubmit={(e) => { e.preventDefault(); if (q.trim()) ask(q); }} className="mt-4 flex gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Which posts get clicks rather than just reactions?" className="h-10 bg-card" />
        <Button type="submit" disabled={pending || !q.trim()} className="h-10">Ask</Button>
      </form>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {["What topics should we develop next?", "Which topics reach people but get no clicks?"].map((s) => (
          <button key={s} onClick={() => { setQ(s); ask(s); }} disabled={pending} className="underline-offset-4 hover:text-foreground hover:underline">{s}</button>
        ))}
        <button onClick={review} disabled={pending} className="underline-offset-4 hover:text-foreground hover:underline">Review this view for Gate 4 →</button>
        {pending && <span className="kicker animate-pulse">Thinking… about 20 seconds</span>}
      </div>

      {answer && !pending && (
        <div className="mt-6 rounded-sm border border-border bg-card px-5 py-5">
          <p className="kicker">“{asked}” · {askedScope}</p>
          <p className="mt-2 font-serif text-[1.15rem] leading-relaxed">{answer.answer}</p>
          {answer.evidence?.length > 0 && (
            <ul className="mt-3 space-y-0.5">{answer.evidence.map((e, i) => <li key={i} className="num text-[0.75rem] text-muted-foreground">— {e}</li>)}</ul>
          )}
          <div className="mt-4 grid gap-4 border-t border-dashed border-border pt-4 text-sm md:grid-cols-2">
            <div>
              <p className="kicker text-foreground">Observed</p>
              <p className="mt-1">{answer.observed_trend}</p>
            </div>
            <div>
              <p className="kicker">Possible explanation · not proven</p>
              <p className="mt-1 text-foreground/75 italic">{answer.possible_explanation}</p>
            </div>
          </div>
          <p className="mt-4 text-sm"><span className="kicker mr-2">Try next</span>{answer.recommendation}</p>
          <p className="mt-2 text-xs text-muted-foreground">Caveat: {answer.caveat}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={saving}
              onClick={() => startSave(async () => { await saveAnswerAsInsight(asked, answer, askedScope); toast.success("Saved to the Desk for Gate 4"); router.refresh(); })}
            >
              Save as insight (Gate 4)
            </Button>
            <Button size="sm" variant="outline" onClick={() => router.push(`/write?brief=${encodeURIComponent(answer.recommendation)}`)}>
              Write a post from this
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function UploadReport() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10));
  const [preview, setPreview] = useState<{ file: string; sheet: string; mapped: Record<string, string>; rows: Record<string, string>[]; report: Awaited<ReturnType<typeof uploadPerformanceAction>> } | null>(null);

  const onFile = async (f: File) => {
    try {
      const { parseReport } = await import("@/lib/echo/report-parse");
      const { rows, mapped, sheet } = parseReport(await f.arrayBuffer());
      if (!mapped.impressions) throw new Error("No Impressions column found. Is this a LinkedIn post performance report?");
      start(async () => {
        const report = await uploadPerformanceAction(rows, asOf, true);
        setPreview({ file: f.name, sheet, mapped, rows, report });
      });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap items-end gap-2 text-xs">
        <label className="space-y-1">
          <span className="kicker block">Report date</span>
          <Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className="h-9 w-40 bg-card" />
        </label>
        <label className={cn("inline-flex h-9 cursor-pointer items-center rounded-sm border border-foreground px-3 text-sm hover:bg-foreground hover:text-background", pending && "opacity-50")}>
          {pending ? "Reading…" : "Upload LinkedIn report"}
          <input type="file" accept=".csv,.xlsx,.xls" className="sr-only" disabled={pending} onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
        </label>
      </div>
      <p className="text-[0.7rem] text-muted-foreground">LinkedIn&apos;s own export (XLSX) or CSV. Each upload is one reporting period.</p>

      {preview && (
        <div className="mt-1 w-full max-w-md rounded-sm border border-border bg-card p-4 text-left text-sm">
          <p className="kicker">Check before importing</p>
          <p className="mt-2 font-medium">{preview.file}{preview.sheet ? ` · sheet “${preview.sheet}”` : ""}</p>
          <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
            <li><span className="num text-foreground">{preview.report.received}</span> rows read, <span className="num text-foreground">{preview.report.metrics}</span> with stats</li>
            <li><span className="num text-foreground">{preview.report.matched}</span> matched to known posts{preview.report.matched_by_text ? ` (${preview.report.matched_by_text} by date and opening text)` : ""}</li>
            <li><span className="num text-foreground">{preview.report.added}</span> new posts, <span className="num text-foreground">{preview.report.skipped}</span> skipped (no date)</li>
            <li>Saved as the period of <span className="num text-foreground">{preview.report.as_of}</span></li>
          </ul>
          <p className="mt-2 text-[0.7rem] text-muted-foreground">Columns used: {Object.entries(preview.mapped).map(([k, v]) => `${v} → ${k}`).join(", ")}</p>
          <div className="mt-3 flex gap-2">
            <Button
              size="sm"
              disabled={pending}
              onClick={() => start(async () => {
                const r = await uploadPerformanceAction(preview.rows, asOf);
                toast.success(`Imported: ${r.matched} matched, ${r.added} new`, {
                  description: `Period ${r.as_of}${r.drafts_linked ? ` · ${r.drafts_linked} approved draft(s) found published` : ""}`,
                });
                setPreview(null);
                router.refresh();
              })}
            >
              Import
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPreview(null)}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** "Every content hits objectives": did each post reach the typical post on the metric its goal cares about? */
function ObjectiveResults({ results }: { results: { total: number; met: number; byObjective: { objective: Objective; metric: string; baseline: number; posts: number; met: number; confirmed: number }[] } }) {
  if (!results.total) return null;
  const share = Math.round((results.met / results.total) * 100);
  const fmtBase = (m: string, v: number) => (m === "engagement_rate" || m === "ctr" ? pct(v) : Math.round(v).toLocaleString());
  const inferred = results.byObjective.reduce((s, o) => s + o.posts - o.confirmed, 0);
  return (
    <section className="grid gap-10 lg:grid-cols-[1fr_1.6fr]">
      <div>
        <p className="kicker">Results against objectives</p>
        <h2 className="text-2xl font-medium">Did posts hit their goal?</h2>
        <p className="mt-4 font-serif text-6xl leading-none">
          <NumberFlow value={share} />
          <span className="text-3xl">%</span>
        </p>
        <p className="mt-3 text-sm text-muted-foreground">
          {results.met} of {results.total} posts reached the page&apos;s typical post on the one metric their goal cares about. Awareness posts are judged on impressions, lead
          generation on clicks, engagement on engagement rate, not on likes for everyone.
        </p>
        {inferred > 0 && (
          <p className="mt-3 text-xs text-inferred">
            {inferred} of these goals are still inferred by ECHO. Confirm them on the Desk (Gate 1) to make this number yours.
          </p>
        )}
      </div>
      <table className="w-full self-start text-sm">
        <thead>
          <tr className="border-b border-foreground text-left">
            <th className="kicker py-2 pr-3 font-normal">Goal</th>
            <th className="kicker py-2 pr-3 font-normal">Judged on</th>
            <th className="kicker py-2 pr-3 text-right font-normal">Bar to beat</th>
            <th className="kicker py-2 pr-3 text-right font-normal">Posts</th>
            <th className="kicker py-2 text-right font-normal">Met</th>
          </tr>
        </thead>
        <tbody>
          {results.byObjective.map((o) => {
            const rate = o.posts ? o.met / o.posts : 0;
            return (
              <tr key={o.objective} className="border-b border-border">
                <td className="py-2.5 pr-3 font-medium">{OBJECTIVES[o.objective].label}</td>
                <td className="py-2.5 pr-3 text-xs text-muted-foreground">{METRICS[o.metric as keyof typeof METRICS]?.label ?? o.metric}</td>
                <td className="num py-2.5 pr-3 text-right text-xs">{fmtBase(o.metric, o.baseline)}</td>
                <td className="num py-2.5 pr-3 text-right">{o.posts}{o.posts < DATA_RULES.lowSampleMin && <span className="ml-1 text-[0.6rem] text-muted-foreground">low</span>}</td>
                <td className="py-2.5 text-right">
                  <span className="num">{Math.round(rate * 100)}%</span>
                  <div className="mt-1 ml-auto h-[3px] w-20 bg-muted"><div className="h-full bg-chart-2" style={{ width: `${rate * 100}%` }} /></div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

/** Share of posts meeting their goal, per month (or week). Same fixed bar to beat as the table above. */
function HitRateTrend({ posts, perPost, grain, from, to }: { posts: PostRow[]; perPost: Record<string, boolean>; grain: Filters["grain"]; from: string; to: string }) {
  const g = grain === "day" ? "week" : grain; // a handful of posts per day is noise
  const data = useMemo(() => {
    const judged = posts.filter((p) => p.post_id in perPost);
    if (!judged.length) return [];
    const first = judged.reduce((m, p) => (p.published_date < m ? p.published_date : m), to);
    const buckets = new Map<string, { key: string; posts: number; met: number }>();
    // Every bucket from the first judged post to the end of the period, so empty months show as gaps.
    for (let day = first > from ? first : from; day <= to; day = addDays(day, 1)) {
      const key = bucketOf(day, g);
      if (!buckets.has(key)) buckets.set(key, { key, posts: 0, met: 0 });
    }
    judged.forEach((p) => {
      const b = buckets.get(bucketOf(p.published_date, g));
      if (b) { b.posts++; if (perPost[p.post_id]) b.met++; }
    });
    return [...buckets.values()].map((b) => ({ ...b, rate: b.posts ? b.met / b.posts : null, few: b.posts < 3 }));
  }, [posts, perPost, g, from, to]);

  if (data.length < 2) return null;
  return (
    <section className="-mt-6">
      <p className="kicker">Goal hit rate by {g}</p>
      <ChartContainer config={{ rate: { label: "Met their goal", color: "var(--chart-2)" } } satisfies ChartConfig} className="mt-3 h-40 w-full">
        <BarChart data={data} margin={{ left: 0, right: 8, top: 4 }}>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey="key" tickLine={false} axisLine={false} tickMargin={8} minTickGap={32} className="num"
            tickFormatter={(v) => (g === "month" ? new Date(v).toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" }) : shortDate(v))} />
          <YAxis domain={[0, 1]} ticks={[0, 0.5, 1]} tickFormatter={(v) => `${Math.round(v * 100)}%`} tickLine={false} axisLine={false} width={40} className="num" />
          <ChartTooltip
            cursor={{ fill: "var(--muted)" }}
            content={
              <ChartTooltipContent
                hideIndicator
                labelFormatter={(_, items) => { const r = items?.[0]?.payload; return r ? `${g === "month" ? "Month" : "Week"} of ${rangeLabel(r.key, r.key)}` : ""; }}
                formatter={(_v, _n, item) => item.payload.posts ? `${item.payload.met} of ${item.payload.posts} posts met their goal${item.payload.few ? " (too few to read much into)" : ""}` : "No judged posts"}
              />
            }
          />
          <Bar dataKey="rate" radius={[3, 3, 0, 0]} maxBarSize={28}>
            {data.map((d) => <Cell key={d.key} fill="var(--chart-2)" fillOpacity={d.few ? 0.35 : 1} />)}
          </Bar>
        </BarChart>
      </ChartContainer>
      <p className="mt-1 text-xs text-muted-foreground">Faded bars: fewer than 3 posts with a goal that {g}. Gaps: no posts.</p>
    </section>
  );
}
