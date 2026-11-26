"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { draftAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FORMATS, OBJECTIVES, OBJECTIVE_KEYS } from "@/lib/domain";
import { cn } from "@/lib/utils";

type Rec = { id: string; title: string; text: string; objective?: string };

const STARTERS = [
  "Welcome post for the new cohort starting Monday",
  "Myth-buster: you don't need a computer science degree to switch into tech",
  "Mentor spotlight for the Java full-stack track",
  "Last call: applications for the next cohort close this week",
];

export function WriteForm({ recommendations, initialRec, initialBrief }: { recommendations: Rec[]; initialRec?: string; initialBrief?: string }) {
  const router = useRouter();
  const [brief, setBrief] = useState(initialBrief ?? "");
  const [objective, setObjective] = useState<string>("infer");
  const [format, setFormat] = useState<string>("image");
  const [rec, setRec] = useState<string>(initialRec ?? "none");
  const [pending, start] = useTransition();
  const chosenRec = recommendations.find((r) => r.id === rec);

  const submit = () =>
    start(async () => {
      try {
        const id = await draftAction({
          brief,
          objective: objective === "infer" ? null : objective,
          format,
          recommendationId: rec === "none" ? null : rec,
        });
        toast.success("Two versions are on your Desk");
        router.push(`/?item=${id}`);
      } catch (e) {
        toast.error((e as Error).message);
      }
    });

  return (
    <div className="mt-8 max-w-2xl space-y-6">
      {recommendations.length > 0 && (
        <div className="space-y-1.5">
          <Label>Shape it with an approved recommendation (Gate 4)</Label>
          <Select value={rec} onValueChange={setRec}>
            <SelectTrigger className="w-full bg-card"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No recommendation</SelectItem>
              {recommendations.map((r) => (
                <SelectItem key={r.id} value={r.id}>{r.title}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {chosenRec && <p className="border-l-2 border-pencil pl-3 text-xs text-muted-foreground">{chosenRec.text}</p>}
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="brief">What is the post about?</Label>
        <Textarea
          id="brief"
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          placeholder="e.g. Repurpose the founder talk into a post on why we hire before we train"
          className="min-h-32 bg-card font-serif text-[1.05rem]"
        />
        <div className="flex flex-wrap gap-1.5 pt-1">
          {STARTERS.map((s) => (
            <button key={s} onClick={() => setBrief(s)} className="rounded-sm border border-border px-2 py-1 text-left text-xs text-muted-foreground hover:border-foreground/40 hover:text-foreground">
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Objective</Label>
          <Select value={objective} onValueChange={setObjective}>
            <SelectTrigger className="w-full bg-card"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="infer">Let ECHO suggest (marked inferred)</SelectItem>
              {OBJECTIVE_KEYS.map((k) => (
                <SelectItem key={k} value={k}>{OBJECTIVES[k].label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Format</Label>
          <Select value={format} onValueChange={setFormat}>
            <SelectTrigger className="w-full bg-card"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(FORMATS).filter(([k]) => k !== "reference").map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex items-center gap-4 border-t border-border pt-6">
        <Button onClick={submit} disabled={pending || brief.trim().length < 8} className="h-10 px-5">
          {pending ? "Drafting…" : "Draft two versions"}
        </Button>
        <p className={cn("text-xs text-muted-foreground transition-opacity", pending ? "opacity-100" : "opacity-0")}>
          Searching the library, applying your rules, writing. Usually 15–30 seconds.
        </p>
      </div>
    </div>
  );
}
