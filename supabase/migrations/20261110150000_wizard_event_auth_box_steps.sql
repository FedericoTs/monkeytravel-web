-- Two steps inside the sign-in box that opens on a signed-out Save:
-- 'auth_google_pressed' (Continue with Google was pressed) and
-- 'auth_modal_closed' (the box was closed before an email went out or the
-- visitor left for another sign-in path; elapsed_ms is how long it was open).
--
-- Until now the box wrote 'auth_modal_shown' and the email steps only. A
-- Google press and a close reached PostHog alone, which sees only visitors
-- who accepted analytics cookies, so a Save click that ended with no account
-- could not be told apart: closed at once, pressed Google and never came
-- back, or left the page with the box open.
--
-- The vocabulary lives in two places that must stay in lockstep:
--   1. WIZARD_EVENT_STEPS in components/wizard/wizardEvents.ts, which the API's
--      zod enum reads and a test compares with the newest of these migrations
--   2. this CHECK constraint
-- A value missing here fails the insert with a non-23505 error the route does
-- not swallow as a dedupe, so it surfaces as a 500 rather than a silent drop.

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
    'auth_modal_closed'
  ));

COMMENT ON COLUMN public.wizard_step_events.elapsed_ms IS
  'Milliseconds: on generation_failed rows from the start of the generation to the failure, on abandoned rows the wait before leaving, on auth_modal_closed rows how long the sign-in box was open. NULL otherwise.';
