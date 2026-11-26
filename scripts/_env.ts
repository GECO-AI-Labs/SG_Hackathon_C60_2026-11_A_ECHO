// Shared setup for scripts: loads .env.local and makes an admin Supabase client.
// Scripts bypass row-level security, so they must never run in the browser.
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local", quiet: true });

export function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY in .env.local (see README, step 3).");
    process.exit(1);
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

export const log = (...a: unknown[]) => console.log("›", ...a);
