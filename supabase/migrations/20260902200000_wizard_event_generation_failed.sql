-- A failed generation becomes a fact the funnel records: 'generation_failed'.
--
-- 22 sessions in the 30 days to 2026-09-02 reached `generating` and never
-- reached `result`. Nothing distinguished them from someone closing the tab:
-- `abandoned` cannot follow `generating` (the wizard sets wizardCompletedRef
-- before the request fires) and no failure step existed. So the dead end was
-- countable in aggregate and diagnosable in none of its parts.
--
-- The row carries a failure_code (validation | rate_limit | timeout | network
-- | upstream | unknown — see lib/wizard/generation-failure.ts) because the
-- buckets imply different fixes. `validation` in particular means the CLIENT
-- sent something the server refuses, which is our bug: the >100-character
-- destination that this migration ships alongside was exactly that, and it
-- accounted for 8 of the 22.
--
-- The step vocabulary is duplicated in THREE places that must stay in lockstep:
--   1. WizardEventStep union  — components/wizard/wizardEvents.ts
--   2. STEP_VALUES zod enum   — app/api/wizard-event/route.ts
--   3. this CHECK constraint  — here
-- A value missing from (3) fails the insert; missing from (2) 400s the API.

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
    'generation_failed'
  ));
