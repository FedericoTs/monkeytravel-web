import { NextRequest, after } from "next/server";
import { getAuthenticatedUser } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { logFunnelEventServer } from "@/lib/analytics/funnel-events";
import { createRateLimiter } from "@/lib/api/rate-limit";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";

/**
 * POST /api/trips/claim — take ownership of an anonymous trip after signing up.
 *
 * This is the conversion half of the anonymous share loop. A signed-out planner
 * shares a trip (see /api/trips/anonymous), their browser keeps the secret
 * claim token, and the moment they create an account the trip becomes theirs:
 * it appears in My Trips and only THEN becomes editable, because RLS grants
 * update rights on `user_id = auth.uid()` and not before.
 *
 * The transfer itself is a single atomic RPC. Doing it as read-then-update
 * here would race two concurrent signups on the same token and could hand one
 * trip to two accounts — the same TOCTOU class already fixed in accept_invite
 * and insert_trip_dedup. claim_anonymous_trip puts the token in the WHERE
 * clause so the second caller matches zero rows.
 */

// A claim is a once-per-signup action. This bucket only exists to stop someone
// brute-forcing the token space; legitimate users hit it once or twice.
const limiter = createRateLimiter("trip-claim", 20, 60 * 60_000);

export async function POST(request: NextRequest) {
  try {
    // Auth first: an anonymous caller has nothing to claim TO, and checking
    // before the rate limit keeps signed-out probes out of the honest bucket.
    const { user, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;

    const { allowed } = await limiter.check(request, `u:${user.id}`);
    if (!allowed) {
      return errors.rateLimit("Too many claim attempts. Try again later.");
    }

    let claimToken: unknown;
    try {
      ({ claimToken } = (await request.json()) as { claimToken?: unknown });
    } catch {
      return errors.badRequest("Invalid JSON body.");
    }

    if (typeof claimToken !== "string" || claimToken.length < 20 || claimToken.length > 200) {
      return errors.badRequest("Invalid claim token.");
    }

    // service_role: the RPC is revoked from anon/public and the row being
    // claimed is ownerless, so the caller's own RLS context cannot see it yet.
    const { data, error } = await createAdminClient().rpc("claim_anonymous_trip", {
      p_claim_token: claimToken,
      p_user_id: user.id,
    });

    if (error) {
      console.error("[trip-claim] rpc failed:", error);
      return errors.internal("Could not claim this trip.");
    }

    const row = Array.isArray(data) ? data[0] : data;
    const claimed = Boolean(row?.claimed);

    if (!claimed) {
      // One opaque outcome for already-claimed / expired / unknown. Telling
      // them apart would turn this endpoint into a token oracle.
      return apiSuccess({ claimed: false, tripId: null });
    }

    // Consent-free record of the conversion. The RPC also stamps
    // trip_meta.claimed_at; this row carries the user for cohort joins.
    // Scheduled with after(): a bare `void` insert here was dropped on
    // production (verified 2026-09-02) because the function returns
    // immediately and can be frozen before the write lands. Telemetry must
    // never fail a claim that succeeded, and logFunnelEventServer never throws.
    const claimedTripId = (row?.trip_id as string | undefined) ?? null;
    after(() =>
      logFunnelEventServer({
        event_type: "trip_claimed",
        trip_id: claimedTripId,
        user_id: user.id,
        metadata: { source: "anonymous_share" },
      }),
    );
    return apiSuccess({ claimed: true, tripId: row?.trip_id ?? null });
  } catch (err) {
    console.error("[trip-claim] unexpected error:", err);
    return errors.internal("Could not claim this trip.");
  }
}
