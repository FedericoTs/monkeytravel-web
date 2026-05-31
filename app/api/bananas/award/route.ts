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
import { addBananas } from "@/lib/bananas/transactions";
import type { BananaTransactionType } from "@/types/bananas";

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
    .select("id, user_id")
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

  // Idempotency check: have we already credited this (user, type, reference_id)?
  // The combo is the natural unique key — each activity checks once per trip,
  // each achievement unlocks once per trip, each trip completes once.
  const { data: existing, error: existingErr } = await supabase
    .from("banana_transactions")
    .select("id, balance_after")
    .eq("user_id", user.id)
    .eq("transaction_type", type)
    .eq("reference_id", referenceId)
    .limit(1)
    .maybeSingle();

  if (existingErr) {
    // Don't fail the request just because the check errored — log and continue.
    // Worst case we award twice on a transient DB blip; that's recoverable.
    console.warn("[/api/bananas/award] idempotency check failed (non-fatal):", existingErr.message);
  }
  if (existing) {
    // Already credited. Return current balance for client UI sync.
    const { data: userRow } = await supabase
      .from("users")
      .select("banana_balance")
      .eq("id", user.id)
      .maybeSingle();
    const balance = (userRow as { banana_balance?: number } | null)?.banana_balance ?? existing.balance_after;
    return apiSuccess({
      ok: true,
      awarded: 0,
      newBalance: balance,
      duplicate: true,
    });
  }

  const amount = AWARD_AMOUNTS[type as AwardType];

  const result = await addBananas(
    supabase,
    user.id,
    amount,
    type as BananaTransactionType,
    referenceId,
    description ?? defaultDescriptionFor(type as AwardType)
  );

  if (!result.success) {
    // The 2026-05-30 migration added a DB-level UNIQUE constraint on
    // (user_id, transaction_type, reference_id) WHERE amount > 0 — so
    // concurrent races between the SELECT-then-INSERT pre-check above
    // and this RPC will surface here as a Postgres 23505. Map it to
    // the same idempotent-success response the pre-check returns so
    // the client UX is consistent regardless of which guard fired.
    //
    // Substring match because the supabase-js error doesn't always
    // preserve the code field — we look for the unique-violation
    // signature OR the index name directly. Anything else is a real
    // failure and should still 500.
    const errMsg = result.error ?? "Award failed";
    const isDupRace =
      /duplicate key|already exists|23505|uniq_banana_tx_credit_idempotency/i.test(
        errMsg
      );

    if (isDupRace) {
      const { data: userRow } = await supabase
        .from("users")
        .select("banana_balance")
        .eq("id", user.id)
        .maybeSingle();
      const balance =
        (userRow as { banana_balance?: number } | null)?.banana_balance ?? 0;
      return apiSuccess({
        ok: true,
        awarded: 0,
        newBalance: balance,
        duplicate: true,
      });
    }

    console.error("[/api/bananas/award] addBananas failed:", errMsg);
    return errors.internal(errMsg, "BananasAward");
  }

  return apiSuccess({
    ok: true,
    awarded: amount,
    newBalance: result.newBalance,
    duplicate: false,
  });
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
