-- The homepage destination leaderboard, precomputed hourly by pg_cron. The
-- homepage reads it with the anon key while it builds, under a statement
-- timeout the live query does not always meet. Past three hours (two missed
-- runs) the RPC computes it live again.

create table if not exists public.destination_leaderboard_cache (
  city           text        primary key,
  trips_all      bigint      not null,
  trips_30d      bigint      not null,
  owners         bigint      not null,
  top_activities jsonb,
  computed_at    timestamptz not null default now()
);

-- RLS on and no policy: only the SECURITY DEFINER functions below read it.
alter table public.destination_leaderboard_cache enable row level security;
revoke all on public.destination_leaderboard_cache from public, anon, authenticated;

-- The previous body of get_destination_leaderboard. It returns every city at
-- the minimum threshold (4 owners) with its owner count, so the RPC can apply
-- a caller's threshold, the order and the limit to cached rows.
create or replace function public.compute_destination_leaderboard()
returns table(city text, trips_all bigint, trips_30d bigint, owners bigint, top_activities jsonb)
language sql
stable
set search_path to 'public'
as $function$
  with base as (
    select t.id, coalesce(t.user_id::text, t.id::text) as owner_key, t.itinerary, t.created_at,
           regexp_replace(
             lower(unaccent(split_part(coalesce(t.trip_meta->>'destination', t.title), ',', 1))),
             '\s*(trip|viaje|viagem|viaggio)\s*$', ''
           ) as trip_city
    from trips t
    where t.deleted_at is null
      and jsonb_typeof(t.itinerary) = 'array'
      and coalesce(t.trip_meta->>'destination', t.title) is not null
  ),
  -- One row per DAY, tagged with the city that day is actually in.
  day_city as (
    select b.id, b.owner_key, b.created_at,
           regexp_replace(
             coalesce(
               nullif(trim(lower(unaccent(d->>'city'))), ''),
               b.trip_city
             ),
             '\s*(trip|viaje|viagem|viaggio)\s*$', ''
           ) as city,
           d->'activities' as acts
    from base b, lateral jsonb_array_elements(b.itinerary) d
    where jsonb_typeof(d->'activities') = 'array'
  ),
  -- Fold spelling variants that would otherwise split one city's count.
  norm as (
    select id, owner_key, created_at, acts,
           case
             when city like 'tok%' then 'tokyo'
             when city like 'paris%' or city like 'romantic paris%' then 'paris'
             when city like 'barcelona%' then 'barcelona'
             when city in ('kiyoto') then 'kyoto'
             when city in ('osaka') then 'osaka'
             else trim(city)
           end as city
    from day_city
    where trim(coalesce(city, '')) <> ''
  ),
  counts as (
    select city,
           count(distinct id) as trips_all,
           count(distinct id) filter (where created_at > now() - interval '30 days') as trips_30d,
           count(distinct owner_key) as owners
    from norm
    group by city
  ),
  acts as (
    select n.city, n.owner_key, jsonb_array_elements(n.acts) as a
    from norm n
  ),
  top_acts as (
    select city, name, times,
           row_number() over (partition by city order by times desc, name) as rn
    from (
      select city, a->>'name' as name, count(*) as times
      from acts
      where a->>'type' in ('attraction','cultural','museum','landmark',
                           'sightseeing','nature','adventure','park','activity')
        and length(coalesce(a->>'name','')) between 4 and 60
        and a->>'name' !~* '(check.?in|arrival|departure|settle|transfer|free time|explore the city|hotel|hostel|airbnb)'
      group by city, a->>'name'
      having count(distinct owner_key) >= 2
    ) x
  )
  select c.city, c.trips_all, c.trips_30d, c.owners,
         (select jsonb_agg(jsonb_build_object('name', ta.name, 'times', ta.times) order by ta.rn)
            from top_acts ta
           where ta.city = c.city and ta.rn <= 3) as top_activities
  from counts c
  where c.owners >= 4
    and exists (select 1 from top_acts ta where ta.city = c.city);
$function$;

-- At the default work_mem the per-day CTE spills to disk, which is most of
-- the run. Only this scheduled job gets more; the anon-callable RPC does not.
create or replace function public.refresh_destination_leaderboard()
returns integer
language plpgsql
security definer
set search_path to 'public'
set work_mem to '64MB'
as $function$
declare
  v_rows integer;
begin
  -- One refresh at a time; readers keep the previous rows until commit. The
  -- WHERE is for PostgREST sessions, whose safeupdate refuses a bare DELETE.
  lock table public.destination_leaderboard_cache in share row exclusive mode;
  delete from public.destination_leaderboard_cache where true;
  insert into public.destination_leaderboard_cache (city, trips_all, trips_30d, owners, top_activities, computed_at)
  select l.city, l.trips_all, l.trips_30d, l.owners, l.top_activities, now()
  from public.compute_destination_leaderboard() l;
  get diagnostics v_rows = row_count;
  return v_rows;
end
$function$;

-- Same name, signature and grants: anon keeps EXECUTE for the homepage. The
-- thresholds hold for cached and live rows alike, whatever the caller passes:
-- at least 4 owners per city, at most 50 rows.
create or replace function public.get_destination_leaderboard(p_limit integer default 6, p_min_trips integer default 4)
returns table(city text, trips_all bigint, trips_30d bigint, top_activities jsonb)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_fresh boolean := exists (
    select 1 from public.destination_leaderboard_cache c
    where c.computed_at > now() - interval '3 hours'
  );
begin
  return query
    with src as (
      select c.city, c.trips_all, c.trips_30d, c.owners, c.top_activities
      from public.destination_leaderboard_cache c
      where v_fresh
      union all
      select l.city, l.trips_all, l.trips_30d, l.owners, l.top_activities
      from public.compute_destination_leaderboard() l
      where not v_fresh
    )
    select s.city, s.trips_all, s.trips_30d, s.top_activities
    from src s
    where s.owners >= greatest(coalesce(p_min_trips, 4), 4)
    order by s.trips_all desc, s.city
    limit least(greatest(coalesce(p_limit, 6), 1), 50);
end
$function$;

revoke execute on function public.compute_destination_leaderboard() from public, anon, authenticated;
revoke execute on function public.refresh_destination_leaderboard() from public, anon, authenticated;
grant execute on function public.compute_destination_leaderboard() to service_role;
grant execute on function public.refresh_destination_leaderboard() to service_role;

-- Hourly at :35, clear of the nightly jobs at :10, :20 and :40.
do $$
begin
  if not exists (select 1 from cron.job where jobname = 'refresh-destination-leaderboard') then
    perform cron.schedule('refresh-destination-leaderboard', '35 * * * *', 'select public.refresh_destination_leaderboard()');
  end if;
end
$$;
