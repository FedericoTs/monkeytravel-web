-- A safe projection of public.users for cross-user reads.
--
-- CONTEXT
--
-- 20260820190000 closed the anon half of the users exposure with column-level
-- GRANTs. The `authenticated` half stayed open: the row policy is
-- USING (true), so any signed-in account could still read all 447 rows, and
-- signup is free. Closing that means restricting the row policy to the owner
-- (see 20260820210000), which in turn breaks every legitimate read of somebody
-- ELSE's name and avatar — collaborator lists, vote attribution, the referral
-- landing page.
--
-- This view is where those reads go instead. It is deliberately NOT a
-- security_invoker view: it runs with the owner's privileges, so it returns
-- rows regardless of the base table's row policy. That is the whole point —
-- the column list below IS the access control, and it is a fixed projection
-- rather than a per-row policy, so there is no way to widen it by accident.
--
-- WHAT IS AND IS NOT HERE
--
-- Present: only fields the product already renders publicly — the display
-- identity (name, avatar, username), the privacy/leaderboard preferences that
-- gate that rendering, and referral_tier for the leaderboard badge.
--
-- Absent, and must stay absent: email, preferences, notification_settings,
-- banana_balance, and the other 40 columns. Adding a column here makes it
-- world-readable to every anon caller holding the public JS bundle's key.
-- Treat any addition as a security change, not a convenience.

create or replace view public.public_profiles
with (security_invoker = false) as
select
  id,
  display_name,
  avatar_url,
  username,
  privacy_settings,
  show_on_leaderboard,
  leaderboard_visibility,
  referral_tier
from public.users;

grant select on public.public_profiles to anon, authenticated;

-- PostgREST caches privileges alongside the schema; without this the view is
-- not routable until the next unrelated DDL.
notify pgrst, 'reload schema';
