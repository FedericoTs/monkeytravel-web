import { NextRequest, NextResponse } from "next/server";
import { buildIcal } from "@/lib/calendar/ical";
import {
  CALENDAR_HMAC_HEX_LENGTH,
  fetchUserTripsForFeed,
  findUserByCalendarHmac,
} from "@/lib/calendar/feed";
import { tripsToIcalEvents } from "@/lib/calendar/trip-to-events";
import { createRateLimiter } from "@/lib/api/rate-limit";

/**
 * GET /api/calendar/<user_hmac>.ics — dynamic iCal subscription feed.
 *
 * Phase 1B of calendar-export (docs/specs/calendar-export-smart-notifs.md).
 *
 * URL anatomy:
 *   user_hmac = HMAC-SHA256(user_id, CALENDAR_HMAC_SECRET), lowercase
 *   hex. The Next.js segment captures the WHOLE segment including the
 *   `.ics` suffix that calendar clients append for content-type
 *   sniffing — we strip the suffix below before validating.
 *
 * Behaviour:
 *   - Look up the user by indexed `users.calendar_hmac` column.
 *   - If not found → 404 (no signal that the route exists for invalid
 *     HMACs — defends against scanners enumerating the table).
 *   - Otherwise pull their non-archived trips that ended within the
 *     last 7 days or are still upcoming, build a VCALENDAR, and
 *     return text/calendar with a 15-minute cache window.
 *
 * Cache headers:
 *   `max-age=900, stale-while-revalidate=3600` — Apple Calendar polls
 *   hourly, Google ~daily, Outlook varies. 15 min server-side cache is
 *   plenty short for "I just edited a trip" to propagate within the
 *   PRD's "subscribe picks up on next calendar poll" SLA.
 *
 * Rate limit:
 *   60 req/min/IP — calendar clients poll, not spam. A buggy client
 *   hammering us still gets cut off without 503'ing real users from
 *   the same NAT.
 *
 * Runtime: Node (NOT edge) — the service-role Supabase client + the
 * `node:crypto` HMAC live here. `createRateLimiter` is runtime-agnostic.
 *
 * CAUSALITY:
 *   - app/robots.ts disallows /api/calendar/ so search engines never
 *     index a leaked URL.
 *   - lib/calendar/feed.ts owns HMAC mint/verify + trip lookup.
 *   - lib/calendar/trip-to-events.ts adapts the trip JSONB to the
 *     IcalEvent shape consumed by lib/calendar/ical.ts.
 *   - This route only READS — minting (lazy, on subscribe-tab open)
 *     belongs to the future AddToCalendarSheet UI in Phase 2.
 *
 * No-feature-flag note: the feature gate
 *   NEXT_PUBLIC_CALENDAR_EXPORT_ENABLED
 * is intentionally NOT enforced here. The flag controls the UI that
 * shows the subscribe URL to the user. Even if a user obtained a URL
 * while the flag was on and then we flipped it off, this route still
 * serves the feed — that's correct behaviour: subscriptions in
 * external calendars shouldn't silently break when we toggle the
 * planning UI. The kill-switch is in the UI exposure, not the data.
 */

export const runtime = "nodejs";
// Personalised feed — never cache at the framework layer; clients
// honour the Cache-Control header we set explicitly.
export const dynamic = "force-dynamic";

type RouteCtx = {
  params: Promise<{ user_hmac: string }>;
};

const ICS_SUFFIX = ".ics";
const ICS_CONTENT_TYPE = "text/calendar; charset=utf-8";

// 60 requests per minute per IP. Hard cap on rogue calendar clients
// (e.g. a buggy add-on polling every second) without affecting real
// poll cadences (Apple = hourly, Google = ~6h).
const rateLimiter = createRateLimiter("calendar-feed", 60, 60_000);

function notFound() {
  // Plain 404 with no body — calendar clients show "subscription
  // unavailable" UX, and scanners get nothing useful.
  return new NextResponse(null, { status: 404 });
}

function tooManyRequests() {
  return new NextResponse("Rate limit exceeded", {
    status: 429,
    headers: { "Retry-After": "60" },
  });
}

function serverError() {
  return new NextResponse("Internal Server Error", { status: 500 });
}

export async function GET(request: NextRequest, ctx: RouteCtx) {
  // 1. Rate-limit before any DB or crypto work.
  const limited = await rateLimiter.check(request);
  if (!limited.allowed) return tooManyRequests();

  // 2. Resolve + sanity-check the path param.
  const { user_hmac: rawSegment } = await ctx.params;
  if (typeof rawSegment !== "string") return notFound();

  // Strip the trailing `.ics` suffix calendar clients use for sniffing.
  // We accept either form (`<hmac>` or `<hmac>.ics`) — the latter is
  // the canonical URL we hand out, but bare-HMAC fetches from curl
  // still work for debugging.
  let userHmac = rawSegment.toLowerCase();
  if (userHmac.endsWith(ICS_SUFFIX)) {
    userHmac = userHmac.slice(0, -ICS_SUFFIX.length);
  }

  // Cheap length / charset gate so we don't burn a Supabase round-trip
  // on every random scanner hit.
  if (
    userHmac.length !== CALENDAR_HMAC_HEX_LENGTH ||
    !/^[a-f0-9]+$/.test(userHmac)
  ) {
    return notFound();
  }

  // 3. Look up the user. 404 on both "not found" and "lookup failed"
  // to avoid leaking signal. Errors get surfaced in Sentry via the
  // generic 500 path on any unexpected throw below.
  let userId: string;
  try {
    const found = await findUserByCalendarHmac(userHmac);
    if (!found) return notFound();
    userId = found.userId;
  } catch (err) {
    // Lookup hard-failed (e.g. CALENDAR_HMAC_SECRET unset, Supabase
    // unreachable). Don't 404 here — operator needs to see the alarm.
    console.error("[calendar-feed] HMAC lookup failed:", err);
    return serverError();
  }

  // 4. Fetch trips + build iCal.
  let body: string;
  try {
    const trips = await fetchUserTripsForFeed(userId);
    const events = tripsToIcalEvents(trips);
    body = buildIcal(events, {
      calName: "monkeytravel — My Trips",
      productId: "-//monkeytravel.app//Subscription Feed 1.0//EN",
    });
  } catch (err) {
    console.error("[calendar-feed] Build failed for user", userId, err);
    return serverError();
  }

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": ICS_CONTENT_TYPE,
      // 15-min CDN/edge cache + 1h stale-while-revalidate. Personalised
      // body, but the URL itself is the secret — anyone with it should
      // see the same content, so a shared cache is fine.
      "Cache-Control":
        "private, max-age=900, stale-while-revalidate=3600, must-revalidate",
      // Defensive: never let a browser sniff something else from a
      // calendar feed, and don't let it be embedded in a frame.
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": 'inline; filename="monkeytravel.ics"',
    },
  });
}
