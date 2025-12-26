import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { getAuthenticatedUser } from "@/lib/api/auth";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import type { InviteTokenRouteContext } from "@/lib/api/route-context";
import { validateInvite, type InviteData } from "@/lib/api/invite-validation";
import type { CollaboratorRole } from "@/types";
import {
  addCollaborationBananas,
  checkAndUnlockTier,
  getUserReferralTier,
} from "@/lib/bananas";

/**
 * GET /api/invites/[token] - Get invite details and trip preview (public, no auth required)
 */
export async function GET(request: NextRequest, context: InviteTokenRouteContext) {
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
      return errors.notFound("Invalid invite link");
    }

    // Use shared validation (checks max_uses, is_active, expires_at in correct order)
    const validation = validateInvite(invite as InviteData);
    if (!validation.valid) {
      return validation.errorResponse!;
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
      return errors.notFound("Trip not found");
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

    return apiSuccess({
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
    console.error("[Invites] Error in GET /api/invites/[token]:", error);
    return errors.internal("Internal server error", "Invites");
  }
}

/**
 * POST /api/invites/[token] - Accept invite and join trip (requires auth)
 */
export async function POST(request: NextRequest, context: InviteTokenRouteContext) {
  try {
    const { token } = await context.params;
    const { user, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errors.unauthorized("Authentication required");

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
      return errors.notFound("Invalid invite link");
    }

    // Use shared validation (checks max_uses, is_active, expires_at in correct order)
    const validation = validateInvite(invite as InviteData);
    if (!validation.valid) {
      return validation.errorResponse!;
    }

    // Check if user is the trip owner
    const { data: trip } = await supabaseAdmin
      .from("trips")
      .select("id, user_id, title")
      .eq("id", invite.trip_id)
      .single();

    if (!trip) {
      return errors.notFound("Trip not found");
    }

    if (trip.user_id === user.id) {
      return apiSuccess({
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
      return apiSuccess({
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
      console.error("[Invites] Error adding collaborator:", collabError);
      return errors.internal("Failed to join trip", "Invites");
    }

    // Increment invite use count
    // NOTE: We intentionally do NOT set is_active=false when max_uses is reached.
    // The use_count check already prevents reuse, and keeping is_active=true
    // allows for clearer error messages ("already used" vs "revoked by owner")
    await supabaseAdmin
      .from("trip_invites")
      .update({ use_count: invite.use_count + 1 })
      .eq("id", invite.id);

    // Award bananas to the inviter (collaborator referral reward)
    let bananasAwarded = false;
    let tierUnlocked = false;
    let newTier = 0;

    if (invite.created_by && invite.is_referral_eligible !== false) {
      try {
        // Check if this is a new user who signed up via this invite
        // Award bananas to the person who created the invite
        const inviterTier = await getUserReferralTier(supabaseAdmin, invite.created_by);

        const bananaResult = await addCollaborationBananas(
          supabaseAdmin,
          invite.created_by,
          invite.id,
          inviterTier
        );

        if (bananaResult.success) {
          bananasAwarded = true;

          // Check and unlock tier if eligible
          const tierResult = await checkAndUnlockTier(supabaseAdmin, invite.created_by);
          tierUnlocked = tierResult.tierUnlocked;
          newTier = tierResult.tierInfo.currentTier;
        }

        // Track that this user joined via trip invite (for future referral attribution)
        await supabaseAdmin
          .from("users")
          .update({ signed_up_via_trip_invite: invite.id })
          .eq("id", user.id);
      } catch (bananaError) {
        console.error("[Invites] Error awarding collaboration bananas:", bananaError);
        // Don't fail the join - it's already successful
      }
    }

    return apiSuccess({
      success: true,
      message: "Successfully joined the trip!",
      tripId: trip.id,
      tripTitle: trip.title,
      role: invite.role,
      collaborator: newCollab,
      bananas: {
        awarded: bananasAwarded,
        tierUnlocked,
        newTier: tierUnlocked ? newTier : undefined,
      },
    });
  } catch (error) {
    console.error("[Invites] Error in POST /api/invites/[token]:", error);
    return errors.internal("Internal server error", "Invites");
  }
}
