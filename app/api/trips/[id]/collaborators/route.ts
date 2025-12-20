import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { TripCollaborator, CollaboratorRole } from "@/types";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/trips/[id]/collaborators - List all collaborators on a trip
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { id: tripId } = await context.params;
    const supabase = await createClient();

    // Check authentication
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // First check if user has access to this trip (owner or collaborator)
    const { data: trip } = await supabase
      .from("trips")
      .select("id, user_id, title")
      .eq("id", tripId)
      .single();

    if (!trip) {
      return NextResponse.json({ error: "Trip not found" }, { status: 404 });
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
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Fetch all collaborators with profile info
    const { data: collaborators, error } = await supabase
      .from("trip_collaborators")
      .select(`
        id,
        trip_id,
        user_id,
        role,
        invited_by,
        joined_at,
        profiles:user_id (
          display_name,
          avatar_url,
          email
        )
      `)
      .eq("trip_id", tripId)
      .order("joined_at", { ascending: true });

    if (error) {
      console.error("Error fetching collaborators:", error);
      return NextResponse.json(
        { error: "Failed to fetch collaborators" },
        { status: 500 }
      );
    }

    // Also include trip owner as a "virtual" collaborator if not in the list
    const ownerInList = collaborators?.some((c) => c.user_id === trip.user_id);

    let ownerData = null;
    if (!ownerInList) {
      const { data: ownerProfile } = await supabase
        .from("profiles")
        .select("display_name, avatar_url, email")
        .eq("id", trip.user_id)
        .single();

      if (ownerProfile) {
        ownerData = {
          id: `owner-${trip.user_id}`,
          trip_id: tripId,
          user_id: trip.user_id,
          role: "owner" as CollaboratorRole,
          invited_by: null,
          joined_at: null, // Owner didn't "join"
          display_name: ownerProfile.display_name || "Trip Owner",
          avatar_url: ownerProfile.avatar_url,
          email: ownerProfile.email,
        };
      }
    }

    // Transform collaborators to include profile data at top level
    const transformedCollaborators: TripCollaborator[] = (collaborators || []).map((c) => {
      // Supabase returns the joined profile as an object (single relation)
      const profile = c.profiles as unknown as { display_name: string; avatar_url: string | null; email: string } | null;
      return {
        id: c.id,
        trip_id: c.trip_id,
        user_id: c.user_id,
        role: c.role as CollaboratorRole,
        invited_by: c.invited_by,
        joined_at: c.joined_at,
        display_name: profile?.display_name || "Unknown User",
        avatar_url: profile?.avatar_url || null,
        email: profile?.email,
      };
    });

    // Add owner at the beginning if not in list
    const allCollaborators = ownerData
      ? [ownerData, ...transformedCollaborators]
      : transformedCollaborators;

    return NextResponse.json({
      success: true,
      collaborators: allCollaborators,
      currentUserRole: isOwner ? "owner" : (userCollab ? "collaborator" : null),
    });
  } catch (error) {
    console.error("Error in GET /api/trips/[id]/collaborators:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/trips/[id]/collaborators - Add a collaborator (internal, called after invite accept)
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id: tripId } = await context.params;
    const supabase = await createClient();

    // Check authentication
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { userId, role, invitedBy } = body as {
      userId: string;
      role: CollaboratorRole;
      invitedBy?: string;
    };

    if (!userId || !role) {
      return NextResponse.json(
        { error: "userId and role are required" },
        { status: 400 }
      );
    }

    // Verify the requester has permission to add collaborators
    const { data: trip } = await supabase
      .from("trips")
      .select("id, user_id")
      .eq("id", tripId)
      .single();

    if (!trip) {
      return NextResponse.json({ error: "Trip not found" }, { status: 404 });
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
      return NextResponse.json(
        { error: "You don't have permission to add collaborators" },
        { status: 403 }
      );
    }

    // Check if user is already a collaborator
    const { data: existingCollab } = await supabase
      .from("trip_collaborators")
      .select("id")
      .eq("trip_id", tripId)
      .eq("user_id", userId)
      .single();

    if (existingCollab) {
      return NextResponse.json(
        { error: "User is already a collaborator" },
        { status: 409 }
      );
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
      console.error("Error adding collaborator:", error);
      return NextResponse.json(
        { error: "Failed to add collaborator" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      collaborator: newCollab,
    });
  } catch (error) {
    console.error("Error in POST /api/trips/[id]/collaborators:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
