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
  // Decision-first front-door arm (docs/DECISION_FRONT_DOOR_PLAN.md):
  "options_requested", // decide LLM call dispatched (≈ generating)
  "options_shown", // 2-3 proposals rendered (the decision arm's first-value)
  "first_value", // shared cross-arm "first magical output" (wizard fires alongside result)
  "save_clicked",
  "save_blocked_anon",
  "save_failed",
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
  // Which front-door arm fired this event (front-door A/B). Nullable for the
  // pre-experiment wizard baseline; the decision arm always sends it.
  front_door: z.enum(["wizard", "decision"]).optional(),
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
// Day-4 P2.5 follow-up: the session-keyed bucket originally lived in a
// per-process in-memory Map. On Vercel each lambda instance has its own
// Map, so 71 sequential POSTs with the same mt_session_id distributed
// across N cold-start instances all returned 204 (Task #208 had already
// proven this pattern doesn't work). Replaced with a SECOND createRateLimiter
// call that shares the Upstash backend with the IP-keyed one — bucket
// state is now consistent across function instances.
//
// Fix: keep the session-keyed bucket (catches a single legitimate user
// in a stuck React effect loop) AND add a per-IP bucket via the shared
// Upstash limiter (catches the cookie-rotation bypass). Both are now
// Upstash-backed via createRateLimiter; we pass an explicit customKey
// for the session limiter so it keys on session_id instead of the
// caller IP. The stricter of the two fires. IP bucket is generous
// (300/min) because legitimate shared NAT (offices, cafes) can run
// multiple wizard sessions in parallel — 300/min still cuts the attack
// at ~1/200 of its open rate.
const ipLimiter = createRateLimiter("wizard-event-ip", 300, 60 * 1000);
const sessionLimiter = createRateLimiter(
  "wizard-event-session",
  60,
  60 * 1000
);

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
  //    effect loop). Stricter of the two fires. Both buckets share
  //    Upstash state across Vercel function instances — the session
  //    limiter takes an explicit customKey so it doesn't default to
  //    the caller IP.
  const ipCheck = await ipLimiter.check(request);
  if (!ipCheck.allowed) {
    return errors.rateLimit("Too many wizard events from this IP");
  }
  const sessionCheck = await sessionLimiter.check(request, sessionId);
  if (!sessionCheck.allowed) {
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

  // 5. Insert with atomic DB-level dedupe.
  //
  //    Day-4 P2.6 first tried a client-side ref guard, then a server-
  //    side SELECT-then-INSERT. Both failed: the SELECT-then-INSERT
  //    raced across parallel function instances (3 sequential POSTs
  //    within 1.14s in prod all read "no recent row" and all inserted
  //    because none of the prior INSERTs had committed yet by the time
  //    their SELECTs ran).
  //
  //    Day-5 fix: atomic UNIQUE constraint on
  //    (session_id, step, dedupe_bucket) where dedupe_bucket is a
  //    1-second integer epoch bucket auto-populated by a BEFORE INSERT
  //    trigger (set_wizard_dedupe_bucket — see
  //    supabase/migrations/20260531_wizard_step_events_atomic_dedupe.sql).
  //
  //    We do NOT write dedupe_bucket from here — the trigger owns it.
  //    The .insert() call below is rejected by the unique index
  //    (SQLSTATE 23505) on every duplicate within the same second. We
  //    treat that rejection as success (return 204) because dedupe-as-
  //    success is the contract we want: the row is already there,
  //    funnel state is correct, the wizard sees the same 204 it would
  //    have seen for a real insert.
  //
  //    Why not .upsert({...}, { onConflict: '...', ignoreDuplicates: true })?
  //    The conflict column (dedupe_bucket) is set by the trigger, not
  //    by the client payload. Supabase JS's .upsert() resolves the
  //    conflict-target columns against the payload it ships; with
  //    dedupe_bucket missing from the payload, the upsert doesn't know
  //    what to conflict on. .insert() + catch-23505 is the correct
  //    shape here.
  const { error } = await supabase.from("wizard_step_events").insert({
    session_id: sessionId,
    user_id: userId,
    step: body.step,
    destination: body.destination ?? null,
    duration_days: body.duration_days ?? null,
    group_size: body.group_size ?? null,
    backpacker_mode: body.backpacker_mode ?? null,
    locale: body.locale ?? null,
    front_door: body.front_door ?? null,
  });

  if (error) {
    // Postgres unique_violation — the trigger + index just dedup'd a
    // concurrent or near-concurrent duplicate insert. That's the
    // expected happy path for the bug we're fixing here. Return 204
    // so the wizard sees "success" exactly as it would for a real
    // insert, and don't log (these will dominate the 4xx-ish signals
    // on this route and we don't want to flood Sentry).
    if (error.code === "23505") {
      return new NextResponse(null, { status: 204 });
    }
    console.error("[wizard-event] insert failed:", error);
    // Non-fatal for the client — but return 500 so Sentry/Vercel
    // surfaces the failure. The wizard swallows non-2xx anyway.
    return errors.internal("Failed to record wizard event", "wizard-event");
  }

  // 204 No Content — keep the fire-and-forget response as small as
  // possible. The client doesn't read the body.
  return new NextResponse(null, { status: 204 });
}
