-- Guard the plan, billing and referral columns on public.users, and limit
-- what a user can insert into their own referral code. Safe to apply at
-- merge time: no legitimate user-client write sets these columns except to
-- the values the guard keeps.
--
-- WHY
-- authenticated holds UPDATE and INSERT on every column of public.users and
-- the policies only check id = auth.uid(). Found 2026-09-23, with a user's
-- own token and the public anon key, any signed-in user could:
--   - set their own subscription_tier to 'enterprise' (unlimited AI in
--     lib/usage-limits), subscription_expires_at, is_pro, the Stripe ids;
--   - set referral_tier = 3 (unlimited regenerations), banana_balance,
--     lifetime_referral_conversions, referred_by_code, referral_completed_at;
--   - set email to the admin's address in another letter case:
--     users_email_key is case-sensitive, isAdmin() lowercases, and
--     getUserTier() also trusts users.email for the admin bypass.
-- And the self-insert policy on referral_codes accepted total_clicks,
-- total_signups and total_conversions, which check_and_unlock_tier() pays
-- tiers and bananas on.
-- Nobody had used any of it: 0 non-free tiers, 0 is_pro, 0 referral tiers,
-- no trial longer than 8 days, the highest banana balance 100.
--
-- WHAT
-- A BEFORE INSERT OR UPDATE trigger on users. Callers that are not trusted
-- (current_user other than postgres / service_role / supabase_admin):
--   - the protected columns keep their stored values on UPDATE, and start at
--     their defaults on INSERT, silently (the signup page and auth callback
--     send is_pro: false, which stays false). The exception is
--     referral_completed_at, where a change raises 42501 (see the body);
--   - email may only be set to the caller's own sign-in email (the JWT's).
-- Every legitimate writer is trusted: add_bananas / spend_bananas /
-- check_and_unlock_tier / attach_referral_on_signup / the referral
-- completion and invite routes run as postgres or the service role.
-- trial_ends_at stays writable: the signup page and callback set it, and
-- nothing gates on it (useTrial has no callers).
-- SECURITY INVOKER on purpose: inside a definer function current_user is
-- always postgres and the guard would do nothing.
--
-- referral_codes: users keep INSERT on (user_id, code) only, which is what
-- get_or_create_referral_code() inserts (it is SECURITY INVOKER).
--
-- Rollback: drop trigger users_guard_protected_columns on public.users;
-- grant insert on public.referral_codes to authenticated.

create or replace function public.users_guard_protected_columns()
 returns trigger
 language plpgsql
 security invoker
 set search_path to 'public'
as $function$
declare
  v_jwt_email text := coalesce(auth.jwt() ->> 'email', '');
begin
  if current_user in ('postgres', 'service_role', 'supabase_admin') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.subscription_tier := 'free';
    new.subscription_expires_at := null;
    new.stripe_customer_id := null;
    new.stripe_subscription_id := null;
    new.is_pro := false;
    new.banana_balance := 0;
    new.referral_tier := 0;
    new.lifetime_referral_conversions := 0;
    new.referred_by_code := null;
    new.referral_completed_at := null;
    new.signed_up_via_trip_invite := null;
    if v_jwt_email <> '' and lower(new.email) is distinct from lower(v_jwt_email) then
      new.email := v_jwt_email;
    end if;
    return new;
  end if;

  -- referral_completed_at raises rather than being kept: it is the one-time
  -- claim that stops a referral paying twice. The code before 2026-09-23
  -- made that claim from the user's own client and treated "a row came
  -- back" as winning it; a silently kept NULL would have let every call win
  -- and pay the referrer again (found in review). An error makes the old
  -- code stop before paying, so this migration is safe with either version
  -- of lib/referral/completion.ts, and after a rollback.
  if new.referral_completed_at is distinct from old.referral_completed_at then
    raise exception 'users.referral_completed_at is set by the server'
      using errcode = '42501';
  end if;

  new.subscription_tier := old.subscription_tier;
  new.subscription_expires_at := old.subscription_expires_at;
  new.stripe_customer_id := old.stripe_customer_id;
  new.stripe_subscription_id := old.stripe_subscription_id;
  new.is_pro := old.is_pro;
  new.banana_balance := old.banana_balance;
  new.referral_tier := old.referral_tier;
  new.lifetime_referral_conversions := old.lifetime_referral_conversions;
  new.referred_by_code := old.referred_by_code;
  new.signed_up_via_trip_invite := old.signed_up_via_trip_invite;
  if new.email is distinct from old.email
     and (v_jwt_email = '' or lower(new.email) is distinct from lower(v_jwt_email)) then
    new.email := old.email;
  end if;
  return new;
end;
$function$;

drop trigger if exists users_guard_protected_columns on public.users;
create trigger users_guard_protected_columns
  before insert or update on public.users
  for each row execute function public.users_guard_protected_columns();

revoke insert on public.referral_codes from public, anon, authenticated;
grant insert (user_id, code) on public.referral_codes to authenticated;
