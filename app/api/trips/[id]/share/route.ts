import { NextRequest, after } from "next/server";
import { getAuthenticatedUser, verifyTripAccess, verifyTripOwnership } from "@/lib/api/auth";
import { ensureShareToken, readShareToken } from "@/lib/trips/share-token";
import { enrichTripByIdAdmin } from "@/lib/images/enrichTrip";
import { logFunnelEventServer } from "@/lib/analytics/funnel-events";
import { captureServerEvent } from "@/lib/posthog/server";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import type { TripRouteContext } from "@/lib/api/route-context";
import { purgeTripCard } from "@/lib/seo/trip-card-cache";
import { isExploreUgcEnabled } from "@/lib/explore/flag";
import { buildShareUrl } from "@/lib/trips/share-url";

/**
 * POST /api/trips/[id]/share - Generate a share link for a trip
 */
export async function POST(request: NextRequest, context: TripRouteContext) {
  try {
    const { id } = await context.params;
    const { user, supabase, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;

    // Verify ownership, then hand out the trip's link, made on the first ask
    // (one link however many taps arrive at once). A listed trip stays listed.
    const { trip, errorResponse: tripError } = await verifyTripOwnership(supabase, id, user.id, "id, user_id, visibility");
    if (tripError) return tripError;
    const { token: shareToken, isNew, sharedAt } = await ensureShareToken(
      id,
      trip.visibility === "public" ? "public" : "shared"
    );

    // If already shared, return existing token
    if (!isNew) {
      // Voters are about to look at this trip again — make sure its activity
      // photos are real, not the curated generation-time fallbacks. Runs after
      // the response (next/server `after`); 24h cooldown makes repeats free.
      after(() => enrichTripByIdAdmin(id, "share"));
      const shareUrl = await buildShareUrl(user.id, shareToken);
      return apiSuccess({
        success: true,
        shareToken,
        shareUrl,
        isNew: false,
      });
    }

    // Everything that must survive the response runs inside after(): the
    // function is frozen once the response is sent, so a bare fire-and-forget
    // promise here would be cut off about half the time (the anonymous route,
    // which uses after(), matches its trips one to one). Telemetry
    // first because it is cheap; a telemetry failure must never fail the
    // share, and logFunnelEventServer never throws.
    after(async () => {
      // UX10X Phase 0.3: count exactly one share-link mint per trip (the
      // already-shared branch above returns early and never reaches here).
      await logFunnelEventServer({
        event_type: "share_link_created",
        trip_id: id,
        user_id: user.id,
        // Never the token itself: whoever holds it can open the trip.
        metadata: { via: "share_button" },
      });
      // Crew Loop PostHog: mirror of the funnel event above (new-mint branch
      // only, so it fires at most once per trip).
      await captureServerEvent(user.id, "crew_link_created", {
        tripId: id,
      }).catch(() => {});
      // First share is the moment voters start arriving: upgrade curated
      // fallback images to real place photos (full-trip budget). See
      // lib/images/enrichTrip.ts for the cost model.
      await enrichTripByIdAdmin(id, "share");
    });

    const shareUrl = await buildShareUrl(user.id, shareToken);

    return apiSuccess({
      success: true,
      shareToken,
      shareUrl,
      sharedAt,
      isNew: true,
    });
  } catch (error) {
    console.error("[Share] Error creating share link:", error);
    return errors.internal("Failed to create share link", "Share");
  }
}

/**
 * DELETE /api/trips/[id]/share - Revoke sharing for a trip
 */
export async function DELETE(request: NextRequest, context: TripRouteContext) {
  try {
    const { id } = await context.params;
    const { user, supabase, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;

    // Verify trip ownership
    const { errorResponse: tripError } = await verifyTripOwnership(
      supabase,
      id,
      user.id
    );
    if (tripError) return tripError;

    // Remove share token. A trip on Explore leaves it too, so its listing
    // stamp is cleared the way DELETE /publish clears it.
    const { error: updateError } = await supabase
      .from("trips")
      .update({
        share_token: null,
        shared_at: null,
        visibility: "private",
        submitted_to_trending_at: null,
      })
      .eq("id", id)
      .eq("user_id", user.id);

    if (updateError) {
      console.error("[Share] Error revoking share:", updateError);
      return errors.internal("Failed to revoke sharing", "Share");
    }

    after(() => purgeTripCard(id));
    return apiSuccess({ success: true });
  } catch (error) {
    console.error("[Share] Error revoking share link:", error);
    return errors.internal("Failed to revoke share link", "Share");
  }
}

/**
 * GET /api/trips/[id]/share - Get current share status
 */
export async function GET(request: NextRequest, context: TripRouteContext) {
  try {
    const { id } = await context.params;
    const { user, supabase, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;

    // Any member may READ the share status: ShareButton asks on mount for
    // every role. Owner-only was a 404 on every collaborator's page load.
    // Creating and revoking (POST/DELETE above) stay with the owner.
    // user_id must be in the select: verifyTripAccess decides ownership from it.
    const { trip, errorResponse: tripError } = await verifyTripAccess(
      supabase,
      id,
      user.id,
      "id, user_id, shared_at, visibility, submitted_to_trending_at"
    );
    if (tripError) return tripError;
    const shareToken = await readShareToken(id);

    // The link carries the OWNER's referral code. buildShareUrl creates a
    // code for whoever it is given, so passing the caller would mint one for
    // a collaborator and credit them.
    const isShared = !!shareToken;
    const shareUrl = shareToken
      ? await buildShareUrl(trip.user_id, shareToken)
      : null;

    return apiSuccess({
      success: true,
      isShared,
      shareToken,
      shareUrl,
      sharedAt: trip.shared_at,
      visibility: trip.visibility,
      // The share window's Explore switch starts from this, and is hidden
      // while Explore is off (the publish route answers 404 then). Listed
      // means public and stamped, as the Explore feed reads it.
      isInTrending: trip.visibility === "public" && Boolean(trip.submitted_to_trending_at),
      exploreEnabled: isExploreUgcEnabled(),
    });
  } catch (error) {
    console.error("[Share] Error fetching share status:", error);
    return errors.internal("Failed to fetch share status", "Share");
  }
}
