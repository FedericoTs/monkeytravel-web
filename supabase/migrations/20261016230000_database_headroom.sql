-- More room inside the free plan's 500 MB.
--
-- Bot and automation page views: kept 7 days instead of 14. Their daily
--   counts live on in page_view_rollup; the raw rows were only read to
--   investigate the last few days of crawling.
-- Two indexes no query uses: api_request_logs (api_name, timestamp) is served
--   by idx_api_request_logs_api_name and idx_api_logs_timestamp, and nothing
--   filters page_views by country.
-- A VACUUM after the 03:10 purge, so the space it frees is reused the same
--   night instead of waiting days for autovacuum's default threshold while new
--   rows take new pages. trips is in it for its itinerary TOAST, rewritten on
--   every edit. VACUUM cannot run inside a function, so it is its own job.

drop index if exists public.idx_api_logs_api_name;
drop index if exists public.idx_page_views_country_code;

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
      where created_at < now() - interval '120 days'
      order by created_at
      limit 20000
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
      where timestamp < now() - interval '90 days'
      order by timestamp
      limit 20000
   );
  get diagnostics v_api = row_count;

  delete from public.wizard_step_events
   where id in (
     select id from public.wizard_step_events
      where created_at < now() - interval '180 days'
      order by created_at
      limit 20000
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
        and (x.day < current_date - 180
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
      where (event in ('shown', 'minimized') and created_at < now() - interval '90 days')
         or created_at < now() - interval '395 days'
      order by created_at
      limit 20000
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

-- Nightly at 03:25 UTC, after the 03:10 purge.
do $$
begin
  if not exists (select 1 from cron.job where jobname = 'vacuum-after-purge') then
    perform cron.schedule(
      'vacuum-after-purge',
      '25 3 * * *',
      'VACUUM (ANALYZE) public.page_views, public.api_request_logs, public.page_view_session_labels, public.consent_events, public.wizard_step_events, public.trips'
    );
  end if;
end
$$;
