import type { Metadata } from "next";
import { requireUser } from "@/lib/supabase/server";
import { byFormat, byTopic, loadPerformance, objectiveResults } from "@/lib/echo/analyse";
import { SignalsView } from "@/components/echo/signals-view";

export const metadata: Metadata = { title: "Signals" };

export default async function SignalsPage() {
  const { supabase } = await requireUser();
  const [posts, { data: daily }, { data: demo }, { data: snaps }] = await Promise.all([
    loadPerformance(supabase),
    supabase.from("page_daily").select("*").order("date"),
    supabase.from("follower_demographics").select("dimension, value, organic_followers").in("dimension", ["Seniority", "Function", "AssociationType"]),
    supabase.from("post_metrics").select("post_id, as_of, impressions, clicks").order("as_of", { ascending: false }).limit(10000),
  ]);

  // Reporting periods (one per upload or make.com run) and each post's previous snapshot.
  const reportPeriods = [...new Set((snaps ?? []).map((s) => s.as_of as string))];
  const previous: Record<string, { as_of: string; impressions: number; clicks: number }> = {};
  const seen = new Set<string>();
  for (const s of snaps ?? []) {
    if (!seen.has(s.post_id)) { seen.add(s.post_id); continue; } // newest snapshot, skip
    previous[s.post_id] ??= { as_of: s.as_of, impressions: s.impressions ?? 0, clicks: s.clicks ?? 0 };
  }

  // Weekly totals keep the trend readable (daily LinkedIn numbers are spiky).
  const weeks = new Map<string, { week: string; impressions: number; clicks: number; new_followers: number; page_views: number }>();
  for (const d of daily ?? []) {
    const dt = new Date(d.date + "T00:00:00Z");
    dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7)); // Monday
    const key = dt.toISOString().slice(0, 10);
    const w = weeks.get(key) ?? { week: key, impressions: 0, clicks: 0, new_followers: 0, page_views: 0 };
    w.impressions += d.impressions ?? 0;
    w.clicks += d.clicks ?? 0;
    w.new_followers += d.new_followers ?? 0;
    w.page_views += d.page_views ?? 0;
    weeks.set(key, w);
  }

  // KPIs compare the last 3 FULL calendar months with the 3 before. Calendar months are easy to
  // explain and do not shift when one day is added (a rolling 90-day window jumped ±30% on single-day spikes).
  const last = daily?.length ? new Date(daily[daily.length - 1].date + "T00:00:00Z") : new Date();
  const lastDayOfMonth = new Date(Date.UTC(last.getUTCFullYear(), last.getUTCMonth() + 1, 0)).getUTCDate();
  const endMonth = last.getUTCDate() === lastDayOfMonth ? last.getUTCMonth() + 1 : last.getUTCMonth(); // exclusive
  const m = (offset: number) => new Date(Date.UTC(last.getUTCFullYear(), endMonth + offset, 1));
  const [curFrom, curTo, prevFrom] = [m(-3), m(0), m(-6)];
  const sum = (k: string, from: Date, to: Date) =>
    (daily ?? []).filter((r) => { const d = new Date(r.date + "T00:00:00Z"); return d >= from && d < to; }).reduce((s, r) => s + (r[k] ?? 0), 0);
  const kpi = (k: string) => ({ now: sum(k, curFrom, curTo), before: sum(k, prevFrom, curFrom) });
  const mon = (d: Date) => d.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" });
  const periods = {
    now: `${mon(curFrom)}–${mon(new Date(curTo.getTime() - 864e5))}`,
    before: `${mon(prevFrom)}–${mon(new Date(curFrom.getTime() - 864e5))}`,
  };

  const totalFollowers = (demo ?? []).filter((d) => d.dimension === "Seniority").reduce((s, d) => s + d.organic_followers, 0);
  const top = (dim: string) =>
    (demo ?? [])
      .filter((d) => d.dimension === dim)
      .sort((a, b) => b.organic_followers - a.organic_followers)
      .slice(0, 5)
      .map((d) => ({ value: d.value, n: d.organic_followers }));

  return (
    <SignalsView
      kpis={{ impressions: kpi("impressions"), clicks: kpi("clicks"), new_followers: kpi("new_followers"), page_views: kpi("page_views") }}
      periods={periods}
      reportPeriods={reportPeriods}
      previous={previous}
      weekly={[...weeks.values()].slice(1, -1) /* drop partial first/last week */}
      formats={byFormat(posts)}
      topics={byTopic(posts)}
      results={objectiveResults(posts)}
      posts={posts.map((p) => ({ ...p, text: p.text.slice(0, 220) }))}
      audience={{ total: totalFollowers, employees: (demo ?? []).find((d) => d.value === "EMPLOYEE")?.organic_followers ?? 0, seniority: top("Seniority"), fn: top("Function") }}
      lastDate={last.toISOString().slice(0, 10)}
    />
  );
}
