import { createClient } from "@supabase/supabase-js";

// The secret key bypasses RLS and must never reach a browser. Server modules only.
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;

if (!url || !key) {
  throw new Error(
    "Set SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local. For the local stack, run `supabase status` in ../next_login.",
  );
}

export const db = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
