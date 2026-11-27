import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clip } from "@/lib/edit";

/**
 * Demo publishing through make.com.
 *
 * A person clicks "Send to demo LinkedIn" on a post that passed Gate 2. ECHO posts it to
 * a make.com webhook; the scenario publishes it on a DUMMY LinkedIn profile and calls
 * back with the live link. The real Upskill Today page is never posted to, and nothing
 * is sent without that click (brief: no auto-publish).
 *
 * Each send carries a one-time callback token. Only its hash is stored, so the make.com
 * scenario holds no ECHO secret and a token cannot confirm a post twice.
 */

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export async function sendToDemo(db: SupabaseClient, itemId: string, actor: string, callbackUrl: string) {
  const hook = process.env.MAKE_PUBLISH_WEBHOOK_URL;
  if (!hook) throw new Error("Demo publishing is not set up yet: add MAKE_PUBLISH_WEBHOOK_URL to .env.local.");

  const { data: item } = await db.from("review_items").select("id, item_type, status, title, final, draft, image_path").eq("id", itemId).single();
  if (!item || item.item_type !== "post_draft") throw new Error("Only post drafts can be sent.");
  if (item.status !== "approved" && item.status !== "edited") throw new Error("Only posts approved at Gate 2 can be sent.");
  const text = String(item.final ?? item.draft ?? "").trim();
  if (!text) throw new Error("This post has no approved text.");

  const { data: earlier } = await db.from("publications").select("id, status").eq("review_item_id", itemId).in("status", ["sending", "sent", "published"]).limit(1);
  if (earlier?.length) throw new Error(earlier[0].status === "published" ? "Already on the demo profile." : "Already sent. Waiting for make.com to confirm.");

  const token = randomBytes(24).toString("base64url");
  const { data: pub, error } = await db
    .from("publications")
    .insert({ review_item_id: itemId, text, image_path: item.image_path, status: "sending", callback_hash: sha256(token), requested_by: actor })
    .select("id")
    .single();
  if (error || !pub) throw error ?? new Error("Could not record the send.");

  // make.com downloads the image from a short-lived signed link; the bucket stays private.
  const image = item.image_path ? (await db.storage.from("post-images").createSignedUrl(item.image_path, 3600)).data?.signedUrl ?? null : null;
  const payload = {
    publication_id: pub.id,
    target: "demo",
    text,
    has_image: !!image,
    image_url: image,
    image_filename: item.image_path ? item.image_path.split("/").pop() : null,
    callback_url: callbackUrl,
    callback_token: token,
  };

  let status: "sent" | "failed" = "sent";
  let failure: string | null = null;
  try {
    const res = await fetch(hook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(15000) });
    if (!res.ok) { status = "failed"; failure = `make.com answered ${res.status}`; }
  } catch (e) {
    status = "failed";
    failure = `make.com did not answer: ${(e as Error).message}`;
  }
  // Only move on from "sending": a fast scenario may already have called back with "published".
  await db.from("publications").update({ status, error: failure, ...(status === "failed" && { callback_hash: null }) }).eq("id", pub.id).eq("status", "sending");
  await db.from("events").insert({
    actor, action: `publish.${status}`, target_type: "post_draft", target_id: itemId,
    detail: { publication_id: pub.id, target: "demo", has_image: !!image, error: failure, title: item.title },
  });
  if (failure) throw new Error(failure);
  return pub.id as string;
}

export type CallbackBody = {
  publication_id?: string;
  callback_token?: string;
  status?: string;
  linkedin_post_id?: string;
  linkedin_url?: string;
  error?: string;
};

/** make.com reports back. Runs with the service key (no user session), so the token is the only proof. */
export async function handlePublishCallback(db: SupabaseClient, body: CallbackBody) {
  const id = String(body.publication_id ?? "");
  const token = String(body.callback_token ?? "");
  if (!/^[0-9a-f-]{36}$/.test(id) || token.length < 20) return { ok: false as const, code: 400, error: "publication_id and callback_token are required" };

  const { data: pub } = await db.from("publications").select("id, review_item_id, status, callback_hash").eq("id", id).maybeSingle();
  const a = Buffer.from(pub?.callback_hash ?? "");
  const b = Buffer.from(sha256(token));
  if (!pub || !pub.callback_hash || a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false as const, code: 401, error: "unknown or used token" };

  const published = body.status !== "failed";
  const postId = body.linkedin_post_id ? clip(String(body.linkedin_post_id), 200) : null;
  const given = body.linkedin_url ? String(body.linkedin_url) : "";
  const url = /^https:\/\/(www\.)?linkedin\.com\//.test(given) ? clip(given, 500) : postId?.startsWith("urn:li:") ? `https://www.linkedin.com/feed/update/${postId}/` : null;

  await db.from("publications").update({
    status: published ? "published" : "failed",
    linkedin_post_id: postId,
    linkedin_url: url,
    error: published ? null : clip(String(body.error ?? "make.com reported a failure"), 500),
    published_at: published ? new Date().toISOString() : null,
    callback_hash: null, // one-time
  }).eq("id", id);
  await db.from("events").insert({
    action: published ? "publish.published" : "publish.failed", target_type: "post_draft", target_id: pub.review_item_id,
    detail: { publication_id: id, target: "demo", linkedin_url: url, via: "make" },
  });
  return { ok: true as const, status: published ? "published" : "failed" };
}
