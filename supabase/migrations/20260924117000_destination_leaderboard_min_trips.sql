-- Hold the destination leaderboard's privacy threshold inside the function.
-- Safe to apply at merge time: the homepage already passes p_min_trips = 4
-- (lib/leaderboard/destinations.ts), so its output does not change.
--
-- get_destination_leaderboard is SECURITY DEFINER, executable by anon, and
-- reads every trip, private and link-only ones included. The threshold that
-- keeps it an aggregate (a city appears only when at least 4 trips go
-- there) was the caller's own parameter, so POST
-- /rest/v1/rpc/get_destination_leaderboard {"p_min_trips": 1, "p_limit": 1000}
-- listed 282 cities that came from a single trip, each with that trip's top
-- three activity names. Found 2026-09-23 by the adversarial review of the
-- security branch.
--
-- Now:
--   - a city needs at least 4 distinct OWNERS, whatever the caller asks.
--     Counting trips was not enough: one person's duplicated trips reach 4
--     on their own, and anyone can insert 3 padding trips of their own to
--     surface a single other trip (review round 2). An ownerless
--     (anonymous) trip counts as its own owner. trips_all, the number the
--     homepage shows, is still the trip count;
--   - an activity name is listed only when at least 2 owners have it, so a
--     single person's custom activity never appears;
--   - at most 50 rows.
-- The body is otherwise unchanged from 20260826231948.

create or replace function public.get_destination_leaderboard(p_limit integer default 6, p_min_trips integer default 4)
 returns table(city text, trips_all bigint, trips_30d bigint, top_activities jsonb)
 language sql
 stable security definer
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
  select c.city, c.trips_all, c.trips_30d,
         (select jsonb_agg(jsonb_build_object('name', ta.name, 'times', ta.times) order by ta.rn)
            from top_acts ta
           where ta.city = c.city and ta.rn <= 3) as top_activities
  from counts c
  where c.owners >= greatest(coalesce(p_min_trips, 4), 4)
    and exists (select 1 from top_acts ta where ta.city = c.city)
  order by c.trips_all desc, c.city
  limit least(greatest(coalesce(p_limit, 6), 1), 50);
$function$;
