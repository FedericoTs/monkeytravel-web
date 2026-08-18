import { NextRequest, after } from "next/server";
import { randomBytes, randomUUID } from "crypto";
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
    //
    // share_token is a UUID COLUMN, not text — a base64url string is rejected
    // by Postgres and 500s the whole route. (The authenticated share route
    // imports uuid for exactly this reason.) claim_token is text, so it keeps
    // the higher-entropy random string.
    const shareToken = randomUUID();
    const claimToken = randomBytes(32).toString("base64url");
    const claimExpiresAt = claimExpiryFrom(new Date());

    const { data, error } = await createAdminClient()
      .from("trips")
      .insert({
        user_id: null,
        title: trip.title,
        description: trip.description,
        // `destination` is NOT a top-level column on trips — it lives inside
        // the trip_meta JSONB, which is where persistTrip writes it and where
        // every reader (destination helper, /explore filters, analytics) looks
        // for it. Passing it at top level makes PostgREST reject the insert.
        trip_meta: { destination: trip.destination },
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

    // Two steps, in this order, both after the response (next/server `after`)
    // so neither delays the link.
    //
    // 1. enrichTripByIdAdmin upgrades the curated generation-time ACTIVITY
    //    images to real photos — the same treatment the authenticated share
    //    route gives a trip about to be seen by other people.
    //
    // 2. Then pick a hero cover. This second step is NOT optional and was
    //    missing in the first version: enrichTripRecord writes activity images
    //    only and never touches `cover_image_url`, while /shared renders its
    //    hero with disableApiCalls={true} and therefore never fetches one
    //    client-side. A null cover is thus a guaranteed coral gradient — the
    //    exact P0 look already fixed twice on this surface. Verified live: a
    //    Valencia share had 19/19 activity photos and a gradient hero.
    //
    //    The authenticated path computes its cover inside handleSaveTrip, which
    //    is client-side and unavailable here, so we mirror that function's own
    //    fallback: reuse the first real activity photo. Enrichment runs first so
    //    the image chosen is an upgraded photo rather than a placeholder, and it
    //    costs no extra API call because the URL is already in the itinerary.
    after(async () => {
      await enrichTripByIdAdmin(data.id as string, "share");
      await backfillCoverFromItinerary(data.id as string);
    });

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

/**
 * Give an anonymous shared trip a hero cover, reusing a photo it already has.
 *
 * Only ever fills a NULL cover — never overwrites one a real owner set — and
 * is a no-op when the itinerary has no usable photo, in which case the page
 * keeps its gradient rather than rendering a broken image.
 */
async function backfillCoverFromItinerary(tripId: string): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: trip } = await admin
      .from("trips")
      .select("cover_image_url, itinerary")
      .eq("id", tripId)
      .single();

    if (!trip || trip.cover_image_url) return;

    const days = Array.isArray(trip.itinerary) ? trip.itinerary : [];
    let cover: string | null = null;
    for (const day of days) {
      const acts = (day as { activities?: unknown })?.activities;
      if (!Array.isArray(acts)) continue;
      for (const a of acts) {
        const url = (a as { image_url?: unknown })?.image_url;
        if (typeof url === "string" && url.trim() !== "") {
          cover = url;
          break;
        }
      }
      if (cover) break;
    }
    if (!cover) return;

    // `is("cover_image_url", null)` repeated on the write: between the read and
    // here the trip could have been claimed and given a cover by its new owner.
    await admin
      .from("trips")
      .update({ cover_image_url: cover })
      .eq("id", tripId)
      .is("cover_image_url", null);
  } catch (err) {
    // A missing hero is a cosmetic degradation, never a reason to surface an
    // error for a link that was already handed to the planner successfully.
    console.error("[anon-share] cover backfill failed:", err);
  }
}
