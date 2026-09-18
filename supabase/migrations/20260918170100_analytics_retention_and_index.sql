-- Analytics hygiene (2026-09-18): retention for the raw event tables, and the
-- covering index the human view no longer uses.
--
-- RETENTION
-- page_views held 854k rows back to 2025-12-03 (562 MB with indexes) on a
-- Nano instance with 411 MB of RAM; api_request_logs 35k rows back to
-- 2025-12-02. Every dashboard reads page_view_rollup (daily aggregates, kept
-- forever) or a recent window of page_views_human; nothing reads raw page
-- views older than the 90-day baseline view. So raw rows older than 180 days
-- go, 20,000 a night, which drains the 131k backlog in a week and then keeps
-- pace with the ~9k rows a day that arrive. api_request_logs keeps a year:
-- the cost telescope is small and its history is useful. Nothing references
-- page_views by foreign key.
--
-- INDEX
-- idx_page_views_human_cover (80 MB, WHERE is_bot = false) served the human
-- view until #153 added is_prefetch to its predicate; the view now uses
-- idx_page_views_human_cover_v2 (EXPLAIN verified), the old index has had zero
-- scans since, and no query filters on is_bot alone (the labeller compares
-- coalesce(is_bot, false), which a partial index cannot serve). Dropped.
--
-- LABEL, NEVER BLOCK. Nothing here refuses a request.

create or replace function public.purge_old_analytics_rows()
returns table (page_views_deleted bigint, api_logs_deleted bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pv bigint := 0;
  v_api bigint := 0;
begin
  -- Oldest first, bounded per run so the nightly job never holds a long lock.
  delete from public.page_views
   where id in (
     select id from public.page_views
      where created_at < now() - interval '180 days'
      order by created_at
      limit 20000
   );
  get diagnostics v_pv = row_count;

  delete from public.api_request_logs
   where id in (
     select id from public.api_request_logs
      where timestamp < now() - interval '365 days'
      order by timestamp
      limit 5000
   );
  get diagnostics v_api = row_count;

  page_views_deleted := v_pv;
  api_logs_deleted := v_api;
  return next;
end
$$;

revoke execute on function public.purge_old_analytics_rows() from public, anon, authenticated;
grant execute on function public.purge_old_analytics_rows() to service_role;

-- Nightly at 03:10 UTC, after the labels (02:20) and the rollup (02:40) have
-- read the day. Idempotent: re-running the migration does not add a second job.
do $$
begin
  if not exists (select 1 from cron.job where jobname = 'purge-old-analytics-rows') then
    perform cron.schedule('purge-old-analytics-rows', '10 3 * * *', 'select public.purge_old_analytics_rows()');
  end if;
end
$$;

drop index if exists public.idx_page_views_human_cover;
