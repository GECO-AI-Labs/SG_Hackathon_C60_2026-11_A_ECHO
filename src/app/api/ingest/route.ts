import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { ingestPosts, type PostRowIn } from "@/lib/echo/ingest";

/**
 * Webhook for make.com. POST JSON with header `x-echo-secret: <INGEST_SECRET>`:
 *   { "as_of": "2026-11-26", "posts": [ { post_id, url, published_date, format, text, impressions, clicks, … } ] }
 * Columns match data/clean/posts.csv. Responds with a match report.
 * Add "page": "demo" when syncing the dummy LinkedIn profile: those rows are stored as
 * source = 'demo' and kept out of every stat, insight and learning signal.
 */
export async function POST(req: Request) {
  const secret = process.env.INGEST_SECRET;
  if (!secret || req.headers.get("x-echo-secret") !== secret) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }
  const body = (await req.json().catch(() => null)) as { as_of?: string; page?: string; posts?: PostRowIn[] } | null;
  if (!body?.posts?.length) return NextResponse.json({ error: "expected { posts: [...] }" }, { status: 400 });

  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
  try {
    const demo = body.page === "demo";
    const report = await ingestPosts(db, body.posts, { asOf: body.as_of, via: "make", ...(demo && { source: "demo" as const }) });
    await db.from("events").insert({ action: demo ? "ingest.make_demo" : "ingest.make", target_type: "posts", detail: report });
    return NextResponse.json(report);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
