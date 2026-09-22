// app/api/consent-event/route.ts
//
// Records what the cookie banner did: shown, minimised, accepted, essential
// only, settings saved. One row per event, keyed on the same analytics
// session cookie the page-view tracker uses, no other identifier.
//
// Recording the consent decision is not tracking; it is how the site can
// show it honoured the choice, and it is the only way to know the acceptance
// rate of anonymous visitors (signed-in choices already live on
// users.cookie_consent). Same shape as /api/page-engaged: dumb, rate-limited
// per IP and per session, 204 whatever happens.
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createRateLimiter } from "@/lib/api/rate-limit";
import { errors } from "@/lib/api/response-wrapper";
import { parseConsentEvent } from "@/lib/consent/consent-event-schema";

export const runtime = "nodejs";

// A visitor produces at most a handful of these per page; the IP bucket is
// the one that matters against a scripted caller rotating cookies.
const ipLimiter = createRateLimiter("consent-event-ip", 120, 60 * 1000);
const sessionLimiter = createRateLimiter("consent-event-session", 30, 60 * 1000);

export async function POST(request: NextRequest) {
  const ipCheck = await ipLimiter.check(request);
  if (!ipCheck.allowed) return errors.rateLimit("Too many events from this IP");

  // Unlike page-engaged, a missing session cookie is not a reason to drop the
  // event: a browser that blocks storage still shows the banner and its
  // decision is still worth counting. The row simply has no session.
  const cookie = request.cookies.get("mt_session_id")?.value;
  const sessionId = cookie && cookie !== "no_session" ? cookie : null;
  if (sessionId) {
    const sessionCheck = await sessionLimiter.check(request, sessionId);
    if (!sessionCheck.allowed) return errors.rateLimit("Too many events for this session");
  }

  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    return new NextResponse(null, { status: 204 });
  }
  const payload = parseConsentEvent(body);
  if (!payload) return new NextResponse(null, { status: 204 });

  try {
    await createAdminClient().from("consent_events").insert({
      session_id: sessionId,
      event: payload.event,
      variant: payload.variant,
      analytics: payload.analytics,
      marketing: payload.marketing,
      session_recording: payload.sessionRecording,
      path: payload.path,
      locale: payload.locale,
      origin: payload.origin,
    });
  } catch {
    // Telemetry must never surface to the visitor.
  }

  return new NextResponse(null, { status: 204 });
}
