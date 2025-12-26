import { NextRequest } from "next/server";
import { getAuthenticatedUser } from "@/lib/api/auth";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { batchFetchUserProfiles } from "@/lib/api/batch-users";
import type { TripRouteContext } from "@/lib/api/route-context";
import type { TripCollaborator, CollaboratorRole } from "@/types";

/**
 * GET /api/trips/[id]/collaborators - List all collaborators on a trip
 */
export async function GET(request: NextRequest, context: TripRouteContext) {
  try {
    const { id: tripId } = await context.params;
    const { user, supabase, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;

    // First check if user has access to this trip (owner or collaborator)
    const { data: trip } = await supabase
      .from("trips")
      .select("id, user_id, title")
      .eq("id", tripId)
      .single();

    if (!trip) {
      return errors.notFound("Trip not found");
    }

    const isOwner = trip.user_id === user.id;

    // Check if user is a collaborator
    const { data: userCollab } = await supabase
      .from("trip_collaborators")
      .select("id")
      .eq("trip_id", tripId)
      .eq("user_id", user.id)
      .single();

    if (!isOwner && !userCollab) {
      return errors.forbidden("Access denied");
    }

    // Fetch all collaborators (without user join - FK points to auth.users, not public.users)
    const { data: collaborators, error } = await supabase
      .from("trip_collaborators")
      .select(`
        id,
        trip_id,
        user_id,
        role,
        invited_by,
        joined_at
      `)
      .eq("trip_id", tripId)
      .order("joined_at", { ascending: true });

    if (error) {
      console.error("[Collaborators] Error fetching collaborators:", error);
      return errors.internal("Failed to fetch collaborators", "Collaborators");
    }

    // Collect all user IDs we need to fetch (collaborators + owner)
    const userIds = new Set<string>();
    userIds.add(trip.user_id); // Always include owner
    for (const c of collaborators || []) {
      userIds.add(c.user_id);
    }

    // Batch fetch all user profiles using shared utility
    const profileMap = await batchFetchUserProfiles(supabase, userIds);

    // Check if owner is in the collaborators list
    const ownerInList = collaborators?.some((c) => c.user_id === trip.user_id);

    // Create owner data if not in list
    let ownerData = null;
    if (!ownerInList) {
      const ownerProfile = profileMap.get(trip.user_id);
      ownerData = {
        id: `owner-${trip.user_id}`,
        trip_id: tripId,
        user_id: trip.user_id,
        role: "owner" as CollaboratorRole,
        invited_by: null,
        joined_at: null, // Owner didn't "join"
        display_name: ownerProfile?.display_name || "Trip Owner",
        avatar_url: ownerProfile?.avatar_url || null,
        email: ownerProfile?.email ?? undefined,
      };
    }

    // Transform collaborators to include user data at top level
    const transformedCollaborators: TripCollaborator[] = (collaborators || []).map((c) => {
      const profile = profileMap.get(c.user_id);
      return {
        id: c.id,
        trip_id: c.trip_id,
        user_id: c.user_id,
        role: c.role as CollaboratorRole,
        invited_by: c.invited_by,
        joined_at: c.joined_at,
        display_name: profile?.display_name || "Unknown User",
        avatar_url: profile?.avatar_url || null,
        email: profile?.email ?? undefined,
      };
    });

    // Add owner at the beginning if not in list
    const allCollaborators = ownerData
      ? [ownerData, ...transformedCollaborators]
      : transformedCollaborators;

    return apiSuccess({
      success: true,
      collaborators: allCollaborators,
      currentUserRole: isOwner ? "owner" : (userCollab ? "collaborator" : null),
    });
  } catch (error) {
    console.error("[Collaborators] Error fetching collaborators:", error);
    return errors.internal("Failed to fetch collaborators", "Collaborators");
  }
}

/**
 * POST /api/trips/[id]/collaborators - Add a collaborator (internal, called after invite accept)
 */
export async function POST(request: NextRequest, context: TripRouteContext) {
  try {
    const { id: tripId } = await context.params;
    const { user, supabase, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;

    const body = await request.json();
    const { userId, role, invitedBy } = body as {
      userId: string;
      role: CollaboratorRole;
      invitedBy?: string;
    };

    if (!userId || !role) {
      return errors.badRequest("userId and role are required");
    }

    // Verify the requester has permission to add collaborators
    const { data: trip } = await supabase
      .from("trips")
      .select("id, user_id")
      .eq("id", tripId)
      .single();

    if (!trip) {
      return errors.notFound("Trip not found");
    }

    const isOwner = trip.user_id === user.id;

    // Check if requester is an editor
    const { data: requesterCollab } = await supabase
      .from("trip_collaborators")
      .select("role")
      .eq("trip_id", tripId)
      .eq("user_id", user.id)
      .single();

    const canAddCollaborators = isOwner || requesterCollab?.role === "editor";

    if (!canAddCollaborators) {
      return errors.forbidden("You don't have permission to add collaborators");
    }

    // Check if user is already a collaborator
    const { data: existingCollab } = await supabase
      .from("trip_collaborators")
      .select("id")
      .eq("trip_id", tripId)
      .eq("user_id", userId)
      .single();

    if (existingCollab) {
      return errors.conflict("User is already a collaborator");
    }

    // Add the collaborator
    const { data: newCollab, error } = await supabase
      .from("trip_collaborators")
      .insert({
        trip_id: tripId,
        user_id: userId,
        role: role === "owner" ? "editor" : role, // Can't add someone as owner
        invited_by: invitedBy || user.id,
      })
      .select()
      .single();

    if (error) {
      console.error("[Collaborators] Error adding collaborator:", error);
      return errors.internal("Failed to add collaborator", "Collaborators");
    }

    return apiSuccess({
      success: true,
      collaborator: newCollab,
    });
  } catch (error) {
    console.error("[Collaborators] Error adding collaborator:", error);
    return errors.internal("Failed to add collaborator", "Collaborators");
  }
}
