-- Close a latent EXECUTE hole on the trip-notification enqueue family.
--
-- Every one of these functions was created with the intent of being
-- service-role-only — each migration ran `REVOKE ALL ... FROM PUBLIC` and
-- `GRANT EXECUTE ... TO service_role`, and dormant_followup_candidates' own
-- comment states it "would otherwise let any authenticated caller enumerate
-- other users' trip ids". But REVOKE FROM PUBLIC does NOT remove the EXPLICIT
-- `anon` / `authenticated` grants that Supabase's default privileges attach to
-- every new function, so pg_proc.proacl still reads e.g.
--   anon=X/postgres authenticated=X/postgres service_role=X/postgres
-- i.e. any anon or logged-in caller can execute them. (See memory
-- project_monkeytravel_revoke_from_public: REVOKE FROM PUBLIC is a no-op
-- against role-level grants.)
--
-- These are SECURITY DEFINER writers/readers over every user's rows. The only
-- legitimate callers are the service-role cron (createAdminClient) and the
-- SECURITY DEFINER trigger trg_enqueue_trip_notifications (which runs as its
-- owner, postgres, and so is unaffected by these REVOKEs). No app path executes
-- them as anon or authenticated, so revoking those roles changes no behaviour
-- and closes the hole.
--
-- dormant_followup_candidates is the sharp one — it returns other users'
-- user_id + trip_id — so it matters most that anon/authenticated cannot call it.

REVOKE EXECUTE ON FUNCTION public.enqueue_trip_day_digests(UUID, UUID)   FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enqueue_trip_notifications(UUID, UUID)  FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enqueue_trip_followups(UUID, UUID)      FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enqueue_dormant_followups(INT, BOOLEAN) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.dormant_followup_candidates(INT)        FROM anon, authenticated;

-- Belt and braces: make sure service_role still holds EXECUTE after the revoke.
GRANT EXECUTE ON FUNCTION public.enqueue_trip_day_digests(UUID, UUID)   TO service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_trip_notifications(UUID, UUID)  TO service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_trip_followups(UUID, UUID)      TO service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_dormant_followups(INT, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.dormant_followup_candidates(INT)        TO service_role;
