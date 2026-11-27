"use client";

import { ImagePlus } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";
import { uploadPostImageAction } from "@/app/actions";
import { cn } from "@/lib/utils";

export type PostImage = { path: string; url: string | null };

/**
 * Pick, preview, replace or remove one image for a post. Uploads as soon as a file is
 * chosen, then reports the stored path. `onChange` decides what happens next
 * (keep it in the Write form, or save it on a Gate 2 draft).
 */
export function PostImagePicker({ value, onChange, disabled, compact }: {
  value: PostImage | null;
  onChange: (img: PostImage | null) => void | Promise<void>;
  disabled?: boolean;
  compact?: boolean;
}) {
  const [pending, start] = useTransition();

  const pick = (file: File) =>
    start(async () => {
      try {
        const form = new FormData();
        form.set("file", file);
        await onChange(await uploadPostImageAction(form));
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  const remove = () => start(async () => { try { await onChange(null); } catch (e) { toast.error((e as Error).message); } });

  const input = (
    <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="sr-only" disabled={disabled || pending}
      onChange={(e) => { const f = e.target.files?.[0]; if (f) pick(f); e.target.value = ""; }} />
  );

  if (!value) {
    return (
      <label className={cn(
        "flex cursor-pointer items-center gap-2 rounded-sm border border-dashed border-border text-xs text-muted-foreground hover:border-foreground/40 hover:text-foreground",
        compact ? "px-3 py-2" : "px-4 py-5",
        (disabled || pending) && "pointer-events-none opacity-50",
      )}>
        <ImagePlus className="size-4" />
        {pending ? "Uploading…" : "Add an image (PNG, JPEG, GIF or WebP, up to 8 MB)"}
        {input}
      </label>
    );
  }

  return (
    <div className="flex items-start gap-3">
      {value.url ? (
        // Signed Supabase URLs expire, so next/image caching does not help here.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={value.url} alt="Image attached to this post" className={cn("rounded-sm border border-border object-cover", compact ? "h-16 w-24" : "h-32 w-48")} />
      ) : (
        <div className={cn("grid place-items-center rounded-sm border border-border text-xs text-muted-foreground", compact ? "h-16 w-24" : "h-32 w-48")}>Image</div>
      )}
      {!disabled && (
        <div className="flex flex-col gap-1.5 text-xs">
          <label className={cn("kicker cursor-pointer underline-offset-4 hover:text-foreground hover:underline", pending && "pointer-events-none opacity-50")}>
            {pending ? "Working…" : "Replace"}
            {input}
          </label>
          <button onClick={remove} disabled={pending} className="kicker text-left underline-offset-4 hover:text-pencil hover:underline">Remove</button>
        </div>
      )}
    </div>
  );
}
