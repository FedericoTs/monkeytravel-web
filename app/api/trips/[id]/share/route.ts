import { NextRequest } from "next/server";
import { getAuthenticatedUser, verifyTripOwnership } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { logFunnelEventServer } from "@/lib/analytics/funnel-events";
import { captureServerEvent } from "@/lib/posthog/server";
import { v4 as uuidv4 } from "uuid";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import type { TripRouteContext } from "@/lib/api/route-context";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://monkeytravel.app";

/**
 * Build a shared-trip URL that carries the OWNER's referral code as ?ref, so
 * every shared link is a credited acquisition surface (the dominant organic
 * channel). Falls back to a plain link if the code can't be resolved — sharing
 * must never fail just because referral attribution couldn't be stamped.
 */
async function buildShareUrl(ownerId: string, token: string): Promise<string> {
  let ref = "";
  try {
    const { data: code } = await createAdminClient().rpc("get_or_create_referral_code", {
      p_user_id: ownerId,
    });
    if (code && typeof code === "string") ref = `?ref=${encodeURIComponent(code)}`;
  } catch (e) {
    console.error("[Share] referral-code resolve failed (link still valid):", e);
  }
  return `${APP_URL}/shared/${token}${ref}`;
}

/**
 * POST /api/trips/[id]/share - Generate a share link for a trip
 */
export async function POST(request: NextRequest, context: TripRouteContext) {
  try {
    const { id } = await context.params;
    const { user, supabase, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;

    // Verify ownership and get share status
    const { trip, errorResponse: tripError } = await verifyTripOwnership(
      supabase,
      id,
      user.id,
      "id, user_id, share_token"
    );
    if (tripError) return tripError;

    // If already shared, return existing token
    if (trip.share_token) {
      const shareUrl = await buildShareUrl(user.id, trip.share_token as string);
      return apiSuccess({
        success: true,
        shareToken: trip.share_token,
        shareUrl,
        isNew: false,
      });
    }

    // Generate new share token
    const shareToken = uuidv4();
    const sharedAt = new Date().toISOString();

    // Update trip with share token
    const { error: updateError } = await supabase
      .from("trips")
      .update({
        share_token: shareToken,
        shared_at: sharedAt,
        visibility: "shared",
      })
      .eq("id", id)
      .eq("user_id", user.id);

    if (updateError) {
      console.error("[Share] Error enabling sharing:", updateError);
      return errors.internal("Failed to enable sharing", "Share");
    }

    // UX10X Phase 0.3: count exactly one share-link mint per trip (the
    // already-shared branch above returns early and never reaches here).
    // Fire-and-forget — a telemetry failure must never fail the share.
    void logFunnelEventServer({
      event_type: "share_link_created",
      trip_id: id,
      user_id: user.id,
      metadata: { share_token: shareToken },
    });

    // Crew Loop PostHog: mirror of the funnel event above (new-mint branch
    // only, so it fires at most once per trip). Fire-and-forget.
    captureServerEvent(user.id, "crew_link_created", {
      tripId: id,
    }).catch(() => {});

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

    // Remove share token
    const { error: updateError } = await supabase
      .from("trips")
      .update({
        share_token: null,
        shared_at: null,
        visibility: "private",
      })
      .eq("id", id)
      .eq("user_id", user.id);

    if (updateError) {
      console.error("[Share] Error revoking share:", updateError);
      return errors.internal("Failed to revoke sharing", "Share");
    }

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

    // Verify ownership and get share status
    const { trip, errorResponse: tripError } = await verifyTripOwnership(
      supabase,
      id,
      user.id,
      "id, share_token, shared_at, visibility"
    );
    if (tripError) return tripError;

    const isShared = !!trip.share_token;
    const shareUrl = isShared
      ? await buildShareUrl(user.id, trip.share_token as string)
      : null;

    return apiSuccess({
      success: true,
      isShared,
      shareToken: trip.share_token,
      shareUrl,
      sharedAt: trip.shared_at,
      visibility: trip.visibility,
    });
  } catch (error) {
    console.error("[Share] Error fetching share status:", error);
    return errors.internal("Failed to fetch share status", "Share");
  }
}
