-- Atomic counter RPCs — closes 4 TOCTOU races caught in the 2026-05-24
-- bug-bounty audit (docs/COLLAB_AUDIT.md + parallel API agent report).
--
-- Each function does a single UPDATE ... = column + delta, which is
-- atomic in Postgres without any application-level locking. The
-- previous read-modify-write pattern in the API routes was racy under
-- concurrent requests (e.g. two simultaneous referral conversions
-- could both read old_value and both write old_value+1, dropping one
-- increment).
--
-- All functions are SECURITY DEFINER so the service-role key isn't
-- required from the calling code; RLS still applies to the SELECT
-- against the parent row when reading the returned value, so callers
-- only see counters for rows they're allowed to see.
--
-- Idempotency note: these are simple atomic increments — they're NOT
-- idempotent for the same logical event firing twice (e.g. a doubled
-- referral webhook would credit twice). Idempotency belongs at the
-- next layer up (idempotency_key on email_log; we'd add similar to
-- referral_conversions if/when needed).

-- ===========================================================
-- 1. Referral click counter
-- ===========================================================
-- Was: referral/click reads total_clicks, computes +1 client-side,
-- writes back. Concurrent clicks dropped increments. Plus the
-- original code had an operator-precedence bug (`x || 0 + 1` =
-- `x || 1`) that meant the counter never incremented past 1.
CREATE OR REPLACE FUNCTION public.increment_referral_clicks(
    code_id UUID
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
    SET total_clicks = COALESCE(total_clicks, 0) + 1
    WHERE id = code_id
    RETURNING total_clicks INTO new_count;
    RETURN COALESCE(new_count, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_referral_clicks(UUID)
    TO anon, authenticated, service_role;

-- ===========================================================
-- 2. Template copy counter
-- ===========================================================
-- Was: templates/[id]/copy reads template_copy_count, computes +1,
-- writes back. Two simultaneous "Use this template" clicks dropped
-- one increment.
CREATE OR REPLACE FUNCTION public.increment_template_copy_count(
    template_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    new_count INTEGER;
BEGIN
    UPDATE public.trips
    SET template_copy_count = COALESCE(template_copy_count, 0) + 1
    WHERE id = template_id
    RETURNING template_copy_count INTO new_count;
    RETURN COALESCE(new_count, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_template_copy_count(UUID)
    TO authenticated, service_role;

-- ===========================================================
-- 3. Tester-code consumption with limit check
-- ===========================================================
-- Was: admin/grant-access reads current_uses + max_uses, computes
-- +1, writes back. Concurrent redemptions could both pass the
-- "uses < max" check and both write +1 → max exceeded silently.
--
-- This RPC does the limit check inside the UPDATE so it's all
-- one statement. Returns 0 rows if the code is already exhausted
-- — caller treats empty result as "code unavailable."
--
-- Note: table is `tester_codes` (not `access_codes`) per the
-- 20251226_admin_grant_early_access migration.
CREATE OR REPLACE FUNCTION public.consume_tester_code(
    code_id UUID
)
RETURNS TABLE (
    new_current_uses INTEGER,
    out_max_uses INTEGER,
    exhausted BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
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
$$;

GRANT EXECUTE ON FUNCTION public.consume_tester_code(UUID)
    TO service_role;

-- NOTE: a 4th candidate "atomic banana spend" RPC was considered
-- but `spend_bananas` (defined in an earlier migration, used by
-- lib/bananas/transactions.ts) already exists and already does the
-- atomic balance-check + debit in one statement. The route's
-- precondition check is purely for UX (returns a nicer error before
-- attempting the RPC). No bug; no fix needed.

COMMENT ON FUNCTION public.increment_referral_clicks IS
    'Atomic +1 on referral_codes.total_clicks. Replaces racy read-modify-write in /api/referral/click.';
COMMENT ON FUNCTION public.increment_template_copy_count IS
    'Atomic +1 on trips.template_copy_count. Replaces racy read-modify-write in /api/templates/[id]/copy.';
COMMENT ON FUNCTION public.consume_tester_code IS
    'Atomic increment with max_uses guard on tester_codes. Returns 0 rows when exhausted. Service-role only.';
