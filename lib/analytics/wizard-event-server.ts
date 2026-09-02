/**
 * Server-side writer for wizard_step_events.
 *
 * The client has trackWizardEvent (components/wizard/wizardEvents.ts), which
 * POSTs to /api/wizard-event. Some steps can only be known on the server —
 * `otp_link_opened` fires in the auth callback, where the browser that clicked
 * the emailed link arrives with nothing but its cookies.
 *
 * Consent-free by construction: this writes the same session-keyed row the
 * rest of the wizard funnel uses, and never touches PostHog. Consent defaults
 * to false for most visitors, so anything gated on it cannot answer questions
 * about the people who did not convert — which is exactly who this is for.
 *
 * Fire-and-forget, and it swallows every error: telemetry must never break an
 * auth callback. Schedule it with `after()` from next/server rather than a
 * bare `void` — a route that returns immediately can be frozen before the
 * insert lands, which is how the `trip_claimed` row went missing in
 * production on 2026-09-02 (fixed in #94).
 */
import { createAdminClient } from "@/lib/supabase/admin";

export interface WizardStepServerInput {
  /** Must exist in all THREE copies of the step vocabulary. */
  step: string;
  /** From the mt_session_id cookie. Null means the row cannot be joined; skip it. */
  sessionId: string | null | undefined;
  userId?: string | null;
  locale?: string | null;
}

export async function logWizardStepServer(input: WizardStepServerInput): Promise<void> {
  // "no_session" is what middleware hands a filtered visitor; a row keyed to
  // it joins to everyone and therefore to no one.
  if (!input.sessionId || input.sessionId === "no_session") return;
  try {
    const supabase = createAdminClient();
    // dedupe_bucket is filled by the set_wizard_dedupe_bucket trigger, and the
    // unique index on (session_id, step, dedupe_bucket) makes a duplicate a
    // 23505 rather than a second row — which is the desired outcome here, so
    // the error is swallowed like any other.
    await supabase.from("wizard_step_events").insert({
      session_id: input.sessionId,
      step: input.step,
      user_id: input.userId ?? null,
      locale: input.locale ?? null,
    });
  } catch {
    // never break the caller
  }
}
