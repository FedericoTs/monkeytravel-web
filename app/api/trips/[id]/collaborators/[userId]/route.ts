import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { CollaboratorRole } from "@/types";

interface RouteContext {
  params: Promise<{ id: string; userId: string }>;
}

/**
 * PATCH /api/trips/[id]/collaborators/[userId] - Update a collaborator's role
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { id: tripId, userId: targetUserId } = await context.params;
    const supabase = await createClient();

    // Check authentication
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { role } = body as { role: CollaboratorRole };

    if (!role || !["owner", "editor", "voter", "viewer"].includes(role)) {
      return NextResponse.json(
        { error: "Invalid role. Must be owner, editor, voter, or viewer" },
        { status: 400 }
      );
    }

    // Verify user is the trip owner (only owners can change roles)
    const { data: trip } = await supabase
      .from("trips")
      .select("id, user_id")
      .eq("id", tripId)
      .single();

    if (!trip) {
      return NextResponse.json({ error: "Trip not found" }, { status: 404 });
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
      return NextResponse.json(
        { error: "Only trip owners can change collaborator roles" },
        { status: 403 }
      );
    }

    // Can't change own role to demote self from owner
    if (targetUserId === user.id && role !== "owner" && isOwner) {
      return NextResponse.json(
        { error: "Cannot demote yourself as the trip owner" },
        { status: 400 }
      );
    }

    // Can't promote someone to owner (ownership transfer not implemented yet)
    if (role === "owner" && targetUserId !== user.id) {
      return NextResponse.json(
        { error: "Cannot transfer ownership. This feature is not yet available." },
        { status: 400 }
      );
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
      console.error("Error updating collaborator role:", error);
      return NextResponse.json(
        { error: "Failed to update role" },
        { status: 500 }
      );
    }

    if (!updatedCollab) {
      return NextResponse.json(
        { error: "Collaborator not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      collaborator: updatedCollab,
    });
  } catch (error) {
    console.error("Error in PATCH /api/trips/[id]/collaborators/[userId]:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/trips/[id]/collaborators/[userId] - Remove a collaborator
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const { id: tripId, userId: targetUserId } = await context.params;
    const supabase = await createClient();

    // Check authentication
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Verify trip exists and get owner
    const { data: trip } = await supabase
      .from("trips")
      .select("id, user_id")
      .eq("id", tripId)
      .single();

    if (!trip) {
      return NextResponse.json({ error: "Trip not found" }, { status: 404 });
    }

    const isOwner = trip.user_id === user.id;
    const isSelfRemove = targetUserId === user.id;

    // Can't remove the trip owner
    if (targetUserId === trip.user_id) {
      return NextResponse.json(
        { error: "Cannot remove the trip owner" },
        { status: 400 }
      );
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
      return NextResponse.json(
        { error: "You don't have permission to remove this collaborator" },
        { status: 403 }
      );
    }

    // Remove the collaborator
    const { error } = await supabase
      .from("trip_collaborators")
      .delete()
      .eq("trip_id", tripId)
      .eq("user_id", targetUserId);

    if (error) {
      console.error("Error removing collaborator:", error);
      return NextResponse.json(
        { error: "Failed to remove collaborator" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: isSelfRemove ? "You have left the trip" : "Collaborator removed",
    });
  } catch (error) {
    console.error("Error in DELETE /api/trips/[id]/collaborators/[userId]:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
