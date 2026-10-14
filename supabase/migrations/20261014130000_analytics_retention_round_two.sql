-- Retention for the analytics tables that had none, and shorter windows for
-- the two that grow fastest, so the database stays inside the free plan.
--
-- api_request_logs: raw calls 90 days (was a year). Every day is first summed
--   into api_cost_daily, which is kept, so cost history survives at a few rows
--   a day.
-- page_views: human rows 120 days (was 180). Dashboards read page_view_rollup
--   or at most the 90-day baseline window.
-- page_view_session_labels: a label only hides its session's rows from the
--   human views. Its page views go after 14 days; keep it while that session's
--   wizard events or trip views from the same day can still be read.
-- consent_events: banner impressions 90 days; consent decisions 13 months, as
--   the record of what each visitor chose.

create table if not exists public.api_cost_daily (
  day date not null,
  api_name text not null,
  -- Places bills per call by SKU, and the logged price per call names the
  -- SKU. 0 for APIs priced per token or free.
  unit_usd numeric(10, 6) not null default 0,
  probe boolean not null default false,
  calls integer not null,
  logged_usd numeric(12, 4) not null,
  primary key (day, api_name, unit_usd, probe)
);

alter table public.api_cost_daily enable row level security;
revoke all on table public.api_cost_daily from anon, authenticated;

comment on table public.api_cost_daily is
  'Daily sums of api_request_logs (UTC days) by API and per-call price, kept after the raw rows are purged. Written by refresh_api_cost_daily().';

create or replace function public.refresh_api_cost_daily(p_days integer default 3)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_from date := current_date - greatest(p_days, 1);
  v_rows integer := 0;
begin
  -- Complete UTC days only, recomputed whole so a late row is never lost.
  delete from public.api_cost_daily where day >= v_from and day < current_date;
  insert into public.api_cost_daily (day, api_name, unit_usd, probe, calls, logged_usd)
  select l.timestamp::date,
         l.api_name,
         case when l.api_name like 'google_places%' then round(coalesce(l.cost_usd, 0)::numeric, 6) else 0 end,
         coalesce(l.request_params ? 'probe', false),
         count(*),
         round(coalesce(sum(l.cost_usd), 0)::numeric, 4)
    from public.api_request_logs l
   where l.timestamp >= v_from
     and l.timestamp < current_date
   group by 1, 2, 3, 4;
  get diagnostics v_rows = row_count;
  return v_rows;
end
$function$;

revoke execute on function public.refresh_api_cost_daily(integer) from public, anon, authenticated;
grant execute on function public.refresh_api_cost_daily(integer) to service_role;

-- Everything logged so far, once.
select public.refresh_api_cost_daily(400);

-- Nightly at 02:50 UTC, before the purge at 03:10 deletes old raw rows.
do $$
begin
  if not exists (select 1 from cron.job where jobname = 'refresh-api-cost-daily') then
    perform cron.schedule('refresh-api-cost-daily', '50 2 * * *', 'select public.refresh_api_cost_daily(3)');
  end if;
end
$$;

-- The result gains two columns, so the function is dropped first; the cron
-- job calls it in a select list and does not depend on its shape.
drop function if exists public.purge_old_analytics_rows();

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
      where p.created_at < now() - interval '14 days'
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
