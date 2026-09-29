-- The anonymous free-generation cap becomes a funnel step: 'generation_capped'.
--
-- Until now the refusal wrote no row of its own. The wizard returns before its
-- failure path runs, so a capped session showed `generating` followed a moment
-- later by `auth_modal_shown`, and the daily funnel read that pair as a
-- generation that silently failed. It could only be inferred by hand from the
-- timing of the two rows.
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
    'otp_code_verified'
  ));
