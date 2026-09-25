-- trips.itinerary_version: the compare-and-set token for itinerary saves.
-- Safe before the code ships: the live code never reads the column.
--
-- WHY
-- PATCH /api/trips/[id] wrote the whole itinerary from the tab's copy with no
-- check. The copy is loaded once with the page and nothing refreshes it, so
-- an owner and an invited editor (or two tabs) silently overwrote each other:
-- last write wins, and nobody is told. Clients now send back the version
-- their copy was read at, and a stale save is refused with 409.
--
-- WHAT
-- Only this trigger moves the version, and it computes it from OLD, so
-- whatever a writer sends is ignored. It bumps by 1 when the itinerary
-- changes in anything other than activity image_url. Photo writers (photo
-- capture, enrichment after the wizard / share / publish, the cron) therefore
-- never make an open tab stale.
--
-- ORDER
-- BEFORE triggers fire in name order: trg_trips_public_slug <
-- trips_guard_protected_columns < trips_itinerary_version <
-- update_trips_updated_at. Firing AFTER the guard means the guard sees the
-- writer's own value, normally unchanged, so the editor allowlist in
-- 20260924124000 needs no entry, and an editor who sends a forged version is
-- refused with 42501. A trg_* name would sort BEFORE the guard and turn every
-- editor save into 42501.
--
-- The trigger fires on every UPDATE, not UPDATE OF itinerary, so an owner
-- cannot move the version with a write that leaves the itinerary alone.
--
-- Rollback (only AFTER reverting the code that filters on the column):
--   drop trigger if exists trips_itinerary_version on public.trips;
--   drop function if exists public.trips_bump_itinerary_version();
--   alter table public.trips drop column if exists itinerary_version;

alter table public.trips
  add column if not exists itinerary_version integer not null default 0;

comment on column public.trips.itinerary_version is
  'Moved only by trigger trips_itinerary_version (+1 when the itinerary changes other than activity image_url). Clients send it back as baseItineraryVersion; PATCH /api/trips/[id] answers 409 on a mismatch.';

create or replace function public.trips_bump_itinerary_version()
 returns trigger
 language plpgsql
 security invoker
 set search_path to 'public'
as $function$
declare
  v_new jsonb;
  v_old jsonb;
begin
  if tg_op = 'INSERT' then
    new.itinerary_version := 0;
    return new;
  end if;

  -- Never taken from the writer (owners and the service role can send it).
  new.itinerary_version := old.itinerary_version;

  if new.itinerary is not distinct from old.itinerary then
    return new;
  end if;

  if jsonb_typeof(new.itinerary) is distinct from 'array'
     or jsonb_typeof(old.itinerary) is distinct from 'array' then
    new.itinerary_version := old.itinerary_version + 1;
    return new;
  end if;

  -- Both sides with every activity's image_url removed: a photo-only change
  -- is not a change anyone could lose by saving over it.
  select coalesce(jsonb_agg(
           case when jsonb_typeof(d.day) = 'object' and jsonb_typeof(d.day -> 'activities') = 'array'
                then jsonb_set(d.day, '{activities}', coalesce((
                       select jsonb_agg(case when jsonb_typeof(a.act) = 'object' then a.act - 'image_url' else a.act end
                                        order by a.i)
                         from jsonb_array_elements(d.day -> 'activities') with ordinality as a(act, i)), '[]'::jsonb))
                else d.day end
           order by d.j), '[]'::jsonb)
    into v_new
    from jsonb_array_elements(new.itinerary) with ordinality as d(day, j);

  select coalesce(jsonb_agg(
           case when jsonb_typeof(d.day) = 'object' and jsonb_typeof(d.day -> 'activities') = 'array'
                then jsonb_set(d.day, '{activities}', coalesce((
                       select jsonb_agg(case when jsonb_typeof(a.act) = 'object' then a.act - 'image_url' else a.act end
                                        order by a.i)
                         from jsonb_array_elements(d.day -> 'activities') with ordinality as a(act, i)), '[]'::jsonb))
                else d.day end
           order by d.j), '[]'::jsonb)
    into v_old
    from jsonb_array_elements(old.itinerary) with ordinality as d(day, j);

  if v_new is distinct from v_old then
    new.itinerary_version := old.itinerary_version + 1;
  end if;
  return new;
end;
$function$;

drop trigger if exists trips_itinerary_version on public.trips;
create trigger trips_itinerary_version
  before insert or update on public.trips
  for each row execute function public.trips_bump_itinerary_version();

notify pgrst, 'reload schema';
