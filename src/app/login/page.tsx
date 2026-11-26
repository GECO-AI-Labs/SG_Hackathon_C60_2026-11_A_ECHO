"use client";

import { useActionState } from "react";
import { signIn } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function LoginPage() {
  const [state, action, pending] = useActionState(signIn, null);

  return (
    <main className="mx-auto grid min-h-dvh max-w-5xl grid-cols-1 items-center gap-12 px-6 py-16 md:grid-cols-[1.3fr_1fr]">
      <section>
        <p className="kicker">Cohort 60 · Team A · Content Management</p>
        <h1 className="mt-4 text-[clamp(4rem,12vw,9rem)] leading-[0.85] font-medium tracking-tight">ECHO</h1>
        <div className="mt-5 h-[3px] w-24 bg-pencil" />
        <p className="mt-5 max-w-md font-serif text-2xl leading-snug italic text-foreground/80">
          Every content hits objectives.
        </p>
        <p className="mt-6 max-w-md text-sm leading-relaxed text-muted-foreground">
          ECHO drafts LinkedIn posts from your own library, reads what performed, and learns from every edit you make. You hold the
          red pencil: nothing is posted without your approval.
        </p>
      </section>

      <form action={action} className="rounded-sm border border-border bg-card/60 p-6">
        <p className="kicker mb-6">Reviewer sign-in</p>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" autoComplete="email" required defaultValue={state?.email} key={state?.email} className="h-10 bg-card" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input id="password" name="password" type="password" autoComplete="current-password" required className="h-10 bg-card" />
          </div>
        </div>
        {state?.error && (
          <p role="alert" className="mt-4 text-sm text-pencil">
            {state.error}
          </p>
        )}
        <Button type="submit" disabled={pending} className="mt-6 h-10 w-full">
          {pending ? "Signing in…" : "Open the desk"}
        </Button>
        <p className="mt-4 text-xs text-muted-foreground">Accounts are created by the team lead (see README).</p>
      </form>
    </main>
  );
}
