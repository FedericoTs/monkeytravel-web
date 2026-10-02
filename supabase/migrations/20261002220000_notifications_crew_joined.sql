-- Someone tapping "I'm going" on a shared trip tells the trip's owner in the
-- bell (crew_joined). Keep in sync with lib/notifications/types.ts.
alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type = any (array[
    'collab_vote', 'collab_comment', 'collab_proposal', 'invite_accepted',
    'trip_shared', 'anon_vote', 'system', 'crew_joined'
  ]));
