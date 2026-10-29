-- One identity per destination in the plan cache, and the places travellers
-- kept for each destination: what a new plan is built from first
-- (lib/ai/destination-key.ts, lib/ai/known-places.ts).

-- 1. The plan cache finds a destination by its city and country, so "Tokyo"
--    and "Tokyo, Japan" share their plans.
alter table public.destination_activity_cache
  add column if not exists destination_city text,
  add column if not exists destination_country text;

create index if not exists destination_activity_cache_city_idx
  on public.destination_activity_cache (destination_city, language, budget_tier, travel_style);

-- 2. Per destination (as written), language and place: how many travellers
--    kept it and how many cached plans have it, with the vibes of those trips.
--    A place found only in saved trips needs three travellers, so no one's own
--    plan shows through.
create materialized view public.known_places as
with sources as (
  select 'trip:' || t.id as source,
         t.user_id,
         t.trip_meta->>'destination' as destination,
         coalesce(nullif(t.trip_meta->>'locale', ''), 'en') as language,
         -- A saved trip keeps the interests the wizard derived from its vibes.
         array_remove(array[
           case when t.tags && array['food'] then 'foodie' end,
           case when t.tags && array['history'] then 'cultural' end,
           case when t.tags && array['nature'] then 'nature' end,
           case when t.tags && array['adventure'] then 'adventure' end,
           case when t.tags && array['nightlife', 'shopping'] then 'urban' end,
           case when t.tags && array['relaxation'] then 'romantic' end
         ], null) as vibes,
         t.itinerary as days
  from public.trips t
  where t.deleted_at is null
    and coalesce(t.is_hidden, false) = false
    and t.trip_meta->'cities' is null
    and coalesce(t.trip_meta->>'destination', '') <> ''
    and jsonb_typeof(t.itinerary) = 'array'
  union all
  select 'plan:' || c.id, null, c.destination_name, c.language, c.vibes, c.activities
  from public.destination_activity_cache c
  where jsonb_typeof(c.activities) = 'array'
),
activities as (
  select s.source,
         s.user_id,
         s.language,
         s.vibes,
         btrim(regexp_replace(lower(unaccent(s.destination)), '\s+', ' ', 'g')) as destination,
         -- "Dinner at X" is X; "Dinner in Trastevere" is an area and keeps its name.
         btrim(regexp_replace(a->>'name',
           '^(breakfast|brunch|lunch|dinner|supper|drinks|coffee|aperitivo|pranzo|cena|colazione|almuerzo|desayuno|almoco|almoço|jantar)\s+(at|@|al|alla|allo|da|presso|en|em|no|na)\s+',
           '', 'i')) as name,
         a->>'type' as type,
         a->'estimated_cost'->>'tier' as tier
  from sources s
  cross join lateral jsonb_array_elements(s.days) d
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(d->'activities') = 'array' then d->'activities' else '[]'::jsonb end
  ) a
  where coalesce(a->>'name', '') <> ''
),
keyed as (
  select *,
         btrim(split_part(destination, ',', 1)) as destination_first,
         -- One key for "Hama-rikyu Gardens", "Hamarikyu Gardens (Tokyo)" and
         -- "Explore Hama-rikyu Gardens"; "&" and "and" alike.
         regexp_replace(
           regexp_replace(
             regexp_replace(
               regexp_replace(
                 regexp_replace(lower(unaccent(name)), '\([^)]*\)', '', 'g'),
                 '^\s*(explore|visit)\s+', ''),
               '\s+(exploration|visit)\s*$', ''),
             '\m(and|y|e|et|und)\M', '', 'g'),
           '[^[:alnum:]]+', '', 'g') as place_key
  from activities
  -- "Tokyo & Osaka" is a multi-city trip's label.
  where destination !~ '&'
),
totals as (
  select destination_first, language, place_key,
         count(distinct user_id) as users,
         count(distinct source) filter (where user_id is null) as plans
  from keyed
  where place_key <> ''
  group by 1, 2, 3
),
place_vibes as (
  select destination, language, place_key, jsonb_object_agg(vibe, n) as vibes
  from (
    select k.destination, k.language, k.place_key, v as vibe, count(distinct k.source) as n
    from keyed k
    cross join lateral unnest(k.vibes) v
    group by 1, 2, 3, 4
  ) x
  group by 1, 2, 3
)
select k.destination_first,
       k.destination,
       k.language,
       k.place_key,
       mode() within group (order by k.name) as name,
       mode() within group (order by k.type) as type,
       mode() within group (order by k.tier) as tier,
       count(distinct k.user_id)::int as users,
       (count(distinct k.source) filter (where k.user_id is null))::int as plans,
       coalesce(v.vibes, '{}'::jsonb) as vibes
from keyed k
join totals t using (destination_first, language, place_key)
left join place_vibes v using (destination, language, place_key)
where t.users >= 3 or t.plans >= 2
group by k.destination_first, k.destination, k.language, k.place_key, v.vibes;

-- Required by REFRESH ... CONCURRENTLY.
create unique index known_places_key_uq on public.known_places (destination, language, place_key);
create index known_places_lookup_idx on public.known_places (destination_first, language);

-- Read by the server only (service role); built from private trips.
revoke all on public.known_places from public, anon, authenticated;
grant select on public.known_places to service_role;

-- 3. Rebuilt daily by /api/cron/refresh-activity-index.
create or replace function public.refresh_known_places()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  refresh materialized view concurrently public.known_places;
end;
$$;

revoke all on function public.refresh_known_places() from public, anon, authenticated;
grant execute on function public.refresh_known_places() to service_role;
