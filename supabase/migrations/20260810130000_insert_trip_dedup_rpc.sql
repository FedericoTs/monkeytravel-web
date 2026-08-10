-- Atomic dedupe for trip saves.
--
-- WHY: both save arms (useAutoSaveTrip's insertTrip and NewTripWizard's
-- manual handleSaveTrip) guarded against duplicates with a check-then-insert:
-- SELECT same user+title+start_date created in the last 60s, reuse if found,
-- else INSERT. That guard is not atomic — two saves fired 0.0-0.35s apart
-- (streaming finalize + a second itinerary identity re-triggering the
-- autosave effect) both pass the SELECT before either INSERT commits.
-- Measured 2026-08-10: 19 duplicate pairs within 2 minutes across 273 trips,
-- all TOCTOU-shaped (median gap 0s). The June fix (commit 31e1d41) killed the
-- slow 4-6s double-click cluster but is structurally blind to concurrency.
--
-- HOW: one SECURITY INVOKER function that takes a pg_advisory_xact_lock on
-- (user, title, start_date) so concurrent saves of the same logical trip
-- serialize, THEN runs the 60s-window check, THEN inserts. RLS still applies
-- (invoker rights): the INSERT goes through the caller's own insert policy
-- and user_id comes from auth.uid(), never from the payload.
--
-- Returns exactly one row: (trip_id, reused). reused=true means the caller
-- should skip side effects (notification enqueue, photo enrichment) — the
-- first save already ran them.

create or replace function public.insert_trip_dedup(p_row jsonb)
returns table (trip_id uuid, reused boolean)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_title text := p_row->>'title';
  v_start date := (p_row->>'start_date')::date;
  v_existing uuid;
  v_new uuid;
begin
  if v_user_id is null then
    raise exception 'insert_trip_dedup requires an authenticated caller';
  end if;
  if v_title is null or v_start is null then
    raise exception 'insert_trip_dedup: title and start_date are required';
  end if;

  -- Serialize concurrent saves of the same logical trip. Transaction-scoped:
  -- released automatically at commit/rollback, so an aborted save never
  -- wedges the key. hashtextextended keys the lock to (user, title, date)
  -- so unrelated saves don't contend.
  perform pg_advisory_xact_lock(
    hashtextextended(v_user_id::text || '|' || lower(v_title) || '|' || v_start::text, 0)
  );

  select t.id into v_existing
  from trips t
  where t.user_id = v_user_id
    and t.title = v_title
    and t.start_date = v_start
    and t.created_at >= now() - interval '60 seconds'
    and t.deleted_at is null
  order by t.created_at desc
  limit 1;

  if v_existing is not null then
    return query select v_existing, true;
    return;
  end if;

  insert into trips (
    user_id, title, description, start_date, end_date,
    status, visibility, itinerary, cover_image_url, budget,
    tags, trip_meta, travel_style, packing_list
  )
  values (
    v_user_id,
    v_title,
    p_row->>'description',
    v_start,
    (p_row->>'end_date')::date,
    coalesce(p_row->>'status', 'planning'),
    coalesce(p_row->>'visibility', 'private'),
    p_row->'itinerary',
    p_row->>'cover_image_url',
    p_row->'budget',
    coalesce(
      (select array_agg(x) from jsonb_array_elements_text(
        case when jsonb_typeof(p_row->'tags') = 'array' then p_row->'tags' else '[]'::jsonb end
      ) x),
      '{}'::text[]
    ),
    p_row->'trip_meta',
    coalesce(p_row->>'travel_style', 'classic'),
    p_row->'packing_list'
  )
  returning trips.id into v_new;

  return query select v_new, false;
end;
$$;

-- Lesson from the 2026-06 SECURITY DEFINER audit: never leave function
-- EXECUTE on PUBLIC/anon. This one is INVOKER (RLS applies regardless),
-- but anon has no business calling it at all.
revoke execute on function public.insert_trip_dedup(jsonb) from public;
revoke execute on function public.insert_trip_dedup(jsonb) from anon;
grant execute on function public.insert_trip_dedup(jsonb) to authenticated;
grant execute on function public.insert_trip_dedup(jsonb) to service_role;
