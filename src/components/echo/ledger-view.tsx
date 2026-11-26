"use client";

import NumberFlow from "@number-flow/react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { extractRulesAction, setAutonomy, toggleRule } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { AUTONOMY } from "@/lib/domain";
import { MISTAKES } from "@/lib/echo/checks";
import { cn } from "@/lib/utils";

type TypeRow = {
  item_type: string; level: number; max_level: number; decided: number; approved_unedited: number; edited: number; rejected: number;
  avg_edit_ratio: number | null; avg_seconds: number | null; earned: { rate: number; eligible: number };
};
type RuleRow = { id: string; item_type: string; rule: string; rationale: string | null; active: boolean; origin: string; evidence_ids: string[] };
type Proof = {
  run_at: string; briefs: number; runs_per_brief: number; drafts: number; breaks_without: number; breaks_with: number;
  by_check?: { id: string; without: number; with: number }[];
} | null;
type Event = { id: number; action: string; target_type: string | null; detail: Record<string, unknown>; at: string; profiles: { display_name: string } | null };

const TYPE_LABEL: Record<string, string> = { classification: "Classification (G1)", post_draft: "Post drafts (G2)", objective_metrics: "Objectives & metrics (G3)", insight: "Insights (G4)" };

export function LedgerView({ types, rules, proof, trend, events }: { types: TypeRow[]; rules: RuleRow[]; proof: Proof; trend: { week: string; approval: number; edit: number; n: number }[]; events: Event[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const postRules = [...rules].sort((a, b) => (a.item_type === b.item_type ? 0 : a.item_type === "post_draft" ? -1 : 1));

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
      <section>
        <p className="kicker">Proof it improves</p>
        <h2 className="mt-1 text-2xl font-medium">Does learning make drafts need less fixing?</h2>
        {proof?.by_check ? <ProofView proof={proof} /> : (
          <p className="mt-4 text-sm text-muted-foreground">Not run yet. Run <code className="num">npm run proof</code>.</p>
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
                  {r.item_type === "post_draft" ? "post drafts" : TYPE_LABEL[r.item_type]} · learned from {r.evidence_ids.length} decision{r.evidence_ids.length === 1 ? "" : "s"} · {r.origin}
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

/** Before/after learning, in whole numbers, broken down by mistake type. */
function ProofView({ proof }: { proof: NonNullable<Proof> }) {
  const p = proof;
  const max = Math.max(1, ...p.by_check!.map((c) => Math.max(c.without, c.with)));
  const fewer = p.breaks_without ? Math.round((1 - p.breaks_with / p.breaks_without) * 100) : 0;
  return (
    <div className="mt-6 grid gap-12 lg:grid-cols-[1fr_1.3fr]">
      <div>
        <div className="flex items-end gap-5">
          <div>
            <p className="font-serif text-6xl leading-none text-muted-foreground"><NumberFlow value={p.breaks_without} /></p>
            <p className="kicker mt-2">before learning</p>
          </div>
          <span className="pb-7 font-serif text-3xl text-muted-foreground">→</span>
          <div>
            <p className="font-serif text-6xl leading-none text-pencil"><NumberFlow value={p.breaks_with} /></p>
            <p className="kicker mt-2">after learning</p>
          </div>
        </div>
        <p className="mt-4 font-serif text-xl leading-snug">
          House-rule mistakes in {p.drafts} drafts each. {fewer > 0 ? `${fewer}% fewer things for you to fix.` : "No improvement this run."}
        </p>
        <ol className="mt-6 space-y-2 text-sm text-muted-foreground">
          <li><span className="num mr-2 text-pencil">1</span>We hid {p.briefs} briefs you had already corrected from ECHO&apos;s memory.</li>
          <li><span className="num mr-2 text-pencil">2</span>ECHO wrote each one {p.runs_per_brief} times without its learned rules, and {p.runs_per_brief} times with them ({p.drafts} drafts each way, counting both versions).</li>
          <li><span className="num mr-2 text-pencil">3</span>Plain code, not AI, counted the mistakes on the right.</li>
        </ol>
        <p className="num mt-4 text-[0.7rem] text-muted-foreground">Run {new Date(p.run_at).toLocaleString("en-GB")} · npm run proof</p>
      </div>

      <div>
        <div className="flex items-center justify-end gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5"><span className="h-2 w-4 rounded-[1px] bg-chart-5/60" />Before</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-4 rounded-[1px] bg-pencil" />After</span>
        </div>
        <ul className="mt-3 divide-y divide-border">
          {p.by_check!.map((c) => (
            <li key={c.id} className="grid grid-cols-[11rem_1fr] items-center gap-4 py-3">
              <div>
                <p className="text-sm font-medium">{MISTAKES[c.id] ?? c.id}</p>
                <p className="text-xs text-muted-foreground">
                  {c.without === 0 && c.with === 0 ? "Never happened either way" : c.with <= c.without / 2 ? `${c.without} → ${c.with}, learned` : c.with > c.without ? `${c.without} → ${c.with}, got worse` : `${c.without} → ${c.with}, not learned yet`}
                </p>
              </div>
              <div className="space-y-1" title={`Before ${c.without} · after ${c.with} (out of ${p.drafts} drafts)`}>
                {[["without", "bg-chart-5/60", "text-muted-foreground"], ["with", "bg-pencil", "text-foreground"]].map(([k, bg, tc]) => {
                  const v = c[k as "with" | "without"];
                  return (
                    <div key={k} className="flex items-center gap-2">
                      <div className={cn("h-2.5 rounded-r-[2px]", bg)} style={{ width: `${(v / max) * 100}%`, minWidth: v ? 3 : 0 }} />
                      <span className={cn("num text-[0.7rem]", tc)}>{v}</span>
                    </div>
                  );
                })}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
