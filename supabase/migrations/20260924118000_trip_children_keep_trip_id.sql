-- A row that belongs to a trip stays on that trip. Safe to apply at merge
-- time: no app code changes trip_id on these tables.
--
-- The update policies below check who may edit the row, but their WITH
-- CHECK does not re-check membership of the trip the row ends up on:
--   activity_proposals  proposer (while pending/voting) or trip owner
--   trip_expenses       creator or trip owner
--   activity_votes      the voter
--   ai_conversations    the conversation's user
-- So a user could create a proposal (with their own 'love' vote) or an
-- expense on their own trip and PATCH its trip_id to someone else's: it
-- then shows up in the victim trip's proposals or split, and an approved
-- proposal's activity is written into the victim's itinerary by the
-- service role. Trip ids appear in URLs. Found 2026-09-23 by the
-- adversarial review of the security branch; nothing had been moved
-- (existing rows were not re-validated).
--
-- A BEFORE UPDATE trigger refuses a trip_id change from anyone but the
-- service role / postgres. SECURITY INVOKER so current_user is the caller.

create or replace function public.keep_trip_id_fixed()
 returns trigger
 language plpgsql
 security invoker
 set search_path to 'public'
as $function$
begin
  if current_user in ('postgres', 'service_role', 'supabase_admin') then
    return new;
  end if;
  if new.trip_id is distinct from old.trip_id then
    raise exception '%.trip_id cannot be changed', tg_table_name using errcode = '42501';
  end if;
  return new;
end;
$function$;

drop trigger if exists activity_proposals_keep_trip_id on public.activity_proposals;
create trigger activity_proposals_keep_trip_id
  before update on public.activity_proposals
  for each row execute function public.keep_trip_id_fixed();

drop trigger if exists trip_expenses_keep_trip_id on public.trip_expenses;
create trigger trip_expenses_keep_trip_id
  before update on public.trip_expenses
  for each row execute function public.keep_trip_id_fixed();

drop trigger if exists activity_votes_keep_trip_id on public.activity_votes;
create trigger activity_votes_keep_trip_id
  before update on public.activity_votes
  for each row execute function public.keep_trip_id_fixed();

drop trigger if exists ai_conversations_keep_trip_id on public.ai_conversations;
create trigger ai_conversations_keep_trip_id
  before update on public.ai_conversations
  for each row execute function public.keep_trip_id_fixed();
