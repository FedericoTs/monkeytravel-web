-- Make deleting a trip actually work. Companion to
-- 20260819110000_fix_trips_update_with_check_soft_delete.sql, which fixed a
-- real but INSUFFICIENT half of this bug.
--
-- THE FULL PICTURE
-- Soft-delete (UPDATE trips SET deleted_at = now()) was rejected with 42501
-- "new row violates row-level security policy" for every user since
-- 2026-06-08. Two independent policies both blocked it:
--
--   1. trips_update declared USING (deleted_at IS NULL AND ...) with no
--      WITH CHECK. Postgres then copies USING into WITH CHECK, so the new
--      tombstone failed `deleted_at IS NULL`. Fixed in the companion
--      migration by stating WITH CHECK explicitly, minus that conjunct.
--
--   2. trips_select_consolidated is `deleted_at IS NULL AND (<any branch>)`.
--      A tombstone therefore satisfies NO select branch, and the UPDATE's
--      new row is rejected on that basis too. Proven empirically: adding a
--      permissive owner SELECT policy inside a rolled-back savepoint made
--      the very same update succeed.
--
-- WHY NOT JUST RELAX THE SELECT POLICY
-- Because 61 files query `trips` and only one filters deleted_at itself.
-- Every other read gets "hide deleted trips" for free from that policy. Let
-- owners see their own tombstones and deleted trips reappear across the
-- product. The invariant is load-bearing and stays exactly as it is.
--
-- THE FIX
-- Route the one legitimate write that must produce an invisible row through
-- a SECURITY DEFINER function, which bypasses RLS and re-checks ownership
-- itself. Narrow by construction: it can set deleted_at and nothing else.

CREATE OR REPLACE FUNCTION public.soft_delete_trip(p_trip_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
-- Pinned so a caller cannot shadow `trips` or now() via search_path.
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid  uuid := (SELECT auth.uid());
  v_rows int;
BEGIN
  -- SECURITY DEFINER bypasses RLS, so ownership is enforced here or nowhere.
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  -- Owner only, deliberately: an `editor` collaborator may edit a trip but
  -- must not be able to delete it out from under its owner. This matches
  -- what the DELETE route already enforced with .eq("user_id", user.id).
  --
  -- `deleted_at IS NULL` keeps it idempotent: deleting an already-deleted
  -- trip touches 0 rows and returns false rather than re-stamping the
  -- timestamp and losing the original deletion time.
  UPDATE public.trips
     SET deleted_at = now()
   WHERE id = p_trip_id
     AND user_id = v_uid
     AND deleted_at IS NULL;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;

-- anon must never reach this. Ownership is checked inside, but an
-- unauthenticated caller has no identity to check against.
REVOKE ALL ON FUNCTION public.soft_delete_trip(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.soft_delete_trip(uuid) TO authenticated;

COMMENT ON FUNCTION public.soft_delete_trip(uuid) IS
  'Owner-only soft delete. SECURITY DEFINER because a tombstone satisfies no '
  'branch of trips_select_consolidated (which requires deleted_at IS NULL), '
  'so the write is impossible under RLS. Returns true if a row was tombstoned, '
  'false if it was already deleted, missing, or not owned by the caller.';
