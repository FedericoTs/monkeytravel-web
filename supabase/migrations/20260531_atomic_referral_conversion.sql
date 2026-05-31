-- Atomic referral conversion — closes the 2026-05-31 audit gap (Task #318)
-- where lib/referral/completion.ts had two race-windows:
--
--   1. The referee UPDATE didn't gate on referral_completed_at IS NULL, so
--      two concurrent first-trip saves could both pass the read-side
--      "already completed?" check and both run the full reward path —
--      crediting the referrer twice (bananas, tier bonus, conversion count).
--
--   2. total_conversions on referral_codes was read-modify-write, so even
--      with the row-level guard a doubled run could drop one increment or
--      (worse) credit a tier unlock from a stale read.
--
-- This migration pairs with the application-side change that:
--   - Adds `AND referral_completed_at IS NULL` + `.select("id")` to the
--     referee UPDATE so concurrent runs race on a single statement and the
--     loser bails with "already completed".
--   - Switches the conversion-count bump to the RPC defined below.
--
-- The UNIQUE partial index is belt-and-suspenders: even if a future caller
-- forgets the WHERE guard, the DB rejects the second conversion row for the
-- same referee. Pairs with the equivalent total_clicks RPC in
-- 20260524_atomic_counters.sql.

-- ===========================================================
-- 1. UNIQUE partial index on referral_events conversions
-- ===========================================================
-- One conversion row per referee, ever. event_type='click' rows are
-- unaffected — only conversions are uniqueness-constrained, because a
-- referee converts at most once (their first trip).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_referral_conversion_per_referee
    ON public.referral_events(referee_id, event_type)
    WHERE event_type = 'conversion';

-- ===========================================================
-- 2. Atomic referral conversion counter
-- ===========================================================
-- Mirrors increment_referral_clicks from 20260524_atomic_counters.sql:
-- one UPDATE ... = column + delta, no application-level locking. Replaces
-- the racy read-modify-write at lib/referral/completion.ts:174-180.
CREATE OR REPLACE FUNCTION public.increment_referral_conversions(
    p_code_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    new_count INTEGER;
BEGIN
    UPDATE public.referral_codes
    SET total_conversions = COALESCE(total_conversions, 0) + 1
    WHERE id = p_code_id
    RETURNING total_conversions INTO new_count;
    RETURN COALESCE(new_count, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_referral_conversions(UUID)
    TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.increment_referral_conversions IS
    'Atomic +1 on referral_codes.total_conversions. Pairs with increment_referral_clicks; replaces racy read-modify-write in lib/referral/completion.ts (Task #318, 2026-05-31).';

COMMENT ON INDEX public.uniq_referral_conversion_per_referee IS
    'Belt-and-suspenders for the route-level "already completed" guard — DB rejects a second conversion row for the same referee (Task #318, 2026-05-31).';
