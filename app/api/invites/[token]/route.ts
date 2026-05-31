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

    // Validate token format before querying
    if (!token || token.length < 8 || !/^[a-zA-Z0-9_-]+$/.test(token)) {
      return errors.badRequest("Invalid invite token format");
    }

    // Use admin client for public access to invite details
    const supabaseAdmin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // SECURITY (task #170): use the get_invite_by_token SECURITY DEFINER
    // RPC instead of a direct `.from('trip_invites').select()`. The old
    // public-read RLS policy was dropped because it let anon clients dump
    // every token in the table. The RPC returns at most one row and only
    // when the invite is still usable, so the validateInvite() call below
    // is now belt-and-suspenders (the RPC has already filtered out
    // exhausted / expired / revoked invites — they appear as NOT_FOUND).
    //
    // `message` is the inviter's personal note (added 2026-05-23 with
    // the recipient_email flow) — surfaced in the accept-page UI.
    const { data: invites, error: inviteError } = await supabaseAdmin
      .rpc("get_invite_by_token", { p_token: token });

    let invite = Array.isArray(invites) ? invites[0] : null;

    // Day-2 audit Bug 1: when get_invite_by_token returns no rows we
    // can't distinguish "doesn't exist" from "expired / revoked /
    // exhausted" — all collapse to NOT_FOUND, hiding the precise
    // user-facing error codes (EXPIRED / REVOKED / MAX_USES). Fall
    // back to the status-only RPC (no usability filter) so the shared
    // validator below can surface the right code.
    if (inviteError || !invite) {
      const { data: statusRows } = await supabaseAdmin
        .rpc("get_invite_status_by_token", { p_token: token });
      const statusInvite = Array.isArray(statusRows) ? statusRows[0] : null;
      if (!statusInvite) {
        return errors.notFound("Invalid invite link");
      }
      invite = statusInvite;
    }

    // Defense-in-depth: re-run the shared validator. Post Bug-1 fix
    // this is now the LOAD-BEARING check for EXPIRED / REVOKED /
    // MAX_USES — those rows come from the status RPC above, not from
    // get_invite_by_token, so we must surface the precise error_code.
    const validation = validateInvite(invite as InviteData);
    if (!validation.valid) {
      return validation.errorResponse!;
    }

    // Day-2 audit Bug 3 (P3, info-leak): when the invite was sent to a
    // specific recipient_email, refuse to leak the full trip preview
    // (title, destination, dates, cover image, owner+inviter profiles,
    // personal message) to anyone holding the token. Anonymous viewers
    // and authenticated users whose email doesn't match get a stripped
    // RECIPIENT_MISMATCH response. The POST handler already enforces
    // this for the accept action; this closes the GET-preview leak.
    if (invite.recipient_email) {
      const { user: viewer } = await getAuthenticatedUser();
      const viewerEmail = (viewer?.email ?? "").toLowerCase().trim();
      const expected = String(invite.recipient_email).toLowerCase().trim();
      if (!viewerEmail || viewerEmail !== expected) {
        return errors.forbidden(
          "This invite was sent to a different email address. Sign in with that address to view it.",
          "RECIPIENT_MISMATCH"
        );
      }
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
        message: (invite.message ?? null) as string | null,
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
 * Shape of the jsonb returned by the accept_trip_invite SQL RPC.
 * See supabase/migrations/20260529_atomic_accept_trip_invite.sql.
 */
type AcceptInviteRpcResult =
  | {
      error_code: "NOT_FOUND" | "MAX_USES" | "REVOKED" | "EXPIRED" | "TRIP_NOT_FOUND";
    }
  | {
      ok: true;
      trip_id: string;
      role: string;
      already_member: boolean;
      is_owner: boolean;
      collaborator_id?: string;
      invite_id: string;
      created_by: string | null;
      is_referral_eligible: boolean | null;
    };

/**
 * POST /api/invites/[token] - Accept invite and join trip (requires auth)
 *
 * SECURITY (task #215): the previous flow did SELECT use_count → JS
 * guard → INSERT collaborator → UPDATE use_count, which left a
 * max_uses TOCTOU. Two simultaneous accepts on a 5-use invite at
 * use_count=4 could both pass the guard and produce 6 collaborators.
 * The atomic `accept_trip_invite` RPC pulls the lock/guard/insert/
 * increment into one transaction (SELECT ... FOR UPDATE on the invite
 * row), so concurrent callers serialise and the second one bounces
 * with MAX_USES instead of slipping through.
 *
 * The RECIPIENT_MISMATCH check (bug-bounty 2026-05-24 P0) stays in
 * route code because it depends on the authenticated user's email,
 * which we don't want to pass into SQL. We do a cheap RPC-level read
 * of recipient_email first via get_invite_by_token (still
 * SECURITY DEFINER, no RLS surface change) before invoking the
 * stateful accept RPC.
 */
export async function POST(request: NextRequest, context: InviteTokenRouteContext) {
  try {
    const { token } = await context.params;

    // Validate token format before querying
    if (!token || token.length < 8 || !/^[a-zA-Z0-9_-]+$/.test(token)) {
      return errors.badRequest("Invalid invite token format");
    }

    const { user, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errors.unauthorized("Authentication required");

    // Use admin client for invite operations
    const supabaseAdmin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Read-only precheck via the same SECURITY DEFINER RPC as GET.
    // We need recipient_email to enforce RECIPIENT_MISMATCH before
    // locking the row in the accept RPC. NOT_FOUND here can mean the
    // invite is exhausted/expired/revoked — the atomic RPC below will
    // surface the precise error_code, so we don't short-circuit on it.
    const { data: invites } = await supabaseAdmin
      .rpc("get_invite_by_token", { p_token: token });

    const previewInvite = Array.isArray(invites) ? invites[0] : null;

    // SECURITY (bug-bounty 2026-05-24 P0): when the invite was sent
    // to a specific email address (recipient_email set), enforce that
    // ONLY that recipient can accept. Without this an email-scoped
    // invite was acceptable by anyone with the token — defeating the
    // point of single-recipient invites. Compare case-insensitively
    // because email matching is case-insensitive per RFC 5321.
    if (previewInvite?.recipient_email) {
      const userEmail = (user.email ?? "").toLowerCase().trim();
      const expected = String(previewInvite.recipient_email).toLowerCase().trim();
      if (userEmail !== expected) {
        return errors.forbidden(
          "This invite was sent to a different email address. Sign in with that address to accept.",
          "RECIPIENT_MISMATCH"
        );
      }
    }

    // Atomic accept — SELECT FOR UPDATE on trip_invites, max_uses /
    // is_active / expires_at guards, INSERT into trip_collaborators
    // (ON CONFLICT DO NOTHING), increment use_count, all in one tx.
    const { data: acceptData, error: rpcError } = await supabaseAdmin
      .rpc("accept_trip_invite", { p_token: token, p_user_id: user.id });

    if (rpcError) {
      console.error("[Invites] accept_trip_invite RPC error:", rpcError);
      return errors.internal("Failed to join trip", "Invites");
    }

    const result = acceptData as AcceptInviteRpcResult | null;
    if (!result) {
      return errors.internal("Failed to join trip", "Invites");
    }

    if ("error_code" in result) {
      // Translate SQL error_codes back to HTTP statuses + the
      // user-facing error codes already in use across the app
      // (see lib/api/invite-validation.ts for the canonical list).
      switch (result.error_code) {
        case "NOT_FOUND":
          return errors.notFound("Invalid invite link");
        case "MAX_USES":
          return errors.gone("This invite link has already been used", "MAX_USES");
        case "REVOKED":
          return errors.gone("This invite has been revoked by the trip owner", "REVOKED");
        case "EXPIRED":
          return errors.gone("This invite has expired", "EXPIRED");
        case "TRIP_NOT_FOUND":
          return errors.notFound("Trip not found");
        default:
          return errors.internal("Failed to join trip", "Invites");
      }
    }

    // Owner accepting their own invite — same shape as the pre-#215
    // route returned. No banana award, no DB writes happened.
    if (result.is_owner) {
      return apiSuccess({
        success: true,
        message: "You are the owner of this trip",
        tripId: result.trip_id,
        alreadyMember: true,
      });
    }

    // Already-a-collaborator path — RPC took the ON CONFLICT branch,
    // no seat consumed, no banana award. Look up the trip title for
    // the response payload (cheap single-row read).
    if (result.already_member) {
      const { data: trip } = await supabaseAdmin
        .from("trips")
        .select("id, title")
        .eq("id", result.trip_id)
        .single();

      return apiSuccess({
        success: true,
        message: "You are already a collaborator on this trip",
        tripId: result.trip_id,
        tripTitle: trip?.title,
        role: result.role,
        alreadyMember: true,
      });
    }

    // Fresh join — fetch the trip title and the new collaborator row
    // so the response keeps the same shape callers already consume.
    const [{ data: trip }, { data: newCollab }] = await Promise.all([
      supabaseAdmin
        .from("trips")
        .select("id, title")
        .eq("id", result.trip_id)
        .single(),
      result.collaborator_id
        ? supabaseAdmin
            .from("trip_collaborators")
            .select("*")
            .eq("id", result.collaborator_id)
            .single()
        : Promise.resolve({ data: null }),
    ]);

    // Award bananas to the inviter (collaborator referral reward).
    // Same logic as before — runs OUTSIDE the atomic tx because it's
    // best-effort and shouldn't block the join if banana bookkeeping
    // fails. The invite seat is already consumed.
    let bananasAwarded = false;
    let tierUnlocked = false;
    let newTier = 0;

    if (result.created_by && result.is_referral_eligible !== false) {
      try {
        const inviterTier = await getUserReferralTier(supabaseAdmin, result.created_by);

        const bananaResult = await addCollaborationBananas(
          supabaseAdmin,
          result.created_by,
          result.invite_id,
          inviterTier
        );

        if (bananaResult.success) {
          bananasAwarded = true;

          const tierResult = await checkAndUnlockTier(supabaseAdmin, result.created_by);
          tierUnlocked = tierResult.tierUnlocked;
          newTier = tierResult.tierInfo.currentTier;
        }

        // Track that this user joined via trip invite (for future referral attribution)
        await supabaseAdmin
          .from("users")
          .update({ signed_up_via_trip_invite: result.invite_id })
          .eq("id", user.id);
      } catch (bananaError) {
        console.error("[Invites] Error awarding collaboration bananas:", bananaError);
        // Don't fail the join - it's already successful
      }
    }

    return apiSuccess({
      success: true,
      message: "Successfully joined the trip!",
      tripId: result.trip_id,
      tripTitle: trip?.title,
      role: result.role,
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
