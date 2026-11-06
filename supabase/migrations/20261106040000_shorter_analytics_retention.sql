-- Shorter windows for the raw analytics, so the database stays inside the free plan.
--
-- page_views: human rows 90 days (was 120). Dashboards read page_view_rollup or at
--   most the 90-day baseline window.
-- api_request_logs: raw calls 65 days (was 90). The Costs tab reads the whole of last
--   month at most, and every day is first summed into api_cost_daily, which is kept.
-- wizard_step_events: 90 days (was 180). The funnels read 60 days at most. Session
--   labels follow them.
-- consent_events: banner impressions 30 days (was 90). Decisions stay 13 months, as
--   the record of what each visitor chose.
--
-- Smaller batches too. The whole purge is one statement under the role's 2-minute
-- limit, and a timeout undoes all of it, so the rows these windows now make due go
-- a few thousand a night rather than at once.

create or replace function public.purge_old_analytics_rows()
returns table (
  page_views_deleted bigint,
  api_logs_deleted bigint,
  wizard_events_deleted bigint,
  labels_deleted bigint,
  consent_events_deleted bigint
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pv bigint := 0;
  v_nh bigint := 0;
  v_api bigint := 0;
  v_wiz bigint := 0;
  v_hb bigint := 0;
  v_lbl bigint := 0;
  v_ce bigint := 0;
begin
  delete from public.page_views
   where id in (
     select id from public.page_views
      where created_at < now() - interval '90 days'
      order by created_at
      limit 6000
   );
  get diagnostics v_pv = row_count;

  delete from public.page_views
   where id in (
     select p.id from public.page_views p
      where p.created_at < now() - interval '7 days'
        and (p.is_bot or p.is_prefetch or exists (
          select 1 from public.page_view_session_labels l
           where l.session_id = p.session_id
             and l.day = p.created_at::date
             and l.is_automation))
      order by p.created_at
      limit 50000
   );
  get diagnostics v_nh = row_count;

  -- Already summed into api_cost_daily by the 02:50 job.
  delete from public.api_request_logs
   where id in (
     select id from public.api_request_logs
      where timestamp < now() - interval '65 days'
      order by timestamp
      limit 6000
   );
  get diagnostics v_api = row_count;

  delete from public.wizard_step_events
   where id in (
     select id from public.wizard_step_events
      where created_at < now() - interval '90 days'
      order by created_at
      limit 6000
   );
  get diagnostics v_wiz = row_count;

  -- Step-1 heartbeats, the bulk of the table, are read only by the automation
  -- labeller, which looks back a few days.
  delete from public.wizard_step_events
   where id in (
     select id from public.wizard_step_events
      where step = 'step1_heartbeat'
        and created_at < now() - interval '14 days'
      order by created_at
      limit 20000
   );
  get diagnostics v_hb = row_count;

  -- A label outlives the page views it hides (7 days), and stays while its
  -- session's wizard events or trip views from that day can still be read.
  delete from public.page_view_session_labels
   where (session_id, day) in (
     select x.session_id, x.day from public.page_view_session_labels x
      where x.day < current_date - 14
        and (x.day < current_date - 90
             or (not exists (
                   select 1 from public.wizard_step_events w
                    where w.session_id = x.session_id
                      and w.created_at >= x.day
                      and w.created_at < x.day + 1)
                 and not exists (
                   select 1 from public.trip_views v
                    where v.session_id = x.session_id
                      and v.viewed_on = x.day)))
      order by x.day
      limit 50000
   );
  get diagnostics v_lbl = row_count;

  delete from public.consent_events
   where id in (
     select id from public.consent_events
      where (event in ('shown', 'minimized') and created_at < now() - interval '30 days')
         or created_at < now() - interval '395 days'
      order by created_at
      limit 6000
   );
  get diagnostics v_ce = row_count;

  page_views_deleted := v_pv + v_nh;
  api_logs_deleted := v_api;
  wizard_events_deleted := v_wiz + v_hb;
  labels_deleted := v_lbl;
  consent_events_deleted := v_ce;
  return next;
end
$function$;

revoke execute on function public.purge_old_analytics_rows() from public, anon, authenticated;
grant execute on function public.purge_old_analytics_rows() to service_role;
