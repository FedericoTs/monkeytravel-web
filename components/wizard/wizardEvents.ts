// components/wizard/wizardEvents.ts
//
// Shared, module-scoped wizard funnel telemetry. Hoisted OUT of
// NewTripWizard.tsx (was its lines 165-190) so BOTH the classic wizard and
// the decision-first arm (components/wizard/DecisionIntake.tsx) fire the exact
// same server-side funnel events into wizard_step_events. Placed here (not in
// the [locale] route dir) so both consumers import it without a bracketed
// path: the wizard via "@/components/wizard/wizardEvents", DecisionIntake via
// "./wizardEvents".
//
// MUST stay module-scoped (never nested in a component) — the wizard's
// step-view effect relies on a stable function identity so it doesn't
// invalidate effect deps that pass it around (load-bearing note originally at
// NewTripWizard.tsx 154-164).
//
// The step union + the /api/wizard-event zod enum + the
// wizard_step_events_step_check CHECK constraint are THREE copies of one list.
// Adding a step means editing all three. As of Phase 0 (front-door A/B) all
// three already carry the decision-arm values below; this file mirrors them.

/**
 * The front-door A/B arm that produced an event. Threaded through every call so
 * the funnel is sliceable by arm in SQL (the wizard_step_events.front_door
 * column) and in PostHog (super-property; see NewTripWizard posthog.register).
 * The DB CHECK is only ('wizard' | 'decision') — never send another value or
 * the insert fails with a non-23505 error (NOT swallowed as dedupe) → 500.
 */
export type FrontDoorArm = "wizard" | "decision";

/**
 * Which step-1 arm the session saw (FLAG_WIZARD_STEP1_EDITORIAL).
 *
 * Threaded server-side because it previously existed ONLY as a PostHog
 * property, and PostHog captures ~59% of sessions and skews to converters —
 * so the single number the 2026-09-09 flag review turns on was missing for
 * about four sessions in ten, non-randomly.
 *
 * Caveat worth carrying to the review: assignment FAILS OPEN (see
 * resolveEditorialStep1 — `flagValue !== false`), so every session where the
 * flag does not resolve is counted as "editorial". The arms are not
 * comparable populations; this makes the split measurable, not unbiased.
 *
 * Same closed-vocabulary rule as FrontDoorArm: the DB CHECK accepts only
 * ('editorial' | 'classic'), and any other value fails the insert with a
 * non-23505 error the route does NOT swallow → 500.
 */
export type Step1Variant = "editorial" | "classic";

export type WizardEventStep =
  | "step_1_destination_dates"
  // UX10X Phase 0.3: 10s dwell heartbeat while a session sits on step 1.
  // 56% of step-1 abandoner sessions log exactly ONE event, making dwell
  // (bounce vs struggle) unmeasurable — this makes it measurable. Persists as
  // distinct rows (10s spacing never hits the 1s dedupe bucket).
  | "step1_heartbeat"
  | "step_2_vibes"
  | "generating"
  | "result"
  // Decision-first front-door arm (docs/DECISION_FRONT_DOOR_PLAN.md):
  | "options_requested" // decide-LLM call dispatched (≈ generating)
  | "options_shown" // 2-3 proposals rendered (decision arm's first value)
  | "first_value" // shared cross-arm "first magical output"
  | "save_clicked"
  | "save_blocked_anon"
  | "save_failed"
  | "saved"
  | "abandoned"
  // Draft recovery (2026-09-02). The generated itinerary lives in a
  // localStorage draft, and until now it auto-restored ONLY on the Save-modal
  // path; every other way back into an account met a blank wizard. Nothing
  // server-side recorded a restore, so the loss was invisible.
  | "draft_restored"
  | "draft_expired"
  // A generation that reached the server and came back an error (2026-09-02).
  // `abandoned` cannot follow `generating`, so without this a failure and a
  // closed tab were the same row: nothing.
  | "generation_failed"
  // The save-click-to-account step, which the funnel could not see at all
  // (2026-09-02). 186 sessions clicked Save signed out, 87 ended signed in,
  // and the 99 that did not left no trace of WHY: never typed an address,
  // asked for a link that never arrived, or opened it and still got nothing
  // are three different problems that were one number.
  | "auth_modal_shown"
  | "otp_requested"
  // Written server-side by the auth callback — see lib/analytics/wizard-event-server.ts.
  | "otp_link_opened"
  // The in-tab redemption (2026-09-03). Magic-link sign-ups reach a session
  // 63.0% of the time against Google's 99.0% (n=142, p=1.8e-9) because the
  // link means leaving the browser. These two split "typed the code" from
  // "the code worked", so a failure to redeem is never mistaken for someone
  // who simply walked away.
  | "otp_code_submitted"
  | "otp_code_verified";

/**
 * Fire-and-forget POST to /api/wizard-event. Never awaited from a render path,
 * never surfaces its result, swallows every throw. keepalive:true so the
 * "abandoned" event survives a tab close.
 *
 * `frontDoor` is a first-class OPTIONAL 3rd param (not buried in `extra`) so
 * every call site declares which arm it belongs to, and the server contract is
 * matched (front_door is a top-level body field, sibling of `step`). When
 * omitted it is simply not sent (column stays NULL = pre-experiment baseline).
 * Keep `extra` small — keepalive requests are capped at ~64 KB.
 */
export async function trackWizardEvent(
  step: WizardEventStep,
  extra: Record<string, unknown> = {},
  frontDoor?: FrontDoorArm,
  step1Variant?: Step1Variant
): Promise<void> {
  try {
    await fetch("/api/wizard-event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        step,
        ...(frontDoor ? { front_door: frontDoor } : {}),
        ...(step1Variant ? { step1_variant: step1Variant } : {}),
        ...extra,
      }),
      keepalive: true,
    });
  } catch {
    // Swallow — telemetry must never break the wizard.
  }
}
