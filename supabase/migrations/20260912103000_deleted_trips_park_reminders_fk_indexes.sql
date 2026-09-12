-- 2026-09-12 — diagnostic follow-ups
--
-- 1. soft_delete_trip() parks the trip's pending reminders.
--    Trips are soft-deleted (deleted_at, since 2026-06-07), but
--    scheduled_notifications only cascades on a HARD delete, and the dispatch
--    cron read a tombstoned trip like any other. Result: 5 reminder emails went
--    out for trips their owners had deleted, and 158 more were queued across
--    17 deleted trips. enqueue_trip_notifications() revives a suppressed row
--    on conflict, so restoring a trip and re-enqueuing still works.
-- 2. Backfill: park every pending/failed row whose trip is deleted. Idempotent —
--    the same statement was run by hand on 2026-09-12 08:30 UTC (159 rows).
-- 3. Index the five foreign keys the performance advisor lists as unindexed.
--    All five point at users; an account deletion cascades through each of
--    them, and an unindexed FK is a sequential scan per deleted user.
-- 4. trg_enqueue_trip_notifications() is a SECURITY DEFINER trigger function
--    that PUBLIC/anon/authenticated could EXECUTE. Postgres refuses to call a
--    trigger function directly, so this is hygiene rather than a hole, but the
--    security advisor lists it and the rest of the enqueue family was closed to
--    service_role on 2026-09-06.

CREATE OR REPLACE FUNCTION public.soft_delete_trip(p_trip_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_rows int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  UPDATE public.trips
     SET deleted_at = now()
   WHERE id = p_trip_id
     AND user_id = v_uid
     AND deleted_at IS NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows > 0 THEN
    -- The trip is gone from every read path; its reminders must not follow it
    -- into inboxes. Suppressed rather than deleted: the enqueue RPC revives a
    -- suppressed row on conflict if the trip is ever restored and re-enqueued.
    UPDATE public.scheduled_notifications
       SET status = 'suppressed',
           skipped_reason = 'trip_deleted',
           updated_at = now()
     WHERE trip_id = p_trip_id
       AND status = 'pending';
  END IF;

  RETURN v_rows > 0;
END;
$$;

-- 2. Backfill (idempotent).
UPDATE public.scheduled_notifications n
   SET status = 'suppressed',
       skipped_reason = 'trip_deleted',
       updated_at = now()
  FROM public.trips t
 WHERE t.id = n.trip_id
   AND t.deleted_at IS NOT NULL
   AND n.status IN ('pending', 'failed');

-- 3. FK indexes (all small tables; plain CREATE INDEX is fine).
CREATE INDEX IF NOT EXISTS idx_funnel_events_user_id
  ON public.funnel_events (user_id);
CREATE INDEX IF NOT EXISTS idx_tester_codes_created_by
  ON public.tester_codes (created_by);
CREATE INDEX IF NOT EXISTS idx_trip_itinerary_snapshots_created_by
  ON public.trip_itinerary_snapshots (created_by);
CREATE INDEX IF NOT EXISTS idx_trip_participants_user_id
  ON public.trip_participants (user_id);
CREATE INDEX IF NOT EXISTS idx_trip_today_actions_actor_user_id
  ON public.trip_today_actions (actor_user_id);

-- 4. Trigger-function hygiene.
REVOKE EXECUTE ON FUNCTION public.trg_enqueue_trip_notifications()
  FROM PUBLIC, anon, authenticated;
