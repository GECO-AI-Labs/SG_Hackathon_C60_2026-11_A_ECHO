import { OBJECTIVES, type Objective } from "@/lib/domain";
import { cn } from "@/lib/utils";

/** Objective label. "Inferred" stays visible until a person confirms it (brief design rule). */
export function ObjectiveTag({ objective, status }: { objective?: Objective | null; status?: string }) {
  if (!objective) return <span className="kicker">No objective yet</span>;
  const inferred = status !== "confirmed";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 text-xs",
        inferred ? "border-inferred/40 bg-inferred-soft text-inferred" : "border-approve/40 bg-approve-soft text-approve",
      )}
      title={inferred ? "Suggested by ECHO. Not confirmed by a person yet." : "Confirmed by a reviewer."}
    >
      <span aria-hidden>{inferred ? "◌" : "●"}</span>
      {OBJECTIVES[objective]?.label ?? objective}
      <span className="num text-[0.6rem] uppercase opacity-80">{inferred ? "inferred" : "confirmed"}</span>
    </span>
  );
}

export function SourceTag({ source }: { source: string }) {
  if (source !== "synthetic") return null;
  return (
    <span className="num rounded-sm border border-dashed border-muted-foreground/50 px-1.5 py-0.5 text-[0.6rem] tracking-wider text-muted-foreground uppercase" title="Synthetic sample data, not a real record">
      synthetic
    </span>
  );
}
