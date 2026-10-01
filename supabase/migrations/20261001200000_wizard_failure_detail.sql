-- generation_failed rows carry the server's message when the failure is
-- unknown or the server refused the request (validation). failure_code names
-- the bucket but not the rule or the new error, which until now could only be
-- found in short-lived runtime logs. The client blanks quoted values and sends
-- at most 80 characters; the CHECK holds any caller to 120.

alter table public.wizard_step_events
  add column if not exists failure_detail text
  check (failure_detail is null or char_length(failure_detail) <= 120);

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
