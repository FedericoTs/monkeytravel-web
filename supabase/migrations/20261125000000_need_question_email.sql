-- "What do you still need for your trip?" as one email of its own, ten days
-- before a trip starts. The pre-trip reminders already end with this question
-- until the owner answers it; on its own, with the trip in its subject, it is
-- asked before the last week, while there is still time to help. It goes once
-- per person, not once per trip: the cron holds a row back when the trip has
-- an answer, when the person already had this email, or when they said no to
-- marketing (lib/notifications/need-email.ts).
--
-- It has its own enqueue function and its own trigger instead of a sixth slot
-- in the pre-trip cascade, so the cascade, the in-trip digests, the follow-ups
-- and the triggers that queue them stay exactly as they are, and nothing here
-- can fail a trip write.

-- 1. The slot vocabulary, restated whole with the new slot, before anything
--    below writes one. The account-level rule is unchanged: finish_trip_1d,
--    and only it, has no trip.
alter table public.scheduled_notifications drop constraint if exists scheduled_notifications_slot_check;
alter table public.scheduled_notifications add constraint scheduled_notifications_slot_check check (
  slot = any (array[
    'pack_early_14d', 'visa_check_7d', 'weather_3d', 'confirm_1d', 'morning_of',
    'followup_return_3d', 'followup_next_21d', 'followup_final_45d', 'followup_dormant',
    'finish_trip_1d',
    'need_10d'
  ])
  or slot ~ '^in_trip_day_([2-9]|1[0-9]|2[01])$'
);

alter table public.scheduled_notifications drop constraint if exists scheduled_notifications_trip_scope_check;
alter table public.scheduled_notifications add constraint scheduled_notifications_trip_scope_check
  check ((trip_id is null) = (slot = 'finish_trip_1d'));

-- 2. A trip's need_10d row: for a trip with an owner, a start date and no
--    deletion, at 06:00 UTC ten days before the start (the hour every slot is
--    stamped, an hour before the daily cron), and only while that time is
--    still ahead. A pending row follows the start date and the owner. When
--    the time has passed, or the trip loses its owner, its date or its
--    existence, a pending row is removed. A row already sent stays sent, and
--    one already suppressed stays suppressed: the cron's reason still holds.
--    Returns the rows written.
create or replace function public.enqueue_need_ask(p_trip_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
DECLARE
  SLOT_HOUR CONSTANT INTERVAL := INTERVAL '6 hours';
  v_user_id UUID;
  v_send_at TIMESTAMPTZ;
  v_count   INT := 0;
BEGIN
  -- The UTC day named outright: a date cast to timestamptz takes the session's zone.
  SELECT user_id, (start_date::timestamp AT TIME ZONE 'UTC') + SLOT_HOUR - INTERVAL '10 days'
    INTO v_user_id, v_send_at
    FROM trips
   WHERE id = p_trip_id AND deleted_at IS NULL;

  IF v_user_id IS NULL OR v_send_at IS NULL OR v_send_at <= NOW() THEN
    DELETE FROM scheduled_notifications
     WHERE trip_id = p_trip_id AND slot = 'need_10d' AND status = 'pending';
    RETURN 0;
  END IF;

  INSERT INTO scheduled_notifications (trip_id, user_id, slot, scheduled_for, status)
  VALUES (p_trip_id, v_user_id, 'need_10d', v_send_at, 'pending')
  ON CONFLICT (trip_id, slot) DO UPDATE
     SET scheduled_for = EXCLUDED.scheduled_for,
         user_id       = EXCLUDED.user_id,
         updated_at    = NOW()
   WHERE scheduled_notifications.status = 'pending';

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

revoke execute on function public.enqueue_need_ask(uuid) from public, anon, authenticated;
grant execute on function public.enqueue_need_ask(uuid) to service_role;

-- 3. Keep that row in step with its trip: on every insert, and on every update
--    that moves the start date, the owner or the deletion. The call sits in
--    its own exception block, so a failure is a warning and the trip write
--    goes through.
create or replace function public.trg_enqueue_need_ask()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
BEGIN
  -- Saves write the whole trip back, naming these columns unchanged: nothing
  -- to move. OLD is only read on an update, where it always exists.
  IF TG_OP = 'UPDATE' THEN
    IF NEW.start_date IS NOT DISTINCT FROM OLD.start_date
       AND NEW.user_id IS NOT DISTINCT FROM OLD.user_id
       AND NEW.deleted_at IS NOT DISTINCT FROM OLD.deleted_at THEN
      RETURN NEW;
    END IF;
  END IF;

  BEGIN
    PERFORM public.enqueue_need_ask(NEW.id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'need_10d enqueue failed for trip %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$function$;

drop trigger if exists trips_enqueue_need_ask on public.trips;
create trigger trips_enqueue_need_ask
  after insert or update of start_date, user_id, deleted_at on public.trips
  for each row
  execute function public.trg_enqueue_need_ask();

revoke execute on function public.trg_enqueue_need_ask() from public, anon, authenticated;

-- 4. Trips already saved: only those at least eleven days away, so every row
--    queued here is still a day or more ahead and nothing goes out at once.
insert into public.scheduled_notifications (trip_id, user_id, slot, scheduled_for, status)
select id,
       user_id,
       'need_10d',
       (start_date::timestamp at time zone 'UTC') + interval '6 hours' - interval '10 days',
       'pending'
  from public.trips
 where user_id is not null
   and deleted_at is null
   and start_date >= (now() at time zone 'UTC')::date + 11
on conflict (trip_id, slot) do nothing;
