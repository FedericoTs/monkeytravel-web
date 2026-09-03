-- Which step-1 arm a wizard session actually saw, recorded first-party.
--
-- WHY
-- ---
-- FLAG_WIZARD_STEP1_EDITORIAL is due for review 2026-09-09, and as of today
-- the arm a session saw exists ONLY as a PostHog property (`step1_variant`,
-- registered in NewTripWizard). PostHog captures ~59% of sessions at best and
-- skews toward converters, so the one number the review turns on is missing
-- for roughly four sessions in ten, non-randomly.
--
-- Without this column the review can only be a PRE/POST comparison, which the
-- traffic shift of 2026-08-17 already showed is treacherous here: the raw
-- step-1→step-2 rate reads 31.2% before and 41.3% after (a large "win"),
-- while the dwell-qualified rate reads 74.5% (n=745) before and 69.0% (n=42)
-- after — flat to slightly down. Same product, opposite verdicts, and the
-- difference is entirely denominator pollution.
--
-- A SECOND PROBLEM THIS MAKES VISIBLE
-- -----------------------------------
-- resolveEditorialStep1() returns `flagValue !== false` — it FAILS OPEN. Any
-- session where PostHog does not resolve (consent declined, script blocked,
-- network) lands in the EDITORIAL arm. The arms are therefore not comparable
-- populations: "classic" means "PostHog resolved and returned false", which
-- selects for consenting, unblocked users, while "editorial" is everyone
-- else plus the assigned-true group.
--
-- This column does not fix that bias. It makes it MEASURABLE — the split
-- between arms is currently unknown from first-party data, and after this it
-- is one GROUP BY. Read it before trusting any arm comparison.
--
-- FORWARD-ONLY: sessions before this ships have NULL and cannot be
-- reclassified.

ALTER TABLE public.wizard_step_events
  ADD COLUMN IF NOT EXISTS step1_variant text;

-- Closed vocabulary, same reasoning as front_door and failure_code: an open
-- string stops being groupable. Kept in lockstep with Step1Variant in
-- components/wizard/wizardEvents.ts and the zod enum in
-- app/api/wizard-event/route.ts — a value outside this set makes the insert
-- fail with a NON-23505 error, which the route does NOT swallow as a dedupe,
-- so it would surface as a 500 rather than a silent drop.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'wizard_step_events_step1_variant_check'
  ) THEN
    ALTER TABLE public.wizard_step_events
      ADD CONSTRAINT wizard_step_events_step1_variant_check
      CHECK (step1_variant IS NULL OR step1_variant IN ('editorial', 'classic'));
  END IF;
END $$;

COMMENT ON COLUMN public.wizard_step_events.step1_variant IS
  'Step-1 arm this session saw (editorial|classic). NULL for rows written before 2026-09-03 and for steps that do not carry it. Assignment fails OPEN to editorial, so the arms are not comparable populations — see the migration header.';

-- The review query groups sessions by arm over a date window.
CREATE INDEX IF NOT EXISTS wizard_step_events_step1_variant_idx
  ON public.wizard_step_events (step1_variant, created_at DESC)
  WHERE step1_variant IS NOT NULL;
