import { NextRequest, after } from "next/server";
import { randomBytes } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { enrichTripByIdAdmin } from "@/lib/images/enrichTrip";
import { createRateLimiter } from "@/lib/api/rate-limit";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import {
  validateAnonymousTripPayload,
  claimExpiryFrom,
  MAX_BODY_BYTES,
} from "@/lib/trips/anonymous-share";

/**
 * POST /api/trips/anonymous — mint a shareable trip for a signed-OUT planner.
 *
 * WHY THIS EXISTS
 * The crew loop dies at hop one. An anonymous planner could generate an
 * itinerary but had no way to send it to anyone: persistTrip hard-writes
 * user_id, and /api/trips/[id]/share requires an authenticated owner. Only
 * 55 of 323 trips (17%) had ever been shared. This route is the missing hop.
 *
 * WHAT AN ANONYMOUS CALLER GETS — and deliberately does not
 *   gets:  one ownerless trip row, a public read-only share_token, and a
 *          secret claim_token their browser keeps.
 *   never: editing, the AI concierge, /explore publishing, bananas, referrals
 *          or notifications. That boundary is enforced in Postgres, not here:
 *          trips_update and trips_delete_own both require
 *          user_id = auth.uid(), and `NULL = auth.uid()` is never true, so an
 *          ownerless row is structurally immutable for every caller that goes
 *          through RLS. This route is the only way such a row is ever created.
 *
 * WHY THE ADMIN CLIENT
 * trips_insert_own still requires user_id = auth.uid(), so the anon key cannot
 * insert. That policy is left alone on purpose — relaxing it to allow
 * `user_id IS NULL` would let anyone spam rows straight at PostgREST with the
 * public key. The row is written server-side with the service role, behind the
 * rate limit below, which is the only door.
 */

// Deliberately tight. Creating a row here is a deliberate "share this" action,
// not a background call: a human shares a handful of trips an hour at most.
const limiter = createRateLimiter("anon-trip-share", 5, 60 * 60_000);

export async function POST(request: NextRequest) {
  try {
    const { allowed } = await limiter.check(request);
    if (!allowed) {
      return errors.rateLimit(
        "Too many share links from this connection. Try again later."
      );
    }

    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) {
      return errors.badRequest("Trip is too large to share.");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return errors.badRequest("Invalid JSON body.");
    }

    const result = validateAnonymousTripPayload(parsed);
    if (!result.ok) return errors.badRequest(result.error);
    const trip = result.value;

    // Two DIFFERENT secrets, and they must never be the same value: share_token
    // is public and read-only, claim_token confers ownership exactly once.
    const shareToken = randomBytes(24).toString("base64url");
    const claimToken = randomBytes(32).toString("base64url");
    const claimExpiresAt = claimExpiryFrom(new Date());

    const { data, error } = await createAdminClient()
      .from("trips")
      .insert({
        user_id: null,
        title: trip.title,
        description: trip.description,
        destination: trip.destination,
        start_date: trip.startDate,
        end_date: trip.endDate,
        status: "planning",
        // Stays private: readability comes from share_token via
        // trips_select_consolidated, NOT from visibility. An anonymous trip
        // must never become eligible for the /explore feed.
        visibility: "private",
        itinerary: trip.itinerary,
        cover_image_url: trip.coverImageUrl,
        share_token: shareToken,
        claim_token: claimToken,
        claim_expires_at: claimExpiresAt,
      })
      .select("id")
      .single();

    if (error || !data) {
      console.error("[anon-share] insert failed:", error);
      return errors.internal("Could not create the share link.");
    }

    // Same treatment the authenticated share route gives a trip about to be
    // looked at by other people: upgrade the curated generation-time images to
    // real photos. Without this every anonymous share would land on a gradient
    // hero — the exact failure mode that produced a string of P0 bugs on the
    // /shared pages. Runs after the response (next/server `after`) so it never
    // delays the link, and the 24h cooldown inside makes repeats free.
    after(() => enrichTripByIdAdmin(data.id as string, "share"));

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://monkeytravel.app";

    return apiSuccess({
      tripId: data.id,
      shareToken,
      // No ?ref= here. buildShareUrl on the authenticated share route stamps the
      // OWNER's referral code, and an anonymous sharer has neither an owner nor
      // a code. Attribution is picked up when the trip is claimed at signup.
      shareUrl: `${appUrl}/shared/${shareToken}`,
      claimToken,
      claimExpiresAt,
    });
  } catch (err) {
    console.error("[anon-share] unexpected error:", err);
    return errors.internal("Could not create the share link.");
  }
}
