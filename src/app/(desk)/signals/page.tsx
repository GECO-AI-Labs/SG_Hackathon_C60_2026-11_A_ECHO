import type { Metadata } from "next";
import { requireUser } from "@/lib/supabase/server";
import { loadPerformance } from "@/lib/echo/analyse";
import { parseFilters, type DailyRow } from "@/lib/echo/stats";
import { clip } from "@/lib/edit";
import { SignalsView } from "@/components/echo/signals-view";

export const metadata: Metadata = { title: "Signals" };

export default async function SignalsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { supabase } = await requireUser();
  const [filters, posts, { data: daily }, { data: demo }, { data: snaps }] = await Promise.all([
    searchParams.then(parseFilters),
    loadPerformance(supabase),
    supabase.from("page_daily").select("date, impressions, clicks, new_followers, page_views").order("date"),
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

  // Periods end at the latest data we hold, not today, so a stale export still shows numbers.
  const rows = (daily ?? []) as DailyRow[];
  const latestPost = posts.reduce((m, p) => (p.published_date > m ? p.published_date : m), "");
  const lastDaily = rows.length ? rows[rows.length - 1].date : "";
  const anchor = (lastDaily > latestPost ? lastDaily : latestPost) || new Date().toISOString().slice(0, 10);

  const totalFollowers = (demo ?? []).filter((d) => d.dimension === "Seniority").reduce((s, d) => s + d.organic_followers, 0);
  const top = (dim: string) =>
    (demo ?? [])
      .filter((d) => d.dimension === dim)
      .sort((a, b) => b.organic_followers - a.organic_followers)
      .slice(0, 5)
      .map((d) => ({ value: d.value, n: d.organic_followers }));

  return (
    <SignalsView
      initialFilters={filters}
      anchor={anchor}
      daily={rows}
      reportPeriods={reportPeriods}
      previous={previous}
      posts={posts.map((p) => ({ ...p, text: clip(p.text, 220) }))}
      audience={{ total: totalFollowers, employees: (demo ?? []).find((d) => d.value === "EMPLOYEE")?.organic_followers ?? 0, seniority: top("Seniority"), fn: top("Function") }}
    />
  );
}
