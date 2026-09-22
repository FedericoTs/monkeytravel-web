-- Which surface a consent decision was taken on.
--
-- The banner's minimised state is about to stop being a dead end and start
-- carrying both decisions. Without this column, "more people decided" cannot
-- be attributed to the thing that was built: in the seven days to 2026-09-22,
-- 226 of 228 decisions came from the card and 2 from the settings modal, and
-- every one of them looks identical in the table.
--
-- Nullable with no backfill, so the write path never breaks mid-deploy: an
-- older client still posts payloads without the field for as long as its tab
-- is open, and those rows stay countable (parseConsentEvent coerces an
-- unknown value to NULL rather than rejecting the row).
alter table public.consent_events
  add column if not exists origin text
  check (origin is null or origin in ('card', 'mini', 'settings'));

comment on column public.consent_events.origin is
  'Surface the decision was taken on: card (the banner), mini (the minimised bar), settings (the granular modal). NULL for shown/minimized, and for any row written before 2026-09-22.';

-- A SECOND function rather than a replace of get_consent_funnel: CREATE OR
-- REPLACE resets EXECUTE to PUBLIC, and this codebase has already been bitten
-- by grants living on PUBLIC (see the REVOKE-FROM-anon note in
-- ANALYTICS_SOURCES_OF_TRUTH.md). Adding one avoids the class of mistake.
create or replace function public.get_consent_funnel_by_origin(
  p_from timestamptz,
  p_to timestamptz
)
returns table(
  origin text,
  sessions_decided bigint,
  sessions_accept_all bigint,
  sessions_essential_only bigint,
  sessions_settings_saved bigint
)
language sql
stable
security definer
set search_path to 'public'
as $$
  -- One row per session, attributed to the origin of its FIRST decision:
  -- a visitor who opens Options from the bar and saves there decided once,
  -- and the bar is what got them to decide.
  with first_decision as (
    select distinct on (session_id)
           session_id, coalesce(origin, 'card') as origin, event
    from public.consent_events
    where created_at >= p_from and created_at < p_to
      and event in ('accept_all', 'essential_only', 'settings_saved')
    order by session_id, created_at
  )
  select origin,
         count(*)::bigint as sessions_decided,
         count(*) filter (where event = 'accept_all')::bigint as sessions_accept_all,
         count(*) filter (where event = 'essential_only')::bigint as sessions_essential_only,
         count(*) filter (where event = 'settings_saved')::bigint as sessions_settings_saved
  from first_decision
  group by 1
  order by 2 desc;
$$;

revoke execute on function public.get_consent_funnel_by_origin(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.get_consent_funnel_by_origin(timestamptz, timestamptz) to service_role;
