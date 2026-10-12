-- The wizard masthead's "planned in the last 30 days" figure, precomputed
-- hourly by pg_cron so the RPC reads one row instead of a month of wizard
-- events. Past three hours (two missed runs) the RPC computes it live again.

create table if not exists public.wizard_planning_stats_cache (
  id               boolean     primary key default true check (id),
  planned_last_30d integer     not null,
  computed_at      timestamptz not null default now()
);

-- RLS on and no policy: only the SECURITY DEFINER functions below read it.
alter table public.wizard_planning_stats_cache enable row level security;
revoke all on public.wizard_planning_stats_cache from public, anon, authenticated;

-- wizard_step_events_human, counted per (session, day) before the label test,
-- with the labels bounded to the window's first day: the same result without
-- hashing every label ever written. Keep the label test equal to the view's.
create or replace function public.compute_wizard_planning_stats()
returns integer
language sql
stable
set search_path to 'public'
as $function$
  with w as (
    select distinct session_id, created_at::date as day
    from public.wizard_step_events
    where session_id is not null
      and entered_at > now() - interval '30 days'
  )
  select count(distinct w.session_id)::int
  from w
  where not exists (
    select 1 from public.page_view_session_labels l
    where l.session_id = w.session_id
      and l.day = w.day
      and l.is_automation
      and l.day >= (select min(day) from w)
  );
$function$;

create or replace function public.refresh_wizard_planning_stats()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_planned integer := public.compute_wizard_planning_stats();
begin
  insert into public.wizard_planning_stats_cache (id, planned_last_30d, computed_at)
  values (true, v_planned, now())
  on conflict (id) do update
    set planned_last_30d = excluded.planned_last_30d,
        computed_at = excluded.computed_at;
  return v_planned;
end
$function$;

-- Same name, signature and grants (the service role only).
create or replace function public.get_wizard_planning_stats()
returns integer
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_planned integer;
begin
  select s.planned_last_30d into v_planned
  from public.wizard_planning_stats_cache s
  where s.computed_at > now() - interval '3 hours';
  if found then
    return v_planned;
  end if;
  return public.compute_wizard_planning_stats();
end
$function$;

revoke execute on function public.compute_wizard_planning_stats() from public, anon, authenticated;
revoke execute on function public.refresh_wizard_planning_stats() from public, anon, authenticated;
grant execute on function public.compute_wizard_planning_stats() to service_role;
grant execute on function public.refresh_wizard_planning_stats() to service_role;

-- Hourly at :05, clear of the nightly jobs at :10, :20 and :40.
do $$
begin
  if not exists (select 1 from cron.job where jobname = 'refresh-wizard-planning-stats') then
    perform cron.schedule('refresh-wizard-planning-stats', '5 * * * *', 'select public.refresh_wizard_planning_stats()');
  end if;
end
$$;
