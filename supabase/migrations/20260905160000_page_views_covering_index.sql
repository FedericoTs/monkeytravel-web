-- page_views: a covering index for the human view's window scans.
--
-- MEASURED 2026-09-05 (EXPLAIN ANALYZE, 28-day window):
--   Index Scan using idx_page_views_human_created_at  rows=154,899
--   Buffers: shared hit=94,502  ->  3,865 ms
-- One heap page touched per row. The table has only 39,025 pages; the scan
-- revisits them because the rows are scattered: n_tup_upd = 314,727 — the
-- 2026-08-27 is_bot backfill rewrote every row and destroyed the time-order
-- locality that append-only inserts give. Any 28-day read through the view
-- (get_live_trip_baseline, the nightly labeller, the rollup) pays ~4 s per
-- scan, and the baseline function paid it twice, which is how it crossed
-- PostgREST's 8-second statement timeout.
--
-- The existing partial index is (created_at) WHERE is_bot = false — the right
-- key, but nothing included, so every row goes to the heap. This replaces it
-- with the same key plus the three columns every analytics read needs, so the
-- scan becomes index-only and never touches the scattered heap. Paths average
-- 16 characters (max 64), so the index stays small.

create index if not exists idx_page_views_human_cover
  on public.page_views (created_at)
  include (session_id, user_id, path)
  where is_bot = false;

drop index if exists public.idx_page_views_human_created_at;

comment on index public.idx_page_views_human_cover is
  'Covering partial index for page_views_human window scans (index-only): created_at + session_id, user_id, path, where is_bot = false. Replaced idx_page_views_human_created_at 2026-09-05 after a 155k-row scan measured 94k buffer hits / 3.9 s.';
