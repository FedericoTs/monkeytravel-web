-- Decision-first front-door A/B (flag: front-door) — extend wizard_step_events.
-- Plan: docs/DECISION_FRONT_DOOR_PLAN.md
--
-- Two additive changes + one pre-existing-bug fix. ZERO risk to existing rows:
-- the new column is nullable and the CHECK only becomes MORE permissive.
--
-- 1) front_door arm column — tags each event with the A/B arm ('wizard' |
--    'decision') so the funnel is sliceable by arm in SQL. NULL for the
--    historical/pre-experiment wizard baseline.
--
-- 2) New decision-arm step values in the CHECK enum:
--      - options_requested : decide-LLM call dispatched (≈ 'generating')
--      - options_shown     : 2-3 proposals rendered (decision arm's first-value)
--      - first_value       : shared cross-arm "first magical output" event —
--                            the wizard fires it alongside 'result', the decision
--                            arm alongside 'options_shown'. Gives a single
--                            arm-agnostic survival numerator with no CASE.
--
-- 3) BUG FIX (CHECK drift): 'save_blocked_anon' and 'save_failed' were already
--    fired by the client + accepted by /api/wizard-event's zod enum, but were
--    NEVER in this table's CHECK constraint — so every such insert failed with a
--    CHECK violation (not 23505, so not dedupe-success) → 500 → the client
--    swallowed it → those two steps NEVER persisted to Supabase (PostHog only).
--    Adding them here makes the save funnel comparable across arms in SQL.

-- 1) Arm column
ALTER TABLE public.wizard_step_events
  ADD COLUMN IF NOT EXISTS front_door TEXT
  CHECK (front_door IN ('wizard', 'decision'));

-- 2) + 3) Rebuild the step CHECK (the original was an unnamed inline constraint;
-- Postgres auto-named it wizard_step_events_step_check).
ALTER TABLE public.wizard_step_events
  DROP CONSTRAINT IF EXISTS wizard_step_events_step_check;

ALTER TABLE public.wizard_step_events
  ADD CONSTRAINT wizard_step_events_step_check CHECK (step IN (
    'step_1_destination_dates',
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
    'abandoned'
  ));

COMMENT ON COLUMN public.wizard_step_events.front_door IS
  'A/B arm that produced this event (front-door flag): wizard | decision. NULL = pre-experiment baseline.';
