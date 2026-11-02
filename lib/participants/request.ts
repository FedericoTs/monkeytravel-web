import type { NextRequest } from "next/server";
import type { cookies } from "next/headers";
import { nanoid } from "nanoid";
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
