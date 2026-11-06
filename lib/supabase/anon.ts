import { createClient } from "@supabase/supabase-js";

import { timeoutFetch } from "@/lib/supabase/timeout-fetch";

/**
 * A client with the public key and no session, for what anyone may read, and for
 * the auth calls that don't belong to a signed-in visitor.
 */
export function createAnonClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error("Missing Supabase public credentials");
  }

  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: timeoutFetch },
  });
}
