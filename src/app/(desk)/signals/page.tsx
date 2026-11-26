import type { Metadata } from "next";
import { requireUser } from "@/lib/supabase/server";
import { byFormat, loadPerformance } from "@/lib/echo/analyse";
import { SignalsView } from "@/components/echo/signals-view";

export const metadata: Metadata = { title: "Signals" };

export default async function SignalsPage() {
  const { supabase } = await requireUser();
  const [posts, { data: daily }, { data: demo }] = await Promise.all([
    loadPerformance(supabase),
    supabase.from("page_daily").select("*").order("date"),
    supabase.from("follower_demographics").select("dimension, value, organic_followers").in("dimension", ["Seniority", "Function", "AssociationType"]),
  ]);

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

  const sum = (rows: typeof daily, k: string, from: Date, to: Date) =>
    (rows ?? []).filter((r) => new Date(r.date) >= from && new Date(r.date) < to).reduce((s, r) => s + (r[k] ?? 0), 0);
  const last = daily?.length ? new Date(daily[daily.length - 1].date) : new Date();
  const d90 = new Date(last.getTime() - 90 * 864e5);
  const d180 = new Date(last.getTime() - 180 * 864e5);
  const end = new Date(last.getTime() + 864e5);
  const kpi = (k: string) => ({ now: sum(daily, k, d90, end), before: sum(daily, k, d180, d90) });

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
      weekly={[...weeks.values()].slice(1, -1) /* drop partial first/last week */}
      formats={byFormat(posts)}
      posts={posts.map((p) => ({ ...p, text: p.text.slice(0, 220) }))}
      audience={{ total: totalFollowers, employees: (demo ?? []).find((d) => d.value === "EMPLOYEE")?.organic_followers ?? 0, seniority: top("Seniority"), fn: top("Function") }}
      lastDate={last.toISOString().slice(0, 10)}
    />
  );
}
