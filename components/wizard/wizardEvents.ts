// components/wizard/wizardEvents.ts
//
// Shared, module-scoped wizard funnel telemetry. Hoisted OUT of
// NewTripWizard.tsx (was its lines 165-190) when the decision-first arm
// shared the funnel (2026-07 → 2026-08; the arm was deleted 2026-09-18). It
// stays here because the wizard and components/ui/AuthPromptModal.tsx both
// import it without a bracketed [locale] path.
//
// MUST stay module-scoped (never nested in a component) — the wizard's
// step-view effect relies on a stable function identity so it doesn't
// invalidate effect deps that pass it around (load-bearing note originally at
// NewTripWizard.tsx 154-164).
//
// The step union + the /api/wizard-event zod enum + the
// wizard_step_events_step_check CHECK constraint are THREE copies of one list.
// Adding a step means editing all three. The decision-arm values below stay in
// all three for the rows written during the 2026-07 → 2026-08 experiment.

// front_door: every row is stamped "wizard". The value dates from the
// front-door A/B (wizard vs decision-first, 2026-07-01 → 2026-08-17; the
// decision arm was deleted 2026-09-18) and stays because the funnel SQL
// (get_ux10x_rates, get_live_trip_baseline) and the experiment-era PostHog
// insights filter on it. The DB CHECK only allows ('wizard' | 'decision') —
// never send another value or the insert fails with a non-23505 error (NOT
// swallowed as dedupe) → 500.
const FRONT_DOOR = "wizard" as const;

// step1_variant (2026-09-03 → 2026-09-16) rode step_1_destination_dates and
// step1_heartbeat while wizard-step1-editorial-v1 was split; the editorial
// step 1 is the only one now, so nothing sends it. The API still accepts the
// field so bundles cached from before the ramp keep posting cleanly.

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
  // Decision-first arm (retired 2026-09-18; kept for its rows + the DB CHECK):
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
 * front_door is a top-level body field (sibling of `step`) and is always
 * "wizard" now — see FRONT_DOOR above. Keep `extra` small — keepalive
 * requests are capped at ~64 KB.
 */
export async function trackWizardEvent(
  step: WizardEventStep,
  extra: Record<string, unknown> = {}
): Promise<void> {
  try {
    await fetch("/api/wizard-event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        step,
        front_door: FRONT_DOOR,
        ...extra,
      }),
      keepalive: true,
    });
  } catch {
    // Swallow — telemetry must never break the wizard.
  }
}
