-- Which generation a `generation_failed` row waited for, and for how long.
--
-- The wizard sends an id with each generation request (lib/ai/generation-id.ts)
-- and the server logs it in api_request_logs.request_params.generation_id, so a
-- failure on the client joins to the server's own row: did the server finish
-- (and the answer got lost on the way), fail, or never hear of it?
-- FORWARD-ONLY: earlier rows stay NULL.

ALTER TABLE public.wizard_step_events
  ADD COLUMN IF NOT EXISTS request_id uuid,
  ADD COLUMN IF NOT EXISTS elapsed_ms integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'wizard_step_events_elapsed_ms_check'
  ) THEN
    ALTER TABLE public.wizard_step_events
      ADD CONSTRAINT wizard_step_events_elapsed_ms_check
      CHECK (elapsed_ms IS NULL OR elapsed_ms BETWEEN 0 AND 86400000);
  END IF;
END $$;

COMMENT ON COLUMN public.wizard_step_events.request_id IS
  'Generation id the wizard sent (api_request_logs.request_params.generation_id), on generation_failed rows. NULL otherwise.';
COMMENT ON COLUMN public.wizard_step_events.elapsed_ms IS
  'Milliseconds from the start of the generation to the failure, on generation_failed rows. NULL otherwise.';

-- The view expands w.* when it is created, so it is recreated to carry the
-- new columns; the grants and the comment stay.
create or replace view public.wizard_step_events_human as
  select w.*
  from public.wizard_step_events w
  where not exists (
    select 1 from public.page_view_session_labels l
    where l.session_id = w.session_id
      and l.day = w.created_at::date
      and l.is_automation
  );
