"use client";

import NumberFlow from "@number-flow/react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Bar, BarChart, CartesianGrid, LabelList, Line, LineChart, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { extractRulesAction, setAutonomy, toggleRule } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { AUTONOMY } from "@/lib/domain";
import { cn } from "@/lib/utils";

type TypeRow = {
  item_type: string; level: number; max_level: number; decided: number; approved_unedited: number; edited: number; rejected: number;
  avg_edit_ratio: number | null; avg_seconds: number | null; earned: { rate: number; eligible: number };
};
type RuleRow = { id: string; item_type: string; rule: string; rationale: string | null; active: boolean; origin: string; evidence_ids: string[] };
type Proof = { run_at: string; metric: string; avg_without: number; avg_with: number; rows: { topic: string; without: number; with: number }[] } | null;
type Event = { id: number; action: string; target_type: string | null; detail: Record<string, unknown>; at: string; profiles: { display_name: string } | null };

const TYPE_LABEL: Record<string, string> = { classification: "Classification (G1)", post_draft: "Post drafts (G2)", objective_metrics: "Objectives & metrics (G3)", insight: "Insights (G4)" };

export function LedgerView({ types, rules, proof, trend, events }: { types: TypeRow[]; rules: RuleRow[]; proof: Proof; trend: { week: string; approval: number; edit: number; n: number }[]; events: Event[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const postRules = rules.filter((r) => r.item_type === "post_draft");

  return (
    <div className="space-y-14">
      <header>
        <p className="kicker">Learn and improve</p>
        <h1 className="mt-2 text-4xl font-medium">The Ledger</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          What ECHO learned from your decisions, how much you trust it per task, and who decided what, when. ECHO learns through its instructions, not by retraining a model: every rule below is visible and you can switch it off.
        </p>
      </header>

      {/* Proof of learning */}
      <section className="grid gap-10 lg:grid-cols-[1fr_1.5fr]">
        <div>
          <p className="kicker">Proof it improves</p>
          <h2 className="mt-1 text-2xl font-medium">Same briefs, before and after learning</h2>
          {proof ? (
            <>
              <div className="mt-6 flex items-end gap-6">
                <div>
                  <p className="font-serif text-6xl leading-none text-muted-foreground"><NumberFlow value={proof.avg_without} format={{ maximumFractionDigits: 1 }} /></p>
                  <p className="kicker mt-2">without learning</p>
                </div>
                <span className="pb-6 font-serif text-3xl text-muted-foreground">→</span>
                <div>
                  <p className="font-serif text-6xl leading-none text-pencil"><NumberFlow value={proof.avg_with} format={{ maximumFractionDigits: 1 }} /></p>
                  <p className="kicker mt-2">with learning</p>
                </div>
              </div>
              <p className="mt-5 text-sm text-muted-foreground">
                House-rule checks failed per draft, averaged over {proof.rows.length} held-out briefs the reviewer had already corrected. Lower means less editing.
                The checks are plain code (question opener, over 3 hashtags, hype words, no link, over 150 words), not an AI judging itself.
              </p>
              <p className="num mt-3 text-[0.7rem] text-muted-foreground">Run {new Date(proof.run_at).toLocaleString("en-GB")} · npm run proof</p>
            </>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">Not run yet. Run <code className="num">npm run proof</code>.</p>
          )}
        </div>
        {proof && (
          <ChartContainer
            config={{ without: { label: "Without learning", color: "var(--chart-5)" }, with: { label: "With learning", color: "var(--chart-1)" } } satisfies ChartConfig}
            className="h-72 w-full"
          >
            <BarChart data={proof.rows} margin={{ top: 20, right: 8, left: 0 }} barGap={2}>
              <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
              <XAxis dataKey="topic" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} interval={0} tickFormatter={(v: string) => (v.length > 18 ? v.slice(0, 17) + "…" : v)} />
              <YAxis tickLine={false} axisLine={false} width={28} allowDecimals={false} domain={[0, 5]} className="num" />
              <ChartTooltip cursor={{ fill: "var(--muted)" }} content={<ChartTooltipContent />} />
              <ChartLegend content={<ChartLegendContent />} />
              <Bar dataKey="without" fill="var(--color-without)" radius={[3, 3, 0, 0]} barSize={18}>
                <LabelList dataKey="without" position="top" className="num fill-muted-foreground" fontSize={10} />
              </Bar>
              <Bar dataKey="with" fill="var(--color-with)" radius={[3, 3, 0, 0]} barSize={18}>
                <LabelList dataKey="with" position="top" className="num fill-foreground" fontSize={10} />
              </Bar>
            </BarChart>
          </ChartContainer>
        )}
      </section>

      {/* Rules */}
      <section>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="kicker">House rules · learned from your edits</p>
            <h2 className="text-2xl font-medium">What ECHO now does differently</h2>
          </div>
          <Button
            variant="outline"
            disabled={pending}
            onClick={() =>
              start(async () => {
                try {
                  const r = await extractRulesAction();
                  toast.success(r.added ? `Learned ${r.added} new rule${r.added > 1 ? "s" : ""}` : "No new repeated pattern found");
                  router.refresh();
                } catch (e) {
                  toast.error((e as Error).message);
                }
              })
            }
          >
            {pending ? "Reading your decisions…" : "Learn from recent decisions"}
          </Button>
        </div>
        <ol className="mt-3 divide-y divide-border">
          {postRules.length === 0 && <li className="py-6 text-sm text-muted-foreground">No rules yet. Decide a few drafts, then click “Learn from recent decisions”.</li>}
          {postRules.map((r, i) => (
            <li key={r.id} className={cn("grid grid-cols-[2rem_1fr_auto] items-start gap-3 py-4", !r.active && "opacity-50")}>
              <span className="num pt-1 text-sm text-pencil">{String(i + 1).padStart(2, "0")}</span>
              <div>
                <p className={cn("font-serif text-[1.15rem] leading-snug", !r.active && "line-through")}>{r.rule}</p>
                {r.rationale && <p className="mt-1 text-xs text-muted-foreground">{r.rationale}</p>}
                <p className="num mt-1 text-[0.65rem] text-muted-foreground uppercase">
                  learned from {r.evidence_ids.length} decision{r.evidence_ids.length === 1 ? "" : "s"} · {r.origin}
                </p>
              </div>
              <Switch
                checked={r.active}
                aria-label={r.active ? "Switch rule off" : "Switch rule on"}
                onCheckedChange={(v) => start(async () => { await toggleRule(r.id, v); toast(v ? "Rule on: it goes into every draft prompt" : "Rule off: ECHO will ignore it"); router.refresh(); })}
              />
            </li>
          ))}
        </ol>
      </section>

      {/* Trust panel + autonomy */}
      <section>
        <div>
          <p className="kicker">Trust panel · autonomy ladder</p>
          <h2 className="text-2xl font-medium">How much ECHO may do on its own</h2>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-foreground text-left">
                {["Item type", "Decided", "Approved unedited", "Avg edit size", "Avg time", "Level"].map((h, i) => (
                  <th key={h} className={cn("kicker py-2 pr-3 font-normal", i > 0 && i < 5 && "text-right")}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {types.map((t) => (
                <tr key={t.item_type} className="border-b border-border">
                  <td className="py-3 pr-3 font-medium">{TYPE_LABEL[t.item_type]}</td>
                  <td className="num py-3 pr-3 text-right">{t.decided}</td>
                  <td className="num py-3 pr-3 text-right">{t.decided ? `${Math.round(t.earned.rate * 100)}%` : "–"}</td>
                  <td className="num py-3 pr-3 text-right">{t.avg_edit_ratio != null ? `${Math.round(Number(t.avg_edit_ratio) * 100)}%` : "–"}</td>
                  <td className="num py-3 pr-3 text-right">{t.avg_seconds ? `${t.avg_seconds}s` : "–"}</td>
                  <td className="py-3">
                    <Ladder row={t} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Level 1 is earned at {Math.round(AUTONOMY.level1MinUneditedRate * 100)}% unedited approvals over {AUTONOMY.level1MinItems}+ items. Level 2 needs your opt-in. Post drafts never go above Level 1. You can lower any level at any time.
        </p>

        {trend.length > 1 && (
          <div className="mt-8">
            <p className="kicker">Post drafts · share approved without edits, per week</p>
            <ChartContainer config={{ approval: { label: "Approved unedited", color: "var(--chart-2)" } } satisfies ChartConfig} className="mt-3 h-48 w-full">
              <LineChart data={trend} margin={{ top: 8, right: 8, left: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                <XAxis dataKey="week" tickLine={false} axisLine={false} tickFormatter={(v) => new Date(v).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} className="num" />
                <YAxis tickLine={false} axisLine={false} width={36} domain={[0, 1]} tickFormatter={(v) => `${Math.round(v * 100)}%`} className="num" />
                <ChartTooltip content={<ChartTooltipContent formatter={(v, _n, item) => `${Math.round(Number(v) * 100)}% of ${item.payload.n} decisions`} />} />
                <Line dataKey="approval" stroke="var(--color-approval)" strokeWidth={2} dot={{ r: 3 }} type="monotone" />
              </LineChart>
            </ChartContainer>
          </div>
        )}
      </section>

      {/* Audit trail */}
      <section>
        <div>
          <p className="kicker">Audit trail</p>
          <h2 className="text-2xl font-medium">Who did what, and when</h2>
        </div>
        <ol className="mt-2 divide-y divide-border text-sm">
          {events.length === 0 && <li className="py-4 text-muted-foreground">No live activity yet. Seeded history is marked synthetic on the Desk.</li>}
          {events.map((e) => (
            <li key={e.id} className="grid grid-cols-[9rem_8rem_1fr] gap-3 py-2.5">
              <span className="num text-xs text-muted-foreground">{new Date(e.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
              <span className="truncate text-xs font-medium">{e.profiles?.display_name ?? "system"}</span>
              <span className="min-w-0 truncate text-xs">
                <span className="num text-muted-foreground">{e.action}</span> {describe(e)}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function Ladder({ row }: { row: TypeRow }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div className="flex items-center gap-1">
      {AUTONOMY.levels.map((label, lvl) => {
        const allowed = lvl <= row.max_level;
        const reachable = lvl <= Math.max(row.earned.eligible, row.level) || (lvl === 2 && row.max_level === 2 && row.level >= 1);
        const active = row.level === lvl;
        return (
          <button
            key={lvl}
            disabled={!allowed || pending || (!reachable && lvl > row.level)}
            title={!allowed ? "Not allowed for this item type" : !reachable && lvl > row.level ? "Not earned yet" : label}
            onClick={() => start(async () => {
              try { await setAutonomy(row.item_type, lvl); toast.success(`${TYPE_LABEL[row.item_type]}: ${label}`); router.refresh(); }
              catch (e) { toast.error((e as Error).message); }
            })}
            className={cn(
              "num rounded-sm border px-2 py-1 text-[0.65rem] whitespace-nowrap transition-colors",
              active ? "border-foreground bg-foreground text-background" : "border-border",
              !allowed && "border-dashed opacity-30",
              allowed && !active && reachable && "hover:border-foreground/60",
              allowed && !active && !reachable && lvl > row.level && "opacity-40",
            )}
          >
            L{lvl} {label}
          </button>
        );
      })}
      {row.earned.eligible > row.level && <span className="ml-1 text-[0.65rem] text-approve">earned ↑</span>}
    </div>
  );
}

function describe(e: Event) {
  const d = e.detail ?? {};
  if (e.action.startsWith("review.")) return `Gate ${d.gate}: ${d.title ?? ""}${d.reason ? ` (${String(d.reason).replace("_", " ")})` : ""}`;
  if (e.action === "rules.extracted") return `${d.count} rule(s)`;
  if (e.action.startsWith("ingest")) return `${d.matched} matched, ${d.added} new`;
  if (e.action === "autonomy.changed") return `${e.target_type ?? ""} → level ${d.level}`;
  if (e.action === "library.added") return String(d.title ?? "");
  return "";
}
