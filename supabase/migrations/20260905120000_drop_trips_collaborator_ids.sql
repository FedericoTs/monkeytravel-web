-- Phase 0.3 of docs/LIVE_TRIP_MASTER_PLAN.md — retire trips.collaborator_ids.
--
-- The column (uuid[] default '{}') was a denormalised copy of the crew that
-- nothing ever wrote. Measured 2026-09-05:
--
--   references in application code, generated types, scripts, migrations:  0
--   references in RLS policies, functions, views, triggers, indexes:        0
--   trips with a non-empty array:                                          0
--   trip_collaborators rows (the table access actually runs on):           3
--
-- Every trips policy already grants collaborator access through
-- trip_collaborators (user_is_trip_owner / user_is_trip_collaborator), so
-- that table is the single source of truth and has been for as long as the
-- policies have existed. The array only survived in three docs, one of which
-- proposed "array_length(collaborator_ids)" as the group-trip metric — a metric
-- that would have read 0 forever.
--
-- The plan deferred this drop to Phase 2 to bundle schema changes. With zero
-- references of any kind there is nothing to bundle, and a dead column that
-- looks like a source of truth is worse than no column. Dropped now.

alter table public.trips drop column if exists collaborator_ids;

comment on table public.trip_collaborators is
  'The crew of a trip. Single source of truth for collaborator access (see the trips RLS policies). trips.collaborator_ids was a never-written denormalised copy and was dropped 2026-09-05; Phase 2 adds trip_participants for account-free "I''m going" alongside this table.';
