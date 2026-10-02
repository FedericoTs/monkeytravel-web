-- Votes on a shared link follow the account. A vote cast signed in is the
-- account's on any browser (user_id), and link_guest_to_account now also
-- gives the account the votes this browser cast as a guest. Signed out, a
-- vote is still this browser's (voter_cookie_id). Additive.
alter table public.anonymous_activity_votes
  add column if not exists user_id uuid references auth.users (id) on delete set null;

create unique index if not exists uniq_anonymous_activity_votes_trip_activity_user
  on public.anonymous_activity_votes (trip_id, activity_id, user_id)
  where user_id is not null;

-- One trip, or every trip where the browser has history when p_trip_id is
-- null. Returns how many trips it looked at.
create or replace function public.link_guest_to_account(p_user_id uuid, p_cookie text, p_trip_id uuid default null)
returns integer
language plpgsql
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_trip uuid;
  v_trips uuid[];
  v_member boolean;
  v_guest public.trip_participants%rowtype;
  v_mine public.trip_participants%rowtype;
begin
  if p_user_id is null or p_cookie is null then
    return 0;
  end if;

  if p_trip_id is not null then
    v_trips := array[p_trip_id];
  else
    select coalesce(array_agg(distinct x.trip_id), '{}') into v_trips from (
      select trip_id from public.trip_participants where participant_cookie_id = p_cookie
      union select trip_id from public.trip_today_actions where actor_cookie_id = p_cookie
      union select trip_id from public.trip_expenses where paid_by_cookie_id = p_cookie or created_by_cookie_id = p_cookie
      union select e.trip_id from public.trip_expense_splits s join public.trip_expenses e on e.id = s.expense_id
        where s.participant_cookie_id = p_cookie
      union select trip_id from public.anonymous_activity_votes where voter_cookie_id = p_cookie and user_id is null
    ) x;
  end if;

  foreach v_trip in array v_trips loop
    v_member := exists (select 1 from public.trips t where t.id = v_trip and t.user_id = p_user_id)
      or exists (select 1 from public.trip_collaborators c where c.trip_id = v_trip and c.user_id = p_user_id);

    -- "I'm going": one row per person. A row another account holds stays theirs.
    select * into v_guest from public.trip_participants
      where trip_id = v_trip and participant_cookie_id = p_cookie for update;
    if found and (v_guest.user_id is null or v_guest.user_id = p_user_id) then
      select * into v_mine from public.trip_participants
        where trip_id = v_trip and user_id = p_user_id and id <> v_guest.id for update;
      if found then
        update public.trip_participants set
          display_name = coalesce(v_mine.display_name, v_guest.display_name),
          email = coalesce(v_mine.email, v_guest.email),
          joined_at = least(v_mine.joined_at, v_guest.joined_at),
          left_at = case when v_mine.left_at is null or v_guest.left_at is null then null
                         else greatest(v_mine.left_at, v_guest.left_at) end
          where id = v_mine.id;
        delete from public.trip_participants where id = v_guest.id;
      else
        update public.trip_participants set user_id = p_user_id where id = v_guest.id;
      end if;
    end if;

    -- Today taps. Where the account already has the same tap, the guest's is retired.
    update public.trip_today_actions a set undone_at = now()
      where a.trip_id = v_trip and a.actor_cookie_id = p_cookie and a.undone_at is null
        and exists (
          select 1 from public.trip_today_actions b
          where b.trip_id = v_trip and b.undone_at is null and b.actor_cookie_id is null
            and b.actor_user_id = p_user_id and b.day_number = a.day_number
            and b.action_type = a.action_type and coalesce(b.activity_id, '') = coalesce(a.activity_id, ''));
    update public.trip_today_actions set actor_user_id = p_user_id, actor_cookie_id = null
      where trip_id = v_trip and actor_cookie_id = p_cookie
        and (actor_user_id is null or actor_user_id = p_user_id);

    -- Payments. Only a member becomes the creator by account: a creator can
    -- edit the row directly (RLS), as in the Today routes.
    update public.trip_expenses set paid_by_user_id = p_user_id, paid_by_cookie_id = null
      where trip_id = v_trip and paid_by_cookie_id = p_cookie
        and (paid_by_user_id is null or paid_by_user_id = p_user_id);
    if v_member then
      update public.trip_expenses set created_by = p_user_id, created_by_cookie_id = null
        where trip_id = v_trip and created_by_cookie_id = p_cookie
          and (created_by is null or created_by = p_user_id);
    end if;

    -- Shares: one per person per expense, so a guest share is added to the account's.
    update public.trip_expense_splits s set share_amount = s.share_amount + g.share_amount
      from public.trip_expense_splits g, public.trip_expenses e
      where e.trip_id = v_trip and g.expense_id = e.id and g.participant_cookie_id = p_cookie
        and s.expense_id = g.expense_id and s.user_id = p_user_id;
    delete from public.trip_expense_splits g using public.trip_expenses e
      where g.expense_id = e.id and e.trip_id = v_trip and g.participant_cookie_id = p_cookie
        and exists (select 1 from public.trip_expense_splits s where s.expense_id = g.expense_id and s.user_id = p_user_id);
    update public.trip_expense_splits g set user_id = p_user_id, participant_cookie_id = null
      from public.trip_expenses e
      where g.expense_id = e.id and e.trip_id = v_trip and g.participant_cookie_id = p_cookie;

    -- Votes on the shared link. Where the account already voted on the
    -- activity from another browser, the more recent vote stays.
    delete from public.anonymous_activity_votes a
      using public.anonymous_activity_votes g
      where g.trip_id = v_trip and g.voter_cookie_id = p_cookie and g.user_id is null
        and a.trip_id = v_trip and a.activity_id = g.activity_id
        and a.user_id = p_user_id and a.updated_at < g.updated_at;
    delete from public.anonymous_activity_votes g
      where g.trip_id = v_trip and g.voter_cookie_id = p_cookie and g.user_id is null
        and exists (select 1 from public.anonymous_activity_votes a
          where a.trip_id = v_trip and a.activity_id = g.activity_id and a.user_id = p_user_id);
    update public.anonymous_activity_votes set user_id = p_user_id
      where trip_id = v_trip and voter_cookie_id = p_cookie and user_id is null;
  end loop;

  return coalesce(array_length(v_trips, 1), 0);
end;
$function$;

revoke all on function public.link_guest_to_account(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.link_guest_to_account(uuid, text, uuid) to service_role;
