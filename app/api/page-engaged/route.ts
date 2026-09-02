// app/api/page-engaged/route.ts
//
// One call per session, the first time a real browser keeps a page visible
// long enough to count as a visit.
//
// `page_views.is_bot` is a user-agent regex and the traffic that doubled the
// wizard denominator on 2026-08-17 defeats it entirely — 629 localized step-1
// sessions from CN/SG/HK sharing 29 rotating user agents, 0.0% flagged, and
// six sessions across three regions that ever had an account. Identity cannot
// separate that from a real visitor, and neither can page-view timing, which
// is dominated by prefetch. Time-on-page can, and outside the wizard nothing
// measured it.
//
// The route is deliberately dumb: no body, no parameters a caller could lie
// about beyond its own session cookie, and ON CONFLICT DO NOTHING so the row
// records a session's FIRST engagement and never moves.
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createRateLimiter } from "@/lib/api/rate-limit";
import { errors } from "@/lib/api/response-wrapper";

export const runtime = "nodejs";

// One engagement per session is the whole point, so these are generous only to
// absorb retries and multi-tab noise. The IP bucket is the one that matters:
// it caps a cookie-rotating caller, which is exactly the traffic this exists
// to exclude. Same composite shape as /api/wizard-event and /api/funnel-event.
const ipLimiter = createRateLimiter("page-engaged-ip", 120, 60 * 1000);
const sessionLimiter = createRateLimiter("page-engaged-session", 10, 60 * 1000);

/** Keep only what a dashboard needs; never store a query string. */
function safePath(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.startsWith("/")) return null;
  return raw.split(/[?#]/)[0].slice(0, 120);
}

function safeLocale(raw: unknown): string | null {
  return typeof raw === "string" && /^[a-z]{2}(-[A-Z]{2})?$/.test(raw) ? raw : null;
}

export async function POST(request: NextRequest) {
  const sessionId = request.cookies.get("mt_session_id")?.value;
  // No cookie means the visitor was filtered upstream or blocks storage.
  // Nothing to key a row on, so nothing to record — 204, not an error.
  if (!sessionId || sessionId === "no_session") {
    return new NextResponse(null, { status: 204 });
  }

  const ipCheck = await ipLimiter.check(request);
  if (!ipCheck.allowed) return errors.rateLimit("Too many events from this IP");
  const sessionCheck = await sessionLimiter.check(request, sessionId);
  if (!sessionCheck.allowed) return errors.rateLimit("Too many events for this session");

  let path: string | null = null;
  let locale: string | null = null;
  try {
    const body = (await request.json()) as { path?: unknown; locale?: unknown };
    path = safePath(body.path);
    locale = safeLocale(body.locale);
  } catch {
    // A malformed body still counts as engagement; the columns are optional.
  }

  try {
    // ON CONFLICT DO NOTHING: the row is the session's FIRST engagement and is
    // never updated, so a chatty client cannot rewrite history.
    await createAdminClient()
      .from("session_engagement")
      .upsert({ session_id: sessionId, first_path: path, locale }, { onConflict: "session_id", ignoreDuplicates: true });
  } catch {
    // Telemetry must never surface to the visitor.
  }

  return new NextResponse(null, { status: 204 });
}
