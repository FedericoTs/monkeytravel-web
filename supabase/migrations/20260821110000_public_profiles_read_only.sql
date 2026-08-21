-- CRITICAL: make public.public_profiles read-only.
--
-- The view is security_invoker=false — it MUST be, so cross-user name/avatar
-- reads bypass users' owner-only row policy (that is the entire reason it
-- exists, 20260820200000). It is also a simple single-table projection of
-- public.users, which makes it AUTO-UPDATABLE.
--
-- Supabase's default privileges grant anon/authenticated INSERT/UPDATE/DELETE
-- on every new object in schema public, so those grants landed on the view even
-- though 20260820200000 only intended to GRANT SELECT. And a write through a
-- security_invoker=false view runs as the view OWNER, bypassing RLS on the base
-- table.
--
-- Net effect, proven against the anon role in a rolled-back transaction:
--   UPDATE public_profiles SET display_name='PWNED' WHERE id='<any user>'  -> SUCCEEDED
--   DELETE FROM public_profiles WHERE id='<any user>'                       -> SUCCEEDED
-- Anyone holding the public anon key (shipped in the JS bundle) could rewrite
-- or delete ANY user's row. This is strictly worse than the read exposure the
-- view was created to fix.
--
-- Base tables were NOT affected — anon writes to public.users / public.trips are
-- blocked by the grant lockdown and RLS respectively; the view was the only
-- RLS-bypassing write path. Confirmed with the same harness.
--
-- Found by running tenant-guard (FedericoTs/tenant-guard): its anon-writes /
-- view-isolation guards target exactly this class of leak.
--
-- Fix: strip write privileges. The view is read-only by design; SELECT
-- (granted in 20260820200000) is retained, so every reader — batch-users,
-- /join, activity/proposal vote attribution, Settle Up names — is unaffected.

revoke insert, update, delete on public.public_profiles from anon, authenticated, public;

notify pgrst, 'reload schema';
