-- Point every analytics RPC at human traffic only.
--
-- The is_bot column (20260827114031) marked the rows; nothing read it yet, so
-- the admin dashboard still reported 18% crawler volume as visitors — 75,337
-- of those being SentryUptimeBot, our own uptime monitor.
--
-- WHY A VIEW RATHER THAN EDITING NINE FUNCTION BODIES
-- The nine functions have inconsistent shapes: some have a WHERE to hang a
-- filter off, some do not, one references the table three times. Injecting a
-- predicate into each is nine chances to get boolean precedence wrong.
-- Swapping the table reference is one mechanical substitution, verified safe
-- first: in all nine, every occurrence of 'page_views' is a FROM/JOIN target,
-- and none declares a column by that name.
--
-- This also supersedes the inline user-agent regex added by
-- 20260621_filter_bots_from_page_view_aggregations. That version covered only
-- four of the nine functions and kept its own copy of the signature list, so
-- it drifted from the app's. Functions that had it keep it harmlessly — they
-- now read the view as well, which is strictly stricter.
--
-- security_invoker = true is deliberate. A view defaults to DEFINER rights,
-- and that exact default is what made public_profiles anon-writable in the
-- 2026-08-21 audit. This view is SELECT-only and inherits the caller's rights
-- over the underlying table, so it cannot widen access.
--
-- Measured impact: unique visitors 25,393 -> 24,724 (-2.6%), but the homepage
-- fell from 89,681 views to 10,399 (-88%). The gap is the shape of the
-- problem: one uptime monitor is a single "visitor" hammering one path, so it
-- barely moved distinct-visitor counts while completely dominating per-page
-- numbers. Anyone reasoning about the homepage from this table was wrong by 9x.

create or replace view public.page_views_human
  with (security_invoker = true) as
  select * from public.page_views where is_bot = false;

comment on view public.page_views_human is
  'page_views with declared bots excluded. Analytics RPCs read this, never the raw table. Writes still go to page_views directly — bot rows are RECORDED, just not counted, so crawler load stays measurable.';

-- Rewrite each analytics function to read the view. pg_get_functiondef
-- round-trips the whole definition (signature, volatility, security,
-- search_path), so only the table reference changes.
do $migrate$
declare
  fn record;
  new_def text;
begin
  for fn in
    select p.oid, p.proname, pg_get_functiondef(p.oid) as def
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.prosrc ~* '(from|join)\s+page_views\M'
  loop
    -- \M is the end-of-word boundary: matches 'page_views' but NOT
    -- 'page_views_human', so re-running this migration is a no-op.
    new_def := regexp_replace(fn.def, '(from|join)(\s+)page_views\M',
                              '\1\2public.page_views_human', 'gi');
    if new_def <> fn.def then
      execute new_def;
      raise notice 'rewired %', fn.proname;
    end if;
  end loop;
end
$migrate$;
