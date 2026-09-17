// app/api/page-view/route.ts
//
// One row in page_views per in-app navigation, sent by
// components/analytics/PageViewBeacon.tsx when the pathname changes.
//
// The middleware records document loads. It cannot record client-side
// navigations because Next strips the Flight headers before middleware runs,
// which leaves an RSC navigation indistinguishable from a Link prefetch (see
// lib/analytics/page-view-classifier.ts). So the middleware counts
// navigations only and this route counts the rest, from the one place a
// prefetch can never reach: a client effect on the rendered page.
//
// Same shape as /api/page-engaged: keyed on the analytics session cookie the
// middleware sets, rate-limited per IP and per session, 204 whatever happens.
// The row is built exactly like the middleware's so both kinds join on
// session_id and read the same in every aggregate.
import { NextRequest, NextResponse } from "next/server";
import { geolocation } from "@vercel/functions";
import { createServerClient } from "@supabase/ssr";
import { createAdminClient } from "@/lib/supabase/admin";
import { createRateLimiter } from "@/lib/api/rate-limit";
import { errors } from "@/lib/api/response-wrapper";
import { isAnalyticsBot } from "@/lib/analytics/bot-detection";
import { isPageViewPath } from "@/lib/analytics/page-view-classifier";
import { subjectFromAccessToken } from "@/lib/supabase/middleware";

export const runtime = "nodejs";

// A person navigates a few times a minute at most; the IP bucket is what
// caps a cookie-rotating script.
const ipLimiter = createRateLimiter("page-view-ip", 240, 60 * 1000);
const sessionLimiter = createRateLimiter("page-view-session", 60, 60 * 1000);

/** Pathname only, never a query string; same cap as the other beacons. */
function safePath(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.startsWith("/") || raw.startsWith("//")) return null;
  const path = raw.split(/[?#]/)[0].slice(0, 200);
  return isPageViewPath(path) ? path : null;
}

/** The signed-in user, from the auth cookie alone: no network round-trip. */
async function userIdFromCookies(request: NextRequest): Promise<string | null> {
  try {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => request.cookies.getAll(), setAll: () => undefined } }
    );
    // getSession() reads the cookie; the id comes from the token's `sub`, the
    // same way the middleware attributes document loads.
    const { data } = await supabase.auth.getSession();
    return subjectFromAccessToken(data.session?.access_token);
  } catch {
    return null;
  }
}

function respond(label: string): NextResponse {
  return new NextResponse(null, { status: 204, headers: { "x-mt-pv": label } });
}

export async function POST(request: NextRequest) {
  const sessionId = request.cookies.get("mt_session_id")?.value;
  // No cookie means the document load was not recorded either (filtered
  // upstream, or storage blocked). Nothing to key a row on.
  if (!sessionId || sessionId === "no_session") return respond("skip:session");

  const ipCheck = await ipLimiter.check(request);
  if (!ipCheck.allowed) return errors.rateLimit("Too many page views from this IP");
  const sessionCheck = await sessionLimiter.check(request, sessionId);
  if (!sessionCheck.allowed) return errors.rateLimit("Too many page views for this session");

  let path: string | null = null;
  let from: string | null = null;
  try {
    const body = (await request.json()) as { path?: unknown; from?: unknown };
    path = safePath(body.path);
    from = safePath(body.from);
  } catch {
    return respond("skip:body");
  }
  if (!path) return respond("skip:path");

  // Same guard as the middleware: previews and local dev never write to the
  // production table. The verdict still rides on the response for probes.
  if (process.env.VERCEL_ENV !== "production") return respond("counted;dry");

  try {
    const geo = geolocation(request);
    const userAgent = request.headers.get("user-agent") || null;
    const userId = await userIdFromCookies(request);
    await createAdminClient().from("page_views").insert({
      path,
      // The page the visitor navigated from, on this site.
      referrer: from ? `${request.nextUrl.origin}${from}` : null,
      country: geo.country || null,
      country_code: geo.country || null,
      city: geo.city || null,
      region: geo.countryRegion || null,
      latitude: geo.latitude ? parseFloat(geo.latitude) : null,
      longitude: geo.longitude ? parseFloat(geo.longitude) : null,
      user_agent: userAgent,
      user_id: userId,
      session_id: sessionId,
      is_bot: isAnalyticsBot(userAgent),
    });
  } catch {
    // Telemetry must never surface to the visitor.
  }

  return respond("counted");
}
