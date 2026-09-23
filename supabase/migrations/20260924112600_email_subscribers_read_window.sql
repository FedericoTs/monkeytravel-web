-- Stop the public read of email_subscribers, step 1 of 2. Applied to
-- production on 2026-09-23, before merge, because it was an active exposure
-- (found by the adversarial review of the security branch).
--
-- email_subscribers_anon_select was FOR SELECT TO anon, authenticated,
-- service_role USING (true), so the public anon key listed every waitlist
-- subscriber's email with the user agent and referer in metadata (23 rows).
-- It existed only so app/api/subscribe could read back the row it had just
-- inserted (insert(...).select('id, email') on the anon client).
--
-- Step 1 (this migration, applied now): the policy only shows rows created
-- in the last 30 seconds, which is enough for that read-back and hides every
-- existing subscriber. UPDATE and DELETE were never allowed by any policy;
-- their grants go too.
-- Step 2 (20260924123000, after the code is live): the subscribe route
-- inserts through the service role without reading back, and the policy
-- and the anon/authenticated read grants go entirely.

drop policy if exists email_subscribers_anon_select on public.email_subscribers;
create policy email_subscribers_anon_select
  on public.email_subscribers
  for select
  to anon, authenticated
  using (created_at > now() - interval '30 seconds');

revoke update, delete, truncate, references, trigger on public.email_subscribers from public, anon, authenticated;
