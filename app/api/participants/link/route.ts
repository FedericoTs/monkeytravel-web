/**
 * POST /api/participants/link — after signing in, hand what this browser did
 * as a guest, on every trip, to the account: "I'm going" rows, Today taps,
 * payments and shares (link_guest_to_account). It needs both the session and
 * this browser's guest cookie, which only this browser holds.
 */
import { NextRequest } from "next/server";
import { getAuthenticatedUser } from "@/lib/api/auth";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { createRateLimiter } from "@/lib/api/rate-limit";
import { linkGuestToAccount } from "@/lib/participants/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { browserGuestCookie } from "@/lib/today/actor";

const limiter = createRateLimiter("participants-link", 10, 60_000);

export async function POST(request: NextRequest) {
  try {
    const { user, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;

    const { allowed } = await limiter.check(request, user.id);
    if (!allowed) return errors.rateLimit("Too many requests. Please slow down.");

    const cookieId = await browserGuestCookie();
    if (!cookieId) return apiSuccess({ linked: false });

    if (!(await linkGuestToAccount(createAdminClient(), user.id, cookieId))) {
      return errors.internal("Could not link this browser's guest activity", "ParticipantsLink");
    }
    return apiSuccess({ linked: true });
  } catch (err) {
    console.error("[participants link] unexpected", err);
    return errors.internal("Could not link this browser's guest activity", "ParticipantsLink");
  }
}
