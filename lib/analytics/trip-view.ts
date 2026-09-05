import { createHash } from "node:crypto";

/**
 * trip_views — the North Star's row.
 *
 * Phase 0.1 of docs/LIVE_TRIP_MASTER_PLAN.md. "Trips Opened During Travel"
 * counts a trip when at least one human opens it on at least one calendar
 * day inside [start_date, end_date]. This module holds the pure decisions the
 * route makes before it writes, so they can be unit-tested without a request:
 *
 *   - which surface the open came from (the `source` vocabulary)
 *   - what to use as the session key, and how it degrades without a cookie
 *   - the UTC day that, with trip + session, forms the dedupe key
 *
 * WHY THE COOKIE, NOT IP+UA
 * The previous writer minted a session id from base64(ip:ua:hour). Two
 * problems. It could never be joined to page_views (which keys on the
 * mt_session_id cookie), so "did this session later sign up" was
 * unanswerable. And base64 is reversible — a raw IP and user-agent sat in a
 * column readable by anon for public trips. The cookie is the join key; the
 * fallback is a one-way hash, bucketed by day so the per-day dedupe still
 * holds for cookieless clients.
 *
 * WHY THE DAY IS PART OF THE KEY
 * A participant who opens the trip on Day 1 and again on Day 3 is the exact
 * signal TODT exists to see. A lifetime unique on (trip, session) hid it.
 */

export const TRIP_VIEW_SOURCES = ["shared", "public", "owner", "collaborator"] as const;
export type TripViewSource = (typeof TRIP_VIEW_SOURCES)[number];

/** The cookie middleware sets on every response; page_views keys on it too. */
export const VIEW_SESSION_COOKIE = "mt_session_id";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string | null | undefined): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** Accepts exactly the vocabulary the renderers send; anything else is null. */
export function parseTripViewSource(value: unknown): TripViewSource | null {
  return typeof value === "string" && (TRIP_VIEW_SOURCES as readonly string[]).includes(value)
    ? (value as TripViewSource)
    : null;
}

/** YYYY-MM-DD in UTC — the same day the column default computes. */
export function utcDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export interface ResolvedViewSession {
  sessionId: string;
  /** true when the mt_session_id cookie was present and well-formed. */
  fromCookie: boolean;
}

/**
 * The session key for the dedupe. The cookie wins when it looks like a UUID
 * (the middleware mints one with crypto.randomUUID). Otherwise a one-way,
 * day-bucketed digest of ip|ua — never the raw values — prefixed so the two
 * kinds can be told apart in the table.
 */
export function resolveViewSessionId(
  cookieValue: string | null | undefined,
  ip: string | null | undefined,
  userAgent: string | null | undefined,
  now: Date = new Date(),
): ResolvedViewSession {
  const cookie = cookieValue?.trim();
  if (cookie && UUID_RE.test(cookie)) {
    return { sessionId: cookie.toLowerCase(), fromCookie: true };
  }
  const digest = createHash("sha256")
    .update(`${ip ?? "unknown"}|${userAgent ?? "unknown"}|${utcDay(now)}`)
    .digest("hex");
  return { sessionId: `nocookie:${digest.slice(0, 40)}`, fromCookie: false };
}

/** First hop of x-forwarded-for, or null. */
export function clientIp(forwardedFor: string | null | undefined): string | null {
  const first = forwardedFor?.split(",")[0]?.trim();
  return first ? first : null;
}
