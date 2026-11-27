"use client";

import { useMemo, useState } from "react";
import { CartesianGrid, ReferenceLine, Scatter, ScatterChart, XAxis, YAxis, ZAxis } from "recharts";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { FORMATS } from "@/lib/domain";
import { median, type PostRow } from "@/lib/echo/stats";
import { cn } from "@/lib/utils";

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

/** Reactions + comments + reposts per impression. Leaves clicks out, so it is not the CTR axis in disguise. */
const interaction = (p: PostRow) => (p.impressions ? ((p.likes ?? 0) + (p.comments ?? 0) + (p.shares ?? 0)) / p.impressions : 0);

const MODES = {
  reach: {
    tab: "Reach vs clicks",
    x: { label: "Impressions (log scale)", get: (p: PostRow) => p.impressions ?? 0, fmt: (v: number) => Math.round(v).toLocaleString(), log: true },
    flag: "Reach, few clicks",
    flagWhy: "Seen more than the typical post but clicked less. A clearer call to action or link may help; that is a hypothesis, not a finding.",
    quadrants: { hiHi: "Seen and clicked", hiLo: "Reach, few clicks", loHi: "Clicks, little reach", loLo: "Below on both" },
  },
  engage: {
    tab: "Engagement vs clicks",
    x: { label: "Interaction rate: reactions, comments, reposts ÷ impressions", get: interaction, fmt: pct, log: false },
    flag: "Engaged, few clicks",
    flagWhy: "People reacted more than usual but clicked less. Some of that engagement may be internal staff (LinkedIn does not say who engaged).",
    quadrants: { hiHi: "Engaged and clicked", hiLo: "Engaged, few clicks", loHi: "Clicks, little engagement", loLo: "Below on both" },
  },
} as const;
type Mode = keyof typeof MODES;
type Quadrant = "hiHi" | "hiLo" | "loHi" | "loLo";

// hiLo is the quadrant the brief asks to spot, so it gets the accent colour.
const COLOR: Record<Quadrant, string> = { hiLo: "var(--chart-1)", loHi: "var(--chart-2)", hiHi: "var(--chart-3)", loLo: "var(--chart-5)" };

/**
 * Brief §8E: "spot content with reach but little engagement, or engagement but few
 * clicks". Each comparable post is a dot; the dashed lines are the page's all-time medians.
 */
export function SignalScatter({ posts, allPosts, onSelect }: { posts: PostRow[]; allPosts: PostRow[]; onSelect?: (id: string) => void }) {
  const [mode, setMode] = useState<Mode>("reach");
  const m = MODES[mode];

  const { points, mx, my, counts, flagged } = useMemo(() => {
    const base = allPosts.filter((p) => p.comparable);
    const mx = median(base.map(m.x.get));
    const my = median(base.map((p) => p.ctr ?? 0));
    const points = posts.filter((p) => p.comparable).map((p) => {
      const x = m.x.get(p);
      const y = p.ctr ?? 0;
      const q: Quadrant = `${x >= mx ? "hi" : "lo"}${y >= my ? "Hi" : "Lo"}` as Quadrant;
      return { id: p.post_id, url: p.url, x, y, q, date: p.published_date, format: p.format, opening: p.text.split("\n")[0] };
    });
    const counts = { hiHi: 0, hiLo: 0, loHi: 0, loLo: 0 } as Record<Quadrant, number>;
    points.forEach((p) => counts[p.q]++);
    const flagged = points.filter((p) => p.q === "hiLo").sort((a, b) => b.x - a.x).slice(0, 5);
    return { points, mx, my, counts, flagged };
  }, [posts, allPosts, m]);

  const config = Object.fromEntries((Object.keys(COLOR) as Quadrant[]).map((q) => [q, { label: m.quadrants[q], color: COLOR[q] }])) satisfies ChartConfig;
  const logTicks = [30, 100, 300, 1000, 3000, 10000, 30000].filter((t) => points.some((p) => p.x >= t / 3) && points.some((p) => p.x <= t * 3));
  const open = (id: string, url: string) => (onSelect ? onSelect(id) : window.open(url, "_blank", "noreferrer"));

  return (
    <section className="grid gap-10 lg:grid-cols-[1.4fr_1fr]">
      <div>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="kicker">Spot the gaps</p>
            <h2 className="text-2xl font-medium">{m.flag}?</h2>
          </div>
          <div className="inline-flex gap-4">
            {(Object.keys(MODES) as Mode[]).map((k) => (
              <button key={k} onClick={() => setMode(k)} className={cn("border-b-2 pb-1 text-xs transition-colors", mode === k ? "border-pencil text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
                {MODES[k].tab}
              </button>
            ))}
          </div>
        </div>
        {points.length ? (
          <ChartContainer config={config} className="mt-4 h-80 w-full">
            <ScatterChart margin={{ left: 0, right: 12, top: 8, bottom: 16 }}>
              <CartesianGrid stroke="var(--chart-grid)" />
              <XAxis
                type="number" dataKey="x" name={m.x.label} scale={m.x.log ? "log" : "auto"} domain={m.x.log ? ["auto", "auto"] : [0, "auto"]}
                ticks={m.x.log ? logTicks : undefined} tickFormatter={(v) => (m.x.log ? Number(v).toLocaleString() : pct(Number(v)))}
                tickLine={false} axisLine={false} className="num"
                label={{ value: m.x.label, position: "insideBottom", offset: -12, fontSize: 11, fill: "var(--muted-foreground)" }}
              />
              <YAxis type="number" dataKey="y" name="CTR" tickFormatter={(v) => pct(Number(v))} tickLine={false} axisLine={false} width={48} className="num" />
              <ZAxis range={[36, 36]} />
              <ReferenceLine x={mx} stroke="var(--muted-foreground)" strokeDasharray="4 4" />
              <ReferenceLine y={my} stroke="var(--muted-foreground)" strokeDasharray="4 4" />
              <ChartTooltip
                cursor={{ strokeDasharray: "3 3" }}
                content={({ active, payload }) => {
                  const p = active ? (payload?.[0]?.payload as (typeof points)[number] | undefined) : undefined;
                  if (!p) return null;
                  return (
                    <div className="max-w-64 rounded-sm border border-border bg-background px-3 py-2 text-xs shadow-sm">
                      <p className="kicker" style={{ color: COLOR[p.q] }}>{m.quadrants[p.q]}</p>
                      <p className="mt-1 line-clamp-2">{p.opening}</p>
                      <p className="num mt-1 text-muted-foreground">{p.date} · {FORMATS[p.format] ?? p.format}</p>
                      <p className="num mt-1">{m.x.log ? `${m.x.fmt(p.x)} impressions` : `${m.x.fmt(p.x)} interaction`} · {pct(p.y)} CTR</p>
                    </div>
                  );
                }}
              />
              {(Object.keys(COLOR) as Quadrant[]).map((q) => (
                <Scatter
                  key={q} name={q} data={points.filter((p) => p.q === q)} fill={COLOR[q]} fillOpacity={q === "loLo" ? 0.45 : 0.85}
                  className="cursor-pointer" onClick={(d: { payload?: { id: string; url: string } }) => d.payload && open(d.payload.id, d.payload.url)}
                />
              ))}
            </ScatterChart>
          </ChartContainer>
        ) : (
          <p className="mt-4 rounded-sm border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">No comparable posts match these filters.</p>
        )}
        <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
          {(["hiLo", "loHi", "hiHi", "loLo"] as Quadrant[]).map((q) => (
            <li key={q} className="flex items-center gap-1.5">
              <span className="size-2 rounded-full" style={{ background: COLOR[q] }} />
              {m.quadrants[q]} <span className="num text-foreground">{counts[q]}</span>
            </li>
          ))}
        </ul>
        <p className="mt-1 text-xs text-muted-foreground">Dashed lines: the page&apos;s all-time medians ({m.x.fmt(mx)} and {pct(my)} CTR). Click a dot to open the post.</p>
      </div>

      <aside className="border-t border-border pt-6 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-8">
        <p className="kicker" style={{ color: COLOR.hiLo }}>{m.flag} · {counts.hiLo} posts</p>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{m.flagWhy}</p>
        <ol className="mt-4 space-y-3 text-sm">
          {flagged.map((p) => (
            <li key={p.id}>
              <button onClick={() => open(p.id, p.url)} className="line-clamp-2 text-left hover:underline">{p.opening}</button>
              <p className="num mt-0.5 text-xs text-muted-foreground">{p.date} · {m.x.log ? `${m.x.fmt(p.x)} impr.` : `${m.x.fmt(p.x)} interaction`} · {pct(p.y)} CTR</p>
            </li>
          ))}
          {!flagged.length && <li className="text-xs text-muted-foreground">None in this view.</li>}
        </ol>
      </aside>
    </section>
  );
}
