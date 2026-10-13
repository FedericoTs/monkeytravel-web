-- Which result screen a session saw in the crew-first test, recorded first-party.
--
-- The test (lib/experiments/result-crew-first.ts) splits signed-out planners
-- of group trips 50/50 between today's result screen (control) and one that
-- leads with the crew vote (crew_first). PostHog flags load only after cookie
-- consent, so the arm is drawn in the browser and written here, on the
-- session's `result` row; shares (funnel_events.share_link_created) and saves
-- (step = 'saved') join to it by session_id.
--
-- A pinned arm (the NEXT_PUBLIC_RESULT_CREW_FIRST off switch, or the
-- ?result_variant= QA link) is shown but never written, so every non-NULL row
-- was assigned at random. FORWARD-ONLY: earlier rows stay NULL.

ALTER TABLE public.wizard_step_events
  ADD COLUMN IF NOT EXISTS result_variant text;

-- Closed vocabulary, kept in lockstep with RESULT_VARIANTS and the zod enum in
-- app/api/wizard-event/route.ts.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'wizard_step_events_result_variant_check'
  ) THEN
    ALTER TABLE public.wizard_step_events
      ADD CONSTRAINT wizard_step_events_result_variant_check
      CHECK (result_variant IS NULL OR result_variant IN ('control', 'crew_first'));
  END IF;
END $$;

COMMENT ON COLUMN public.wizard_step_events.result_variant IS
  'Result-screen arm in the crew-first test (control|crew_first), on result rows of assigned sessions only. NULL otherwise.';

CREATE INDEX IF NOT EXISTS wizard_step_events_result_variant_idx
  ON public.wizard_step_events (result_variant, created_at DESC)
  WHERE result_variant IS NOT NULL;

-- The view expands w.* when it is created, so it is recreated to carry the
-- new column; the grants and the comment stay.
create or replace view public.wizard_step_events_human as
  select w.*
  from public.wizard_step_events w
  where not exists (
    select 1 from public.page_view_session_labels l
    where l.session_id = w.session_id
      and l.day = w.created_at::date
      and l.is_automation
  );
