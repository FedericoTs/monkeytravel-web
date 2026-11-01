// components/wizard/wizardEvents.ts
//
// Shared, module-scoped wizard funnel telemetry. It lives outside the
// [locale] route folder because the wizard and
// components/ui/AuthPromptModal.tsx both import it.
//
// MUST stay module-scoped (never nested in a component) — the wizard's
// step-view effect relies on a stable function identity so it doesn't
// invalidate effect deps that pass it around.
//
// WIZARD_EVENT_STEPS below feeds the /api/wizard-event zod enum, and the test
// beside this file checks it against the wizard_step_events_step_check CHECK
// constraint in the newest migration. Adding a step means one entry here plus
// a migration. The decision-arm values stay for the rows already written.

// front_door: every row is stamped "wizard". The value comes from the
// front-door experiment (wizard vs decision-first, whose decision arm is
// gone) and stays because the funnel SQL (get_ux10x_rates,
// get_live_trip_baseline) and PostHog insights filter on it. The DB CHECK
// only allows ('wizard' | 'decision') — never send another value or the
// insert fails with a non-23505 error (NOT swallowed as dedupe) → 500.
const FRONT_DOOR = "wizard" as const;

// step1_variant is no longer sent: step 1 has one version. The API still
// accepts the field so older cached bundles that send it keep posting cleanly.

export const WIZARD_EVENT_STEPS = [
  "step_1_destination_dates",
  // A 10s dwell heartbeat while a session sits on step 1, which tells a
  // bounce from a struggle. Each beat is its own row: 10s spacing never hits
  // the 1s dedupe bucket.
  "step1_heartbeat",
  "step_2_vibes",
  "generating",
  "result",
  // Decision-first arm (retired; kept for its rows + the DB CHECK):
  "options_requested", // decide-LLM call dispatched (≈ generating)
  "options_shown", // 2-3 proposals rendered (decision arm's first value)
  "first_value", // shared cross-arm "first magical output"
  "save_clicked",
  "save_blocked_anon",
  "save_failed",
  "saved",
  "abandoned",
  // Draft recovery. The generated itinerary lives in a localStorage draft;
  // these record a draft restored into the wizard, or one that had expired.
  "draft_restored",
  "draft_expired",
  // A generation that reached the server and came back an error.
  // `abandoned` cannot follow `generating`, so without this a failure and a
  // closed tab would look the same: no row.
  "generation_failed",
  // The anonymous free-generation cap. Without its own row, the refusal
  // would read as `generating` then `auth_modal_shown`: a generation that
  // silently failed.
  "generation_capped",
  // The steps from a signed-out Save click to an account. They tell apart
  // someone who never typed an address, one whose link never arrived, and one
  // who opened it and still got no session.
  "auth_modal_shown",
  "otp_requested",
  // Written server-side by the auth callback — see lib/analytics/wizard-event-server.ts.
  "otp_link_opened",
  // The in-tab code redemption. These two split "typed the code" from "the
  // code worked", so a failure to redeem is never mistaken for someone who
  // simply walked away.
  "otp_code_submitted",
  "otp_code_verified",
] as const;

export type WizardEventStep = (typeof WIZARD_EVENT_STEPS)[number];

/**
 * Where this wizard document came from, for the step-1 row: the referrer's
 * host and path (no query, which can carry tokens) and the URL's utm_source.
 * document.referrer is the referrer of the page load, so after an in-app
 * navigation it still names the outside source that brought the session in.
 */
export function landingAttribution(): { referrer?: string; utm_source?: string } {
  if (typeof window === "undefined") return {};
  const out: { referrer?: string; utm_source?: string } = {};
  try {
    if (document.referrer) {
      const ref = new URL(document.referrer);
      out.referrer = `${ref.host}${ref.pathname}`.slice(0, 256);
    }
  } catch {
    // An unparsable referrer is not worth an event.
  }
  const source = new URLSearchParams(window.location.search).get("utm_source")?.trim();
  if (source) out.utm_source = source.slice(0, 64);
  return out;
}

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
