import { diffWords } from "diff";

/** Character-level Levenshtein distance. Used as "edit size" on the trust panel. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** Edit size as a share of the draft: 0 = untouched, 1 = fully rewritten. */
export function editRatio(draft: string, final: string): number {
  if (!draft.length) return final.length ? 1 : 0;
  return Math.min(1, levenshtein(draft, final) / draft.length);
}

export type DiffPart = { value: string; added?: boolean; removed?: boolean };

/** Word-level diff for the proofreading-marks view. */
export function wordDiff(draft: string, final: string): DiffPart[] {
  return diffWords(draft, final).map((p) => ({ value: p.value, added: p.added, removed: p.removed }));
}

/** Cut text to n characters without splitting an emoji (Postgres rejects half-emoji). */
export const clip = (s: string, n: number) => s.slice(0, n).toWellFormed();

/** Short title: first line, cut at a word boundary with an ellipsis. */
export function headline(s: string, n = 90) {
  const line = s.trim().split("\n")[0];
  if (line.length <= n) return line.toWellFormed();
  return line.slice(0, n).replace(/\s+\S*$/, "").toWellFormed() + "…";
}
