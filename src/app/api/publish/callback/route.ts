import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { handlePublishCallback, type CallbackBody } from "@/lib/echo/publish";

/**
 * make.com calls this after posting to the DEMO LinkedIn profile:
 *   POST { "publication_id": "…", "callback_token": "…", "status": "published" | "failed",
 *          "linkedin_post_id": "urn:li:share:…", "linkedin_url": "https://www.linkedin.com/…", "error": "…" }
 * The one-time token came with the send, so no shared secret lives in make.com.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as CallbackBody | null;
  if (!body) return NextResponse.json({ error: "expected JSON" }, { status: 400 });
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
  const result = await handlePublishCallback(db, body);
  return result.ok ? NextResponse.json(result) : NextResponse.json({ error: result.error }, { status: result.code });
}
