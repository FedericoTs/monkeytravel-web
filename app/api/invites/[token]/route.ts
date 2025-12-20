import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import type { CollaboratorRole } from "@/types";

interface RouteContext {
  params: Promise<{ token: string }>;
}

/**
 * GET /api/invites/[token] - Get invite details and trip preview (public, no auth required)
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { token } = await context.params;

    // Use admin client for public access to invite details
    const supabaseAdmin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Fetch invite with trip details
    const { data: invite, error: inviteError } = await supabaseAdmin
      .from("trip_invites")
      .select(`
        id,
        trip_id,
        token,
        role,
        created_by,
        created_at,
        expires_at,
        max_uses,
        use_count,
        is_active
      `)
      .eq("token", token)
      .single();

    if (inviteError || !invite) {
      return NextResponse.json(
        { error: "Invalid invite link", code: "INVALID_TOKEN" },
        { status: 404 }
      );
    }

    // Check if invite is still valid
    // IMPORTANT: Check max_uses BEFORE is_active to show correct error message
    // (used-up invites may have is_active=false, but "max uses" is more accurate)
    if (invite.max_uses > 0 && invite.use_count >= invite.max_uses) {
      return NextResponse.json(
        { error: "This invite link has already been used", code: "MAX_USES" },
        { status: 410 }
      );
    }

    if (!invite.is_active) {
      return NextResponse.json(
        { error: "This invite has been revoked by the trip owner", code: "REVOKED" },
        { status: 410 }
      );
    }

    if (new Date(invite.expires_at) < new Date()) {
      return NextResponse.json(
        { error: "This invite has expired", code: "EXPIRED" },
        { status: 410 }
      );
    }

    // Fetch trip preview (limited info for non-authenticated users)
    const { data: trip, error: tripError } = await supabaseAdmin
      .from("trips")
      .select(`
        id,
        title,
        description,
        start_date,
        end_date,
        cover_image_url,
        user_id
      `)
      .eq("id", invite.trip_id)
      .single();

    if (tripError || !trip) {
      return NextResponse.json(
        { error: "Trip not found", code: "TRIP_NOT_FOUND" },
        { status: 404 }
      );
    }

    // Fetch trip owner info from users table
    const { data: owner } = await supabaseAdmin
      .from("users")
      .select("display_name, avatar_url")
      .eq("id", trip.user_id)
      .single();

    // Fetch inviter info (if different from owner)
    let inviter = null;
    if (invite.created_by && invite.created_by !== trip.user_id) {
      const { data: inviterProfile } = await supabaseAdmin
        .from("users")
        .select("display_name, avatar_url")
        .eq("id", invite.created_by)
        .single();
      inviter = inviterProfile;
    }

    // Count existing collaborators
    const { count: collaboratorCount } = await supabaseAdmin
      .from("trip_collaborators")
      .select("id", { count: "exact", head: true })
      .eq("trip_id", invite.trip_id);

    // Fetch first destination from itinerary if available
    const { data: tripData } = await supabaseAdmin
      .from("trips")
      .select("itinerary")
      .eq("id", invite.trip_id)
      .single();

    let destination = null;
    if (tripData?.itinerary && Array.isArray(tripData.itinerary) && tripData.itinerary.length > 0) {
      // Try to extract destination from first activity
      const firstDay = tripData.itinerary[0];
      if (firstDay?.activities?.[0]?.location) {
        destination = firstDay.activities[0].location;
      }
    }

    // Calculate trip duration
    const startDate = new Date(trip.start_date);
    const endDate = new Date(trip.end_date);
    const durationDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;

    return NextResponse.json({
      success: true,
      invite: {
        token: invite.token,
        role: invite.role as Exclude<CollaboratorRole, "owner">,
        expiresAt: invite.expires_at,
      },
      trip: {
        id: trip.id,
        title: trip.title,
        description: trip.description,
        coverImageUrl: trip.cover_image_url,
        startDate: trip.start_date,
        endDate: trip.end_date,
        durationDays,
        destination,
        collaboratorCount: (collaboratorCount || 0) + 1, // +1 for owner
      },
      owner: {
        displayName: owner?.display_name || "Trip Owner",
        avatarUrl: owner?.avatar_url,
      },
      inviter: inviter ? {
        displayName: inviter.display_name,
        avatarUrl: inviter.avatar_url,
      } : null,
    });
  } catch (error) {
    console.error("Error in GET /api/invites/[token]:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/invites/[token] - Accept invite and join trip (requires auth)
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { token } = await context.params;
    const supabase = await createClient();

    // Check authentication
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: "Authentication required", code: "AUTH_REQUIRED" },
        { status: 401 }
      );
    }

    // Use admin client for invite operations
    const supabaseAdmin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Fetch and validate invite
    const { data: invite, error: inviteError } = await supabaseAdmin
      .from("trip_invites")
      .select("*")
      .eq("token", token)
      .single();

    if (inviteError || !invite) {
      return NextResponse.json(
        { error: "Invalid invite link", code: "INVALID_TOKEN" },
        { status: 404 }
      );
    }

    // Validate invite is still usable
    // IMPORTANT: Check max_uses BEFORE is_active to show correct error message
    if (invite.max_uses > 0 && invite.use_count >= invite.max_uses) {
      return NextResponse.json(
        { error: "This invite link has already been used", code: "MAX_USES" },
        { status: 410 }
      );
    }

    if (!invite.is_active) {
      return NextResponse.json(
        { error: "This invite has been revoked by the trip owner", code: "REVOKED" },
        { status: 410 }
      );
    }

    if (new Date(invite.expires_at) < new Date()) {
      return NextResponse.json(
        { error: "This invite has expired", code: "EXPIRED" },
        { status: 410 }
      );
    }

    // Check if user is the trip owner
    const { data: trip } = await supabaseAdmin
      .from("trips")
      .select("id, user_id, title")
      .eq("id", invite.trip_id)
      .single();

    if (!trip) {
      return NextResponse.json(
        { error: "Trip not found", code: "TRIP_NOT_FOUND" },
        { status: 404 }
      );
    }

    if (trip.user_id === user.id) {
      return NextResponse.json({
        success: true,
        message: "You are the owner of this trip",
        tripId: trip.id,
        alreadyMember: true,
      });
    }

    // Check if user is already a collaborator
    const { data: existingCollab } = await supabaseAdmin
      .from("trip_collaborators")
      .select("id, role")
      .eq("trip_id", invite.trip_id)
      .eq("user_id", user.id)
      .single();

    if (existingCollab) {
      return NextResponse.json({
        success: true,
        message: "You are already a collaborator on this trip",
        tripId: trip.id,
        role: existingCollab.role,
        alreadyMember: true,
      });
    }

    // Add user as collaborator
    const { data: newCollab, error: collabError } = await supabaseAdmin
      .from("trip_collaborators")
      .insert({
        trip_id: invite.trip_id,
        user_id: user.id,
        role: invite.role,
        invited_by: invite.created_by,
      })
      .select()
      .single();

    if (collabError) {
      console.error("Error adding collaborator:", collabError);
      return NextResponse.json(
        { error: "Failed to join trip", code: "JOIN_FAILED" },
        { status: 500 }
      );
    }

    // Increment invite use count
    // NOTE: We intentionally do NOT set is_active=false when max_uses is reached.
    // The use_count check already prevents reuse, and keeping is_active=true
    // allows for clearer error messages ("already used" vs "revoked by owner")
    await supabaseAdmin
      .from("trip_invites")
      .update({ use_count: invite.use_count + 1 })
      .eq("id", invite.id);

    return NextResponse.json({
      success: true,
      message: "Successfully joined the trip!",
      tripId: trip.id,
      tripTitle: trip.title,
      role: invite.role,
      collaborator: newCollab,
    });
  } catch (error) {
    console.error("Error in POST /api/invites/[token]:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
