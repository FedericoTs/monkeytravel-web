-- 2026-06-01 — Pre-launch security lockdown (conservative variant)
--
-- Supabase security advisor flagged 39 SECURITY DEFINER functions
-- executable by the `anon` role via /rest/v1/rpc/. Each is reachable
-- by an unauthenticated HTTP POST and runs with definer privileges,
-- bypassing RLS. Critical examples:
--   - admin_grant_early_access  → anon can grant admin/early-access tier
--   - add_bananas / spend_bananas → mint or drain virtual currency
--   - increment_trip_like_count → fake social proof
--   - increment_trip_reported_count → auto-hide any trip by reporting
--   - handle_new_user → trigger function should never be callable directly
--
-- Strategy (LAUNCH-NIGHT, CONSERVATIVE):
--   Revoke EXECUTE from `anon` only. `authenticated` grants are
--   preserved so existing API routes (which use the cookie-based
--   server Supabase client, NOT service_role) keep working.
--
--   This kills the highest-impact attack vector — anonymous REST
--   calls — while keeping every legitimate codepath intact. A
--   tighter follow-up will move the dangerous mutations behind
--   service_role + add trigger-level rate limits (see #366).
--
--   Trigger functions (handle_new_user, update_proposal_updated_at,
--   on_proposal_vote_insert) are ALSO revoked from authenticated
--   since they're never meant to be RPC-callable — they only ever
--   fire as table triggers running as table owner.
--
--   service_role bypasses these grants (it's the supabase superuser
--   role) so cron / server-side jobs are unaffected.

BEGIN;

-- ─── 1. Banana economy ──────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.add_bananas(uuid, integer, text, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.spend_bananas(uuid, integer, text, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.expire_old_bananas() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_available_banana_balance(uuid) FROM PUBLIC, anon;

-- ─── 2. Admin / tier grants ─────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.admin_grant_early_access(uuid, uuid, text, integer, integer, integer, timestamp with time zone, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_admin_user() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.check_and_unlock_tier(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.increment_early_access_usage(uuid, text) FROM PUBLIC, anon;

-- ─── 3. Tester codes ────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.consume_tester_code(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.increment_tester_code_usage() FROM PUBLIC, anon;

-- ─── 4. Referral metrics ────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.increment_referral_clicks(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.increment_referral_conversions(uuid) FROM PUBLIC, anon;

-- ─── 5. Template / trip social-proof counters ───────────────────
REVOKE EXECUTE ON FUNCTION public.increment_template_copy_count(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.increment_trip_fork_count(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.increment_trip_like_count(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.increment_trip_save_count(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.increment_trip_reported_count(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.decrement_trip_like_count(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.decrement_trip_save_count(uuid) FROM PUBLIC, anon;

-- ─── 6. Usage tracking ──────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.increment_usage(uuid, text, text, text, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_user_usage(uuid, text, text) FROM PUBLIC, anon;

-- ─── 7. Invite acceptance ───────────────────────────────────────
-- accept_trip_invite needs the caller to BE p_user_id; only the
-- authenticated API route should call it, never anon directly.
REVOKE EXECUTE ON FUNCTION public.accept_trip_invite(text, uuid) FROM PUBLIC, anon;

-- ─── 8. Trip-detail mutation ────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.update_activity_website(uuid, text, text) FROM PUBLIC, anon;

-- ─── 9. Trending score recompute ────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.update_trip_trending_score(uuid) FROM PUBLIC, anon;

-- ─── 10. Trigger-only functions ─────────────────────────────────
-- Never meant to be RPC-callable; revoke from EVERY role except owner.
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_proposal_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.on_proposal_vote_insert() FROM PUBLIC, anon, authenticated;

-- ─── KEPT (no change) ───────────────────────────────────────────
-- The following remain executable by anon by design:
--   - user_can_access_trip / user_can_vote / user_has_trip_access /
--     user_is_trip_collaborator / user_is_trip_owner
--       → called from RLS policies; anon needs EXECUTE
--   - get_invite_by_token / get_invite_status_by_token
--       → /invite/<token> landing page works for anonymous visitors
--   - get_page_views_by_city / get_page_views_by_country
--       → public analytics; no PII
--   - st_estimatedextent (3 PostGIS variants)

COMMIT;
