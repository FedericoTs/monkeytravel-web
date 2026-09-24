-- Owner-only columns on trips: what an invited editor may change.
-- Safe to apply before or after the code: no editor path writes a column
-- outside the list below (audited 2026-09-24, see WHAT).
--
-- WHY
-- trips_update admits the owner and any collaborator with role 'editor', and
-- authenticated holds UPDATE on every trips column. 20260924120000 stopped
-- user_id / parent_trip_id changes and pinned the counters and flags, but an
-- editor calling PostgREST with their own token could still change
-- everything else: make the owner's private trip public (visibility +
-- share_token, which the anon read policy then serves: notes, emergency
-- contacts, itinerary, budget), kill the owner's share link, move status and
-- dates, mute the owner's reminders, rewrite trip_meta (timezone and locale
-- decide when and in which language the owner's emails go out), archive or
-- tombstone the trip, and set author_*, template_* and claim_*. 8 editor
-- rows existed in production; nobody had used any of it. PATCH
-- /api/trips/[id] already limits editors to EDITOR_FIELDS (#178); this makes
-- the database agree.
--
-- WHAT
-- For a caller that is neither trusted (current_user postgres / service_role
-- / supabase_admin) nor the owner (auth.uid() = old.user_id, both non-null),
-- on UPDATE, after the existing pins:
--   - any column outside c_editor_columns that differs raises 42501 naming
--     it. Default-deny: a column added to trips later is owner-only until it
--     is listed here;
--   - trip_meta: packing_checked is taken from the write (it must be an
--     array of strings, else 22023) and every other key from the stored row.
--     TripPackingEssentials ticks an item by writing back the whole object it
--     read a moment earlier, so this keeps the tick and anything written in
--     between;
--   - public_slug: only trg_trips_public_slug's fill of a missing slug on a
--     public trip passes (that trigger fires before this one);
--   - updated_at is not compared: update_trips_updated_at fires after this
--     trigger and sets now().
-- The editor write paths this was checked against: PATCH /api/trips/[id]
-- (itinerary, title, description, tags, budget, cover_image_url, updated_at;
-- the activityPhoto branch writes itinerary) and the packing tick
-- (trip_meta.packing_checked, updated_at). Every other user-client write to
-- trips is owner-gated in its route. Proposal consensus apply, report,
-- submit-trending, claim and the crons use the service role or definer
-- functions owned by postgres, which the guard does not check. A future
-- SECURITY DEFINER function that writes trips for an editor bypasses this and
-- must enforce the same list itself.
--
-- Rollback: re-run create or replace function public.trips_guard_protected_columns()
-- from 20260924120000. Do NOT drop the trigger: that also drops the counter guard.

create or replace function public.trips_guard_protected_columns()
 returns trigger
 language plpgsql
 security invoker
 set search_path to 'public'
as $function$
declare
  -- What a member who is not the owner may change (trips_update admits such
  -- a member only as role 'editor'). Keep in step with EDITOR_FIELDS in
  -- app/api/trips/[id]/route.ts (a vitest enforces it). updated_at,
  -- trip_meta and public_slug are handled separately below.
  c_editor_columns constant text[] := array[
    'itinerary', 'title', 'description', 'tags', 'budget', 'cover_image_url',
    'updated_at', 'trip_meta', 'public_slug'
  ];
  v_uid uuid;
  v_pc jsonb;
  v_changed text[];
begin
  if current_user in ('postgres', 'service_role', 'supabase_admin') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.like_count := 0;
    new.save_count := 0;
    new.fork_count := 0;
    new.template_copy_count := 0;
    new.view_count := 0;
    new.trending_score := 0;
    new.trending_approved := false;
    new.is_editors_pick := false;
    new.is_hidden := false;
    new.reported_count := 0;
    new.is_template := false;
    -- The trending freshness term counts from shared_at / created_at, and
    -- the editors-pick cron requires created_at at least 7 days back: a
    -- future date would hold freshness at its maximum forever, a past one
    -- would skip the age gate. A trip is created now.
    new.created_at := now();
    new.shared_at := case when new.shared_at > now() then now() else new.shared_at end;
    if new.parent_trip_id is not null and not public.trip_is_forkable(new.parent_trip_id) then
      raise exception 'trips.parent_trip_id must name a public trip'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.user_id is distinct from old.user_id then
    raise exception 'trips.user_id cannot be changed here'
      using errcode = '42501';
  end if;
  if new.parent_trip_id is distinct from old.parent_trip_id then
    raise exception 'trips.parent_trip_id cannot be changed here'
      using errcode = '42501';
  end if;

  new.like_count := old.like_count;
  new.save_count := old.save_count;
  new.fork_count := old.fork_count;
  new.template_copy_count := old.template_copy_count;
  new.view_count := old.view_count;
  new.trending_score := old.trending_score;
  new.trending_approved := old.trending_approved;
  new.is_editors_pick := old.is_editors_pick;
  new.is_hidden := old.is_hidden;
  new.reported_count := old.reported_count;
  new.is_template := old.is_template;
  new.created_at := old.created_at;
  if new.shared_at > now() then
    new.shared_at := now();
  end if;

  -- The owner may change every other column. auth.uid() is null for anon,
  -- and old.user_id is null on an unclaimed anonymous trip: neither is an
  -- owner, so null = null must not count.
  v_uid := auth.uid();
  if v_uid is not null and v_uid = old.user_id then
    return new;
  end if;

  -- trip_meta: packing_checked from the write, every other key from the
  -- stored row. An editor cannot move the owner's timezone, locale or
  -- destination, and a key someone wrote in between survives the tick.
  if new.trip_meta is distinct from old.trip_meta then
    v_pc := case when jsonb_typeof(new.trip_meta) = 'object'
                 then new.trip_meta -> 'packing_checked' end;
    if v_pc is not null
       and (jsonb_typeof(v_pc) <> 'array'
            or jsonb_path_exists(v_pc, 'strict $[*] ? (@.type() != "string")')) then
      -- The trip page feeds this straight into new Set(...): anything but a
      -- list of names would break the page for everyone on the trip.
      raise exception 'trips.trip_meta.packing_checked must be a list of item names'
        using errcode = '22023';
    end if;
    new.trip_meta := (coalesce(old.trip_meta, '{}'::jsonb) - 'packing_checked')
      || case when v_pc is null then '{}'::jsonb
              else jsonb_build_object('packing_checked', v_pc) end;
  end if;

  -- Every other column, including any added to trips later, is the owner's.
  select array_agg(n.key order by n.key)
    into v_changed
    from jsonb_each(to_jsonb(new)) as n
   where n.key <> all (c_editor_columns)
     and n.value is distinct from (to_jsonb(old) -> n.key);

  -- public_slug: trg_trips_public_slug fires before this trigger and fills a
  -- missing slug on a public trip from title, destination and id. That fill
  -- may land on an editor's save; any other change is the owner's.
  if new.public_slug is distinct from old.public_slug
     and not (old.public_slug is null
              and new.visibility = 'public'
              and new.public_slug = public.mt_trip_public_slug(new.title, new.template_destination, new.id)) then
    v_changed := array_append(coalesce(v_changed, '{}'::text[]), 'public_slug');
  end if;

  if v_changed is not null then
    raise exception 'only the trip owner can change: %', array_to_string(v_changed, ', ')
      using errcode = '42501',
            hint = 'A trip editor may change itinerary, title, description, tags, budget, cover_image_url and trip_meta.packing_checked.';
  end if;
  return new;
end;
$function$;
