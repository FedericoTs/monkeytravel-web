-- wizard_step_events_human carries the step-1 attribution columns.
--
-- The view expands w.* when it is created, so the referrer and utm_source
-- columns added to the table afterwards never reached it, and funnel reads
-- could not see where a session came from. Recreating it appends them; the
-- grants and the comment stay. components/wizard/wizardEvents.vitest.ts now
-- fails when a migration adds a column without recreating the view.

create or replace view public.wizard_step_events_human as
  select w.*
  from public.wizard_step_events w
  where not exists (
    select 1 from public.page_view_session_labels l
    where l.session_id = w.session_id
      and l.day = w.created_at::date
      and l.is_automation
  );
