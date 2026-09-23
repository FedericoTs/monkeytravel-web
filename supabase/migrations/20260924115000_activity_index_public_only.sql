-- Rebuild activity_index from published trips only. Safe to apply at merge
-- time: no code changes with it.
--
-- The materialized view (20260529 activity_index_mview) took activities from
-- trips with visibility 'public' OR 'shared'. 'shared' is a link-only trip
-- that only people holding the link should see, and materialized views do
-- not apply row-level security, while anon could SELECT this one (and the
-- search_activities() RPC reads it for anyone). So the name, description,
-- address and coordinates of every activity in every link-only trip, with
-- its trip_id, were readable with the public anon key; custom activities
-- can hold a home or rental address. It also still listed 5 soft-deleted
-- trips.
--
-- Now: visibility = 'public', not hidden, not deleted. Public trips are
-- already readable by anyone, so the view exposes nothing of its own. The
-- activity suggestions lose the link-only trips' names (2,383 -> about
-- 1,700 distinct), so signed-in search falls back to Google a little more
-- often when fewer than 3 local results come back.
--
-- The grants are reset to SELECT only: anon and authenticated also held
-- INSERT/UPDATE/DELETE/MAINTAIN (meaningless on a matview, but not ours to
-- hand out). search_activities() is SECURITY INVOKER and needs SELECT.
-- The unique index is required by the nightly REFRESH ... CONCURRENTLY.
--
-- The rebuild takes an ACCESS EXCLUSIVE lock for the second it runs (about
-- 2k rows); a search in that second returns [] through its error path.
-- Rollback: recreate with the old WHERE clause (IN ('public', 'shared')).

drop materialized view if exists public.activity_index;

create materialized view public.activity_index as
select
  md5(t.id::text || '|' || day_ord.day_idx::text || '|' || act_ord.act_idx::text) as row_key,
  t.id as trip_id,
  coalesce(act_ord.act ->> 'name', '') as name,
  lower(public.unaccent(coalesce(act_ord.act ->> 'name', ''))) as name_norm,
  coalesce(act_ord.act ->> 'type', 'attraction') as type,
  coalesce(act_ord.act ->> 'description', '') as description,
  act_ord.act ->> 'address' as address,
  act_ord.act ->> 'location' as location,
  lower(public.unaccent(coalesce(act_ord.act ->> 'location', '') || ' ' || coalesce(act_ord.act ->> 'address', ''))) as destination_norm,
  act_ord.act -> 'coordinates' as coordinates,
  coalesce((act_ord.act ->> 'duration_minutes')::integer, 90) as duration_minutes,
  act_ord.act -> 'estimated_cost' as estimated_cost,
  act_ord.act ->> 'image_url' as image_url
from public.trips t,
  lateral jsonb_array_elements(t.itinerary) with ordinality day_ord(day, day_idx),
  lateral jsonb_array_elements(day_ord.day -> 'activities') with ordinality act_ord(act, act_idx)
where t.itinerary is not null
  and jsonb_typeof(t.itinerary) = 'array'
  and jsonb_typeof(day_ord.day -> 'activities') = 'array'
  and coalesce(act_ord.act ->> 'name', '') <> ''
  and coalesce(t.is_hidden, false) = false
  and t.deleted_at is null
  and t.visibility = 'public'
with data;

create unique index activity_index_row_key_uq on public.activity_index using btree (row_key);
create index activity_index_name_norm_trgm on public.activity_index using gin (name_norm public.gin_trgm_ops);
create index activity_index_destination_norm_trgm on public.activity_index using gin (destination_norm public.gin_trgm_ops);
create index activity_index_type_btree on public.activity_index using btree (type);

revoke all on public.activity_index from public, anon, authenticated;
grant select on public.activity_index to anon, authenticated, service_role;
