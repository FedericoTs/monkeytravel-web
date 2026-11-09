-- Landmark photo lookups (google_places_cache, cache_type 'wikimedia_landmark') are kept 30 days
-- when a photo was found and 14 when none was (lib/images/landmark-photos.ts). Rows stored with the
-- longer lifetimes are brought in line, and a nightly job deletes what has expired.

delete from public.google_places_cache
 where cache_type = 'wikimedia_landmark'
   and cached_at < now() - case when data ? 'none' then interval '14 days' else interval '30 days' end;

update public.google_places_cache
   set expires_at = cached_at + case when data ? 'none' then interval '14 days' else interval '30 days' end
 where cache_type = 'wikimedia_landmark'
   and expires_at > cached_at + case when data ? 'none' then interval '14 days' else interval '30 days' end;

-- The signed-in tests' database (supabase/ci) has no pg_cron; production does.
do $do$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule(
      'purge-expired-landmark-photos',
      '15 3 * * *',
      $cmd$delete from public.google_places_cache where cache_type = 'wikimedia_landmark' and expires_at < now()$cmd$
    );
  end if;
end
$do$;
