-- 2026-05-30: extend the banana_transactions.transaction_type CHECK
-- allowlist with the gamification reward types.
--
-- Background: the gamification reward loop (5107ba7) introduced four
-- transaction types — activity_completion, achievement_bonus, trip_complete,
-- first_trip_bonus. Only trip_complete was pre-existing in the allowlist;
-- the other three rejected every INSERT with check_violation, after the
-- separately-fixed UUID coercion already would have done the same.
-- Discovered during Alyssa's backfill — first add_bananas call bounced on
-- the CHECK before even reaching the new uniq idempotency index.
--
-- Apply this AFTER 20260530_bananas_widen_reference_id_to_text.sql — they
-- are independent in scope but together fix the gamification award path.

BEGIN;

ALTER TABLE public.banana_transactions
  DROP CONSTRAINT IF EXISTS banana_transactions_transaction_type_check;

ALTER TABLE public.banana_transactions
  ADD CONSTRAINT banana_transactions_transaction_type_check
  CHECK (transaction_type = ANY (ARRAY[
    -- Pre-existing — referral economy
    'referral'::text,
    'tier_bonus'::text,
    'trip_complete'::text,
    'signup_bonus'::text,
    'review'::text,
    'collaboration'::text,
    'spend'::text,
    'clawback'::text,
    'expiration'::text,
    'admin'::text,
    -- New 2026-05-31 — gamification reward loop
    'activity_completion'::text,
    'achievement_bonus'::text,
    'first_trip_bonus'::text
  ]));

COMMIT;
