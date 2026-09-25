import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { createRateLimiter } from "@/lib/api/rate-limit";
import { buildAuthCallbackUrl, normalizeAuthLocale } from "@/lib/auth/callback-url";
import { maskEmail } from "@/lib/invites/recipient";
import type { InviteTokenRouteContext } from "@/lib/api/route-context";

/**
 * POST /api/invites/[token]/sign-in-link — email a sign-in link to the
 * address an invite was sent to.
 *
 * WHY THIS EXISTS (2026-09-24)
 * An invite sent to a specific email can only be accepted by that account,
 * so the invite page shows a signed-out visitor "Sign in with that email to
 * view and accept the invite". It offered no way to sign in: its one button
 * went to "Create Your Own Trip". Every emailed invite to someone without an
 * account ended there (0 of 5 accepted, against 3 of 3 for recipients who
 * already had one), and a user reported it the same day.
 *
 * The page cannot put the address in a form (links get forwarded, and the
 * page shows only a masked hint), so the link goes to the invited address
 * from here. It lands through /auth/callback back on the invite, signed in
 * as that account, where Join works. A new address gets an account on the
 * way (shouldCreateUser), in the page's language.
 *
 * Holding the token is enough to trigger the email, but only ever to the
 * invited address and at most a few times an hour, so the worst case is a
 * few more copies of a mail that person was already sent.
 */

// Per invite: a couple of retries, not a mail cannon. Per IP: a household
// working through several invites is fine.
const perToken = createRateLimiter("invite-sign-in-link-token", 3, 60 * 60 * 1000);
const perIp = createRateLimiter("invite-sign-in-link-ip", 10, 60 * 60 * 1000);

export async function POST(request: NextRequest, context: InviteTokenRouteContext) {
  try {
    const { token } = await context.params;
    if (!token || token.length < 8 || !/^[a-zA-Z0-9_-]+$/.test(token)) {
      return errors.badRequest("Invalid invite token format");
    }

    if (!(await perIp.check(request)).allowed || !(await perToken.check(request, token)).allowed) {
      return errors.rateLimit("Too many sign-in emails for this invite. Try again in an hour.");
    }

    let locale = "en";
    try {
      const body = (await request.json()) as { locale?: unknown };
      locale = normalizeAuthLocale(body?.locale) ?? "en";
    } catch {
      // No body: English.
    }

    // Only a usable invite (active, unexpired, not used up) comes back here.
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });
    const { data: rows } = await admin.rpc("get_invite_by_token", { p_token: token });
    const invite = Array.isArray(rows) ? (rows[0] as { recipient_email?: string | null } | undefined) : undefined;
    if (!invite) return errors.notFound("This invite link is no longer valid");
    if (!invite.recipient_email) {
      // A shareable-link invite: anyone may sign in however they like on the page.
      return errors.badRequest("This invite is not tied to an email address");
    }

    // The anon client, as a browser would call it: the auth email goes out
    // through our send-email hook like every other sign-in link.
    const auth = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await auth.auth.signInWithOtp({
      email: invite.recipient_email,
      options: {
        emailRedirectTo: buildAuthCallbackUrl(new URL(request.url).origin, {
          next: `/invite/${token}`,
          locale,
        }),
        shouldCreateUser: true,
        data: { locale },
      },
    });
    if (error) {
      if (error.status === 429) {
        return errors.rateLimit("Too many sign-in emails right now. Try again in a few minutes.");
      }
      console.error("[invite sign-in link] signInWithOtp failed:", error.message);
      return errors.internal("Could not send the sign-in email", "Invite sign-in link");
    }

    return apiSuccess({ sent: true, sentTo: maskEmail(invite.recipient_email) });
  } catch (error) {
    console.error("[invite sign-in link] unexpected error:", error);
    return errors.internal("Could not send the sign-in email", "Invite sign-in link");
  }
}
