-- Draft recovery becomes measurable: 'draft_restored' and 'draft_expired'.
--
-- The signed-out itinerary lives in a localStorage draft. Until 2026-09-02 the
-- wizard auto-restored it ONLY when `pendingTripGeneration` was set — a flag
-- written in exactly four places, all inside AuthPromptModal. Every other path
-- back into an account (the header Sign-in, /auth/login, a magic link, a
-- return the next day) landed on a blank wizard with the itinerary sitting
-- unread beside it. Measured over 30 days: 96 signed-out result sessions end
-- with a signed-in user on the same session cookie, and 13 of those users
-- finished with no trip at all.
--
-- Nothing server-side recorded a restore, so neither the loss nor the fix
-- could be seen in the consent-free funnel. These two steps close that.
--
-- The step vocabulary is duplicated in THREE places that must stay in lockstep:
--   1. WizardEventStep union  — components/wizard/wizardEvents.ts
--   2. STEP_VALUES zod enum   — app/api/wizard-event/route.ts
--   3. this CHECK constraint  — here
-- A value missing from (3) fails the insert; missing from (2) 400s the API.
-- Modeled on 20260703_wizard_event_step1_heartbeat.sql.

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
    'draft_expired'
  ));
