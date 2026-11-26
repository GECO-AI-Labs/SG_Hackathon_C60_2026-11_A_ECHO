/**
 * Pre-flight checks: plain code, no AI. Each one mirrors a correction the reviewer
 * keeps making. Shown on every draft card, and used by the learning proof
 * (fewer failed checks after learning = less work for the reviewer).
 */
export type Check = { id: string; label: string; pass: boolean; detail?: string };

const HYPE = ["revolutionary", "game-changing", "game changer", "unlock", "journey", "transformative", "cutting-edge", "disrupt", "supercharge", "elevate"];

export function runChecks(text: string): Check[] {
  const firstLine = text.trim().split(/\n/)[0] ?? "";
  const firstSentence = firstLine.split(/(?<=[.!?])\s/)[0] ?? "";
  const hashtags = text.match(/#[\p{L}\p{N}_]+/gu) ?? [];
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const hype = HYPE.filter((w) => text.toLowerCase().includes(w));
  const hasLink = /https?:\/\/|upskilltoday\.com|www\./i.test(text);

  return [
    { id: "opener", label: "Opens with a statement", pass: !firstSentence.trim().endsWith("?"), detail: firstSentence.slice(0, 80) },
    { id: "hashtags", label: "3 hashtags or fewer", pass: hashtags.length <= 3, detail: `${hashtags.length} hashtags` },
    { id: "hype", label: "No hype words", pass: hype.length === 0, detail: hype.join(", ") || undefined },
    { id: "link", label: "Has a link or call to action", pass: hasLink },
    { id: "length", label: "Under 150 words", pass: words <= 150, detail: `${words} words` },
  ];
}

export const failedCount = (text: string) => runChecks(text).filter((c) => !c.pass).length;
