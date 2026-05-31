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

// In-memory per-session rate limit. 60 events/min/session is plenty for
// the legitimate wizard flow (which fires maybe 7 events total over a
// 5-minute session). The bucket exists to catch a stuck React effect
// or a malicious client looping the endpoint.
//
// NOTE: lib/api/rate-limit.ts is IP-keyed and Upstash-backed. For this
// route we want SESSION-keyed buckets, which Upstash doesn't help with
// any more than an in-memory Map — every Vercel function instance will
// see the same sticky session anyway because session_id is cookie-bound.
// We accept best-effort cross-instance enforcement and keep the limiter
// local + zero-dep.
type RateBucket = { count: number; resetAt: number };
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60 * 1000;
const buckets = new Map<string, RateBucket>();

function checkRateLimit(sessionId: string): boolean {
  const now = Date.now();
  const bucket = buckets.get(sessionId);
  if (!bucket || now > bucket.resetAt) {
    buckets.set(sessionId, { count: 1, resetAt: now + RATE_WINDOW_MS });
    // Lazy GC: bound the Map size by sweeping expired entries when we
    // mint a new bucket. Cheap (Map iteration over ~few hundred items).
    if (buckets.size > 5_000) {
      for (const [k, v] of buckets) {
        if (now > v.resetAt) buckets.delete(k);
      }
    }
    return true;
  }
  if (bucket.count >= RATE_LIMIT) return false;
  bucket.count++;
  return true;
}

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

  // 3. Per-session rate limit.
  if (!checkRateLimit(sessionId)) {
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
