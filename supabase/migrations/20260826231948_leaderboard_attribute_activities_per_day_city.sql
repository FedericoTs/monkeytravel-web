-- Homepage destination leaderboard — corrected attribution.
--
-- Replaces the v1 attempt (20260826222320), which derived a trip's city from
-- split_part(destination, ',', 1). 178 of 380 trips (47%) are multi-city, so
-- that collapsed each onto its first city and dragged other cities'
-- attractions with it. Measured before this fix:
--
--   Berlin    24 days actually in Dresden / Munich / Nuremberg / Rothenburg
--   Tokyo     18 days actually in Kyoto / Nara / Osaka / Sydney
--   Paris     15 days actually in Amsterdam / Lyon / Nice / Reims / Timisoara
--   Santorini  8 days actually in Capri / Rome / Lauterbrunnen
--
-- IMPORTANT, because the first read of this was wrong: the ITINERARIES were
-- never wrong. A trip titled "Dubai, Vienna, Villach, Cornwall & Toronto"
-- really does visit Cornwall, so its Cornwall hotels were correct for that
-- trip — the AGGREGATION mislabelled them as Dubai's. Days on multi-city
-- itineraries carry their own `city` (719 of 2,461 days), and attribution now
-- uses it, falling back to the trip destination only for single-city trips
-- where it is exact by construction.
--
-- After this change: zero misattributed days across every city on the board,
-- and Kyoto surfaces as its own entry instead of being absorbed into Tokyo.
--
-- SECURITY DEFINER is required and safe: the homepage is anonymous and RLS
-- correctly hides other users' trips from `anon` (anon reads 96 of 380 rows
-- directly), so an invoker version would return a near-empty board. The
-- function emits ONLY aggregates — a city name, two counts, and public
-- attraction names. No trip id, user id, title, note or date leaves it.
--
-- search_path is pinned to 'public' (unaccent lives there too). An empty
-- search_path would break every unqualified reference below — the exact
-- defect repaired in 20260826150932.
create or replace function public.get_destination_leaderboard(
  p_limit int default 6,
  p_min_trips int default 4
)
returns table (
  city text,
  trips_all bigint,
  trips_30d bigint,
  top_activities jsonb
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with base as (
    select t.id, t.itinerary, t.created_at,
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
    select b.id, b.created_at,
           regexp_replace(
             coalesce(nullif(trim(lower(unaccent(d->>'city'))), ''), b.trip_city),
             '\s*(trip|viaje|viagem|viaggio)\s*$', ''
           ) as city,
           d->'activities' as acts
    from base b, lateral jsonb_array_elements(b.itinerary) d
    where jsonb_typeof(d->'activities') = 'array'
  ),
  -- Fold spelling variants that would otherwise split one city's count.
  -- 'kiyoto' is a real misspelling the generator has emitted.
  norm as (
    select id, created_at, acts,
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
  -- A trip counts toward every distinct city it actually visits, which is the
  -- honest reading of "trips that included this city".
  counts as (
    select city,
           count(distinct id) as trips_all,
           count(distinct id) filter (where created_at > now() - interval '30 days') as trips_30d
    from norm
    group by city
  ),
  acts as (
    select n.city, jsonb_array_elements(n.acts) as a
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
        -- Drop itinerary scaffolding and lodging. Lodging is excluded because
        -- there is not enough of it to rank — 44 property-naming entries
        -- across 30 cities, roughly 1.5 per city — NOT because it is wrong.
        and a->>'name' !~* '(check.?in|arrival|departure|settle|transfer|free time|explore the city|hotel|hostel|airbnb)'
      group by city, a->>'name'
    ) x
  )
  select c.city, c.trips_all, c.trips_30d,
         (select jsonb_agg(jsonb_build_object('name', ta.name, 'times', ta.times) order by ta.rn)
            from top_acts ta
           where ta.city = c.city and ta.rn <= 3) as top_activities
  from counts c
  where c.trips_all >= p_min_trips
    and exists (select 1 from top_acts ta where ta.city = c.city)
  order by c.trips_all desc, c.city
  limit p_limit;
$function$;

grant execute on function public.get_destination_leaderboard(int, int) to anon, authenticated;
