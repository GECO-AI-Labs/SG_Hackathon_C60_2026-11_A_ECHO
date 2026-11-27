"use client";

import { ChevronDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DATA_RULES, FORMATS, OBJECTIVES, OBJECTIVE_KEYS, type Objective } from "@/lib/domain";
import { COMPARES, DEFAULT_FILTERS, GRAINS, PERIODS, filtersToQuery, isDefault, type Filters, type Range } from "@/lib/echo/stats";
import { cn } from "@/lib/utils";

/** One filter bar for the whole Signals page. It stays in view while scrolling and lives in the URL. */
export function SignalFilters({ value, onChange, formats, topics, cur, cmp, anchor, posts, comparable }: {
  value: Filters;
  onChange: (f: Filters) => void;
  formats: string[];
  topics: string[];
  cur: Range;
  cmp: Range | null;
  anchor: string;
  posts: number;
  comparable: number;
}) {
  const set = (patch: Partial<Filters>) => onChange({ ...value, ...patch });

  return (
    <div className="-mx-4 border-y border-border bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={value.period} onValueChange={(v) => set({ period: v as Filters["period"] })}>
          <SelectTrigger size="sm" className="w-44 bg-card text-xs" aria-label="Period"><SelectValue /></SelectTrigger>
          <SelectContent>
            {Object.entries(PERIODS).map(([k, label]) => <SelectItem key={k} value={k}>{label}</SelectItem>)}
          </SelectContent>
        </Select>

        {value.period === "custom" && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Input type="date" aria-label="From" value={value.from ?? DATA_RULES.statsFrom} min={DATA_RULES.statsFrom} max={anchor} onChange={(e) => set({ from: e.target.value || null })} className="h-8 w-36 bg-card text-xs" />
            to
            <Input type="date" aria-label="To" value={value.to ?? anchor} min={DATA_RULES.statsFrom} max={anchor} onChange={(e) => set({ to: e.target.value || null })} className="h-8 w-36 bg-card text-xs" />
          </span>
        )}

        <Select value={value.compare} onValueChange={(v) => set({ compare: v as Filters["compare"] })} disabled={value.period === "all"}>
          <SelectTrigger size="sm" className="w-48 bg-card text-xs" aria-label="Compare with"><SelectValue /></SelectTrigger>
          <SelectContent>
            {Object.entries(COMPARES).map(([k, label]) => <SelectItem key={k} value={k}>{k === "none" ? label : `vs ${label.toLowerCase()}`}</SelectItem>)}
          </SelectContent>
        </Select>

        <span className="mx-1 hidden h-5 w-px bg-border sm:block" />

        <Multi label="Format" all="All" value={value.formats} onChange={(formats) => set({ formats })} options={formats.map((f) => ({ value: f, label: FORMATS[f] ?? f }))} />
        <Multi label="Topic" all="All" value={value.topics} onChange={(topics) => set({ topics })} options={topics.map((t) => ({ value: t, label: t }))} />
        <Multi
          label="Goal" all="All" value={value.objectives} onChange={(o) => set({ objectives: o as Objective[] })}
          options={OBJECTIVE_KEYS.map((o) => ({ value: o, label: OBJECTIVES[o].label }))}
        />

        <Select value={value.status} onValueChange={(v) => set({ status: v as Filters["status"] })}>
          <SelectTrigger size="sm" className="w-48 bg-card text-xs" aria-label="Goal status"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Confirmed + inferred</SelectItem>
            <SelectItem value="confirmed">Confirmed goals</SelectItem>
            <SelectItem value="inferred">Inferred goals</SelectItem>
          </SelectContent>
        </Select>

        <Select value={value.link} onValueChange={(v) => set({ link: v as Filters["link"] })}>
          <SelectTrigger size="sm" className="w-32 bg-card text-xs" aria-label="Link"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any link</SelectItem>
            <SelectItem value="yes">With link</SelectItem>
            <SelectItem value="no">Without link</SelectItem>
          </SelectContent>
        </Select>

        <span className="ml-auto flex items-center gap-3">
          <span className="kicker">By</span>
          <span className="inline-flex gap-3">
            {(Object.keys(GRAINS) as (keyof typeof GRAINS)[]).map((g) => (
              <button key={g} onClick={() => set({ grain: g })} className={cn("border-b-2 pb-0.5 text-xs transition-colors", value.grain === g ? "border-pencil text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
                {GRAINS[g]}
              </button>
            ))}
          </span>
          {!isDefault(value) && (
            <button onClick={() => onChange(DEFAULT_FILTERS)} className="kicker underline-offset-4 hover:text-foreground hover:underline">Reset</button>
          )}
        </span>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        <span className="text-foreground">{cur.label}</span>
        {cmp && <> · compared with <span className="text-foreground">{cmp.label}</span></>}
        {" · "}
        <span className="num text-foreground">{posts}</span> posts, <span className="num">{comparable}</span> comparable
        {posts > comparable && ` (${posts - comparable} under ${DATA_RULES.minImpressions} impressions left out)`}
        <a
          href={`/signals/report${filtersToQuery(value) ? `?${filtersToQuery(value)}` : ""}`}
          target="_blank"
          rel="noreferrer"
          className="kicker float-right underline-offset-4 hover:text-foreground hover:underline"
        >
          Report for this view →
        </a>
      </p>
    </div>
  );
}

function Multi({ label, all, options, value, onChange }: {
  label: string; all: string; options: { value: string; label: string }[]; value: string[]; onChange: (v: string[]) => void;
}) {
  const shown = value.length === 0 ? all : value.length === 1 ? options.find((o) => o.value === value[0])?.label ?? value[0] : `${value.length} selected`;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className={cn("inline-flex h-8 max-w-56 items-center gap-1.5 rounded-sm border bg-card px-2.5 text-xs", value.length ? "border-foreground" : "border-border")}>
          <span className="text-muted-foreground">{label}</span>
          <span className="truncate">{shown}</span>
          <ChevronDown className="size-3.5 shrink-0 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 w-60 overflow-y-auto">
        {options.map((o) => (
          <DropdownMenuCheckboxItem
            key={o.value}
            checked={value.includes(o.value)}
            onSelect={(e) => e.preventDefault() /* keep the menu open while ticking several */}
            onCheckedChange={(c) => onChange(c ? [...value, o.value] : value.filter((v) => v !== o.value))}
            className="text-xs"
          >
            {o.label}
          </DropdownMenuCheckboxItem>
        ))}
        {value.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onChange([])} className="text-xs">Clear {label.toLowerCase()}</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
