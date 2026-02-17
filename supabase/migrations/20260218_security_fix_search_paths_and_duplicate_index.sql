-- =============================================================
-- Security & Performance Fix Migration
-- 1. Set search_path on 14 functions (prevents search_path hijacking)
-- 2. Drop duplicate index on api_request_logs
-- =============================================================

-- Fix search_path on all public functions
-- Using SET search_path = 'public' since all functions reference public schema tables

CREATE OR REPLACE FUNCTION public.add_bananas(p_user_id uuid, p_amount integer, p_type text, p_reference_id uuid DEFAULT NULL::uuid, p_description text DEFAULT NULL::text)
 RETURNS TABLE(new_balance integer, transaction_id uuid)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public'
AS $function$
DECLARE v_new_balance INTEGER; v_expires_at TIMESTAMPTZ; v_tx_id UUID;
BEGIN
  IF p_amount <= 0 THEN RAISE EXCEPTION 'Amount must be positive'; END IF;
  v_expires_at := NOW() + INTERVAL '12 months';
  SELECT COALESCE(banana_balance, 0) INTO v_new_balance FROM users WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'User not found'; END IF;
  v_new_balance := v_new_balance + p_amount;
  INSERT INTO banana_transactions (user_id, amount, balance_after, transaction_type, reference_id, description, expires_at)
  VALUES (p_user_id, p_amount, v_new_balance, p_type, p_reference_id, p_description, v_expires_at) RETURNING id INTO v_tx_id;
  UPDATE users SET banana_balance = v_new_balance WHERE id = p_user_id;
  RETURN QUERY SELECT v_new_balance, v_tx_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.check_and_unlock_tier(p_user_id uuid)
 RETURNS TABLE(new_tier integer, tier_unlocked boolean, bonus_bananas integer)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public'
AS $function$
DECLARE v_conversions INTEGER; v_current_tier INTEGER; v_new_tier INTEGER; v_highest_tier INTEGER;
  v_tier_unlocked BOOLEAN := false; v_bonus INTEGER := 0;
BEGIN
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

CREATE OR REPLACE FUNCTION public.expire_old_bananas()
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public'
AS $function$
DECLARE v_expired_count INTEGER := 0; v_affected_users UUID[];
BEGIN
  SELECT ARRAY_AGG(DISTINCT user_id) INTO v_affected_users FROM banana_transactions WHERE expires_at < NOW() AND expired = false AND amount > 0;
  WITH expired AS (UPDATE banana_transactions SET expired = true WHERE expires_at < NOW() AND expired = false AND amount > 0 RETURNING id)
  SELECT COUNT(*) INTO v_expired_count FROM expired;
  IF v_affected_users IS NOT NULL AND array_length(v_affected_users, 1) > 0 THEN
    UPDATE users u SET banana_balance = COALESCE((
      SELECT SUM(CASE WHEN bt.amount > 0 AND NOT bt.expired AND (bt.expires_at IS NULL OR bt.expires_at > NOW()) THEN bt.amount WHEN bt.amount < 0 THEN bt.amount ELSE 0 END)
      FROM banana_transactions bt WHERE bt.user_id = u.id
    ), 0) WHERE u.id = ANY(v_affected_users);
  END IF;
  RETURN v_expired_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.generate_referral_code()
 RETURNS character varying LANGUAGE plpgsql SET search_path = 'public'
AS $function$
DECLARE chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; result VARCHAR(8) := ''; i INTEGER;
BEGIN
  FOR i IN 1..6 LOOP result := result || substr(chars, floor(random() * length(chars) + 1)::int, 1); END LOOP;
  RETURN result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_available_banana_balance(p_user_id uuid)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public'
AS $function$
DECLARE v_balance INTEGER;
BEGIN
  SELECT COALESCE(SUM(CASE WHEN amount > 0 AND NOT expired AND (expires_at IS NULL OR expires_at > NOW()) THEN amount WHEN amount < 0 THEN amount ELSE 0 END), 0)
  INTO v_balance FROM banana_transactions WHERE user_id = p_user_id;
  RETURN v_balance;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_or_create_referral_code(p_user_id uuid)
 RETURNS character varying LANGUAGE plpgsql SET search_path = 'public'
AS $function$
DECLARE v_code VARCHAR(8); v_attempts INTEGER := 0;
BEGIN
  SELECT code INTO v_code FROM referral_codes WHERE user_id = p_user_id;
  IF v_code IS NOT NULL THEN RETURN v_code; END IF;
  LOOP
    v_code := generate_referral_code(); v_attempts := v_attempts + 1;
    BEGIN
      INSERT INTO referral_codes (user_id, code) VALUES (p_user_id, v_code); RETURN v_code;
    EXCEPTION WHEN unique_violation THEN
      IF v_attempts >= 10 THEN RAISE EXCEPTION 'Could not generate unique referral code after 10 attempts'; END IF;
    END;
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.increment_cache_hit_count(cache_id uuid)
 RETURNS void LANGUAGE sql SET search_path = 'public'
AS $function$
  UPDATE destination_activity_cache SET hit_count = hit_count + 1, last_accessed_at = NOW() WHERE id = cache_id;
$function$;

CREATE OR REPLACE FUNCTION public.increment_tester_code_usage()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public'
AS $function$
BEGIN
  UPDATE tester_codes SET current_uses = current_uses + 1 WHERE id = NEW.code_id;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.spend_bananas(p_user_id uuid, p_amount integer, p_type text, p_reference_id uuid DEFAULT NULL::uuid, p_description text DEFAULT NULL::text)
 RETURNS TABLE(success boolean, new_balance integer, transaction_id uuid)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public'
AS $function$
DECLARE v_available INTEGER; v_new_balance INTEGER; v_tx_id UUID;
BEGIN
  IF p_amount <= 0 THEN RAISE EXCEPTION 'Amount must be positive'; END IF;
  SELECT COALESCE(banana_balance, 0) INTO v_new_balance FROM users WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT false, 0, NULL::UUID; RETURN; END IF;
  SELECT COALESCE(SUM(CASE WHEN amount > 0 AND NOT expired AND (expires_at IS NULL OR expires_at > NOW()) THEN amount WHEN amount < 0 THEN amount ELSE 0 END), 0)
  INTO v_available FROM banana_transactions WHERE user_id = p_user_id;
  IF v_available < p_amount THEN RETURN QUERY SELECT false, v_new_balance, NULL::UUID; RETURN; END IF;
  v_new_balance := v_new_balance - p_amount;
  INSERT INTO banana_transactions (user_id, amount, balance_after, transaction_type, reference_id, description, expires_at)
  VALUES (p_user_id, -p_amount, v_new_balance, p_type, p_reference_id, p_description, NULL) RETURNING id INTO v_tx_id;
  UPDATE users SET banana_balance = v_new_balance WHERE id = p_user_id;
  RETURN QUERY SELECT true, v_new_balance, v_tx_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_activity_vote_updated_at()
 RETURNS trigger LANGUAGE plpgsql SET search_path = 'public'
AS $function$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$function$;

CREATE OR REPLACE FUNCTION public.update_trip_trending_score(p_trip_id uuid)
 RETURNS integer LANGUAGE plpgsql SET search_path = 'public'
AS $function$
DECLARE v_copy_count INTEGER; v_view_count INTEGER; v_days_since_shared INTEGER; v_score INTEGER;
BEGIN
  SELECT COALESCE(template_copy_count, 0) INTO v_copy_count FROM trips WHERE id = p_trip_id;
  SELECT COUNT(*) INTO v_view_count FROM trip_views WHERE trip_id = p_trip_id;
  SELECT EXTRACT(DAY FROM NOW() - shared_at)::int INTO v_days_since_shared FROM trips WHERE id = p_trip_id;
  IF v_days_since_shared IS NULL THEN v_days_since_shared := 0; END IF;
  v_score := (v_copy_count * 10) + v_view_count + GREATEST(0, 100 - v_days_since_shared);
  UPDATE trips SET trending_score = v_score, view_count = v_view_count WHERE id = p_trip_id;
  RETURN v_score;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_trip_view_count()
 RETURNS trigger LANGUAGE plpgsql SET search_path = 'public'
AS $function$
BEGIN
  UPDATE trips SET view_count = (SELECT COUNT(*) FROM trip_views WHERE trip_id = NEW.trip_id) WHERE id = NEW.trip_id;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.user_can_access_trip(p_trip_id uuid, p_user_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM trips WHERE id = p_trip_id AND user_id = p_user_id)
  OR EXISTS (SELECT 1 FROM trip_collaborators WHERE trip_id = p_trip_id AND user_id = p_user_id);
$function$;

CREATE OR REPLACE FUNCTION public.user_can_vote(p_trip_id uuid, p_user_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM trips WHERE id = p_trip_id AND user_id = p_user_id)
  OR EXISTS (SELECT 1 FROM trip_collaborators WHERE trip_id = p_trip_id AND user_id = p_user_id AND role IN ('owner', 'editor', 'voter'));
$function$;

-- Drop duplicate index (identical to idx_api_logs_api_name)
DROP INDEX IF EXISTS public.idx_api_logs_name_timestamp;
