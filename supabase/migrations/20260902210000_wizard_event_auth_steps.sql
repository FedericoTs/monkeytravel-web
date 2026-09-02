-- Make the save-click-to-account step legible: three auth steps.
--
-- Measured over the 30 days to 2026-09-02, consent-free:
--
--   186 sessions clicked Save while signed out
--    87 of them ended signed in
--    77 reached `saved`
--    99 NEVER signed in
--
-- The 99 are the largest unexplained pool left on the activation list, and the
-- funnel cannot say a single thing about them: the only steps their sessions
-- carry are pre-auth ones (step_1, generating, result, save_clicked,
-- save_blocked_anon). Whether they closed the modal without typing an address,
-- asked for a magic link that never arrived, or opened the link and still
-- ended with nothing are three completely different problems — deliverability,
-- copy, or a broken redemption — and today they are one number.
--
--   auth_modal_shown  the ask was actually put in front of them
--   otp_requested     they typed an address and asked for the link
--   otp_link_opened   the emailed link was redeemed (written by the callback)
--
-- All three are keyed to the same mt_session_id the save_clicked row carries,
-- so the drop splits by subtraction. No PostHog: consent defaults to false, so
-- a consent-gated event cannot describe people who did not convert.
--
-- Known limit, deliberately not papered over: `otp_link_opened` is written by
-- the auth callback from the cookie of the browser that opened the LINK. Open
-- it on a phone after requesting it on a laptop and the row lands under a
-- different session and will not join. That absence is itself the cross-device
-- signal (see #86), and it means otp_requested minus otp_link_opened is an
-- UPPER bound on "asked and never opened", not an exact count.
--
-- The step vocabulary is duplicated in THREE places that must stay in lockstep:
--   1. WizardEventStep union  — components/wizard/wizardEvents.ts
--   2. STEP_VALUES zod enum   — app/api/wizard-event/route.ts
--   3. this CHECK constraint  — here

ALTER TABLE public.wizard_step_events
  DROP CONSTRAINT wizard_step_events_step_check;

ALTER TABLE public.wizard_step_events
  ADD CONSTRAINT wizard_step_events_step_check CHECK (step IN (
    'step_1_destination_dates',
    'step1_heartbeat',
    'step_2_vibes',
    'generating',
    'result',
    'options_requested',
    'options_shown',
    'first_value',
    'save_clicked',
    'save_blocked_anon',
    'save_failed',
    'saved',
    'abandoned',
    'draft_restored',
    'draft_expired',
    'generation_failed',
    'auth_modal_shown',
    'otp_requested',
    'otp_link_opened'
  ));
