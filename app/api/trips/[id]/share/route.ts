import { NextRequest } from "next/server";
import { getAuthenticatedUser, verifyTripOwnership } from "@/lib/api/auth";
import { v4 as uuidv4 } from "uuid";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import type { TripRouteContext } from "@/lib/api/route-context";

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
      const shareUrl = `${process.env.NEXT_PUBLIC_APP_URL || "https://monkeytravel.app"}/shared/${trip.share_token}`;
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

    const shareUrl = `${process.env.NEXT_PUBLIC_APP_URL || "https://monkeytravel.app"}/shared/${shareToken}`;

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
      ? `${process.env.NEXT_PUBLIC_APP_URL || "https://monkeytravel.app"}/shared/${trip.share_token}`
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
