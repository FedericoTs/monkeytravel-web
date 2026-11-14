-- Which way a saved trip was deleted, and which planner field a session was on.
-- Both NULL on older rows. The checks are NOT VALID: they hold for every new
-- row without reading the old ones, which are all NULL.

ALTER TABLE public.trip_deletion_feedback ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE public.trip_deletion_feedback DROP CONSTRAINT IF EXISTS trip_deletion_feedback_source_check;
ALTER TABLE public.trip_deletion_feedback
  ADD CONSTRAINT trip_deletion_feedback_source_check
  CHECK (source IS NULL OR source IN ('my_trips', 'start_over')) NOT VALID;
COMMENT ON COLUMN public.trip_deletion_feedback.source IS
  'Where the trip was deleted: my_trips (the card''s delete) or start_over (the planner''s Start over). NULL on older rows.';

ALTER TABLE public.wizard_step_events ADD COLUMN IF NOT EXISTS field text;
ALTER TABLE public.wizard_step_events DROP CONSTRAINT IF EXISTS wizard_step_events_field_check;
ALTER TABLE public.wizard_step_events
  ADD CONSTRAINT wizard_step_events_field_check
  CHECK (field IS NULL OR field IN (
    'destination_autocomplete', 'destination_pill', 'start_date', 'end_date', 'vibe', 'budget',
    'pace', 'requirements', 'flexible_dates', 'express_plan', 'read_request'
  )) NOT VALID;
COMMENT ON COLUMN public.wizard_step_events.field IS
  'The planner field: on step1_heartbeat rows the one the session was on last, on abandoned rows the one it touched last. NULL otherwise.';

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
