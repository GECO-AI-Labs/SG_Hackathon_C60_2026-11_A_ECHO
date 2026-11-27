import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/supabase/server";
import { resolveView } from "@/lib/echo/analyse";
import { byFormat, byTopic, median, objectiveBaselines, objectiveResults, sumDaily, type PostRow } from "@/lib/echo/stats";
import { DATA_RULES, METRICS, OBJECTIVES, type MetricKey } from "@/lib/domain";
import { ReportActions } from "@/components/echo/report-actions";

export const metadata: Metadata = { title: "Performance report" };

const pct = (v: number | null | undefined) => (v == null ? "–" : `${(v * 100).toFixed(1)}%`);
const fmtMetric = (m: string, v: number) => (m === "ctr" || m === "engagement_rate" ? pct(v) : Math.round(v).toLocaleString());

/** Loads and computes everything the report shows, and times it. Kept out of the component so render stays pure. */
async function buildReport(query: string) {
  const started = Date.now();
  const { supabase, user } = await requireUser();
  const [{ rows: all, view, cur, cmp, daily, scope, query: clean }, { data: profile }, { data: insights }] = await Promise.all([
    resolveView(supabase, query),
    supabase.from("profiles").select("display_name").eq("id", user.id).single(),
    supabase.from("review_items").select("id, title, final, draft, payload, context, decided_at").eq("item_type", "insight").in("status", ["approved", "edited"]).order("decided_at", { ascending: false }).limit(5),
  ]);

  const comp = view.filter((p) => p.comparable);
  const baselines = objectiveBaselines(all);
  const allComp = all.filter((p) => p.comparable);
  const medImpr = median(allComp.map((p) => p.impressions ?? 0));
  const medCtr = median(allComp.map((p) => p.ctr ?? 0));

  // Best and weakest against each post's OWN goal: primary metric ÷ the bar it had to beat.
  const judged = comp
    .filter((p) => p.objective)
    .map((p) => {
      const m = OBJECTIVES[p.objective!].primary[0];
      const v = Number((p as Record<string, unknown>)[m] ?? 0);
      return { p, m, v, ratio: baselines[m] ? v / baselines[m] : 0 };
    })
    .sort((a, b) => b.ratio - a.ratio);

  return {
    user, profile, insights, view, cur, cmp, scope, clean, comp, medImpr, medCtr,
    now: sumDaily(daily, cur),
    before: cmp ? sumDaily(daily, cmp) : null,
    results: objectiveResults(view, all),
    best: judged.slice(0, 5),
    weakest: judged.length > 5 ? judged.slice(-Math.min(5, judged.length - 5)).reverse() : [],
    reachNoClicks: comp.filter((p) => (p.impressions ?? 0) >= medImpr && (p.ctr ?? 0) < medCtr).sort((a, b) => (b.impressions ?? 0) - (a.impressions ?? 0)),
    formats: byFormat(view),
    topics: byTopic(view),
    generated: new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date()),
    builtMs: Date.now() - started,
  };
}

/**
 * One printable page for the filtered Signals view: page totals, results against
 * objectives, best and weakest posts against their own goal, formats and topics,
 * and the insights a person approved. Plain code builds every number; no AI call.
 */
export default async function ReportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const query = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (Array.isArray(v) ? v.map((x) => [k, x]) : v != null ? [[k, v]] : []))).toString();
  const { user, profile, insights, view, cur, cmp, scope, clean, comp, medImpr, medCtr, now, before, results, best, weakest, reachNoClicks, formats, topics, generated, builtMs } =
    await buildReport(query);

  return (
    <article className="mx-auto max-w-4xl space-y-10 print:max-w-none print:space-y-6 print:text-[11px]">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={`/signals${clean ? `?${clean}` : ""}`} className="kicker underline-offset-4 hover:text-foreground hover:underline">← Back to Signals</Link>
        <ReportActions builtMs={builtMs} query={clean} scope={scope} />
      </div>

      <header className="border-b-2 border-foreground pb-4">
        <p className="kicker">Upskill Today · LinkedIn performance report</p>
        <h1 className="mt-2 font-serif text-4xl font-medium print:text-3xl">{cur.label}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {scope.split(" · ").slice(1).join(" · ") || "All posts"}{cmp ? ` · compared with ${cmp.label}` : ""}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Generated {generated} for {profile?.display_name ?? user.email} · built in {(builtMs / 1000).toFixed(1)} s from {view.length} posts and {now.days} days of page data.
        </p>
      </header>

      <section>
        <h2 className="kicker">Page-wide totals</h2>
        <dl className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {(["impressions", "clicks", "new_followers", "page_views"] as const).map((k) => {
            const b = before?.covered ? before[k] : null;
            const delta = b ? (now[k] - b) / b : null;
            return (
              <div key={k} className="border-l-2 border-border pl-3">
                <dt className="kicker">{k === "page_views" ? "Page views" : k === "new_followers" ? "New followers" : METRICS[k].label}</dt>
                <dd className="num mt-1 font-serif text-3xl">{now[k].toLocaleString()}</dd>
                <dd className="num text-xs text-muted-foreground">
                  {delta == null ? (cmp ? "no full comparison data" : "") : `${delta >= 0 ? "▲" : "▼"} ${Math.abs(delta * 100).toFixed(0)}% vs ${b!.toLocaleString()}`}
                </dd>
              </div>
            );
          })}
        </dl>
        <p className="mt-2 text-xs text-muted-foreground">
          {now.covered ? "" : `Page data covers ${now.days} days of this period. `}LinkedIn gives these for the whole page, so post filters do not apply to them.
        </p>
      </section>

      <section className="grid gap-8 sm:grid-cols-[1fr_1.6fr] print:break-inside-avoid">
        <div>
          <h2 className="kicker">Did posts hit their goal?</h2>
          <p className="num mt-2 font-serif text-5xl">{results.total ? Math.round((results.met / results.total) * 100) : 0}%</p>
          <p className="mt-2 text-sm text-muted-foreground">
            {results.met} of {results.total} comparable posts reached the page&apos;s typical post (all-time median) on the one metric their goal cares about.
          </p>
        </div>
        <table className="w-full self-start text-sm">
          <thead><tr className="border-b border-foreground text-left"><th className="kicker py-1.5 font-normal">Goal</th><th className="kicker py-1.5 font-normal">Judged on</th><th className="kicker py-1.5 text-right font-normal">Bar</th><th className="kicker py-1.5 text-right font-normal">Posts</th><th className="kicker py-1.5 text-right font-normal">Met</th></tr></thead>
          <tbody>
            {results.byObjective.map((o) => (
              <tr key={o.objective} className="border-b border-border">
                <td className="py-1.5">{OBJECTIVES[o.objective].label}{o.posts - o.confirmed > 0 && <span className="text-xs text-inferred"> · {o.posts - o.confirmed} inferred</span>}</td>
                <td className="py-1.5 text-xs text-muted-foreground">{METRICS[o.metric as MetricKey]?.label}</td>
                <td className="num py-1.5 text-right text-xs">{fmtMetric(o.metric, o.baseline)}</td>
                <td className="num py-1.5 text-right">{o.posts}{o.posts < DATA_RULES.lowSampleMin && <span className="text-[0.65rem] text-muted-foreground"> low</span>}</td>
                <td className="num py-1.5 text-right">{o.posts ? Math.round((o.met / o.posts) * 100) : 0}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="grid gap-8 sm:grid-cols-2 print:break-inside-avoid">
        <PostList title="Furthest above their goal" rows={best} />
        <PostList title="Furthest below their goal" rows={weakest} />
      </section>

      <section className="grid gap-8 sm:grid-cols-2 print:break-inside-avoid">
        <GroupTable title="By format" rows={formats} />
        <GroupTable title="By topic" rows={topics} />
      </section>

      <section className="print:break-inside-avoid">
        <h2 className="kicker">Reach, few clicks · {reachNoClicks.length} posts</h2>
        <p className="mt-1 text-xs text-muted-foreground">Seen at least as often as the typical post ({medImpr.toLocaleString()} impressions) but clicked less ({pct(medCtr)} CTR).</p>
        <ul className="mt-2 space-y-1 text-sm">
          {reachNoClicks.slice(0, 3).map((p) => (
            <li key={p.post_id} className="flex justify-between gap-4"><span className="line-clamp-1">{p.text.split("\n")[0]}</span><span className="num shrink-0 text-xs text-muted-foreground">{p.impressions?.toLocaleString()} · {pct(p.ctr)}</span></li>
          ))}
          {!reachNoClicks.length && <li className="text-xs text-muted-foreground">None in this view.</li>}
        </ul>
      </section>

      <section className="print:break-inside-avoid">
        <h2 className="kicker">Insights approved at Gate 4 · latest {insights?.length ?? 0}</h2>
        <div className="mt-3 space-y-4">
          {(insights ?? []).map((i) => (
            <div key={i.id} className="border-l-2 border-border pl-3 text-sm">
              <p className="font-medium">{i.title}</p>
              {i.payload?.observed_trend && <p className="mt-1"><span className="kicker mr-1">Observed</span>{i.payload.observed_trend}</p>}
              {i.payload?.possible_explanation && <p className="mt-1 text-foreground/75 italic"><span className="kicker mr-1 not-italic">Possible explanation, not proven</span>{i.payload.possible_explanation}</p>}
              <p className="mt-1"><span className="kicker mr-1">Next</span>{i.final ?? i.draft}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Approved {i.decided_at ? new Date(i.decided_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : ""}
                {i.context?.view ? ` · based on ${i.context.view}` : ""}
              </p>
            </div>
          ))}
          {!insights?.length && <p className="text-xs text-muted-foreground">No approved insights yet. Ask ECHO on Signals and approve one on the Desk.</p>}
        </div>
      </section>

      <footer className="space-y-1 border-t border-border pt-4 text-xs text-muted-foreground print:break-inside-avoid">
        <p className="kicker">How to read this</p>
        <p>{DATA_RULES.minImpressionsWhy} {view.length - comp.length} posts in this period were left out for that reason.</p>
        <p>{DATA_RULES.audienceCaveat}</p>
        <p>CTR = {METRICS.ctr.def} Engagement rate = {METRICS.engagement_rate.def} Groups with fewer than {DATA_RULES.lowSampleMin} posts are marked low and should not drive decisions.</p>
        <p>Every number here is computed by plain code from LinkedIn exports. Insights were drafted by AI and approved by a person; they describe patterns, not causes.</p>
      </footer>
    </article>
  );
}

function PostList({ title, rows }: { title: string; rows: { p: PostRow; m: string; v: number; ratio: number }[] }) {
  return (
    <div>
      <h2 className="kicker">{title}</h2>
      <ol className="mt-2 space-y-2 text-sm">
        {rows.map(({ p, m, v, ratio }) => (
          <li key={p.post_id}>
            <p className="line-clamp-1">{p.text.split("\n")[0]}</p>
            <p className="num text-xs text-muted-foreground">
              {p.published_date} · {OBJECTIVES[p.objective!].label}{p.objective_status !== "confirmed" && " (inferred)"} · {fmtMetric(m, v)} {METRICS[m as MetricKey].label.toLowerCase()} · {ratio.toFixed(1)}× the bar
            </p>
          </li>
        ))}
        {!rows.length && <li className="text-xs text-muted-foreground">Not enough posts with a goal.</li>}
      </ol>
    </div>
  );
}

function GroupTable({ title, rows }: { title: string; rows: ReturnType<typeof byFormat> }) {
  return (
    <div>
      <h2 className="kicker">{title}</h2>
      <table className="mt-2 w-full text-sm">
        <thead><tr className="border-b border-foreground text-left"><th className="kicker py-1 font-normal" /><th className="kicker py-1 text-right font-normal">Posts</th><th className="kicker py-1 text-right font-normal">Med. impr.</th><th className="kicker py-1 text-right font-normal">Med. CTR</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.format} className={r.lowSample ? "border-b border-border text-muted-foreground" : "border-b border-border"}>
              <td className="py-1">{r.label}{r.lowSample && <span className="text-[0.65rem]"> · low</span>}</td>
              <td className="num py-1 text-right">{r.posts}</td>
              <td className="num py-1 text-right">{r.median_impressions.toLocaleString()}</td>
              <td className="num py-1 text-right">{pct(r.median_ctr)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
