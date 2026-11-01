import { NextRequest } from "next/server";
import { getAuthenticatedUser, verifyTripAccess } from "@/lib/api/auth";
import { COLLABORATOR_ROLES } from "@/lib/api/constants";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import type { TripCollaboratorRouteContext } from "@/lib/api/route-context";
import type { CollaboratorRole } from "@/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { isDemotion, resetInviteLinks } from "@/lib/invites/links";
import { readJsonBody } from "@/lib/api/json-body";

/**
 * PATCH /api/trips/[id]/collaborators/[userId] - Update a collaborator's role
 */
export async function PATCH(request: NextRequest, context: TripCollaboratorRouteContext) {
  try {
    const { id: tripId, userId: targetUserId } = await context.params;
    const { user, supabase, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;

    const { body, invalidBody } = await readJsonBody(request);
    if (invalidBody) return invalidBody;
    const { role } = body as { role: CollaboratorRole };

    if (!role || !["owner", "editor", "voter", "viewer"].includes(role)) {
      return errors.badRequest("Invalid role. Must be owner, editor, voter, or viewer");
    }

    // Only owners (the trip's, or a collaborator with the owner role) can change roles.
    const { isOwner, collaboratorRole, errorResponse: accessError } = await verifyTripAccess(
      supabase,
      tripId,
      user.id,
      "id, user_id",
      [...COLLABORATOR_ROLES]
    );
    if (accessError) return accessError;

    const canChangeRoles = isOwner || collaboratorRole === "owner";

    if (!canChangeRoles) {
      return errors.forbidden("Only trip owners can change collaborator roles");
    }

    // Can't change own role to demote self from owner
    if (targetUserId === user.id && role !== "owner" && isOwner) {
      return errors.badRequest("Cannot demote yourself as the trip owner");
    }

    // Can't promote someone to owner (ownership transfer not implemented yet)
    if (role === "owner" && targetUserId !== user.id) {
      return errors.badRequest("Cannot transfer ownership. This feature is not yet available.");
    }

    // The role before the change: lowering it switches off the trip's open
    // invite links (lib/invites/links.ts), or a demoted editor could leave and
    // rejoin as an editor through one. Unread, a demotion would keep them.
    const { data: previousCollab, error: previousError } = await supabase
      .from("trip_collaborators")
      .select("role")
      .eq("trip_id", tripId)
      .eq("user_id", targetUserId)
      .maybeSingle();

    if (previousError) {
      console.error("[Collaborators] Error reading the current role:", previousError);
      return errors.internal("Failed to update role", "Collaborators");
    }

    // Update the collaborator's role
    const { data: updatedCollab, error } = await supabase
      .from("trip_collaborators")
      .update({ role })
      .eq("trip_id", tripId)
      .eq("user_id", targetUserId)
      .select()
      .single();

    if (error) {
      console.error("[Collaborators] Error updating collaborator role:", error);
      return errors.internal("Failed to update role", "Collaborators");
    }

    if (!updatedCollab) {
      return errors.notFound("Collaborator not found");
    }

    const invitesReset = isDemotion(previousCollab?.role, role) ? await resetInviteLinks(supabase, tripId) : 0;

    return apiSuccess({
      success: true,
      collaborator: updatedCollab,
      invitesReset,
    });
  } catch (error) {
    console.error("[Collaborators] Error updating collaborator role:", error);
    return errors.internal("Failed to update role", "Collaborators");
  }
}

/**
 * DELETE /api/trips/[id]/collaborators/[userId] - Remove a collaborator
 */
export async function DELETE(request: NextRequest, context: TripCollaboratorRouteContext) {
  try {
    const { id: tripId, userId: targetUserId } = await context.params;
    const { user, supabase, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;

    // Any member, a collaborator with the owner role included.
    const { trip, isOwner, collaboratorRole, errorResponse: accessError } = await verifyTripAccess(
      supabase,
      tripId,
      user.id,
      "id, user_id",
      [...COLLABORATOR_ROLES]
    );
    if (accessError) return accessError;

    const isSelfRemove = targetUserId === user.id;

    // Can't remove the trip owner
    if (targetUserId === trip.user_id) {
      return errors.badRequest("Cannot remove the trip owner");
    }

    const canRemoveOthers = isOwner || collaboratorRole === "owner";

    // Users can remove themselves, owners can remove anyone
    if (!isSelfRemove && !canRemoveOthers) {
      return errors.forbidden("You don't have permission to remove this collaborator");
    }

    // Remove the collaborator
    const { error } = await supabase
      .from("trip_collaborators")
      .delete()
      .eq("trip_id", tripId)
      .eq("user_id", targetUserId);

    if (error) {
      console.error("[Collaborators] Error removing collaborator:", error);
      return errors.internal("Failed to remove collaborator", "Collaborators");
    }

    // Someone the owner removed must not walk back in through an open invite
    // link, or an unused email invite to them (lib/invites/links.ts). Leaving
    // on your own does not reset the group's links.
    let invitesReset = 0;
    if (!isSelfRemove) {
      let removedEmail: string | null = null;
      try {
        const { data: removed } = await createAdminClient().auth.admin.getUserById(targetUserId);
        removedEmail = removed?.user?.email ?? null;
      } catch (err) {
        console.error("[Collaborators] Could not read the removed member's email:", err);
      }
      invitesReset = await resetInviteLinks(supabase, tripId, removedEmail);
    }

    return apiSuccess({
      success: true,
      message: isSelfRemove ? "You have left the trip" : "Collaborator removed",
      invitesReset,
    });
  } catch (error) {
    console.error("[Collaborators] Error removing collaborator:", error);
    return errors.internal("Failed to remove collaborator", "Collaborators");
  }
}
