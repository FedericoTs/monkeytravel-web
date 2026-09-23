-- Credit gameplay bananas with the caps checked in the same transaction.
-- Apply at merge time, BEFORE the new code is live: /api/bananas/award now
-- calls this function. It only adds a function, so the old code is
-- unaffected.
--
-- WHY (review round 2, 2026-09-23)
-- The award route checked its caps (one activity credit per activity in
-- the trip, 150 bananas a day) with plain reads and then credited through
-- add_bananas. Nothing serialised the two, so a burst of parallel requests
-- all read the same totals and all got credited: 20 trips x 14 parallel
-- achievement / trip-complete requests landed about 1,500 bananas instead
-- of 150, repeatable daily. Bananas buy AI generations.
--
-- Now the route passes the caps here. The function locks the user's row
-- first (add_bananas locks the same row, so every credit to one user is
-- serialised), then re-checks, in order:
--   duplicate  the (user, type, reference) was already credited
--   capped     activity_completion over the trip's activity count, or the
--              24-hour gameplay total would pass the daily cap
--   credited   add_bananas ran; new_balance is the balance after it
-- The caller is the service role only. p_activity_cap and p_daily_cap come
-- from the route (the trip's itinerary length and DAILY_GAMEPLAY_AWARD_CAP).

create or replace function public.award_gameplay_bananas(
  p_user_id uuid,
  p_type text,
  p_reference text,
  p_amount integer,
  p_trip_id uuid,
  p_activity_cap integer,
  p_daily_cap integer,
  p_description text default null
)
 returns table(outcome text, new_balance integer)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_balance integer;
  v_on_trip integer;
  v_today integer;
begin
  if p_type not in ('activity_completion', 'achievement_bonus', 'trip_complete', 'first_trip_bonus') then
    raise exception 'award_gameplay_bananas: not a gameplay award: %', p_type using errcode = '22023';
  end if;
  if p_amount is null or p_amount < 1 then
    raise exception 'award_gameplay_bananas: amount must be positive' using errcode = '22023';
  end if;

  select coalesce(banana_balance, 0) into v_balance
    from public.users where id = p_user_id
     for update;
  if not found then
    raise exception 'User not found';
  end if;

  if exists (
    select 1 from public.banana_transactions
     where user_id = p_user_id and transaction_type = p_type and reference_id = p_reference
  ) then
    return query select 'duplicate'::text, v_balance;
    return;
  end if;

  if p_type = 'activity_completion' then
    select count(*) into v_on_trip
      from public.banana_transactions
     where user_id = p_user_id
       and transaction_type = 'activity_completion'
       and reference_id like p_trip_id::text || ':%';
    if v_on_trip >= coalesce(p_activity_cap, 0) then
      return query select 'capped'::text, v_balance;
      return;
    end if;
  end if;

  select coalesce(sum(amount), 0) into v_today
    from public.banana_transactions
   where user_id = p_user_id
     and amount > 0
     and transaction_type in ('activity_completion', 'achievement_bonus', 'trip_complete', 'first_trip_bonus')
     and created_at >= now() - interval '24 hours';
  if v_today + p_amount > coalesce(p_daily_cap, 0) then
    return query select 'capped'::text, v_balance;
    return;
  end if;

  return query
    select 'credited'::text, b.new_balance
      from public.add_bananas(p_user_id, p_amount, p_type, p_reference, p_description) b;
end;
$function$;

revoke execute on function public.award_gameplay_bananas(uuid, text, text, integer, uuid, integer, integer, text) from public, anon, authenticated;
grant execute on function public.award_gameplay_bananas(uuid, text, text, integer, uuid, integer, integer, text) to service_role;
