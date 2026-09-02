-- Why a generation failed, as a groupable column.
--
-- `generation_failed` (20260902200000) says a generation came back an error.
-- On its own that only replaces one unanswerable question with another, since
-- the buckets imply completely different fixes:
--
--   validation  we sent something the server refuses — OUR bug, because the
--               client is supposed to mirror those rules. The >100-character
--               destination shipped in this same PR was exactly this, and it
--               accounted for 8 of the 22 dead-end sessions in 30 days.
--   rate_limit  the anonymous cap doing its job; a product decision.
--   timeout     the model took too long.
--   network     the request never completed.
--   upstream    the server or the model errored.
--   unknown     none of the above. If this bucket grows, the list is wrong.
--
-- CHECK-constrained rather than free text on purpose: an open column fills
-- with model prose and stops being groupable, which is the whole reason it
-- exists. Kept in lockstep with GenerationFailureCode in
-- lib/wizard/generation-failure.ts and the zod enum in
-- app/api/wizard-event/route.ts.
--
-- Nullable, and null for every other step.

ALTER TABLE public.wizard_step_events
  ADD COLUMN IF NOT EXISTS failure_code text;

ALTER TABLE public.wizard_step_events
  DROP CONSTRAINT IF EXISTS wizard_step_events_failure_code_check;

ALTER TABLE public.wizard_step_events
  ADD CONSTRAINT wizard_step_events_failure_code_check CHECK (
    failure_code IS NULL OR failure_code IN (
      'validation', 'rate_limit', 'timeout', 'network', 'upstream', 'unknown'
    )
  );
