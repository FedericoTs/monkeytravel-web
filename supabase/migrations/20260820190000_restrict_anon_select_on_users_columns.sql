-- Stop the ANON role reading every column of public.users.
--
-- FOUND 2026-08-20 while verifying an unrelated migration. The RLS policy
-- `users_select_public` is USING (true), and anon held SELECT on all 48
-- columns, so anyone holding the anon key — which ships in the public JS
-- bundle at /_next/static/chunks/*.js — could dump all 447 rows including
-- every email address:
--
--     GET /rest/v1/users?select=email  ->  200, content-range 0-0/447
--
-- Reproduced end to end with the key scraped from production before changing
-- anything, and confirmed closed afterwards (now 42501 permission denied).
--
-- WHY A COLUMN GRANT AND NOT AN RLS CHANGE
--
-- RLS is row-level; it cannot express "these columns only". Tightening the row
-- policy to `id = auth.uid()` would break genuine ANONYMOUS reads of other
-- people's rows:
--
--     app/[locale]/join/[code]   -> display_name, avatar_url  (referral page)
--     app/api/invites/[token]    -> display_name, avatar_url
--     app/api/explore/trips      -> id, username, privacy_settings
--
-- So the row policy stays permissive and the column grant does the work.
--
-- AUDIT BEHIND THE COLUMN LIST
--
-- All 49 files reading public.users were classified by which client they use.
-- Every reader of a restricted column is either service_role (bypasses RLS and
-- column grants) or requires a logged-in user — including the two that looked
-- anonymous at first glance: lib/consent/storage.ts is documented "for
-- logged-in users" and takes a userId, and /api/referral/leaderboard returns
-- 401 to anonymous callers. So this changes nothing for `authenticated`.
--
-- KNOWN RESIDUAL, TRACKED SEPARATELY
--
-- `authenticated` still holds SELECT on all columns with a USING (true) row
-- policy, so any signed-in user can still read other people's rows. Signup is
-- free, so that is a real gap — but closing it needs a public_profiles view
-- plus a row-policy change plus repointing the cross-user readers (the
-- leaderboard reads other users' referral_tier). That is a change with real
-- breakage risk; this migration removes the internet-facing exposure without
-- touching logged-in behaviour.

revoke select on public.users from anon;

grant select (
  id,
  display_name,
  avatar_url,
  username,
  privacy_settings
) on public.users to anon;

-- PostgREST caches privileges alongside the schema; without this the change
-- does not take effect until the next unrelated DDL.
notify pgrst, 'reload schema';
