-- 2026-06-21 — Wire referral attribution at signup (the K-Factor numerator).
-- Applied to prod via apply_migration ("attach_referral_on_signup").
-- Canonical repo record + replay path.
--
-- WHY: the admin K-Factor read "n/a" because referral_codes.total_signups was
-- incremented by ZERO code paths, and users.referred_by_code was written
-- UNVALIDATED (a typo/spoofed ?ref became a dead stamp). This RPC is the single
-- validated writer, called server-side from both signup paths
-- (app/auth/callback/route.ts OAuth + PKCE branches; /api/referral/attach for
-- email instant sessions).
--
-- Properties: atomic, idempotent, race-safe, service-role-guarded, $0.
--   * The partial unique index + the signup-event INSERT (ON CONFLICT DO
--     NOTHING) form the idempotency gate — total_signups + the welcome reward
--     fire EXACTLY once per referee even under concurrent calls.
--   * Stores the CANONICAL referral_codes.code so completion.ts's exact-match
--     (referral_codes.code = users.referred_by_code) keeps working at first trip.
--   * Self-referral and unknown codes attribute nothing (anti-fraud).
--   * Referee welcome gift = 30 bananas = exactly one free AI generation
--     (lib/bananas spend menu), so the "1 FREE trip" promise is literally true.
--     Referrer reward (50🍌 + tier) is untouched; it fires at the referee's
--     first trip via completeReferralIfEligible, which this finally FEEDS.

CREATE UNIQUE INDEX IF NOT EXISTS uniq_referral_signup_per_referee
    ON public.referral_events (referee_id, event_type)
    WHERE event_type = 'signup';

CREATE OR REPLACE FUNCTION public.attach_referral_on_signup(
    p_user_id uuid,
    p_code    text
)
RETURNS TABLE(attributed boolean, referrer_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_code_id   uuid;
    v_referrer  uuid;
    v_canonical text;
    v_norm      text := upper(trim(coalesce(p_code, '')));
BEGIN
    IF (SELECT auth.role()) <> 'service_role' THEN
        RAISE EXCEPTION 'forbidden: service-role only' USING ERRCODE = '42501';
    END IF;

    IF length(v_norm) = 0 THEN
        RETURN QUERY SELECT false, NULL::uuid; RETURN;
    END IF;

    SELECT id, user_id, code INTO v_code_id, v_referrer, v_canonical
    FROM referral_codes WHERE upper(code) = v_norm;

    IF v_code_id IS NULL OR v_referrer = p_user_id THEN
        RETURN QUERY SELECT false, NULL::uuid; RETURN;
    END IF;

    INSERT INTO referral_events (referral_code_id, referee_id, event_type)
    VALUES (v_code_id, p_user_id, 'signup')
    ON CONFLICT DO NOTHING;

    IF NOT FOUND THEN
        RETURN QUERY SELECT true, v_referrer; RETURN;  -- already attributed
    END IF;

    UPDATE users SET referred_by_code = v_canonical WHERE id = p_user_id;
    UPDATE referral_codes SET total_signups = COALESCE(total_signups, 0) + 1 WHERE id = v_code_id;
    PERFORM add_bananas(p_user_id, 30, 'referral', v_code_id::text, 'Welcome gift - invited by a friend');

    RETURN QUERY SELECT true, v_referrer;
END;
$$;

GRANT EXECUTE ON FUNCTION public.attach_referral_on_signup(uuid, text) TO service_role;
