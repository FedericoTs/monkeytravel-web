-- The sky test: the plan drawn as a sky ('sky') against the classic result
-- screen ('classic'), on result rows of randomly assigned sessions
-- (lib/experiments/result-sky.ts). Its own arm names, so its rows never mix
-- with the retired crew-first test's ('control' | 'crew_first'), which stay
-- valid. Kept in lockstep with the result_variant field in
-- app/api/wizard-event/route.ts.
ALTER TABLE public.wizard_step_events
  DROP CONSTRAINT IF EXISTS wizard_step_events_result_variant_check;

ALTER TABLE public.wizard_step_events
  ADD CONSTRAINT wizard_step_events_result_variant_check
  CHECK (result_variant IS NULL OR result_variant IN ('control', 'crew_first', 'classic', 'sky')) NOT VALID;

ALTER TABLE public.wizard_step_events
  VALIDATE CONSTRAINT wizard_step_events_result_variant_check;

COMMENT ON COLUMN public.wizard_step_events.result_variant IS
  'Result-screen arm of a test, on result rows of randomly assigned sessions only: the crew-first test (control|crew_first) or the sky test (classic|sky). NULL otherwise.';
