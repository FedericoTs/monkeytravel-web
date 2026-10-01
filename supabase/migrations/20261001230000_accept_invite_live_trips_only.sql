-- An invite to a deleted trip can no longer be accepted. accept_trip_invite
-- looked the trip up without deleted_at, so a live invite link still added
-- people to a trip its owner had deleted. POST /api/invites/[token] already
-- answers TRIP_NOT_FOUND with a 404. CREATE OR REPLACE keeps the grants.

CREATE OR REPLACE FUNCTION public.accept_trip_invite(p_token text, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_invite          RECORD;
    v_trip_owner_id   UUID;
    v_existing_role   TEXT;
    v_inserted        BOOLEAN := FALSE;
    v_new_collab_id   UUID;
BEGIN
    SELECT id, trip_id, role, created_by, max_uses, use_count,
           is_active, expires_at, is_referral_eligible, recipient_email
      INTO v_invite
      FROM public.trip_invites
     WHERE token = p_token
     FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('error_code', 'NOT_FOUND');
    END IF;

    IF v_invite.max_uses > 0 AND v_invite.use_count >= v_invite.max_uses THEN
        RETURN jsonb_build_object('error_code', 'MAX_USES');
    END IF;

    IF v_invite.is_active IS NOT TRUE THEN
        RETURN jsonb_build_object('error_code', 'REVOKED');
    END IF;

    IF v_invite.expires_at <= now() THEN
        RETURN jsonb_build_object('error_code', 'EXPIRED');
    END IF;

    SELECT user_id INTO v_trip_owner_id
      FROM public.trips
     WHERE id = v_invite.trip_id
       AND deleted_at IS NULL;

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

    INSERT INTO public.trip_collaborators (trip_id, user_id, role, invited_by)
    VALUES (v_invite.trip_id, p_user_id, v_invite.role, v_invite.created_by)
    ON CONFLICT (trip_id, user_id) DO NOTHING
    RETURNING id INTO v_new_collab_id;

    v_inserted := v_new_collab_id IS NOT NULL;

    IF NOT v_inserted THEN
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
$function$;
