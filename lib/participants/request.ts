import type { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { nanoid } from "nanoid";
import { errors } from "@/lib/api/response-wrapper";
import type { createRateLimiter } from "@/lib/api/rate-limit";
import type { InviteTokenRouteContext } from "@/lib/api/route-context";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/utils/uuid";
import { isParticipantCookieId, PARTICIPANT_COOKIE, PARTICIPANT_COOKIE_MAX_AGE_SECONDS } from "./shared";

/**
 * The request side of an anonymous participant's write on a shared trip
 * (join, vote, expense, Today's actions): who is writing, and whether to
 * believe it is a person.
 */

const SCRIPTED_AGENT = /^(curl|wget|python-requests|httpie|go-http-client|libwww-perl|scrapy)\b/i;

/**
 * A script's first write: no participant cookie yet, and no user agent or an
 * obvious scripting one. A browser always sends an agent that passes, so a
 * real first-time participant gets through; a script minting a fresh
 * identity on every call does not.
 */
export function isCookielessScript(request: NextRequest, cookieId: string | undefined): boolean {
  if (cookieId) return false;
  const agent = request.headers.get("user-agent") ?? "";
  return !agent || SCRIPTED_AGENT.test(agent);
}

/**
 * What every anonymous write on a shared trip checks first, in this order: the
 * share token's form, the per-IP limit, that this is not a cookieless script,
 * and a JSON object for a body.
 */
export async function readParticipantWrite<Body>(
  request: NextRequest,
  context: InviteTokenRouteContext,
  ipLimiter: ReturnType<typeof createRateLimiter>,
  tooMany = "Too many requests. Please slow down."
): Promise<
  | {
      token: string;
      body: Body;
      cookieStore: Awaited<ReturnType<typeof cookies>>;
      existingCookie: string | undefined;
      errorResponse?: undefined;
    }
  | { errorResponse: NextResponse }
> {
  const { token } = await context.params;
  if (!token || !isUuid(token)) return { errorResponse: errors.badRequest("Invalid share token") };

  const { allowed } = await ipLimiter.check(request);
  if (!allowed) return { errorResponse: errors.rateLimit(tooMany) };

  const cookieStore = await cookies();
  const existingCookie = cookieStore.get(PARTICIPANT_COOKIE)?.value;
  if (isCookielessScript(request, existingCookie)) return { errorResponse: errors.badRequest("Invalid request") };

  const body = (await request.json().catch(() => null)) as Body | null;
  if (!body || typeof body !== "object") return { errorResponse: errors.badRequest("Invalid request body") };

  return { token, body, cookieStore, existingCookie };
}

/** The account behind a shared-trip request, if any. Anyone with the link may write, so a failed read is no account. */
export async function signedInUser(): Promise<{ id: string; email?: string | null } | null> {
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    return data.user ?? null;
  } catch {
    return null;
  }
}

/** The participant's cookie id, or a new one when it is missing or malformed. */
export function participantCookieId(cookieId: string | undefined): { cookieId: string; issued: boolean } {
  return isParticipantCookieId(cookieId) ? { cookieId, issued: false } : { cookieId: nanoid(21), issued: true };
}

/** Keeps a newly issued participant id. httpOnly: identity goes through the routes, never the page. */
export function setParticipantCookie(cookieStore: Awaited<ReturnType<typeof cookies>>, cookieId: string): void {
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
