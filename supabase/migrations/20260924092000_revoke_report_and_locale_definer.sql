-- Close two more SECURITY DEFINER functions that callers outside the server
-- could reach. Found by the adversarial review of #174 (2026-09-23), which
-- went looking beyond the three functions 20260924090000 closed.
--
-- 1. user_inferred_ui_locale(p_min_views, p_min_share) — executable by ANON.
--    It returns every signed-in user's id, their inferred language and their
--    page-view counts, read from page_views_human with the owner's rights, so
--    row-level security never applies. The anon key ships in the browser
--    bundle, so anyone could POST /rest/v1/rpc/user_inferred_ui_locale and
--    enumerate the user base with activity volumes. 20260827150000 revoked
--    it from PUBLIC but anon keeps its own grant. The only caller is
--    scripts/audit-queued-emails.mts, which uses the service-role key.
--
-- 2. increment_trip_reported_count(p_trip_id) — executable by authenticated.
--    The report route rate-limits reports per IP, then calls this through the
--    service-role client. Calling the function directly skipped the rate
--    limit, so one account could push any trip's report count up at will.
--
-- Both are now service-role only; neither caller changes.
--
-- NOT done here, on purpose: increment/decrement_trip_like_count,
-- increment/decrement_trip_save_count, increment_trip_fork_count,
-- increment_template_copy_count and update_trip_trending_score have the same
-- exposure (any signed-in user can inflate any trip's counters or trending
-- score), BUT the like, save, fork, copy, publish and submit-trending routes
-- call them with the signed-in user's own client. Revoking them would break
-- those features. Each needs its call moved behind the service role first.
--
-- Also: the table comment on page_view_session_labels listed reasons only up
-- to legacy_sweep; it now names the two added this week.

revoke execute on function public.user_inferred_ui_locale(integer, numeric) from public, anon, authenticated;
grant execute on function public.user_inferred_ui_locale(integer, numeric) to service_role;

revoke execute on function public.increment_trip_reported_count(uuid) from public, anon, authenticated;
grant execute on function public.increment_trip_reported_count(uuid) to service_role;

comment on table public.page_view_session_labels is
  'One row per (session, UTC day) excluded from page_views_human: automation presenting as a browser, or (phantom_prefetch) a session that was only the prefetch bug. Rebuilt nightly by label_automation_sessions(). reason ∈ phantom_prefetch | document_burst | heavy_unengaged | ua_city_sweep | ua_family_sweep | family_conversionless | ua_lagging_fleet | nocity_lagging_fleet | stale_chrome | legacy_sweep | cookieless_internal_entry | entry_burst_fleet. Labelling only — nothing is blocked.';
