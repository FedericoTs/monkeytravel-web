import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

interface RouteContext {
  params: Promise<{ id: string; inviteId: string }>;
}

/**
 * DELETE /api/trips/[id]/invites/[inviteId] - Revoke an invite
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const { id: tripId, inviteId } = await context.params;
    const supabase = await createClient();

    // Check authentication
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Verify user has permission (owner or editor)
    const { data: trip } = await supabase
      .from("trips")
      .select("id, user_id")
      .eq("id", tripId)
      .single();

    if (!trip) {
      return NextResponse.json({ error: "Trip not found" }, { status: 404 });
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
      return NextResponse.json(
        { error: "You don't have permission to revoke invites" },
        { status: 403 }
      );
    }

    // Verify the invite belongs to this trip
    const { data: invite } = await supabase
      .from("trip_invites")
      .select("id, trip_id")
      .eq("id", inviteId)
      .eq("trip_id", tripId)
      .single();

    if (!invite) {
      return NextResponse.json({ error: "Invite not found" }, { status: 404 });
    }

    // Deactivate the invite (soft delete)
    const { error } = await supabase
      .from("trip_invites")
      .update({ is_active: false })
      .eq("id", inviteId);

    if (error) {
      console.error("Error revoking invite:", error);
      return NextResponse.json(
        { error: "Failed to revoke invite" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Invite revoked successfully",
    });
  } catch (error) {
    console.error("Error in DELETE /api/trips/[id]/invites/[inviteId]:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
