"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { signOut } from "@/app/actions";

const NAV = [
  { href: "/", label: "Desk", hint: "Review queue, all four gates" },
  { href: "/write", label: "Write", hint: "Brief a new post" },
  { href: "/library", label: "Library", hint: "Search and add material" },
  { href: "/signals", label: "Signals", hint: "Performance and insights" },
  { href: "/ledger", label: "Ledger", hint: "Trust, rules and audit trail" },
];

export function Masthead({ name, pending, dateline }: { name: string; pending: number; dateline: string }) {
  const path = usePathname();
  return (
    <header>
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 pt-4 text-[0.7rem] sm:px-6">
        <span className="kicker">{dateline}</span>
        <span className="kicker hidden sm:inline">Upskill Today · LinkedIn</span>
        <form action={signOut} className="flex items-center gap-3">
          <span className="kicker normal-case tracking-normal">{name}</span>
          <button className="kicker underline-offset-4 hover:text-foreground hover:underline">Sign out</button>
        </form>
      </div>
      <div className="mx-auto flex max-w-7xl flex-wrap items-end justify-between gap-x-8 gap-y-3 px-4 pt-3 pb-0 sm:px-6">
        <Link href="/" className="group flex items-baseline gap-3 pb-3">
          <span className="font-serif text-4xl leading-none font-semibold tracking-tight">ECHO</span>
          <span className="hidden font-serif text-sm italic text-muted-foreground md:inline">Every content hits objectives</span>
        </Link>
        <nav className="-mb-px flex gap-1 overflow-x-auto">
          {NAV.map((n) => {
            const active = n.href === "/" ? path === "/" : path.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                title={n.hint}
                className={cn(
                  "relative px-3 pt-2 pb-3 text-sm whitespace-nowrap transition-colors",
                  active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {n.label}
                {n.href === "/" && pending > 0 && <span className="num ml-1.5 text-[0.7rem] text-pencil">{pending}</span>}
                <span className={cn("absolute inset-x-3 bottom-0 h-[3px] transition-colors", active ? "bg-pencil" : "bg-transparent")} />
              </Link>
            );
          })}
        </nav>
      </div>
      <div className="h-[3px] bg-rule" />
    </header>
  );
}
