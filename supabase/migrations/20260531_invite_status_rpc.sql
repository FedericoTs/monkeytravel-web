-- Migration: Status-only invite lookup RPC (Day-2 audit Bug 1)
--
-- Background
-- ----------
-- The earlier 20260529_lockdown_trip_invites_rls.sql migration introduced
-- `get_invite_by_token` as a SECURITY DEFINER RPC for anonymous lookups.
-- Critically, its WHERE clause embeds the usability filter:
--   AND is_active = true
--   AND expires_at > now()
--   AND (max_uses <= 0 OR use_count < max_uses)
-- so a non-usable invite (revoked / expired / exhausted) returns 0 rows,
-- which the page collapses to the generic "Invalid Invite Link" screen.
-- The dedicated EXPIRED / REVOKED / MAX_USES UX branches and translation
-- strings (messages/{en,it,es}/common.json → invitePage.errors) are
-- therefore unreachable.
--
-- This migration adds a sibling lookup function that returns the SAME
-- column set WITHOUT the usability gate. Callers run validateInvite()
-- in app code on the returned row to surface the precise error_code so
-- the user sees the right "this invite expired" / "revoked by owner" /
-- "already used up" message instead of the generic 404.
--
-- Security note: the existing trip_invites RLS lockdown is preserved.
-- We're not loosening the policy — we're adding a second SECURITY DEFINER
-- function that returns ONE row matching a known token. An attacker
-- without the token still can't enumerate, exactly like get_invite_by_token.

CREATE OR REPLACE FUNCTION public.get_invite_status_by_token(p_token text)
RETURNS TABLE (
  id uuid,
  trip_id uuid,
  token text,
  role text,
  created_by uuid,
  created_at timestamptz,
  expires_at timestamptz,
  max_uses integer,
  use_count integer,
  is_active boolean,
  is_referral_eligible boolean,
  recipient_email text,
  recipient_locale text,
  message text
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    ti.id,
    ti.trip_id,
    ti.token,
    ti.role,
    ti.created_by,
    ti.created_at,
    ti.expires_at,
    ti.max_uses,
    ti.use_count,
    ti.is_active,
    ti.is_referral_eligible,
    ti.recipient_email,
    ti.recipient_locale,
    ti.message
  FROM public.trip_invites ti
  WHERE ti.token = p_token
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.get_invite_status_by_token(text) IS
  'Anonymous-safe lookup of an invite by token WITHOUT the usability '
  'filter. Returns the row regardless of expired / revoked / exhausted '
  'state so app code can render a precise error message (EXPIRED, '
  'REVOKED, MAX_USES) instead of the generic INVALID_TOKEN screen. '
  'Used as a fallback when get_invite_by_token returns no rows.';

REVOKE ALL ON FUNCTION public.get_invite_status_by_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_invite_status_by_token(text) TO anon, authenticated;
