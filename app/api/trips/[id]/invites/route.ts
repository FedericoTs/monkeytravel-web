import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { nanoid } from "nanoid";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import type { TripRouteContext } from "@/lib/api/route-context";
import type { CollaboratorRole, TripInvite } from "@/types";

/**
 * GET /api/trips/[id]/invites - List all active invites for a trip
 */
export async function GET(request: NextRequest, context: TripRouteContext) {
  try {
    const { id: tripId } = await context.params;
    const supabase = await createClient();

    // Check authentication
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return errors.unauthorized();
    }

    // Verify user has access (owner or editor)
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

    const canViewInvites = isOwner || userCollab?.role === "editor";

    if (!canViewInvites) {
      return errors.forbidden("You don't have permission to view invites");
    }

    // Fetch active invites (no expiration filter - invites are essentially permanent)
    const { data: invites, error } = await supabase
      .from("trip_invites")
      .select("*")
      .eq("trip_id", tripId)
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[Invites] Error fetching invites:", error);
      return errors.internal("Failed to fetch invites", "Invites");
    }

    // Transform invites to include invite URLs
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://monkeytravel.app";
    const invitesWithUrls = (invites || []).map((invite: TripInvite) => ({
      ...invite,
      inviteUrl: `${baseUrl}/invite/${invite.token}`,
    }));

    return apiSuccess({ success: true, invites: invitesWithUrls });
  } catch (error) {
    console.error("[Invites] Error fetching invites:", error);
    return errors.internal("Failed to fetch invites", "Invites");
  }
}

/**
 * POST /api/trips/[id]/invites - Create a new invite link
 */
export async function POST(request: NextRequest, context: TripRouteContext) {
  try {
    const { id: tripId } = await context.params;
    const supabase = await createClient();

    // Check authentication
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return errors.unauthorized();
    }

    const body = await request.json();
    const {
      role = "voter",
      maxUses = 1,
      expiresInDays = 3650, // ~10 years, effectively never expires
    } = body as {
      role?: Exclude<CollaboratorRole, "owner">;
      maxUses?: number;
      expiresInDays?: number;
    };

    // Validate role
    if (!["editor", "voter", "viewer"].includes(role)) {
      return errors.badRequest("Invalid role. Must be editor, voter, or viewer");
    }

    // Verify user has permission to create invites (owner or editor)
    const { data: trip } = await supabase
      .from("trips")
      .select("id, user_id, title")
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

    const canCreateInvites = isOwner || userCollab?.role === "editor";

    if (!canCreateInvites) {
      return errors.forbidden("You don't have permission to create invites");
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
      console.error("[Invites] Error creating invite:", error);
      return errors.internal("Failed to create invite", "Invites");
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://monkeytravel.app";
    const inviteUrl = `${baseUrl}/invite/${token}`;

    return apiSuccess({
      success: true,
      invite: {
        ...invite,
        inviteUrl,
      },
    });
  } catch (error) {
    console.error("[Invites] Error creating invite:", error);
    return errors.internal("Failed to create invite", "Invites");
  }
}
