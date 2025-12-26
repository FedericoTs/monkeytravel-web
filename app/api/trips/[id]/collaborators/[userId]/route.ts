import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import type { TripCollaboratorRouteContext } from "@/lib/api/route-context";
import type { CollaboratorRole } from "@/types";

/**
 * PATCH /api/trips/[id]/collaborators/[userId] - Update a collaborator's role
 */
export async function PATCH(request: NextRequest, context: TripCollaboratorRouteContext) {
  try {
    const { id: tripId, userId: targetUserId } = await context.params;
    const supabase = await createClient();

    // Check authentication
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return errors.unauthorized();
    }

    const body = await request.json();
    const { role } = body as { role: CollaboratorRole };

    if (!role || !["owner", "editor", "voter", "viewer"].includes(role)) {
      return errors.badRequest("Invalid role. Must be owner, editor, voter, or viewer");
    }

    // Verify user is the trip owner (only owners can change roles)
    const { data: trip } = await supabase
      .from("trips")
      .select("id, user_id")
      .eq("id", tripId)
      .single();

    if (!trip) {
      return errors.notFound("Trip not found");
    }

    const isOwner = trip.user_id === user.id;

    // Check if user is an owner collaborator
    const { data: requesterCollab } = await supabase
      .from("trip_collaborators")
      .select("role")
      .eq("trip_id", tripId)
      .eq("user_id", user.id)
      .single();

    const canChangeRoles = isOwner || requesterCollab?.role === "owner";

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

    return apiSuccess({
      success: true,
      collaborator: updatedCollab,
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
    const supabase = await createClient();

    // Check authentication
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return errors.unauthorized();
    }

    // Verify trip exists and get owner
    const { data: trip } = await supabase
      .from("trips")
      .select("id, user_id")
      .eq("id", tripId)
      .single();

    if (!trip) {
      return errors.notFound("Trip not found");
    }

    const isOwner = trip.user_id === user.id;
    const isSelfRemove = targetUserId === user.id;

    // Can't remove the trip owner
    if (targetUserId === trip.user_id) {
      return errors.badRequest("Cannot remove the trip owner");
    }

    // Check if user is an owner collaborator
    const { data: requesterCollab } = await supabase
      .from("trip_collaborators")
      .select("role")
      .eq("trip_id", tripId)
      .eq("user_id", user.id)
      .single();

    const canRemoveOthers = isOwner || requesterCollab?.role === "owner";

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

    return apiSuccess({
      success: true,
      message: isSelfRemove ? "You have left the trip" : "Collaborator removed",
    });
  } catch (error) {
    console.error("[Collaborators] Error removing collaborator:", error);
    return errors.internal("Failed to remove collaborator", "Collaborators");
  }
}
