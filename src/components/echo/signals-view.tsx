"use client";

import NumberFlow from "@number-flow/react";
import Papa from "papaparse";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, LabelList, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { insightsAction, uploadPerformanceAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { DATA_RULES, FORMATS, METRICS } from "@/lib/domain";
import type { PostRow } from "@/lib/echo/analyse";
import { cn } from "@/lib/utils";

type KPI = { now: number; before: number };
type FormatRow = { format: string; label: string; posts: number; lowSample: boolean; median_impressions: number; median_ctr: number; median_er: number; median_clicks: number };

const pct = (v: number | null | undefined, d = 1) => (v == null ? "–" : `${(v * 100).toFixed(d)}%`);

const COMPARE = {
  median_impressions: { label: "Median impressions", fmt: (v: number) => v.toLocaleString() },
  median_ctr: { label: "Median CTR", fmt: (v: number) => pct(v) },
  median_er: { label: "Median engagement rate", fmt: (v: number) => pct(v) },
} as const;
type CompareKey = keyof typeof COMPARE;

export function SignalsView(props: {
  kpis: Record<"impressions" | "clicks" | "new_followers" | "page_views", KPI>;
  weekly: { week: string; impressions: number; clicks: number; new_followers: number }[];
  formats: FormatRow[];
  posts: PostRow[];
  audience: { total: number; employees: number; seniority: { value: string; n: number }[]; fn: { value: string; n: number }[] };
  lastDate: string;
}) {
  const [trendMetric, setTrendMetric] = useState<"impressions" | "clicks" | "new_followers">("impressions");
  const [compare, setCompare] = useState<CompareKey>("median_impressions");
  const [sortBy, setSortBy] = useState<"impressions" | "ctr" | "clicks">("impressions");
  const [fmt, setFmt] = useState<string>("all");

  const comparable = props.posts.filter((p) => p.comparable);
  const excluded = props.posts.length - comparable.length;
  const ranked = useMemo(
    () => comparable.filter((p) => fmt === "all" || p.format === fmt).sort((a, b) => (b[sortBy] ?? 0) - (a[sortBy] ?? 0)),
    [comparable, sortBy, fmt],
  );
  const medianOf = (k: "impressions" | "ctr" | "clicks") => {
    const s = comparable.map((p) => p[k] ?? 0).sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)] ?? 0;
  };
  const med = { impressions: medianOf("impressions"), ctr: medianOf("ctr"), clicks: medianOf("clicks") };

  return (
    <div className="space-y-14">
      <header className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="kicker">Stage 03 · how it performs</p>
          <h1 className="mt-2 text-4xl font-medium">Signals</h1>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">
            Upskill Today page, {DATA_RULES.statsFrom.slice(0, 4)} to {props.lastDate}. {comparable.length} posts are comparable;{" "}
            {excluded} with under {DATA_RULES.minImpressions} impressions are left out.
          </p>
        </div>
        <UploadReport />
      </header>

      {/* KPI row: last 90 days vs the 90 before */}
      <section className="grid grid-cols-2 lg:grid-cols-4">
        {(
          [
            ["impressions", "Impressions"],
            ["clicks", "Clicks"],
            ["new_followers", "New followers"],
            ["page_views", "Page views"],
          ] as const
        ).map(([k, label], i) => {
          const { now, before } = props.kpis[k];
          const delta = before ? (now - before) / before : 0;
          return (
            <div key={k} className={cn("py-5 pr-4", i > 0 && "lg:border-l lg:pl-5", i % 2 === 1 && "border-l pl-4", "border-border")}>
              <p className="kicker">{label} · 90 days</p>
              <p className="mt-2 font-serif text-[2.6rem] leading-none font-medium">
                <NumberFlow value={now} />
              </p>
              <p className={cn("num mt-2 text-xs", delta >= 0 ? "text-approve" : "text-pencil")}>
                {delta >= 0 ? "▲" : "▼"} {Math.abs(delta * 100).toFixed(0)}% <span className="text-muted-foreground">vs previous 90 days</span>
              </p>
            </div>
          );
        })}
      </section>

      {/* Trend */}
      <section>
        <SectionHead kicker="Trend" title="Week by week">
          <Segmented value={trendMetric} onChange={setTrendMetric} options={{ impressions: "Impressions", clicks: "Clicks", new_followers: "New followers" }} />
        </SectionHead>
        <ChartContainer config={{ [trendMetric]: { label: METRICS[trendMetric].label, color: "var(--chart-1)" } } satisfies ChartConfig} className="mt-4 h-64 w-full">
          <AreaChart data={props.weekly} margin={{ left: 0, right: 8, top: 8 }}>
            <defs>
              <linearGradient id="fillTrend" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.18} />
                <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
            <XAxis dataKey="week" tickLine={false} axisLine={false} tickMargin={8} minTickGap={40} tickFormatter={(v) => new Date(v).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} className="num" />
            <YAxis tickLine={false} axisLine={false} width={44} className="num" />
            <ChartTooltip cursor={{ stroke: "var(--muted-foreground)", strokeDasharray: "3 3" }} content={<ChartTooltipContent labelFormatter={(v) => `Week of ${new Date(v).toLocaleDateString("en-GB", { day: "numeric", month: "long" })}`} />} />
            <Area dataKey={trendMetric} type="monotone" stroke="var(--chart-1)" strokeWidth={2} fill="url(#fillTrend)" activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--background)" }} />
          </AreaChart>
        </ChartContainer>
        <p className="mt-2 text-xs text-muted-foreground">{METRICS[trendMetric].def} Weekly totals, Monday to Sunday.</p>
      </section>

      {/* Format comparison */}
      <section className="grid gap-10 lg:grid-cols-[1.4fr_1fr]">
        <div>
          <SectionHead kicker="Compare" title="Which formats work">
            <Segmented value={compare} onChange={setCompare} options={{ median_impressions: "Impressions", median_ctr: "CTR", median_er: "Engagement" }} />
          </SectionHead>
          <ChartContainer config={{ v: { label: COMPARE[compare].label, color: "var(--chart-2)" } }} className="mt-4 h-72 w-full">
            <BarChart data={props.formats} layout="vertical" margin={{ left: 8, right: 56 }}>
              <CartesianGrid horizontal={false} stroke="var(--chart-grid)" />
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="label" width={120} tickLine={false} axisLine={false} tick={{ fontSize: 12 }} />
              <ChartTooltip cursor={{ fill: "var(--muted)" }} content={<ChartTooltipContent formatter={(v, _n, item) => `${COMPARE[compare].fmt(Number(v))} · ${item.payload.posts} posts${item.payload.lowSample ? " (low sample)" : ""}`} hideIndicator />} />
              <Bar dataKey={compare} radius={[0, 3, 3, 0]} barSize={16}>
                {props.formats.map((f) => (
                  <Cell key={f.format} fill="var(--chart-2)" fillOpacity={f.lowSample ? 0.35 : 1} />
                ))}
                <LabelList dataKey={compare} position="right" className="num fill-foreground" fontSize={11} formatter={(v: unknown) => COMPARE[compare].fmt(Number(v))} />
              </Bar>
            </BarChart>
          </ChartContainer>
          <p className="mt-2 text-xs text-muted-foreground">
            Medians over comparable posts. Faded bars have fewer than {DATA_RULES.lowSampleMin} posts: too few to trust.
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

      {/* Post table */}
      <section>
        <SectionHead kicker="Posts" title="Best and weakest">
          <div className="flex flex-wrap items-center gap-6">
            <Segmented value={sortBy} onChange={setSortBy} options={{ impressions: "Impressions", clicks: "Clicks", ctr: "CTR" }} />
            <Select value={fmt} onValueChange={setFmt}>
              <SelectTrigger size="sm" className="w-40 bg-card text-xs"><SelectValue /></SelectTrigger>
              <SelectContent align="end">
                <SelectItem value="all">All formats</SelectItem>
                {props.formats.map((f) => <SelectItem key={f.format} value={f.format}>{f.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </SectionHead>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-foreground text-left">
                <th className="kicker py-2 pr-3 font-normal">Date</th>
                <th className="kicker py-2 pr-3 font-normal">Post</th>
                <th className="kicker py-2 pr-3 font-normal">Format</th>
                <th className="kicker py-2 pr-3 text-right font-normal">Impr.</th>
                <th className="kicker py-2 pr-3 text-right font-normal">Clicks</th>
                <th className="kicker py-2 pr-3 text-right font-normal">CTR</th>
                <th className="kicker py-2 text-right font-normal">vs median</th>
              </tr>
            </thead>
            <tbody>
              {[...ranked.slice(0, 6), ...(ranked.length > 12 ? ranked.slice(-4) : [])].map((p, i, arr) => {
                const ratio = med[sortBy] ? (p[sortBy] ?? 0) / med[sortBy] : 0;
                const isBottom = ranked.length > 12 && i >= arr.length - 4;
                return (
                  <tr key={p.post_id} className={cn("border-b border-border align-top", isBottom && i === arr.length - 4 && "border-t-2 border-t-foreground/20")}>
                    <td className="num py-2.5 pr-3 text-xs whitespace-nowrap text-muted-foreground">{p.published_date}</td>
                    <td className="py-2.5 pr-3">
                      <a href={p.url} target="_blank" rel="noreferrer" className="line-clamp-2 max-w-md hover:underline">{p.text.split("\n")[0]}</a>
                    </td>
                    <td className="py-2.5 pr-3 text-xs">{FORMATS[p.format] ?? p.format}</td>
                    <td className="num py-2.5 pr-3 text-right">{p.impressions?.toLocaleString()}</td>
                    <td className="num py-2.5 pr-3 text-right">{p.clicks}</td>
                    <td className="num py-2.5 pr-3 text-right">{pct(p.ctr)}</td>
                    <td className={cn("num py-2.5 text-right text-xs", ratio >= 1.5 ? "text-approve" : ratio < 0.5 ? "text-pencil" : "text-muted-foreground")}>
                      {ratio >= 1.5 ? "▲ high" : ratio < 0.5 ? "▼ low" : ""} {ratio.toFixed(1)}×
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Top 6 and bottom 4 by the selected metric. High = 1.5× the median or more, low = under half.</p>
      </section>

      <section className="grid gap-10 lg:grid-cols-[1.4fr_1fr]">
        <AskEcho />
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
    </div>
  );
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

function AskEcho() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [pending, start] = useTransition();
  const ask = (question?: string) =>
    start(async () => {
      try {
        const n = await insightsAction(question);
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
      <p className="mt-1 text-sm text-muted-foreground">ECHO reads the aggregates above (never raw guesses) and drafts insight cards. You approve them at Gate 4 before they shape new posts.</p>
      <form onSubmit={(e) => { e.preventDefault(); ask(q); }} className="mt-4 flex gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Which posts get clicks rather than just reactions?" className="h-10 bg-card" />
        <Button type="submit" disabled={pending || !q.trim()} className="h-10">Ask</Button>
      </form>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <button onClick={() => ask()} disabled={pending} className="underline underline-offset-4 hover:text-foreground">Or: review the period and suggest next topics</button>
        {pending && <span className="kicker animate-pulse">Analysing… about 20 seconds</span>}
      </div>
    </div>
  );
}

function UploadReport() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10));
  return (
    <div className="flex flex-wrap items-end gap-2 text-xs">
      <label className="space-y-1">
        <span className="kicker block">Report date</span>
        <Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className="h-9 w-40 bg-card" />
      </label>
      <label className={cn("inline-flex h-9 cursor-pointer items-center rounded-sm border border-foreground px-3 text-sm hover:bg-foreground hover:text-background", pending && "opacity-50")}>
        {pending ? "Importing…" : "Upload performance CSV"}
        <input
          type="file"
          accept=".csv"
          className="sr-only"
          disabled={pending}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            Papa.parse<Record<string, string>>(f, {
              header: true,
              skipEmptyLines: true,
              complete: (res) =>
                start(async () => {
                  try {
                    const r = await uploadPerformanceAction(res.data, asOf);
                    toast.success(`${r.matched} posts matched, ${r.added} new, ${r.metrics} with stats`, { description: r.skipped ? `${r.skipped} rows skipped (no post_id or date)` : "Same columns as data/clean/posts.csv" });
                    router.refresh();
                  } catch (err) {
                    toast.error((err as Error).message);
                  }
                }),
            });
            e.target.value = "";
          }}
        />
      </label>
    </div>
  );
}
