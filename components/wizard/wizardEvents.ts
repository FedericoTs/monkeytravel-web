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
  | "abandoned";

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
  frontDoor?: FrontDoorArm
): Promise<void> {
  try {
    await fetch("/api/wizard-event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        frontDoor ? { step, front_door: frontDoor, ...extra } : { step, ...extra }
      ),
      keepalive: true,
    });
  } catch {
    // Swallow — telemetry must never break the wizard.
  }
}
