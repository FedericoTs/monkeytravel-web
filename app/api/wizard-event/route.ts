/**
 * POST /api/wizard-event
 *
 * Server-side mirror of the wizard funnel events that the client also
 * fires to PostHog. See supabase/migrations/20260531_wizard_step_events.sql
 * for the motivation and table shape.
 *
 * Contract:
 *   - Fire-and-forget from the client (responds 204; the wizard does
 *     not await or handle errors).
 *   - Accepts anonymous + authenticated callers — wizard sessions
 *     routinely start anonymous.
 *   - session_id is read from the mt_session_id cookie set by middleware
 *     (lib/supabase/middleware.ts:29-30). If absent (e.g. cookie blocked,
 *     bot, direct curl without cookies) we still accept the call and
 *     mint a synthetic "no-session" id so the row count surfaces in the
 *     funnel as a degraded-state signal rather than silently disappearing.
 *   - Rate-limited per session_id at 60/min to absorb a stuck client
 *     loop without burning Supabase quota.
 *
 * Returns 204 No Content on success (no body — keeps the response small
 * for the fire-and-forget path). 400 on body validation failure, 429
 * when the per-session limit fires, 500 on DB error. The wizard swallows
 * all of these.
 */

import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { errors } from "@/lib/api/response-wrapper";
import { createRateLimiter } from "@/lib/api/rate-limit";

// Mirror the CHECK constraint in the migration. Keep these in lockstep
// — adding a step requires updates in BOTH places (and the wizard
// trackWizardEvent() call sites).
const STEP_VALUES = [
  "step_1_destination_dates",
  "step_2_vibes",
  "generating",
  "result",
  "save_clicked",
  "saved",
  "abandoned",
] as const;

const BodySchema = z.object({
  step: z.enum(STEP_VALUES),
  destination: z.string().trim().min(1).max(120).optional(),
  duration_days: z.number().int().min(1).max(365).optional(),
  group_size: z.string().trim().min(1).max(32).optional(),
  backpacker_mode: z.boolean().optional(),
  locale: z.string().trim().min(2).max(8).optional(),
});

// Day-4 bug fix (P2.5): composite IP + session rate limit.
//
// Original implementation rate-limited per session_id only (60/min).
// Day-4 hunt proved this was bypassable in one line of curl by minting
// a fresh mt_session_id cookie per request — 100 requests with rotating
// cookies all returned 204 (vs 60×204 + 15×429 with the same cookie).
// That let an attacker poison wizard_step_events (the table that backs
// Task #285 ghost-user funnel dashboards) with unlimited rows from a
// single IP and inflate Supabase storage on a no-retention table.
//
// Fix: keep the session-keyed bucket (catches a single legitimate user
// in a stuck React effect loop) AND add a per-IP bucket via the shared
// Upstash limiter (catches the cookie-rotation bypass). The stricter
// of the two fires. IP bucket is generous (300/min) because legitimate
// shared NAT (offices, cafes) can run multiple wizard sessions in
// parallel — 300/min still cuts the attack at ~1/200 of its open rate.
type RateBucket = { count: number; resetAt: number };
const SESSION_RATE_LIMIT = 60;
const SESSION_RATE_WINDOW_MS = 60 * 1000;
const buckets = new Map<string, RateBucket>();

function checkSessionRateLimit(sessionId: string): boolean {
  const now = Date.now();
  const bucket = buckets.get(sessionId);
  if (!bucket || now > bucket.resetAt) {
    buckets.set(sessionId, { count: 1, resetAt: now + SESSION_RATE_WINDOW_MS });
    // Lazy GC: bound the Map size by sweeping expired entries when we
    // mint a new bucket. Cheap (Map iteration over ~few hundred items).
    if (buckets.size > 5_000) {
      for (const [k, v] of buckets) {
        if (now > v.resetAt) buckets.delete(k);
      }
    }
    return true;
  }
  if (bucket.count >= SESSION_RATE_LIMIT) return false;
  bucket.count++;
  return true;
}

// IP-keyed limiter — caches Upstash check across function instances.
// 300/min/IP absorbs shared-NAT legitimacy while shutting down the
// cookie-rotation bypass (which would otherwise issue 1 row per req).
const ipLimiter = createRateLimiter("wizard-event-ip", 300, 60 * 1000);

export async function POST(request: NextRequest) {
  // 1. Parse the body. Malformed JSON → 400, not 500.
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return errors.badRequest("Body must be valid JSON");
  }

  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return errors.badRequest("Invalid wizard event payload", {
      issues: parsed.error.issues,
    });
  }
  const body = parsed.data;

  // 2. Resolve session_id from cookie. Middleware mints + persists this
  //    on first visit; if absent we still accept the row so degraded
  //    cookie-less traffic shows up in the funnel as a "no_session"
  //    cohort rather than disappearing.
  const sessionId =
    request.cookies.get("mt_session_id")?.value || "no_session";

  // 3. Composite rate limit: IP-keyed (catches cookie-rotation bypass)
  //    AND session-keyed (catches a single legitimate user in a stuck
  //    effect loop). Stricter of the two fires.
  const ipCheck = await ipLimiter.check(request);
  if (!ipCheck.allowed) {
    return errors.rateLimit("Too many wizard events from this IP");
  }
  if (!checkSessionRateLimit(sessionId)) {
    return errors.rateLimit("Too many wizard events for this session");
  }

  // 4. Resolve the optional authenticated user. Don't require it —
  //    anonymous wizard sessions are the majority of inserts.
  //    The RLS INSERT policy enforces user_id IS NULL OR
  //    user_id = auth.uid(), so we pass through auth.uid() when present
  //    and trust the DB to reject mismatches.
  const supabase = await createClient();
  let userId: string | null = null;
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    userId = user?.id ?? null;
  } catch {
    // Auth lookup failure shouldn't drop the event. Insert anon.
    userId = null;
  }

  // 4a. Day-4 bug fix (P2.6, server-side backstop): client-side React
  //     ref guards are unreliable here — Suspense flicker, route-level
  //     remounts, and parent key changes all defeat per-instance refs.
  //     Live verification showed 4 inserts per page load even with the
  //     ref in place. Server-side dedupe is bulletproof: skip inserts
  //     for (session_id, step) within a 5-second window. Real step
  //     transitions are >5s apart (a user has to read + interact); a
  //     remount-driven re-fire is always sub-second.
  //
  //     This is a soft dedupe (SELECT-then-INSERT) — it could race with
  //     a concurrent insert across two function instances, but the
  //     worst-case is 2 rows instead of 4, still a massive improvement
  //     for funnel-arithmetic purposes. A hard dedupe via UNIQUE
  //     constraint on (session_id, step, minute_bucket) is the
  //     follow-up if this proves insufficient.
  const { data: recentRow } = await supabase
    .from("wizard_step_events")
    .select("id")
    .eq("session_id", sessionId)
    .eq("step", body.step)
    .gt("created_at", new Date(Date.now() - 5_000).toISOString())
    .limit(1)
    .maybeSingle();
  if (recentRow) {
    return new NextResponse(null, { status: 204 });
  }

  // 5. Insert. Fire-and-forget from the client's perspective, but we
  //    do await here so the DB error path surfaces in server logs +
  //    Sentry rather than being swallowed.
  const { error } = await supabase.from("wizard_step_events").insert({
    session_id: sessionId,
    user_id: userId,
    step: body.step,
    destination: body.destination ?? null,
    duration_days: body.duration_days ?? null,
    group_size: body.group_size ?? null,
    backpacker_mode: body.backpacker_mode ?? null,
    locale: body.locale ?? null,
  });

  if (error) {
    console.error("[wizard-event] insert failed:", error);
    // Non-fatal for the client — but return 500 so Sentry/Vercel
    // surfaces the failure. The wizard swallows non-2xx anyway.
    return errors.internal("Failed to record wizard event", "wizard-event");
  }

  // 204 No Content — keep the fire-and-forget response as small as
  // possible. The client doesn't read the body.
  return new NextResponse(null, { status: 204 });
}
