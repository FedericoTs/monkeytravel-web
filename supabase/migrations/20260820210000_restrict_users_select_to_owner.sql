-- Close the `authenticated` half of the public.users exposure.
--
-- WHAT WAS OPEN
--
-- `users_select_public` was USING (true) for role `public`, i.e. every role.
-- 20260820190000 removed anon's column access, which stopped the internet-facing
-- leak, but any SIGNED-IN account could still read all 447 rows. Signup is free
-- and unverified, so "authenticated" is not a meaningful trust boundary: one
-- throwaway account was enough to dump every user's email, preferences,
-- notification settings and banana balance.
--
-- 3 of 447 accounts are admins, and admin-ness is an application-level email
-- allowlist (lib/admin.ts) that Postgres knows nothing about. So there is no
-- row policy that can express "admins see everything" — instead, the admin and
-- analytics surfaces read with the service client, which bypasses RLS. That
-- code change ships BEFORE this migration; see the ordering note below.
--
-- WHY THIS IS SAFE FOR THE APP
--
-- Every legitimate cross-user read was repointed at public.public_profiles
-- (20260820200000) or moved to the service client first:
--
--   lib/api/batch-users.ts                     -> public_profiles
--   app/[locale]/join/[code]                   -> public_profiles  (anon)
--   api/health                                 -> public_profiles  (anon)
--   api/trips/[id]/activities/[id]/vote        -> public_profiles  (was an embed)
--   api/trips/[id]/proposals{,/[id],/[id]/vote} -> public_profiles  (were embeds)
--   api/admin/costs, api/admin/google-metrics  -> service client
--   api/referral/leaderboard                   -> service client
--
-- The four proposal/vote call sites were PostgREST embeds — `user:user_id(...)`
-- nested inside a select on another table. They never appear as from("users"),
-- so a grep-based audit misses them entirely, and RLS does not error on an
-- embed: it returns null. Left alone they would have relabelled every
-- teammate's vote "Unknown" with nothing in the logs.
--
-- ORDERING — THIS MIGRATION MUST GO LAST
--
-- RLS denial is silent: a denied read returns zero rows, not an error. Applying
-- this before the code deploy would blank the admin dashboard, the leaderboard
-- and every collaborator name with no failure anywhere to notice. Deploy the
-- code, verify against DATA (rows actually present, names actually rendering),
-- then apply this.
--
-- Own-row reads (19 call sites), service-role reads (31), INSERT and UPDATE are
-- all unaffected: users_insert_own and users_update_own were already scoped to
-- id = auth.uid().

drop policy if exists "users_select_public" on public.users;

create policy "users_select_own"
  on public.users
  for select
  using (id = (select auth.uid()));

-- anon can no longer match a row here under any circumstance (auth.uid() is
-- null), so the narrow column grant from 20260820190000 is now dead weight.
-- Drop it rather than leave a grant whose only effect would be to soften a
-- future policy mistake. public_profiles is unaffected: it is a
-- security_invoker=false view, so it reads the base table as its owner.
revoke select on public.users from anon;

notify pgrst, 'reload schema';
