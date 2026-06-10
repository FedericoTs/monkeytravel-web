-- ============================================================================
-- SECURITY: internal authorization guards on privileged SECURITY DEFINER funcs
-- ============================================================================
-- 2026-06-09 audit finding. The Supabase advisor flagged 39 SECURITY DEFINER
-- functions as EXECUTE-able by the `authenticated` role via /rest/v1/rpc.
-- Task #365 only revoked the `anon` role; the `authenticated` exposure
-- remained. Several of these take the target user/code as a *parameter* and
-- had NO internal auth check, so any signed-up user could call them directly
-- against another user:
--
--   delete_user_account(p_user_id)        -> delete ANY account
--   add_bananas(p_user_id, p_amount, ...) -> mint unlimited currency
--   admin_grant_early_access(p_user_id)   -> self-grant elevated AI limits
--   increment_usage(p_user_id, ...)       -> burn another user's quota
--   spend_bananas / check_and_unlock_tier -> economy manipulation
--   increment_referral_conversions        -> referral inflation
--   consume_tester_code                   -> tester-code abuse
--
-- Fix: keep the EXECUTE grant (the app's user-scoped client legitimately
-- calls some of these for the CURRENT user), but add an internal guard so the
-- function refuses to act across the user boundary unless the caller is the
-- service role.
--
-- Two guard shapes:
--   * SELF-OR-SERVICE  - functions that a user legitimately calls for THEMSELVES
--                        via the user client (award own bananas, spend own,
--                        increment own usage). Allowed when auth.uid() = the
--                        target p_user_id, OR caller is service_role.
--   * SERVICE-ONLY     - functions only ever called server-side via the admin
--                        (service-role) client. No legitimate user-client path.
--
-- Call-site audit that backs each classification (2026-06-09):
--   delete_user_account            -> app/api/profile/delete (admin client)   SERVICE-ONLY
--   admin_grant_early_access       -> app/api/admin/grant-access (admin)       SERVICE-ONLY
--   consume_tester_code            -> app/api/admin/grant-access (admin)       SERVICE-ONLY
--   increment_referral_conversions -> lib/referral/completion (admin, refactor) SERVICE-ONLY
--   add_bananas                    -> award(self,user) / referral+collab(admin) SELF-OR-SERVICE
--   spend_bananas                  -> spend(self,user) / clawback(admin)        SELF-OR-SERVICE
--   increment_usage                -> usage-limits(self,user)                   SELF-OR-SERVICE
--   check_and_unlock_tier          -> referral+invites(admin)                   SELF-OR-SERVICE
--
-- The companion code change routes lib/referral/completion.ts's three
-- cross-user writes through the service-role admin client so the SERVICE
-- branch is satisfied (referee session != referrer being rewarded).
--
-- NOTE: bodies below are reproduced verbatim from the live definitions with
-- ONLY the guard block prepended after BEGIN. No other logic changed.
-- Lower-severity count functions (increment_trip_like/save/fork_count) take a
-- trip id, not a user id, and the anon-save path uses the user client; those
-- are tracked as a separate follow-up (count inflation, not data loss).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- SERVICE-ONLY
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.delete_user_account(p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF (SELECT auth.role()) <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden: service-role only' USING ERRCODE = '42501';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id is required';
  END IF;

  DELETE FROM public.trips WHERE user_id = p_user_id;
  DELETE FROM public.ai_usage WHERE user_id = p_user_id;
  DELETE FROM public.user_tester_access WHERE user_id = p_user_id;
  DELETE FROM public.users WHERE id = p_user_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_grant_early_access(p_user_id uuid, p_code_id uuid, p_code_used text, p_ai_generations_limit integer DEFAULT NULL::integer, p_ai_regenerations_limit integer DEFAULT NULL::integer, p_ai_assistant_limit integer DEFAULT NULL::integer, p_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_granted_by uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_access_id UUID;
BEGIN
  IF (SELECT auth.role()) <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden: service-role only' USING ERRCODE = '42501';
  END IF;

  INSERT INTO user_tester_access (
    user_id, code_id, code_used,
    ai_generations_limit, ai_generations_used,
    ai_regenerations_limit, ai_regenerations_used,
    ai_assistant_limit, ai_assistant_used,
    expires_at, redeemed_at
  ) VALUES (
    p_user_id, p_code_id, p_code_used,
    p_ai_generations_limit, 0,
    p_ai_regenerations_limit, 0,
    p_ai_assistant_limit, 0,
    p_expires_at, NOW()
  )
  RETURNING id INTO v_access_id;

  RETURN v_access_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.consume_tester_code(code_id uuid)
 RETURNS TABLE(new_current_uses integer, out_max_uses integer, exhausted boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    IF (SELECT auth.role()) <> 'service_role' THEN
      RAISE EXCEPTION 'forbidden: service-role only' USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    UPDATE public.tester_codes
    SET current_uses = current_uses + 1
    WHERE id = code_id
      AND (max_uses IS NULL OR current_uses < max_uses)
    RETURNING
        current_uses AS new_current_uses,
        max_uses AS out_max_uses,
        (max_uses IS NOT NULL AND current_uses >= max_uses) AS exhausted;
END;
$function$;

CREATE OR REPLACE FUNCTION public.increment_referral_conversions(p_code_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    new_count INTEGER;
BEGIN
    IF (SELECT auth.role()) <> 'service_role' THEN
      RAISE EXCEPTION 'forbidden: service-role only' USING ERRCODE = '42501';
    END IF;

    UPDATE public.referral_codes
    SET total_conversions = COALESCE(total_conversions, 0) + 1
    WHERE id = p_code_id
    RETURNING total_conversions INTO new_count;
    RETURN COALESCE(new_count, 0);
END;
$function$;

-- ---------------------------------------------------------------------------
-- SELF-OR-SERVICE
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.add_bananas(p_user_id uuid, p_amount integer, p_type text, p_reference_id text DEFAULT NULL::text, p_description text DEFAULT NULL::text)
 RETURNS TABLE(new_balance integer, transaction_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_new_balance INTEGER;
  v_expires_at  TIMESTAMPTZ;
  v_tx_id       UUID;
BEGIN
  IF (SELECT auth.role()) <> 'service_role'
     AND (SELECT auth.uid()) IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'forbidden: cross-user operation not allowed' USING ERRCODE = '42501';
  END IF;

  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;

  v_expires_at := NOW() + INTERVAL '12 months';

  SELECT COALESCE(banana_balance, 0)
    INTO v_new_balance
    FROM users
   WHERE id = p_user_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  v_new_balance := v_new_balance + p_amount;

  INSERT INTO banana_transactions (
    user_id, amount, balance_after, transaction_type,
    reference_id, description, expires_at
  )
  VALUES (
    p_user_id, p_amount, v_new_balance, p_type,
    p_reference_id, p_description, v_expires_at
  )
  RETURNING id INTO v_tx_id;

  UPDATE users SET banana_balance = v_new_balance WHERE id = p_user_id;

  RETURN QUERY SELECT v_new_balance, v_tx_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.spend_bananas(p_user_id uuid, p_amount integer, p_type text, p_reference_id text DEFAULT NULL::text, p_description text DEFAULT NULL::text)
 RETURNS TABLE(success boolean, new_balance integer, transaction_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_current_balance INTEGER;
  v_new_balance     INTEGER;
  v_tx_id           UUID;
BEGIN
  IF (SELECT auth.role()) <> 'service_role'
     AND (SELECT auth.uid()) IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'forbidden: cross-user operation not allowed' USING ERRCODE = '42501';
  END IF;

  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;

  SELECT COALESCE(banana_balance, 0)
    INTO v_current_balance
    FROM users
   WHERE id = p_user_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  IF v_current_balance < p_amount THEN
    RETURN QUERY SELECT false, v_current_balance, NULL::uuid;
    RETURN;
  END IF;

  v_new_balance := v_current_balance - p_amount;

  INSERT INTO banana_transactions (
    user_id, amount, balance_after, transaction_type,
    reference_id, description, expires_at
  )
  VALUES (
    p_user_id, -p_amount, v_new_balance, p_type,
    p_reference_id, p_description, NULL
  )
  RETURNING id INTO v_tx_id;

  UPDATE users SET banana_balance = v_new_balance WHERE id = p_user_id;

  RETURN QUERY SELECT true, v_new_balance, v_tx_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.increment_usage(p_user_id uuid, p_period_type text, p_period_key text, p_column_name text, p_amount integer DEFAULT 1)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_current_value INTEGER;
BEGIN
  IF (SELECT auth.role()) <> 'service_role'
     AND (SELECT auth.uid()) IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'forbidden: cross-user operation not allowed' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.user_usage (user_id, period_type, period_key)
  VALUES (p_user_id, p_period_type, p_period_key)
  ON CONFLICT (user_id, period_type, period_key) DO NOTHING;

  EXECUTE format(
    'UPDATE public.user_usage SET %I = COALESCE(%I, 0) + $1, updated_at = NOW()
     WHERE user_id = $2 AND period_type = $3 AND period_key = $4
     RETURNING %I',
    p_column_name, p_column_name, p_column_name
  ) INTO v_current_value USING p_amount, p_user_id, p_period_type, p_period_key;

  RETURN v_current_value;
END;
$function$;

CREATE OR REPLACE FUNCTION public.check_and_unlock_tier(p_user_id uuid)
 RETURNS TABLE(new_tier integer, tier_unlocked boolean, bonus_bananas integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_conversions INTEGER; v_current_tier INTEGER; v_new_tier INTEGER; v_highest_tier INTEGER;
  v_tier_unlocked BOOLEAN := false; v_bonus INTEGER := 0;
BEGIN
  IF (SELECT auth.role()) <> 'service_role'
     AND (SELECT auth.uid()) IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'forbidden: cross-user operation not allowed' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(total_conversions, 0) INTO v_conversions FROM referral_codes WHERE user_id = p_user_id;
  IF NOT FOUND THEN v_conversions := 0; END IF;
  v_new_tier := CASE WHEN v_conversions >= 10 THEN 3 WHEN v_conversions >= 6 THEN 2 WHEN v_conversions >= 3 THEN 1 ELSE 0 END;
  INSERT INTO referral_tiers (user_id, lifetime_conversions) VALUES (p_user_id, v_conversions)
  ON CONFLICT (user_id) DO UPDATE SET lifetime_conversions = GREATEST(referral_tiers.lifetime_conversions, v_conversions), updated_at = NOW()
  RETURNING current_tier, highest_tier_achieved INTO v_current_tier, v_highest_tier;
  IF v_new_tier > COALESCE(v_current_tier, 0) THEN
    v_tier_unlocked := true;
    v_bonus := CASE v_new_tier WHEN 1 THEN 100 WHEN 2 THEN 200 WHEN 3 THEN 500 ELSE 0 END;
    UPDATE referral_tiers SET current_tier = v_new_tier,
        highest_tier_achieved = GREATEST(highest_tier_achieved, v_new_tier),
        tier_1_unlocked_at = CASE WHEN v_new_tier >= 1 AND tier_1_unlocked_at IS NULL THEN NOW() ELSE tier_1_unlocked_at END,
        tier_2_unlocked_at = CASE WHEN v_new_tier >= 2 AND tier_2_unlocked_at IS NULL THEN NOW() ELSE tier_2_unlocked_at END,
        tier_3_unlocked_at = CASE WHEN v_new_tier = 3 AND tier_3_unlocked_at IS NULL THEN NOW() ELSE tier_3_unlocked_at END,
        updated_at = NOW()
    WHERE user_id = p_user_id;
    UPDATE users SET referral_tier = v_new_tier WHERE id = p_user_id;
    IF v_bonus > 0 THEN PERFORM add_bananas(p_user_id, v_bonus, 'tier_bonus', NULL, 'Tier ' || v_new_tier || ' unlock bonus'); END IF;
  END IF;
  RETURN QUERY SELECT v_new_tier, v_tier_unlocked, v_bonus;
END;
$function$;
