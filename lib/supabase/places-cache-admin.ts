import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Service-role client for the `google_places_cache` table.
 *
 * WHY THIS EXISTS
 * The cache was read AND written through the ANON client, and its RLS policies
 * were `google_places_cache_public_insert` (WITH CHECK true) and
 * `google_places_cache_public_update` (USING true). Verified against
 * production with the public anon key: an UPDATE to a row we did not create
 * returned 200, and an INSERT returned 201. Cache keys are md5 of predictable
 * strings, so any row is targetable — meaning anyone holding the public key
 * could overwrite the name, address, coordinates or photo URL that every user
 * of this app then sees. (DELETE was already denied: no DELETE policy exists,
 * so PostgREST returns 204 having removed nothing — confirmed by re-counting
 * the table afterwards.)
 *
 * Writing through the service role lets the accompanying migration drop those
 * public write policies without breaking the cache, which is the point: the
 * cache is a major cost saver and a cost regression would be worse than the
 * risk being closed.
 *
 * SAFETY
 * The key is read from `process.env.SUPABASE_SERVICE_ROLE_KEY`, which Next.js
 * never inlines into a client bundle — only `NEXT_PUBLIC_*` is inlined — so it
 * cannot leak to the browser through this module. Every importer today is a
 * route handler or a server-only lib.
 */

// Memoised per lambda instance. createAdminClient() builds a fresh client on
// every call, and the cache is touched on essentially every place lookup, so
// constructing one per request would be pure waste.
let client: SupabaseClient | null | undefined;

/**
 * The cache client, or `null` when the service key is unavailable.
 *
 * Deliberately returns null instead of throwing. createAdminClient() throws on
 * missing credentials, and the call sites it replaces were wrapped in
 * try/catch that degraded to "treat as a cache miss". A misconfigured
 * environment must keep serving places results — slower and more expensive,
 * but working — rather than 500 the route. Callers therefore null-check and
 * skip the cache, exactly as they previously swallowed an error.
 */
export function placesCacheDb(): SupabaseClient | null {
  if (client !== undefined) return client;
  try {
    client = createAdminClient();
  } catch (err) {
    // Once per instance, not once per request.
    console.error(
      "[places-cache] service role unavailable — running without cache:",
      err instanceof Error ? err.message : err
    );
    client = null;
  }
  return client;
}
