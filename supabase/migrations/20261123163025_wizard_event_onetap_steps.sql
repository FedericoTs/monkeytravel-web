-- Three steps for Google's one-tap in the sign-in box that opens on a
-- signed-out Save (lib/auth/google-one-tap.ts):
--   'auth_onetap_offered'    Google's script loaded and the prompt was asked for
--                            (with the browser's own prompt the page can't see
--                            whether it showed, so this counts the asks)
--   'auth_onetap_signed_in'  the tapped account's credential signed them in
--   'auth_onetap_failed'     signing in with that credential failed
--
-- Without them a one-tap save would read as a box that closed with nothing
-- pressed, the very group this is meant to win back.
--
-- The vocabulary lives in two places that must stay in lockstep:
--   1. WIZARD_EVENT_STEPS in components/wizard/wizardEvents.ts, which the API's
--      zod enum reads and a test compares with the newest of these migrations
--   2. this CHECK constraint

ALTER TABLE public.wizard_step_events
  DROP CONSTRAINT IF EXISTS wizard_step_events_step_check;

ALTER TABLE public.wizard_step_events
  ADD CONSTRAINT wizard_step_events_step_check
  CHECK (step IN (
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
    'generation_capped',
    'auth_modal_shown',
    'otp_requested',
    'otp_link_opened',
    'otp_code_submitted',
    'otp_code_verified',
    'auth_google_pressed',
    'auth_modal_closed',
    'auth_onetap_offered',
    'auth_onetap_signed_in',
    'auth_onetap_failed'
  ));
