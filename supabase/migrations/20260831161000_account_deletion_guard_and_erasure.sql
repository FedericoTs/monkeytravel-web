-- Two follow-ups to 20260831160000_fix_account_deletion_fks.sql.
--
-- 1. A CHECK THAT CANNOT BE FORGOTTEN
-- ----------------------------------
-- Six of the seven blocking foreign keys survived the 2026-08-04 pass, and one
-- that pass explicitly fixed (mcp_itineraries.claimed_by) was NO ACTION again
-- by today. Nothing was watching, and the symptom only appears when a real
-- person tries to delete their account and gets a 500.
--
-- account_deletion_blockers() names every FK into auth.users that would block
-- a delete. scripts/audit-account-deletion.mts asserts it returns nothing, so
-- the next table added with an auth.users FK cannot quietly reintroduce this.
-- SECURITY DEFINER because pg_constraint is not reachable through PostgREST,
-- and service-role only because it describes the schema.
--
-- 2. ERASURE THAT ACTUALLY ERASES
-- -------------------------------
-- Deleting an account left the person's email address behind, because these
-- rows are keyed by email rather than by user id and so no foreign key ever
-- touched them. Measured 2026-08-31:
--
--   email_subscribers.email      19 rows   <- fixed here (their own subscription)
--   user_feedback.contact_email   1 row    <- fixed here (nulled, feedback kept)
--   email_log.recipient_email    41 rows   <- deliberately left, see below
--   contact_messages.email        6 rows   <- deliberately left, see below
--   trip_invites.recipient_email  1 row    <- deliberately left, see below
--
-- The two fixed here are unambiguous: a marketing subscription is the person's
-- own and must not outlive their account, and a feedback row is useful without
-- the address attached, so the address is removed and the content kept.
--
-- The other three are retention POLICY, not defects, and are left for a human:
-- email_log is a delivery audit trail, contact_messages is correspondence that
-- may belong to an unresolved support thread, and trip_invites.recipient_email
-- records something ANOTHER user did. Deleting any of them has consequences a
-- migration should not decide by itself.

CREATE OR REPLACE FUNCTION public.account_deletion_blockers()
RETURNS TABLE (
  constraint_name text,
  child_table     text,
  child_columns   text,
  on_delete       text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog', 'pg_temp'
AS $$
  SELECT
    c.conname::text,
    (n.nspname || '.' || t.relname)::text,
    (SELECT string_agg(a.attname, ',' ORDER BY k.ord)
       FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum)::text,
    CASE c.confdeltype WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT' END::text
  FROM pg_constraint c
  JOIN pg_class t      ON t.oid  = c.conrelid
  JOIN pg_namespace n  ON n.oid  = t.relnamespace
  JOIN pg_class rt     ON rt.oid = c.confrelid
  JOIN pg_namespace rn ON rn.oid = rt.relnamespace
  WHERE c.contype = 'f'
    AND rn.nspname = 'auth'
    AND rt.relname = 'users'
    AND c.confdeltype IN ('a','r')
  ORDER BY 2, 1;
$$;

-- Supabase's ALTER DEFAULT PRIVILEGES grants EXECUTE on new public functions
-- to anon and authenticated. This one describes the schema, so revoke it —
-- and REVOKE FROM PUBLIC alone does not remove those two, they must be named.
REVOKE ALL ON FUNCTION public.account_deletion_blockers() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.account_deletion_blockers() TO service_role;

-- --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.delete_user_account(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_email text;
BEGIN
  IF (SELECT auth.role()) <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden: service-role only' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id is required';
  END IF;

  -- Read the address BEFORE the row goes, or the email-keyed rows below can
  -- no longer be found.
  SELECT email INTO v_email FROM public.users WHERE id = p_user_id;

  DELETE FROM public.trips WHERE user_id = p_user_id;
  DELETE FROM public.ai_usage WHERE user_id = p_user_id;
  DELETE FROM public.user_tester_access WHERE user_id = p_user_id;

  -- Rows keyed by email rather than by user id, which no foreign key reaches.
  IF v_email IS NOT NULL THEN
    -- Their own marketing subscription: it must not outlive the account, and
    -- nothing else can unsubscribe them once the account is gone.
    DELETE FROM public.email_subscribers WHERE lower(email) = lower(v_email);
    -- The feedback is worth keeping; the address attached to it is not.
    UPDATE public.user_feedback
       SET contact_email = NULL
     WHERE contact_email IS NOT NULL AND lower(contact_email) = lower(v_email);
  END IF;

  DELETE FROM public.users WHERE id = p_user_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.delete_user_account(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_user_account(uuid) TO service_role;
