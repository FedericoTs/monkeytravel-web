-- Live figures for the marketing pages and the "saved in N trips" line on
-- activity cards: aggregates only, precomputed by pg_cron every six hours.
-- The anon-callable readers return the cached row whatever its age, never a
-- live compute: that reads every itinerary and takes about as long as the
-- anon key's statement timeout.

create table if not exists public.public_stats_cache (
  id          boolean     primary key default true check (id),
  stats       jsonb       not null,
  places      jsonb       not null,
  computed_at timestamptz not null default now()
);

-- RLS on and no policy: only the SECURITY DEFINER functions below read it.
alter table public.public_stats_cache enable row level security;
revoke all on public.public_stats_cache from public, anon, authenticated;

-- Planning sessions that reached a plan, with the automation label test of
-- compute_wizard_planning_stats(), plus the trips saved before the wizard
-- events begin.
create or replace function public.compute_public_stats()
returns jsonb
language sql
stable
set search_path to 'public'
as $function$
  with plans as (
    select distinct on (w.session_id) w.session_id, w.created_at, w.group_size, w.duration_days
    from public.wizard_step_events w
    where w.step = 'result'
      and w.session_id is not null
      and w.session_id not like 'e2eprobe%'
      and not exists (
        select 1 from public.page_view_session_labels l
        where l.session_id = w.session_id
          and l.is_automation
      )
    order by w.session_id, w.created_at desc
  ),
  saved as (
    select t.created_at, t.itinerary
    from public.trips t
    where t.deleted_at is null
      and not coalesce(t.is_template, false)
  )
  select jsonb_build_object(
    'plans', (select count(*) from plans)
      + (select count(*) from saved where created_at < (select min(created_at) from public.wizard_step_events)),
    'plans_30d', (select count(*) from plans where created_at > now() - interval '30 days'),
    'group_plans', (select count(*) from plans where group_size = 'group'),
    'solo_plans', (select count(*) from plans where group_size = 'solo'),
    'short_plans', (select count(*) from plans where duration_days between 1 and 3),
    'activities', (
      select count(*)
      from saved s,
        lateral jsonb_array_elements(case when jsonb_typeof(s.itinerary) = 'array' then s.itinerary else '[]'::jsonb end) d(day),
        lateral jsonb_array_elements(case when jsonb_typeof(d.day->'activities') = 'array' then d.day->'activities' else '[]'::jsonb end) a(act)
    ),
    'median_plan_seconds', (
      select round((percentile_cont(0.5) within group (order by response_time_ms) / 1000.0)::numeric)
      from public.api_request_logs
      where endpoint = '/api/ai/generate/stream'
        and "timestamp" > now() - interval '30 days'
        and not coalesce(cache_hit, false)
        and response_status = 200
    )
  );
$function$;

-- Places saved in at least three independent trips by at least three
-- different people. A trip and its forks or copies count once, so no single
-- plan, and no name only its owner wrote, reaches the list. One name in two
-- cities stays two places: rows of one name are clustered within ~20 km.
-- Each entry is [normalised name, lat, lng, trips].
create or replace function public.compute_saved_places()
returns jsonb
language sql
stable
set search_path to 'public'
as $function$
  with acts as (
    select coalesce(t.parent_trip_id, t.id) as lineage,
           coalesce(t.user_id::text, t.id::text) as owner,
           lower(public.unaccent(btrim(a.act->>'name'))) as name_norm,
           (a.act->'coordinates'->>'lat')::double precision as lat,
           (a.act->'coordinates'->>'lng')::double precision as lng
    from public.trips t,
      lateral jsonb_array_elements(case when jsonb_typeof(t.itinerary) = 'array' then t.itinerary else '[]'::jsonb end) d(day),
      lateral jsonb_array_elements(case when jsonb_typeof(d.day->'activities') = 'array' then d.day->'activities' else '[]'::jsonb end) a(act)
    where t.deleted_at is null
      and not coalesce(t.is_template, false)
      and not coalesce(t.is_hidden, false)
      and coalesce(a.act->>'type', '') <> 'transport'
      and length(btrim(a.act->>'name')) between 3 and 80
      and jsonb_typeof(a.act->'coordinates') = 'object'
      and (a.act->'coordinates'->>'lat') ~ '^-?[0-9]{1,2}(\.[0-9]+)?$'
      and (a.act->'coordinates'->>'lng') ~ '^-?[0-9]{1,3}(\.[0-9]+)?$'
  ),
  places as (
    select *
    from acts
    -- Meals, transfers and hotel time are steps of a day, not places.
    where name_norm !~ '^(breakfast|brunch|lunch|dinner|supper|drinks|coffee break|check[ -]?(in|out)|arrival|arrive|departure|depart|transfer|travel to|flight|train to|bus to|drive to|return to|free time|leisure time|relax|rest at|last[ -]minute|souvenir|packing)\y'
      and name_norm !~ '\yat (the|your) hotel\y'
      and abs(lat) <= 90
      and abs(lng) <= 180
      and not (lat = 0 and lng = 0)
  ),
  clustered as (
    select p.*,
           ST_ClusterDBSCAN(ST_MakePoint(p.lng, p.lat), eps := 0.2, minpoints := 1)
             over (partition by p.name_norm) as cluster
    from places p
  )
  select coalesce(jsonb_agg(jsonb_build_array(name_norm, lat, lng, trips) order by trips desc, name_norm), '[]'::jsonb)
  from (
    select name_norm,
           round(avg(lat)::numeric, 3) as lat,
           round(avg(lng)::numeric, 3) as lng,
           count(distinct lineage)::int as trips
    from clustered
    group by name_norm, cluster
    having count(distinct owner) >= 3
       and count(distinct lineage) >= 3
  ) s;
$function$;

-- More work_mem than the default: the clustering sort spills ~15 MB to disk.
create or replace function public.refresh_public_stats()
returns timestamptz
language plpgsql
security definer
set search_path to 'public'
set work_mem to '64MB'
as $function$
begin
  insert into public.public_stats_cache (id, stats, places, computed_at)
  values (true, public.compute_public_stats(), public.compute_saved_places(), now())
  on conflict (id) do update
    set stats = excluded.stats,
        places = excluded.places,
        computed_at = excluded.computed_at;
  return now();
end
$function$;

create or replace function public.get_public_stats()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select s.stats || jsonb_build_object('computed_at', s.computed_at)
  from public.public_stats_cache s;
$function$;

create or replace function public.get_saved_places()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce((select s.places from public.public_stats_cache s), '[]'::jsonb);
$function$;

revoke execute on function public.compute_public_stats() from public, anon, authenticated;
revoke execute on function public.compute_saved_places() from public, anon, authenticated;
revoke execute on function public.refresh_public_stats() from public, anon, authenticated;
grant execute on function public.compute_public_stats() to service_role;
grant execute on function public.compute_saved_places() to service_role;
grant execute on function public.refresh_public_stats() to service_role;

revoke execute on function public.get_public_stats() from public;
revoke execute on function public.get_saved_places() from public;
grant execute on function public.get_public_stats() to anon, authenticated, service_role;
grant execute on function public.get_saved_places() to anon, authenticated, service_role;

-- Every six hours at :15, clear of the hourly :05 and :35 and the nightly jobs.
do $$
begin
  if not exists (select 1 from cron.job where jobname = 'refresh-public-stats') then
    perform cron.schedule('refresh-public-stats', '15 */6 * * *', 'select public.refresh_public_stats()');
  end if;
end
$$;

select public.refresh_public_stats();
