import { NextRequest } from "next/server";
import { getAuthenticatedUser, verifyTripAccess } from "@/lib/api/auth";
import { nanoid } from "nanoid";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { ASSIGNABLE_ROLES, isValidAssignableRole } from "@/lib/api/constants";
import type { TripRouteContext } from "@/lib/api/route-context";
import type { CollaboratorRole, TripInvite } from "@/types";
import { dispatchEmail } from "@/lib/email/send";
import { normalizeEmailLocale } from "@/lib/email/copy";

// RFC 5322 / WHATWG-compatible loose email regex. Strict-enough to reject
// obvious typos ("not an email") without rejecting legitimate addresses
// that look unusual (plus tags, subdomains, single-character TLDs, etc).
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_MESSAGE_LENGTH = 500;

/**
 * GET /api/trips/[id]/invites - List all active invites for a trip
 */
export async function GET(request: NextRequest, context: TripRouteContext) {
  try {
    const { id: tripId } = await context.params;
    const { user, supabase, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;

    // Verify user has access (owner or editor can view invites)
    const { errorResponse: accessError } = await verifyTripAccess(
      supabase,
      tripId,
      user.id,
      "id, user_id",
      ["editor"] // Only editors (besides owner) can view invites
    );
    if (accessError) return accessError;

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
    const { user, supabase, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;

    const body = await request.json();
    const {
      role = "voter",
      maxUses = 1,
      expiresInDays = 3650, // ~10 years, effectively never expires
      recipientEmail,
      recipientLocale,
      message,
    } = body as {
      role?: Exclude<CollaboratorRole, "owner">;
      maxUses?: number;
      expiresInDays?: number;
      // New optional fields — when recipientEmail is set, the invite is
      // single-recipient and we dispatch an email. Omitted = current
      // shareable-link semantics (unchanged).
      recipientEmail?: string;
      recipientLocale?: string;
      message?: string;
    };

    // Validate role
    if (!isValidAssignableRole(role)) {
      return errors.badRequest(`Invalid role. Must be one of: ${ASSIGNABLE_ROLES.join(", ")}`);
    }

    // Validate new optional fields
    const normalizedEmail = recipientEmail?.trim().toLowerCase();
    if (normalizedEmail !== undefined && normalizedEmail !== "") {
      if (!EMAIL_REGEX.test(normalizedEmail)) {
        return errors.badRequest("Invalid recipient_email format");
      }
    }
    if (recipientLocale !== undefined && !/^[a-z]{2}(-[A-Z]{2})?$/.test(recipientLocale)) {
      return errors.badRequest("Invalid recipient_locale (expected BCP-47, e.g. 'en' or 'en-US')");
    }
    if (message !== undefined && message.length > MAX_MESSAGE_LENGTH) {
      return errors.badRequest(`Message too long (max ${MAX_MESSAGE_LENGTH} chars)`);
    }

    // Verify user has permission (owner or editor can create invites)
    const { errorResponse: accessError, trip } = await verifyTripAccess(
      supabase,
      tripId,
      user.id,
      "id, user_id, title, destination",
      ["editor"]
    );
    if (accessError) return accessError;

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
        // Email invites: enforce single-use regardless of caller's maxUses
        // (the recipient is named; allowing N uses would be a footgun).
        max_uses: normalizedEmail ? 1 : maxUses,
        use_count: 0,
        is_active: true,
        recipient_email: normalizedEmail || null,
        recipient_locale: recipientLocale || null,
        message: message?.trim() || null,
      })
      .select()
      .single();

    if (error) {
      console.error("[Invites] Error creating invite:", error);
      return errors.internal("Failed to create invite", "Invites");
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://monkeytravel.app";
    const inviteUrl = `${baseUrl}/invite/${token}`;

    // If an email was supplied, dispatch the invite email. Best-effort —
    // the invite row is already saved, so a failed send doesn't undo the
    // user's action. The dispatch helper records the outcome to email_log
    // for visibility.
    let emailOutcome: string | undefined;
    if (normalizedEmail) {
      try {
        const inviterName =
          (user.user_metadata?.full_name as string | undefined) ||
          (user.email?.split("@")[0]) ||
          "A trip collaborator";
        const tripData = trip as { title?: string; destination?: string } | undefined;
        const result = await dispatchEmail({
          recipientEmail: normalizedEmail,
          recipientUserId: null, // recipient may not exist yet — no opt-out check
          // Recipient has no account yet, so default the shell to the
          // inviter's language (the email is about their trip).
          locale: normalizeEmailLocale(user.user_metadata?.locale),
          idempotencyKey: `invite:${invite.id}`,
          template: {
            id: "invite",
            props: {
              inviterName,
              tripTitle: tripData?.title || "",
              tripDestination: tripData?.destination || "your trip",
              role: role as "editor" | "voter" | "viewer",
              inviteUrl,
              message: message?.trim() || undefined,
            },
          },
          metadata: { invite_id: invite.id, trip_id: tripId },
        });
        emailOutcome = result.status;
      } catch (sendErr) {
        // Already logged inside dispatchEmail; surface a generic status
        // so the client can show "saved but couldn't email" UI.
        console.error("[Invites] Email dispatch error:", sendErr);
        emailOutcome = "failed";
      }
    }

    return apiSuccess({
      success: true,
      invite: {
        ...invite,
        inviteUrl,
      },
      emailOutcome,
    });
  } catch (error) {
    console.error("[Invites] Error creating invite:", error);
    return errors.internal("Failed to create invite", "Invites");
  }
}
