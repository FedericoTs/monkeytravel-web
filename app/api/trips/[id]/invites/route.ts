import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { nanoid } from "nanoid";
import type { CollaboratorRole, TripInvite } from "@/types";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/trips/[id]/invites - List all active invites for a trip
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

    // Verify user has access (owner or editor)
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

    const canViewInvites = isOwner || userCollab?.role === "editor";

    if (!canViewInvites) {
      return NextResponse.json(
        { error: "You don't have permission to view invites" },
        { status: 403 }
      );
    }

    // Fetch active invites
    const { data: invites, error } = await supabase
      .from("trip_invites")
      .select("*")
      .eq("trip_id", tripId)
      .eq("is_active", true)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error fetching invites:", error);
      return NextResponse.json(
        { error: "Failed to fetch invites" },
        { status: 500 }
      );
    }

    // Transform invites to include invite URLs
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://monkeytravel.app";
    const invitesWithUrls = (invites || []).map((invite: TripInvite) => ({
      ...invite,
      inviteUrl: `${baseUrl}/invite/${invite.token}`,
    }));

    return NextResponse.json({
      success: true,
      invites: invitesWithUrls,
    });
  } catch (error) {
    console.error("Error in GET /api/trips/[id]/invites:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/trips/[id]/invites - Create a new invite link
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
    const {
      role = "voter",
      maxUses = 1,
      expiresInDays = 7,
    } = body as {
      role?: Exclude<CollaboratorRole, "owner">;
      maxUses?: number;
      expiresInDays?: number;
    };

    // Validate role
    if (!["editor", "voter", "viewer"].includes(role)) {
      return NextResponse.json(
        { error: "Invalid role. Must be editor, voter, or viewer" },
        { status: 400 }
      );
    }

    // Verify user has permission to create invites (owner or editor)
    const { data: trip } = await supabase
      .from("trips")
      .select("id, user_id, title")
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

    const canCreateInvites = isOwner || userCollab?.role === "editor";

    if (!canCreateInvites) {
      return NextResponse.json(
        { error: "You don't have permission to create invites" },
        { status: 403 }
      );
    }

    // Generate invite token (URL-safe, short)
    const token = nanoid(12); // 12 chars = 64^12 combinations

    // Calculate expiration
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expiresInDays);

    // Create the invite
    const { data: invite, error } = await supabase
      .from("trip_invites")
      .insert({
        trip_id: tripId,
        token,
        role,
        created_by: user.id,
        expires_at: expiresAt.toISOString(),
        max_uses: maxUses,
        use_count: 0,
        is_active: true,
      })
      .select()
      .single();

    if (error) {
      console.error("Error creating invite:", error);
      return NextResponse.json(
        { error: "Failed to create invite" },
        { status: 500 }
      );
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://monkeytravel.app";
    const inviteUrl = `${baseUrl}/invite/${token}`;

    return NextResponse.json({
      success: true,
      invite: {
        ...invite,
        inviteUrl,
      },
    });
  } catch (error) {
    console.error("Error in POST /api/trips/[id]/invites:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
