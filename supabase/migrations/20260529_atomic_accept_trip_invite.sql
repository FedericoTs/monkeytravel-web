-- Atomic invite acceptance RPC — closes the max_uses TOCTOU caught in
-- task #215 (companion to the 2026-05-24 atomic-counters work in
-- 20260524_atomic_counters.sql).
--
-- Background: POST /api/invites/[token] used to do
--   1. SELECT use_count, max_uses
--   2. (in JS) check use_count < max_uses
--   3. INSERT into trip_collaborators
--   4. UPDATE trip_invites SET use_count = use_count + 1
-- Two concurrent accepts that both observed use_count=4 against
-- max_uses=5 would both pass the guard, both insert, and both bump,
-- leaving use_count=6 — beyond the configured cap. Tasks #170 and
-- #186 hardened the read path but did not close this race.
--
-- accept_trip_invite() pulls the SELECT-check-INSERT-UPDATE into a
-- single statement chain inside one transaction. The SELECT ... FOR
-- UPDATE on trip_invites serialises concurrent accepts on the same
-- token so the second caller observes the bumped use_count and
-- bounces with MAX_USES instead of slipping through the guard.
--
-- The collaborator INSERT uses ON CONFLICT DO NOTHING against the
-- (trip_id, user_id) unique constraint so a user who retries an
-- accept they already completed gets ALREADY_MEMBER instead of a
-- duplicate-key crash. In that case we do NOT bump use_count — the
-- seat was already consumed on the original accept.
--
-- Return shape is jsonb so the route handler can branch on
-- `error_code` and translate to HTTP statuses (matches the existing
-- MAX_USES / REVOKED / EXPIRED error-code surface from
-- lib/api/invite-validation.ts).

CREATE OR REPLACE FUNCTION public.accept_trip_invite(
    p_token TEXT,
    p_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_invite          RECORD;
    v_trip_owner_id   UUID;
    v_existing_role   TEXT;
    v_inserted        BOOLEAN := FALSE;
    v_new_collab_id   UUID;
BEGIN
    -- Lock the invite row so concurrent accepts on the same token
    -- serialise here. SELECT ... FOR UPDATE blocks until the other
    -- transaction commits, at which point use_count is already bumped
    -- and the second caller's guard below trips.
    SELECT id, trip_id, role, created_by, max_uses, use_count,
           is_active, expires_at, is_referral_eligible, recipient_email
      INTO v_invite
      FROM public.trip_invites
     WHERE token = p_token
     FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('error_code', 'NOT_FOUND');
    END IF;

    -- Match the ordering in lib/api/invite-validation.ts: MAX_USES
    -- first (most specific), then REVOKED, then EXPIRED.
    IF v_invite.max_uses > 0 AND v_invite.use_count >= v_invite.max_uses THEN
        RETURN jsonb_build_object('error_code', 'MAX_USES');
    END IF;

    IF v_invite.is_active IS NOT TRUE THEN
        RETURN jsonb_build_object('error_code', 'REVOKED');
    END IF;

    IF v_invite.expires_at <= now() THEN
        RETURN jsonb_build_object('error_code', 'EXPIRED');
    END IF;

    -- Owner short-circuit — the route used to handle this in JS, but
    -- moving it in here keeps all "you already belong on this trip"
    -- paths in one place so the caller can treat any non-error
    -- response uniformly.
    SELECT user_id INTO v_trip_owner_id
      FROM public.trips
     WHERE id = v_invite.trip_id;

    IF v_trip_owner_id IS NULL THEN
        RETURN jsonb_build_object('error_code', 'TRIP_NOT_FOUND');
    END IF;

    IF v_trip_owner_id = p_user_id THEN
        RETURN jsonb_build_object(
            'ok',            TRUE,
            'trip_id',       v_invite.trip_id,
            'role',          'owner',
            'already_member', TRUE,
            'is_owner',      TRUE,
            'invite_id',     v_invite.id,
            'created_by',    v_invite.created_by,
            'is_referral_eligible', v_invite.is_referral_eligible
        );
    END IF;

    -- Idempotent insert. ON CONFLICT on the (trip_id, user_id) unique
    -- constraint means a retry by the same user no-ops cleanly. We
    -- only bump use_count when we actually consumed a seat.
    INSERT INTO public.trip_collaborators (trip_id, user_id, role, invited_by)
    VALUES (v_invite.trip_id, p_user_id, v_invite.role, v_invite.created_by)
    ON CONFLICT (trip_id, user_id) DO NOTHING
    RETURNING id INTO v_new_collab_id;

    v_inserted := v_new_collab_id IS NOT NULL;

    IF NOT v_inserted THEN
        -- Already a collaborator from a previous accept. Look up
        -- their current role so the API can echo it back.
        SELECT role INTO v_existing_role
          FROM public.trip_collaborators
         WHERE trip_id = v_invite.trip_id
           AND user_id = p_user_id;

        RETURN jsonb_build_object(
            'ok',             TRUE,
            'trip_id',        v_invite.trip_id,
            'role',           v_existing_role,
            'already_member', TRUE,
            'is_owner',       FALSE,
            'invite_id',      v_invite.id,
            'created_by',     v_invite.created_by,
            'is_referral_eligible', v_invite.is_referral_eligible
        );
    END IF;

    -- Consume one seat. Same row is still locked from the FOR UPDATE
    -- above, so this UPDATE doesn't race anyone.
    UPDATE public.trip_invites
       SET use_count = use_count + 1
     WHERE id = v_invite.id;

    RETURN jsonb_build_object(
        'ok',                   TRUE,
        'trip_id',              v_invite.trip_id,
        'role',                 v_invite.role,
        'already_member',       FALSE,
        'is_owner',             FALSE,
        'collaborator_id',      v_new_collab_id,
        'invite_id',            v_invite.id,
        'created_by',           v_invite.created_by,
        'is_referral_eligible', v_invite.is_referral_eligible
    );
END;
$$;

-- Only the route handler (running with the service-role key) needs to
-- call this. We do NOT grant to anon — accept-invite is an
-- authenticated action — and we don't grant to authenticated because
-- the route currently uses the service-role client (createAdminClient)
-- anyway, and going through that path keeps the email-recipient
-- precheck in route code rather than duplicating it in SQL.
GRANT EXECUTE ON FUNCTION public.accept_trip_invite(TEXT, UUID)
    TO service_role;

COMMENT ON FUNCTION public.accept_trip_invite IS
    'Atomic invite acceptance — SELECT FOR UPDATE + guard + INSERT (ON CONFLICT DO NOTHING) + use_count bump in one transaction. Closes the max_uses TOCTOU left open by tasks #170 / #186. Returns jsonb { ok, trip_id, role, ... } or { error_code }.';
