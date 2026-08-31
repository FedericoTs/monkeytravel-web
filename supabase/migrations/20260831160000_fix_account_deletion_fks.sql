-- Account deletion was impossible for 283 of 495 real accounts (57%).
--
-- WHAT HAPPENED
-- -------------
-- /api/profile/delete runs in two phases: delete_user_account() over the
-- public schema, then auth.admin.deleteUser(). Seven foreign keys still
-- referenced auth.users with the Postgres default ON DELETE NO ACTION, so
-- phase 2 raised a foreign-key violation and the account survived — after
-- phase 1 had already destroyed the user's trips.
--
-- The user experience of that is the worst possible ordering: your data is
-- gone and your account is not. And the API returns a 500 whose message
-- ("Database error deleting user") names no constraint, so nothing in the
-- logs says which table caused it.
--
-- A previous pass (2026-08-04) fixed four such FKs — trip_invites.created_by,
-- trip_collaborators.invited_by, activity_proposals.resolved_by and
-- mcp_itineraries.claimed_by — and was measured as affecting 0 accounts at the
-- time, so it was recorded as latent rather than live. Two things then went
-- wrong: mcp_itineraries.claimed_by is NO ACTION again in production, and six
-- more columns exist that the pass never covered. The blocker today is
-- api_request_logs.user_id, which did not exist as a problem in August because
-- nobody had 708 rows in it yet.
--
-- MEASURED 2026-08-31, before this migration:
--   total accounts                     495
--   accounts that CANNOT be deleted    284
--   real accounts affected             283   (the other is an E2E fixture)
--
-- WHY SET NULL AND NOT CASCADE
-- ----------------------------
-- Every one of these seven columns answers "who did this", not "whose data is
-- this":
--
--   activity_status.proposed_by    who proposed a status on someone's trip
--   api_config.updated_by          which admin last changed a setting
--   api_request_logs.user_id       which account made an API request
--   mcp_itineraries.claimed_by     who claimed a generated itinerary
--   site_config.updated_by         which admin last changed site config
--   tester_codes.created_by        which admin minted a tester code
--   trip_reports.resolved_by       which moderator resolved a report
--
-- CASCADE would delete another user's trip status, an admin's config history,
-- or a moderation record because the person who touched it closed their
-- account. SET NULL severs the personal link and keeps the record — which is
-- the correct erasure semantic for an audit trail, and the least destructive.
--
-- All seven columns are already nullable (verified), so no column changes are
-- needed and no existing row is rewritten.
--
-- The user's OWN data is not touched here: it is removed by
-- delete_user_account() and by the FKs that already CASCADE.

BEGIN;

ALTER TABLE public.activity_status
  DROP CONSTRAINT IF EXISTS activity_status_proposed_by_fkey,
  ADD CONSTRAINT activity_status_proposed_by_fkey
    FOREIGN KEY (proposed_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.api_config
  DROP CONSTRAINT IF EXISTS api_config_updated_by_fkey,
  ADD CONSTRAINT api_config_updated_by_fkey
    FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.api_request_logs
  DROP CONSTRAINT IF EXISTS api_request_logs_user_id_fkey,
  ADD CONSTRAINT api_request_logs_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.mcp_itineraries
  DROP CONSTRAINT IF EXISTS mcp_itineraries_claimed_by_fkey,
  ADD CONSTRAINT mcp_itineraries_claimed_by_fkey
    FOREIGN KEY (claimed_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.site_config
  DROP CONSTRAINT IF EXISTS site_config_updated_by_fkey,
  ADD CONSTRAINT site_config_updated_by_fkey
    FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.tester_codes
  DROP CONSTRAINT IF EXISTS tester_codes_created_by_fkey,
  ADD CONSTRAINT tester_codes_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.trip_reports
  DROP CONSTRAINT IF EXISTS trip_reports_resolved_by_fkey,
  ADD CONSTRAINT trip_reports_resolved_by_fkey
    FOREIGN KEY (resolved_by) REFERENCES auth.users(id) ON DELETE SET NULL;

COMMIT;

-- After this, no FK into auth.users is left on NO ACTION or RESTRICT. The
-- companion check in scripts/audit-account-deletion.mts asserts that, so the
-- next table with an auth.users FK cannot silently reintroduce it — which is
-- how six of these seven survived the August pass.
