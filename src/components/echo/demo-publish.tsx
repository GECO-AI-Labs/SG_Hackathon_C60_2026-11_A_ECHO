"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { sendToDemoAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ReadyPost = { id: string; title: string; text: string; decided_at: string; image_url: string | null; sent: string | null };
export type Publication = {
  id: string; title: string; status: "sending" | "sent" | "published" | "failed"; requested_at: string; published_at: string | null;
  linkedin_url: string | null; error: string | null; by: string | null; has_image: boolean;
  stale: boolean; // sent more than 5 minutes ago and make.com has not called back
};

const STATUS: Record<Publication["status"], { label: string; cls: string }> = {
  sending: { label: "Sending", cls: "text-muted-foreground" },
  sent: { label: "Sent, waiting for make.com", cls: "text-inferred" },
  published: { label: "Live on demo profile", cls: "text-approve" },
  failed: { label: "Failed", cls: "text-pencil" },
};

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/**
 * Stage 03, shown on Write: posts that passed Gate 2 can be sent, one click each, to the
 * DUMMY LinkedIn profile through make.com. The log below proves the sync. Demo posts never
 * count in Signals or learning.
 */
export function DemoPublish({ ready, log, configured }: { ready: ReadyPost[]; log: Publication[]; configured: boolean }) {
  return (
    <div className="space-y-4 border-t border-border pt-4">
      <div>
        <p className="kicker">Demo LinkedIn · via make.com</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Send an approved post to the team&apos;s dummy profile to show the automation. The real Upskill Today page is never posted to, and demo results never count in
          Signals or learning.
        </p>
        {!configured && <p className="mt-2 text-xs text-inferred">Not connected yet: MAKE_PUBLISH_WEBHOOK_URL is missing. See the README, “make.com”.</p>}
      </div>

      <ul className="space-y-3">
        {ready.map((p) => <ReadyRow key={p.id} post={p} disabled={!configured} />)}
        {!ready.length && <li className="text-xs text-muted-foreground">No approved posts yet. Approve one at Gate 2 on the Desk.</li>}
      </ul>

      {log.length > 0 && (
        <div>
          <p className="kicker">Sync log</p>
          <ul className="mt-2 space-y-2 text-xs">
            {log.map((l) => {
              return (
                <li key={l.id} className="border-l-2 border-border pl-2">
                  <p className="line-clamp-1 text-foreground">{l.title}</p>
                  <p className={STATUS[l.status].cls}>
                    {STATUS[l.status].label}
                    {l.linkedin_url && <> · <a href={l.linkedin_url} target="_blank" rel="noreferrer" className="underline underline-offset-4">open post</a></>}
                  </p>
                  {l.error && <p className="text-pencil">{l.error}</p>}
                  {l.stale && <p className="text-muted-foreground">No confirmation after 5 minutes. Check the scenario&apos;s run history in make.com.</p>}
                  <p className="text-muted-foreground">{when(l.requested_at)}{l.by ? ` · ${l.by}` : ""}{l.has_image ? " · with image" : ""}</p>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function ReadyRow({ post, disabled }: { post: ReadyPost; disabled: boolean }) {
  const router = useRouter();
  const [armed, setArmed] = useState(false);
  const [pending, start] = useTransition();

  // Two clicks: posting to LinkedIn (even a dummy profile) is outward-facing.
  const send = () => {
    if (!armed) { setArmed(true); setTimeout(() => setArmed(false), 5000); return; }
    start(async () => {
      try {
        await sendToDemoAction(post.id);
        toast.success("Sent to make.com", { description: "It appears in the sync log when the demo post is live." });
        router.refresh();
      } catch (e) {
        toast.error((e as Error).message);
        router.refresh();
      } finally {
        setArmed(false);
      }
    });
  };

  return (
    <li className="flex gap-3">
      {post.image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={post.image_url} alt="" className="h-12 w-16 shrink-0 rounded-sm border border-border object-cover" />
      ) : (
        <div className="grid h-12 w-16 shrink-0 place-items-center rounded-sm border border-dashed border-border text-[0.6rem] text-muted-foreground">text only</div>
      )}
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-xs" title={post.text}>{post.title}</p>
        {post.sent ? (
          <p className="mt-1 text-[0.7rem] text-muted-foreground">{post.sent}</p>
        ) : (
          <Button size="sm" variant={armed ? "default" : "outline"} disabled={disabled || pending} onClick={send} className={cn("mt-1 h-7 text-xs", armed && "bg-pencil hover:bg-pencil/90")}>
            {pending ? "Sending…" : armed ? "Click again to post to demo profile" : "Send to demo LinkedIn"}
          </Button>
        )}
      </div>
    </li>
  );
}
