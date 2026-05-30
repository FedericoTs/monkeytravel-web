/**
 * Calendar subscription feed — HMAC mint/verify + trip fetch.
 *
 * Phase 1B of the calendar-export feature (see
 * docs/specs/calendar-export-smart-notifs.md). The route
 * /api/calendar/[user_hmac].ics calls into these helpers to:
 *   1. resolve `user_hmac` → user_id (via the indexed
 *      `users.calendar_hmac` column added in 20260601);
 *   2. pull that user's recent trips for the iCal build;
 *   3. (optional) lazily mint the HMAC for a logged-in user that
 *      hasn't generated their feed URL yet.
 *
 * HMAC choice
 * -----------
 * SHA-256 keyed by `CALENDAR_HMAC_SECRET` over the canonical user_id
 * (lowercase UUID). Output is hex (64 chars) — URL-safe without
 * encoding, distinguishable in logs, easy to type into a support
 * ticket if needed. Constant-time comparison is enforced via
 * `timingSafeEqual` in `verifyUserHmac()`.
 *
 * We use `node:crypto` rather than `crypto.subtle` because the route
 * runs on the Node runtime (Supabase service-role client is not
 * compatible with the edge runtime due to its websocket transport for
 * realtime). `node:crypto` is synchronous, smaller, and avoids the
 * Uint8Array dance for keyed HMACs.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Length in hex chars of a SHA-256 HMAC. Used to early-reject
 * obviously-bogus path segments before doing any DB work.
 */
export const CALENDAR_HMAC_HEX_LENGTH = 64;

/**
 * Throws if CALENDAR_HMAC_SECRET is missing. Module-level reads can
 * race with Next.js's env-loader on edge, so we read on demand.
 */
function getSecret(): string {
  const secret = process.env.CALENDAR_HMAC_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      "CALENDAR_HMAC_SECRET is not set (or shorter than 16 chars). " +
        "Set it in Vercel project env — see lib/calendar/README.md."
    );
  }
  return secret;
}

/**
 * Deterministic HMAC for a user_id. Same input → same output → stable
 * subscription URL. Canonicalised to lowercase so calling with a
 * mixed-case UUID still resolves.
 */
export function computeUserHmac(userId: string): string {
  const secret = getSecret();
  return createHmac("sha256", secret)
    .update(userId.toLowerCase())
    .digest("hex");
}

/**
 * Constant-time compare of two HMAC hex strings. Returns false fast
 * if lengths don't match (timingSafeEqual throws on length mismatch).
 */
export function verifyUserHmac(candidate: string, expected: string): boolean {
  if (
    candidate.length !== CALENDAR_HMAC_HEX_LENGTH ||
    expected.length !== CALENDAR_HMAC_HEX_LENGTH
  ) {
    return false;
  }
  try {
    return timingSafeEqual(
      Buffer.from(candidate, "hex"),
      Buffer.from(expected, "hex")
    );
  } catch {
    return false;
  }
}

/**
 * Look up the user_id for a given calendar_hmac via the indexed
 * UNIQUE column. Returns null if the HMAC isn't recognised — the
 * route surfaces that as 404 (intentional: don't differentiate from
 * "route doesn't exist" so scanners get no signal).
 *
 * Uses service-role because the column doesn't have a public RLS
 * read policy (and shouldn't — it's an opaque secret for one user).
 */
export async function findUserByCalendarHmac(
  userHmac: string
): Promise<{ userId: string } | null> {
  if (
    typeof userHmac !== "string" ||
    userHmac.length !== CALENDAR_HMAC_HEX_LENGTH ||
    !/^[a-f0-9]+$/i.test(userHmac)
  ) {
    return null;
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("users")
    .select("id")
    .eq("calendar_hmac", userHmac.toLowerCase())
    .maybeSingle();

  if (error || !data) return null;
  return { userId: data.id };
}

/**
 * Mint + persist the user's calendar_hmac if it isn't already set.
 * Idempotent — re-call is cheap. Returns the hmac value either way.
 *
 * NOT used by the read-only feed route (which must not write). Phase
 * 2 will call this from the Subscribe-tab UI when the user opens
 * AddToCalendarSheet to obtain a stable URL to copy.
 */
export async function getOrCreateUserHmac(userId: string): Promise<string> {
  const hmac = computeUserHmac(userId);
  const admin = createAdminClient();
  // UPSERT-ish: write-if-null. We avoid plain UPDATE-without-condition
  // so re-running with a rotated secret doesn't silently overwrite
  // (rotation is an explicit ops action — null the column first).
  const { error } = await admin
    .from("users")
    .update({ calendar_hmac: hmac })
    .eq("id", userId)
    .is("calendar_hmac", null);

  if (error) {
    // Unique-violation is fine — means a concurrent caller wrote it.
    // 23505 = unique_violation; we don't import pg-error-codes for one
    // string match.
    const code = (error as { code?: string }).code;
    if (code !== "23505") {
      throw new Error(
        `Failed to mint calendar HMAC for user: ${error.message}`
      );
    }
  }
  return hmac;
}

// ---------------------------------------------------------------------------
// Trip query for the feed
// ---------------------------------------------------------------------------

/**
 * Window we expose in the feed. Anything that ended more than this
 * many days ago is omitted — keeps the .ics small and avoids
 * resurfacing ancient trips on a calendar client's first sync.
 */
export const FEED_PAST_WINDOW_DAYS = 7;

export type FeedTrip = {
  id: string;
  title: string;
  start_date: string | null;
  end_date: string | null;
  // The .ics builder only needs the structural pieces — JSONB shape
  // matches `ItineraryDay[]` from @/types. We keep it untyped here to
  // avoid widening the lib/calendar surface with a trip-domain import.
  itinerary: unknown;
  trip_meta: unknown;
};

/**
 * Pull the user's trips eligible for inclusion in the subscription
 * feed. Bypasses RLS via service-role (we've already authenticated
 * the caller via the HMAC).
 *
 * Filters:
 *   - own trips only (no collaborator trips — privacy: don't expose
 *     another user's itinerary in this user's calendar feed without
 *     explicit opt-in. Phase 3 will add collaborator opt-in.)
 *   - not archived
 *   - end_date IS NULL (undated trip — still surface) OR
 *     end_date > now() - INTERVAL '7 days'
 */
export async function fetchUserTripsForFeed(
  userId: string
): Promise<FeedTrip[]> {
  const admin = createAdminClient();
  const cutoff = new Date(
    Date.now() - FEED_PAST_WINDOW_DAYS * 24 * 60 * 60 * 1000
  )
    .toISOString()
    .slice(0, 10); // YYYY-MM-DD for the DATE column

  const { data, error } = await admin
    .from("trips")
    .select("id, title, start_date, end_date, itinerary, trip_meta")
    .eq("user_id", userId)
    .neq("is_archived", true)
    // PostgREST `.or()` for the (end_date NULL or > cutoff) compound.
    .or(`end_date.is.null,end_date.gte.${cutoff}`)
    .order("start_date", { ascending: true, nullsFirst: false })
    .limit(200);

  if (error) {
    throw new Error(`fetchUserTripsForFeed failed: ${error.message}`);
  }
  return (data ?? []) as FeedTrip[];
}
