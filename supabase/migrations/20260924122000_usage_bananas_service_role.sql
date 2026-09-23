-- Close the usage, banana, referral and tester functions to direct calls,
-- and stop users writing their own tester access. APPLY AFTER THE CODE IS
-- LIVE: incrementUsage, /api/bananas/award, /api/bananas/spend,
-- /api/referral/click and redeemTesterCode now use the service role.
-- Applied before, AI and Places usage silently stops being counted (so every
-- quota stops being enforced), banana awards and redemptions fail, and
-- tester codes can't be redeemed. Rolling Vercel back has the same effect.
--
-- WHY (found 2026-09-23; nothing here was exploited)
--   - increment_usage(p_user_id, ..., p_column_name, p_amount): a signed-in
--     user could call it on their own row with a negative amount and reset
--     their AI quota, or name any column.
--   - add_bananas / spend_bananas / check_and_unlock_tier: callable on the
--     caller's own id; add_bananas mints.
--   - get_available_banana_balance, get_user_usage: any user's balance and
--     usage, no caller check.
--   - increment_referral_clicks, increment_referral_conversions,
--     expire_old_bananas, consume_tester_code, admin_grant_early_access,
--     increment_tester_code_usage: no caller check at all, or one only the
--     service role should pass.
--   - user_tester_access: the self INSERT and UPDATE policies let a user
--     create or rewrite their own access row with any AI limit, reset the
--     used counts and clear the expiry.
--
-- increment_usage also gets a whitelist of its seven counter columns and a
-- positive-amount check, in case a grant ever comes back. Every caller in
-- the app passes 1.
--
-- Rollback: grant execute on the functions to authenticated; recreate the
-- tester policies with the (auth.uid() = user_id) branch.

create or replace function public.increment_usage(
  p_user_id uuid,
  p_period_type text,
  p_period_key text,
  p_column_name text,
  p_amount integer default 1
)
 returns integer
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_current_value integer;
begin
  if (select auth.role()) <> 'service_role'
     and (select auth.uid()) is distinct from p_user_id then
    raise exception 'forbidden: cross-user operation not allowed' using errcode = '42501';
  end if;
  if p_column_name not in (
    'ai_generations_used', 'ai_regenerations_used', 'ai_assistant_messages_used',
    'ai_tokens_used', 'places_autocomplete_used', 'places_search_used',
    'places_details_used'
  ) then
    raise exception 'increment_usage: unknown counter %', p_column_name using errcode = '22023';
  end if;
  if p_amount is null or p_amount < 1 then
    raise exception 'increment_usage: amount must be positive' using errcode = '22023';
  end if;
  insert into public.user_usage (user_id, period_type, period_key)
  values (p_user_id, p_period_type, p_period_key)
  on conflict (user_id, period_type, period_key) do nothing;
  execute format(
    'update public.user_usage set %I = coalesce(%I, 0) + $1, updated_at = now()
      where user_id = $2 and period_type = $3 and period_key = $4
      returning %I',
    p_column_name, p_column_name, p_column_name
  ) into v_current_value using p_amount, p_user_id, p_period_type, p_period_key;
  return v_current_value;
end;
$function$;

revoke execute on function public.increment_usage(uuid, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.increment_usage(uuid, text, text, text, integer) to service_role;

revoke execute on function public.add_bananas(uuid, integer, text, text, text) from public, anon, authenticated;
grant execute on function public.add_bananas(uuid, integer, text, text, text) to service_role;

revoke execute on function public.spend_bananas(uuid, integer, text, text, text) from public, anon, authenticated;
grant execute on function public.spend_bananas(uuid, integer, text, text, text) to service_role;

revoke execute on function public.check_and_unlock_tier(uuid) from public, anon, authenticated;
grant execute on function public.check_and_unlock_tier(uuid) to service_role;

revoke execute on function public.get_available_banana_balance(uuid) from public, anon, authenticated;
grant execute on function public.get_available_banana_balance(uuid) to service_role;

revoke execute on function public.get_user_usage(uuid, text, text) from public, anon, authenticated;
grant execute on function public.get_user_usage(uuid, text, text) to service_role;

revoke execute on function public.expire_old_bananas() from public, anon, authenticated;
grant execute on function public.expire_old_bananas() to service_role;

revoke execute on function public.increment_referral_clicks(uuid) from public, anon, authenticated;
grant execute on function public.increment_referral_clicks(uuid) to service_role;

revoke execute on function public.increment_referral_conversions(uuid) from public, anon, authenticated;
grant execute on function public.increment_referral_conversions(uuid) to service_role;

revoke execute on function public.increment_tester_code_usage() from public, anon, authenticated;
grant execute on function public.increment_tester_code_usage() to service_role;

revoke execute on function public.consume_tester_code(uuid) from public, anon, authenticated;
grant execute on function public.consume_tester_code(uuid) to service_role;

revoke execute on function public.admin_grant_early_access(uuid, uuid, text, integer, integer, integer, timestamp with time zone, uuid) from public, anon, authenticated;
grant execute on function public.admin_grant_early_access(uuid, uuid, text, integer, integer, integer, timestamp with time zone, uuid) to service_role;

drop policy if exists user_tester_access_insert on public.user_tester_access;
create policy user_tester_access_insert
  on public.user_tester_access
  for insert
  to authenticated
  with check (is_admin_user() or ((select auth.role()) = 'service_role'));

drop policy if exists user_tester_access_update on public.user_tester_access;
create policy user_tester_access_update
  on public.user_tester_access
  for update
  to authenticated
  using (is_admin_user() or ((select auth.role()) = 'service_role'))
  with check (is_admin_user() or ((select auth.role()) = 'service_role'));
