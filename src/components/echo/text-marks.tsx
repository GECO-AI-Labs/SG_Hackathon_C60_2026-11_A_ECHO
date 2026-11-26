import { wordDiff } from "@/lib/edit";
import { cn } from "@/lib/utils";

/** Draft→final shown as an editor's proofreading marks: struck red for cuts, underlined green for additions. */
export function ProofMarks({ draft, final, className }: { draft: string; final: string; className?: string }) {
  const parts = wordDiff(draft, final);
  return (
    <p className={cn("leading-relaxed whitespace-pre-wrap", className)}>
      {parts.map((p, i) =>
        p.removed ? (
          <del key={i} className="mark-del" aria-label="removed">
            {p.value}
          </del>
        ) : p.added ? (
          <ins key={i} className="mark-ins no-underline" aria-label="added">
            {p.value}
          </ins>
        ) : (
          <span key={i}>{p.value}</span>
        ),
      )}
    </p>
  );
}

/** Renders "[2]" citation markers as footnote numbers. onHover links them to margin notes. */
export function Footnoted({
  text,
  onHover,
  className,
}: {
  text: string;
  onHover?: (n: number | null) => void;
  className?: string;
}) {
  const pieces = text.split(/(\[\d+(?:,\s*\d+)*\])/g);
  return (
    <p className={cn("leading-relaxed whitespace-pre-wrap", className)}>
      {pieces.map((piece, i) => {
        const m = piece.match(/^\[(\d+(?:,\s*\d+)*)\]$/);
        if (!m) return <span key={i}>{piece}</span>;
        return m[1].split(/,\s*/).map((n) => (
          <sup
            key={`${i}-${n}`}
            className="fn"
            onMouseEnter={() => onHover?.(Number(n))}
            onMouseLeave={() => onHover?.(null)}
          >
            {n}
          </sup>
        ));
      })}
    </p>
  );
}
