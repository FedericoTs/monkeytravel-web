-- Drop users.free_trips_remaining.
--
-- The column backed a beta-era "free trip" grant that stopped being enforced
-- on 2026-05-23, when decrementFreeTrips() became a hardcoded `return 999`.
-- lib/referral/completion.ts already recorded it as deprecated 2026-05-31:
-- "written here but never read anywhere". Real quotas come from TIER_LIMITS
-- (30 generations/month) and the anonymous 5-per-24h window; neither consults
-- this column.
--
-- Measured before writing this migration, on production:
--   * 447 user rows, and the ONLY distinct value is 0 — even the writers that
--     set 1 and 2 never persisted, so there is no data to preserve.
--   * no views, policies, functions, indexes, constraints or triggers depend
--     on the column.
--
-- ORDERING MATTERS. The application must already have stopped writing this
-- column before the drop lands, or PostgREST rejects the signup upsert against
-- an unknown column and account creation breaks. Writers were removed in
-- 86d52d9 and that deploy must be live before this runs. The guard below turns
-- a wrong-order run into a loud abort instead of a broken signup flow.

do $$
declare
  v_rows       bigint;
  v_nonzero    bigint;
  v_dependents int;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'users'
      and column_name  = 'free_trips_remaining'
  ) then
    raise notice 'free_trips_remaining already dropped — nothing to do';
    return;
  end if;

  -- Refuse if the column somehow carries data after all. A non-zero value
  -- would mean something started writing it again between the audit and now,
  -- and this migration's central premise ("no data to preserve") is false.
  select count(*), count(*) filter (where free_trips_remaining is distinct from 0)
    into v_rows, v_nonzero
    from public.users;

  if v_nonzero > 0 then
    raise exception
      'ABORT: % of % users have a non-zero free_trips_remaining. Something is writing this column again — re-audit before dropping.',
      v_nonzero, v_rows;
  end if;

  -- Refuse if anything in the database grew a dependency since the audit.
  select
    (select count(*) from pg_policies
       where schemaname = 'public'
         and (qual ilike '%free_trips_remaining%' or with_check ilike '%free_trips_remaining%'))
  + (select count(*) from pg_proc p join pg_namespace n on p.pronamespace = n.oid
       where n.nspname not in ('pg_catalog', 'information_schema')
         and p.prosrc ilike '%free_trips_remaining%')
  + (select count(*) from pg_indexes
       where schemaname = 'public' and indexdef ilike '%free_trips_remaining%')
  + (select count(*) from pg_constraint
       where conrelid = 'public.users'::regclass
         and pg_get_constraintdef(oid) ilike '%free_trips_remaining%')
    into v_dependents;

  if v_dependents > 0 then
    raise exception
      'ABORT: % database object(s) now reference free_trips_remaining. Re-audit before dropping.',
      v_dependents;
  end if;

  execute 'alter table public.users drop column free_trips_remaining';
  raise notice 'dropped users.free_trips_remaining (% rows, all zero)', v_rows;
end $$;
