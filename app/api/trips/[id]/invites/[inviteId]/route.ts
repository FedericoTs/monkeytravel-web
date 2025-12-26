import { NextRequest } from "next/server";
import { getAuthenticatedUser, verifyTripAccess } from "@/lib/api/auth";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import type { TripInviteRouteContext } from "@/lib/api/route-context";

/**
 * DELETE /api/trips/[id]/invites/[inviteId] - Revoke an invite
 */
export async function DELETE(request: NextRequest, context: TripInviteRouteContext) {
  try {
    const { id: tripId, inviteId } = await context.params;
    const { user, supabase, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;

    // Verify user has permission (owner or editor)
    const { errorResponse: accessError } = await verifyTripAccess(
      supabase,
      tripId,
      user.id,
      "id, user_id",
      ["editor"]
    );
    if (accessError) return accessError;

    // Verify the invite belongs to this trip
    const { data: invite } = await supabase
      .from("trip_invites")
      .select("id, trip_id")
      .eq("id", inviteId)
      .eq("trip_id", tripId)
      .single();

    if (!invite) {
      return errors.notFound("Invite not found");
    }

    // Deactivate the invite (soft delete)
    const { error } = await supabase
      .from("trip_invites")
      .update({ is_active: false })
      .eq("id", inviteId);

    if (error) {
      console.error("[Invites] Error revoking invite:", error);
      return errors.internal("Failed to revoke invite", "Invites");
    }

    return apiSuccess({
      success: true,
      message: "Invite revoked successfully",
    });
  } catch (error) {
    console.error("[Invites] Error revoking invite:", error);
    return errors.internal("Failed to revoke invite", "Invites");
  }
}
