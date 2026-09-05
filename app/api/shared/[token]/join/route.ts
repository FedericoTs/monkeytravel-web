/**
 * POST /api/shared/[token]/join — "I'm going" (Live Trip Phase 2.1)
 *
 * A recipient of a shared or public trip says they are going, gives a name
 * (optional), gives an email for this trip's notifications (optional), or
 * takes it back. No auth required — possession of the share token is the
 * capability, exactly like /vote. Identity is the SAME cookie /vote mints
 * (mt_anon_voter), so a participant's votes and participation are one
 * person; user_id is attached when the browser also holds a session.
 *
 * Body: { action: 'join' | 'update' | 'leave', source?, display_name?, email? }
 *   join   — insert, or re-activate a row that had left; name/email if given
 *   update — name and/or email on an active row
 *   leave  — sets left_at (the row stays, for the tap-rate history)
 *
 * Returns the same shape as GET /participants so the page can replace its
 * state in one go: { count, participants[], me }.
 *
 * Writes go through the service role: the table has RLS on and no policies.
 * Two rate limits: per IP (scripted cookie-less loops) and per cookie per
 * trip (a person toggling in a loop). Requests without a cookie from obvious
 * scripting user-agents are refused, as in /vote.
 */
import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { nanoid } from "nanoid";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { captureServerEvent } from "@/lib/posthog/server";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { createRateLimiter } from "@/lib/api/rate-limit";
import type { InviteTokenRouteContext } from "@/lib/api/route-context";
import { isLiveTripParticipantsEnabled } from "@/lib/participants/flag";
import {
  PARTICIPANT_COOKIE,
  PARTICIPANT_COOKIE_MAX_AGE_SECONDS,
  isUuid,
  normalizeDisplayName,
  normalizeEmail,
  parseJoinAction,
  parseParticipantSource,
  type ParticipantSource,
} from "@/lib/participants/shared";
import { participantsSnapshot } from "@/lib/participants/snapshot";

const ipLimiter = createRateLimiter("shared-join-ip", 30, 60_000);
const cookieTripLimiter = createRateLimiter("shared-join-cookie-trip", 6, 60_000);
const BOT_UA_REGEX = /^(curl|wget|python-requests|httpie|go-http-client|libwww-perl|scrapy)\b/i;

interface JoinBody {
  action?: unknown;
  source?: unknown;
  display_name?: unknown;
  email?: unknown;
}

export async function POST(request: NextRequest, context: InviteTokenRouteContext) {
  try {
    if (!isLiveTripParticipantsEnabled()) {
      return errors.notFound("Not available");
    }
    const { token } = await context.params;
    if (!token || !isUuid(token)) {
      return errors.badRequest("Invalid share token");
    }

    const { allowed: ipAllowed } = await ipLimiter.check(request);
    if (!ipAllowed) {
      return errors.rateLimit("Too many requests. Please slow down.");
    }

    const cookieStore = await cookies();
    const existingCookie = cookieStore.get(PARTICIPANT_COOKIE)?.value;
    if (!existingCookie) {
      const ua = request.headers.get("user-agent") ?? "";
      if (!ua || BOT_UA_REGEX.test(ua)) {
        return errors.badRequest("Invalid request");
      }
    }

    const body = (await request.json().catch(() => null)) as JoinBody | null;
    if (!body || typeof body !== "object") {
      return errors.badRequest("Invalid request body");
    }
    const action = parseJoinAction(body.action);
    if (!action) {
      return errors.badRequest("Invalid action — must be 'join', 'update' or 'leave'");
    }
    const source: ParticipantSource = parseParticipantSource(body.source) ?? "shared";
    const displayName = normalizeDisplayName(body.display_name);
    const email = normalizeEmail(body.email);
    if (email === false) {
      return errors.badRequest("That email address doesn't look right");
    }

    const admin = createAdminClient();
    const { data: trip, error: tripError } = await admin
      .from("trips")
      .select("id, user_id")
      .eq("share_token", token)
      .single();
    if (tripError || !trip) {
      return errors.notFound("Shared trip not found");
    }

    // Read or mint the shared identity cookie (same rules as /vote).
    let cookieId = existingCookie;
    let issuedCookie = false;
    if (!cookieId || cookieId.length < 10 || cookieId.length > 60) {
      cookieId = nanoid(21);
      issuedCookie = true;
    }

    const { allowed: cookieAllowed } = await cookieTripLimiter.check(request, `${cookieId}:${trip.id}`);
    if (!cookieAllowed) {
      return errors.rateLimit("Too many changes. Please slow down.");
    }

    // A signed-in recipient is linked to their account; anonymous stays anonymous.
    let userId: string | null = null;
    try {
      const supabase = await createClient();
      const { data } = await supabase.auth.getUser();
      userId = data.user?.id ?? null;
    } catch {
      userId = null;
    }

    const { data: existing } = await admin
      .from("trip_participants")
      .select("id, left_at, display_name, email")
      .eq("trip_id", trip.id)
      .eq("participant_cookie_id", cookieId)
      .maybeSingle();

    let joinedNow = false;
    if (action === "join") {
      if (!existing) {
        const { error } = await admin.from("trip_participants").insert({
          trip_id: trip.id,
          participant_cookie_id: cookieId,
          user_id: userId,
          display_name: displayName,
          email: email ?? null,
          source,
        });
        if (error) {
          console.error("[Shared Join] insert failed:", error);
          return errors.internal("Could not save that", "SharedJoin");
        }
        joinedNow = true;
      } else {
        const patch: Record<string, unknown> = { left_at: null };
        if (displayName) patch.display_name = displayName;
        if (email) patch.email = email;
        if (userId) patch.user_id = userId;
        const { error } = await admin.from("trip_participants").update(patch).eq("id", existing.id);
        if (error) {
          console.error("[Shared Join] rejoin failed:", error);
          return errors.internal("Could not save that", "SharedJoin");
        }
        joinedNow = existing.left_at !== null;
      }
    } else if (action === "update") {
      if (!existing || existing.left_at !== null) {
        return errors.notFound("You haven't said you're going yet");
      }
      const patch: Record<string, unknown> = {};
      if (displayName) patch.display_name = displayName;
      if (email) patch.email = email;
      if (userId) patch.user_id = userId;
      if (Object.keys(patch).length > 0) {
        const { error } = await admin.from("trip_participants").update(patch).eq("id", existing.id);
        if (error) {
          console.error("[Shared Join] update failed:", error);
          return errors.internal("Could not save that", "SharedJoin");
        }
      }
    } else {
      // leave
      if (existing && existing.left_at === null) {
        const { error } = await admin
          .from("trip_participants")
          .update({ left_at: new Date().toISOString() })
          .eq("id", existing.id);
        if (error) {
          console.error("[Shared Join] leave failed:", error);
          return errors.internal("Could not save that", "SharedJoin");
        }
      }
    }

    if (joinedNow) {
      // Consent-free server capture, keyed by the shared cookie like crew votes.
      captureServerEvent(cookieId, "participant_joined", {
        trip_id: trip.id,
        source,
        authenticated: userId !== null,
        gave_name: displayName !== null,
        gave_email: email !== null && email !== undefined,
      });
    }

    if (issuedCookie) {
      cookieStore.set({
        name: PARTICIPANT_COOKIE,
        value: cookieId,
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: PARTICIPANT_COOKIE_MAX_AGE_SECONDS,
        path: "/",
      });
    }

    const snapshot = await participantsSnapshot(admin, trip.id, cookieId);
    return apiSuccess(snapshot);
  } catch (error) {
    console.error("[Shared Join] Unexpected error:", error);
    return errors.internal("Internal server error", "SharedJoin");
  }
}
