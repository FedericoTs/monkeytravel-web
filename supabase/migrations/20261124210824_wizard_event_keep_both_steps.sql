-- Three steps for the card that asks a signed-out planner to sign in when they
-- start a second trip in the same visit ("Keep both trips: sign in free"):
--   'keep_both_shown'      the card showed while the second trip was being made
--   'keep_both_signed_in'  they signed in from it
--   'keep_both_dismissed'  they pressed "Not now"
--
-- Without them the card's own effect can't be told apart from the Save box's:
-- of the planners asked, how many signed in, how many said not now, how many
-- did neither.
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
    'auth_onetap_failed',
    'keep_both_shown',
    'keep_both_signed_in',
    'keep_both_dismissed'
  ));
