-- Close email_subscribers to anon and authenticated, step 2 of 2 (step 1:
-- 20260924112600, applied 2026-09-23). APPLY AFTER THE CODE IS LIVE:
-- app/api/subscribe now inserts through the service role. Applied before,
-- every waitlist signup fails with a permission error.
--
-- Every writer and reader is now the service role: the subscribe route,
-- app/api/admin/stats, the sync-resend-audience cron and account deletion.
-- Rollback: recreate email_subscribers_anon_insert and the step-1 SELECT
-- policy, and grant insert, select to anon, authenticated.

drop policy if exists email_subscribers_anon_select on public.email_subscribers;
drop policy if exists email_subscribers_anon_insert on public.email_subscribers;

revoke all on public.email_subscribers from public, anon, authenticated;
