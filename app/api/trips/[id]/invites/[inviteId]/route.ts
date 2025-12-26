import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import type { TripInviteRouteContext } from "@/lib/api/route-context";

/**
 * DELETE /api/trips/[id]/invites/[inviteId] - Revoke an invite
 */
export async function DELETE(request: NextRequest, context: TripInviteRouteContext) {
  try {
    const { id: tripId, inviteId } = await context.params;
    const supabase = await createClient();

    // Check authentication
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return errors.unauthorized();
    }

    // Verify user has permission (owner or editor)
    const { data: trip } = await supabase
      .from("trips")
      .select("id, user_id")
      .eq("id", tripId)
      .single();

    if (!trip) {
      return errors.notFound("Trip not found");
    }

    const isOwner = trip.user_id === user.id;

    // Check if user is an editor
    const { data: userCollab } = await supabase
      .from("trip_collaborators")
      .select("role")
      .eq("trip_id", tripId)
      .eq("user_id", user.id)
      .single();

    const canRevokeInvites = isOwner || userCollab?.role === "editor";

    if (!canRevokeInvites) {
      return errors.forbidden("You don't have permission to revoke invites");
    }

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
