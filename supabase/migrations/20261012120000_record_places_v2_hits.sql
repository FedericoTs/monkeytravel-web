-- Hit counts for the places_v2 cache, one call per trip (lib/images/activity.ts
-- looks up all of a trip's activities at once and passes the keys that hit).
-- It replaces two UPDATEs per hit that were built but never sent, so these
-- counters have never moved. Either deploy order works: until this is applied
-- the call fails with PGRST202, which the code ignores.

create or replace function public.record_places_v2_hits(p_keys text[])
returns void
language plpgsql
set search_path to ''
as $$
declare
  v_place_ids text[];
begin
  -- Rows are locked in key order, then in place order, so concurrent calls
  -- over shared keys queue behind each other instead of deadlocking.
  select array_agg(locked.place_id order by locked.place_id)
    into v_place_ids
    from (
      select l.place_id
        from public.places_v2_lookup l
       where l.normalized_key = any(p_keys)
       order by l.normalized_key
         for no key update
    ) locked;

  if v_place_ids is null then
    return;
  end if;

  update public.places_v2_lookup
     set hit_count = hit_count + 1,
         last_accessed_at = now()
   where normalized_key = any(p_keys);

  perform 1
     from public.places_v2 p
    where p.place_id = any(v_place_ids)
    order by p.place_id
      for no key update;

  -- Several spellings can hit one place in the same trip; each counts.
  update public.places_v2 p
     set hit_count = p.hit_count + c.hits,
         last_accessed_at = now()
    from (
      select ids.place_id, count(*)::integer as hits
        from unnest(v_place_ids) as ids(place_id)
       group by ids.place_id
    ) c
   where p.place_id = c.place_id;
end;
$$;

revoke execute on function public.record_places_v2_hits(text[]) from public, anon, authenticated;
grant execute on function public.record_places_v2_hits(text[]) to service_role;

comment on function public.record_places_v2_hits(text[]) is
  'Adds a hit to each places_v2_lookup row in p_keys and to its places_v2 row, and stamps last_accessed_at. Service role only.';

notify pgrst, 'reload schema';
