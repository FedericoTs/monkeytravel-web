-- 2026-05-30: fix the gamification award path.
--
-- Problem: the /api/bananas/award path (introduced 5107ba7) was designed to
-- pass composite/literal reference_ids:
--   activity_completion → activity.id  (e.g. "act_fb7d9d9bda4c" — NOT uuid)
--   achievement_bonus   → "${tripId}:${achievementId}"  (composite — NOT uuid)
--   trip_complete       → tripId  (uuid — OK)
--   first_trip_bonus    → "first_trip" (literal — NOT uuid)
--
-- But banana_transactions.reference_id was declared uuid and add_bananas
-- typed p_reference_id uuid. Every call except trip_complete crashed on
-- "invalid input syntax for type uuid". Result: zero bananas were
-- persisted via this path since the gamification fix shipped — discovered
-- when Alyssa reported 0 bananas after a confirmed San Antonio trip with
-- 4 completed activities.
--
-- Fix: widen reference_id to text so the column matches the documented
-- design intent. Same for spend_bananas for symmetry.
--
-- Also: add the missing UNIQUE constraint on (user_id, type, reference_id)
-- so idempotency is enforced at the DB level — the route.ts SELECT-then-
-- INSERT pattern is racy under concurrent requests and the comment
-- "Idempotent on (user_id, transaction_type, reference_id)" was a lie:
-- no such constraint existed.

BEGIN;

-- 1. Widen reference_id to text. uuid → text is a safe implicit cast.
ALTER TABLE public.banana_transactions
  ALTER COLUMN reference_id TYPE text USING reference_id::text;

-- 2. Re-declare add_bananas with text reference_id. CREATE OR REPLACE alone
--    cannot change a parameter type — drop+recreate is required.
DROP FUNCTION IF EXISTS public.add_bananas(uuid, integer, text, uuid, text);

CREATE OR REPLACE FUNCTION public.add_bananas(
  p_user_id      uuid,
  p_amount       integer,
  p_type         text,
  p_reference_id text DEFAULT NULL,
  p_description  text DEFAULT NULL
)
RETURNS TABLE(new_balance integer, transaction_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_new_balance INTEGER;
  v_expires_at  TIMESTAMPTZ;
  v_tx_id       UUID;
BEGIN
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
$$;

-- 3. Same widening for spend_bananas — the column type is the source of
--    truth; the param must match. Existing call sites only pass uuid-shaped
--    redemption ids today, so this widening is backward compatible.
DROP FUNCTION IF EXISTS public.spend_bananas(uuid, integer, text, uuid, text);

CREATE OR REPLACE FUNCTION public.spend_bananas(
  p_user_id      uuid,
  p_amount       integer,
  p_type         text,
  p_reference_id text DEFAULT NULL,
  p_description  text DEFAULT NULL
)
RETURNS TABLE(success boolean, new_balance integer, transaction_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_current_balance INTEGER;
  v_new_balance     INTEGER;
  v_tx_id           UUID;
BEGIN
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
$$;

-- 4. Idempotency: enforce uniqueness at the DB layer for positive credits
--    where a reference is provided. Concurrent award calls now safely race
--    and the second one gets a clean unique-violation that the route can
--    swallow as a duplicate.
--    Partial index because:
--      - NULL reference_id is legitimate for admin/spend ops where idempotency
--        doesn't apply
--      - amount<=0 (spends, clawbacks) follow a different idempotency model
CREATE UNIQUE INDEX IF NOT EXISTS uniq_banana_tx_credit_idempotency
ON public.banana_transactions (user_id, transaction_type, reference_id)
WHERE reference_id IS NOT NULL AND amount > 0;

COMMIT;
