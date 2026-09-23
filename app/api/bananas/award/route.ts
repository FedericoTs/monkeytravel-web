/**
 * POST /api/bananas/award
 *
 * Server-side banana credit endpoint for the in-trip gamification loop.
 *
 * Background:
 *   useGamification.recordCompletion historically updated only LOCAL React
 *   state + fired analytics — it NEVER touched the persistence layer. So
 *   users saw "+X" reward animations as they checked activities, but their
 *   actual users.banana_balance stayed at 0 and banana_transactions had
 *   zero entries. Surfaced 2026-05-31 by Alyssa: 4 trips, 0 bananas.
 *
 * This endpoint closes the loop:
 *   - Anyone can earn the small per-activity / per-achievement awards
 *     while their trip is active.
 *   - Trip-complete + first-trip-bonus awards fire once per trip.
 *   - Every award is idempotent on (user_id, transaction_type, reference_id)
 *     — replaying the same client event NEVER double-credits.
 *
 * Auth: required. Anonymous users can't earn bananas (no account to credit).
 *
 * Request:
 *   {
 *     "type": "activity_completion" | "achievement_bonus" | "trip_complete" | "first_trip_bonus",
 *     "tripId": "uuid",
 *     "referenceId": "uuid-or-string",   // activityId for activity_completion,
 *                                          // achievementId for achievement_bonus,
 *                                          // tripId for trip_complete / first_trip_bonus
 *     "description": "optional"
 *   }
 *
 * Response 200:
 *   { ok: true, awarded: 1, newBalance: 47, duplicate: false }
 *   { ok: true, awarded: 0, newBalance: 47, duplicate: true }   // idempotent replay
 *
 * Response 400 / 401 / 403 / 500 as usual.
 */

import { NextRequest } from "next/server";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  DAILY_GAMEPLAY_AWARD_CAP,
  itineraryActivityCount,
  storedAwardReference,
} from "@/lib/bananas/award-reference";

// Per-event award rates. Kept here (not in lib/bananas/config.ts) so the
// server-side authoritative numbers can't be tampered with from client.
const AWARD_AMOUNTS: Record<
  "activity_completion" | "achievement_bonus" | "trip_complete" | "first_trip_bonus",
  number
> = {
  activity_completion: 1,   // 1 banana per checked activity
  achievement_bonus: 5,     // 5 bananas per achievement unlock
  trip_complete: 10,        // 10 bananas when every activity in a trip is done
  first_trip_bonus: 25,     // +25 bonus the first time a user completes any trip
};

type AwardType = keyof typeof AWARD_AMOUNTS;

const VALID_TYPES = new Set<AwardType>([
  "activity_completion",
  "achievement_bonus",
  "trip_complete",
  "first_trip_bonus",
]);

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return errors.unauthorized("Sign in to earn bananas");
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return errors.badRequest("Body must be valid JSON");
  }

  const type = body.type as string;
  const tripId = body.tripId as string;
  const referenceId = (body.referenceId as string) || tripId;
  const description = typeof body.description === "string" ? body.description : undefined;

  if (!VALID_TYPES.has(type as AwardType)) {
    return errors.badRequest(
      `Invalid type. Expected one of: ${Array.from(VALID_TYPES).join(", ")}`
    );
  }
  if (!tripId || typeof tripId !== "string") {
    return errors.badRequest("tripId is required");
  }
  if (!referenceId || typeof referenceId !== "string") {
    return errors.badRequest("referenceId is required");
  }

  // Verify the user actually owns this trip. Stops "I can credit my own
  // account by spamming any random trip id" attacks.
  const { data: trip, error: tripErr } = await supabase
    .from("trips")
    .select("id, user_id, itinerary")
    .is("deleted_at", null)
    .eq("id", tripId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (tripErr) {
    console.error("[/api/bananas/award] trip lookup failed:", tripErr.message);
    return errors.internal("Could not verify trip ownership", "BananasAward");
  }
  if (!trip) {
    return errors.forbidden("That trip doesn't belong to you");
  }

  // The reference must be one this award accepts, or every new string would
  // be a new credit (lib/bananas/award-reference.ts).
  const storedReference = storedAwardReference(type as AwardType, tripId, referenceId);
  if (!storedReference) {
    return errors.badRequest("referenceId does not match this award");
  }

  const amount = AWARD_AMOUNTS[type as AwardType];

  // Duplicate check, caps and credit happen in one transaction that locks
  // the user's row (award_gameplay_bananas, 20260924119000): a trip earns at
  // most one activity credit per activity it holds, and a person at most
  // DAILY_GAMEPLAY_AWARD_CAP a day. Checked here with plain reads, a burst
  // of parallel requests all saw the same totals and all got credited.
  // Service role: the function takes any user id; this is the session user.
  const { data: rows, error: awardErr } = await createAdminClient().rpc("award_gameplay_bananas", {
    p_user_id: user.id,
    p_type: type,
    p_reference: storedReference,
    p_amount: amount,
    p_trip_id: tripId,
    p_activity_cap: itineraryActivityCount(trip.itinerary),
    p_daily_cap: DAILY_GAMEPLAY_AWARD_CAP,
    p_description: description ?? defaultDescriptionFor(type as AwardType),
  });

  if (awardErr) {
    // The unique index on (user_id, transaction_type, reference_id) can still
    // fire for a request that raced past the duplicate check before the lock
    // existed on this row; treat it like the duplicate it is.
    if (/duplicate key|already exists|23505|uniq_banana_tx_credit_idempotency/i.test(awardErr.message)) {
      return apiSuccess({ ok: true, awarded: 0, newBalance: await balanceOf(supabase, user.id), duplicate: true });
    }
    console.error("[/api/bananas/award] award_gameplay_bananas failed:", awardErr.message);
    return errors.internal("Award failed", "BananasAward");
  }

  const row = (Array.isArray(rows) ? rows[0] : rows) as { outcome?: string; new_balance?: number } | null;
  const outcome = row?.outcome ?? "credited";
  // Over a cap is not an error: the client's animation already played, so it
  // answers like a duplicate with nothing credited.
  return apiSuccess({
    ok: true,
    awarded: outcome === "credited" ? amount : 0,
    newBalance: row?.new_balance ?? 0,
    duplicate: outcome === "duplicate",
    ...(outcome === "capped" ? { capped: true } : {}),
  });
}

async function balanceOf(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string
): Promise<number> {
  const { data } = await supabase.from("users").select("banana_balance").eq("id", userId).maybeSingle();
  return (data as { banana_balance?: number } | null)?.banana_balance ?? 0;
}

function defaultDescriptionFor(type: AwardType): string {
  switch (type) {
    case "activity_completion":
      return "Activity completed";
    case "achievement_bonus":
      return "Achievement unlocked";
    case "trip_complete":
      return "Trip completed — all activities done";
    case "first_trip_bonus":
      return "First trip completed — welcome bonus!";
  }
}
