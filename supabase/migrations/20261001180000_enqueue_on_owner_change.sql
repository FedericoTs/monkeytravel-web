-- A trip saved without an owner and claimed later never had its emails
-- scheduled: the enqueue trigger ran on INSERT only, and a claim is an UPDATE.
-- It now also runs when a trip gains an owner. The pre-trip enqueue also stops
-- clearing the trip's in-trip digests and follow-ups, which a date change used
-- to wipe without putting the follow-ups back.

create or replace function public.enqueue_trip_notifications(p_trip_id uuid, p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
DECLARE
  SLOT_HOUR CONSTANT INTERVAL := INTERVAL '6 hours';
  v_start     TIMESTAMPTZ;
  v_muted     BOOLEAN;
  v_cancelled BOOLEAN;
  v_count     INT := 0;
BEGIN
  SELECT
    start_date::timestamptz + SLOT_HOUR,
    COALESCE(reminders_muted, FALSE),
    status = 'cancelled'
  INTO v_start, v_muted, v_cancelled
  FROM trips
  WHERE id = p_trip_id AND user_id = p_user_id;

  -- Only this function's five slots: digests and follow-ups have their own.
  IF v_start IS NULL OR v_muted OR COALESCE(v_cancelled, FALSE) OR v_start < NOW() THEN
    DELETE FROM scheduled_notifications
     WHERE trip_id = p_trip_id AND status = 'pending'
       AND slot IN ('pack_early_14d', 'visa_check_7d', 'weather_3d', 'confirm_1d', 'morning_of');
    RETURN 0;
  END IF;

  DELETE FROM scheduled_notifications
   WHERE trip_id = p_trip_id AND status = 'pending'
     AND slot IN ('pack_early_14d', 'visa_check_7d', 'weather_3d', 'confirm_1d', 'morning_of');

  INSERT INTO scheduled_notifications (user_id, trip_id, slot, scheduled_for)
  SELECT p_user_id, p_trip_id, slot, v_start - offset_intv
  FROM (VALUES
    ('pack_early_14d', INTERVAL '14 days'),
    ('visa_check_7d',  INTERVAL '7 days'),
    ('weather_3d',     INTERVAL '3 days'),
    ('confirm_1d',     INTERVAL '1 day'),
    ('morning_of',     INTERVAL '0')
  ) AS s(slot, offset_intv)
  WHERE v_start - offset_intv > NOW()
  ON CONFLICT (trip_id, slot) DO UPDATE
     SET scheduled_for  = EXCLUDED.scheduled_for,
         user_id        = EXCLUDED.user_id,
         status         = 'pending',
         skipped_reason = NULL,
         last_error     = NULL,
         updated_at     = NOW()
   WHERE scheduled_notifications.status = 'suppressed';

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

drop trigger if exists trips_enqueue_notifications_on_owner on public.trips;
create trigger trips_enqueue_notifications_on_owner
  after update of user_id on public.trips
  for each row
  when (new.user_id is not null and old.user_id is distinct from new.user_id)
  execute function public.trg_enqueue_trip_notifications();

revoke execute on function public.enqueue_trip_notifications(uuid, uuid) from public, anon, authenticated;
grant execute on function public.enqueue_trip_notifications(uuid, uuid) to service_role;
