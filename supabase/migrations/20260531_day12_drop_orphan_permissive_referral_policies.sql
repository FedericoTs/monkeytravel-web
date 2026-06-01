-- =====================================================================
-- Day-12 Performance: Drop 4 orphan permissive policies on referral_*
-- =====================================================================
-- Follow-up to the Day-11 multiple_permissive_policies consolidation.
-- The Day-11 agent matched against expected policy names but missed 4
-- orphans on referral_codes + referral_tiers with different names:
--
--   referral_codes:
--     * "Public can view referral codes by code"  (SELECT, {public}, USING true)
--     * "Users can view own referral code"        (SELECT, {public}, USING auth.uid()=user_id)
--   referral_tiers:
--     * "Leaderboard can view tiers"              (SELECT, {public}, USING true)
--     * "Users can view own tier"                 (SELECT, {public}, USING auth.uid()=user_id)
--
-- All 4 are strictly equal-or-narrower than the *_select_consolidated
-- policies created in Day-11 (which use USING(true) — already covers
-- everyone). Dropping them is a pure simplification: zero access change,
-- 12 advisor findings cleared.
--
-- Idempotent (IF EXISTS) so re-runs are safe.

DROP POLICY IF EXISTS "Public can view referral codes by code" ON public.referral_codes;
DROP POLICY IF EXISTS "Users can view own referral code"       ON public.referral_codes;
DROP POLICY IF EXISTS "Leaderboard can view tiers"             ON public.referral_tiers;
DROP POLICY IF EXISTS "Users can view own tier"                ON public.referral_tiers;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- Verification (informational, run after apply):
--   SELECT tablename, cmd, COUNT(*)
--     FROM pg_policies
--    WHERE schemaname='public' AND permissive='PERMISSIVE'
--    GROUP BY tablename, cmd
--    HAVING COUNT(*) >= 2;
-- Expected: 0 rows.
-- =====================================================================
