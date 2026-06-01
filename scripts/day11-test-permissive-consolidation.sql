-- ============================================================================
-- Day 11 adversarial test: verify RLS policy consolidation is access-equivalent
-- ============================================================================
-- Purpose:
--   For every consolidated policy in
--   migrations/20260531_day11_perf_consolidate_permissive_policies.sql,
--   exercise:
--     A) a synthetic user who matched the OLD policy A → still has access
--     B) a synthetic user who matched the OLD policy B → still has access
--     C) a synthetic user who matched NO policy → still has no access
--
-- Run AFTER applying the migration. Everything is wrapped in BEGIN/ROLLBACK
-- so prod data is untouched.
--
-- Usage:
--   psql "$DATABASE_URL" -f scripts/day11-test-permissive-consolidation.sql
--
-- Each section uses SET LOCAL ROLE + SET LOCAL request.jwt.claims so RLS sees
-- the synthetic user IDs. NOTE: this requires the connection to be made as a
-- role that can SET ROLE authenticated / anon (the Supabase service_role can).
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Synthetic test fixtures
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_user_a uuid := '11111111-1111-1111-1111-111111111111';
  v_user_b uuid := '22222222-2222-2222-2222-222222222222';
  v_user_c uuid := '33333333-3333-3333-3333-333333333333';  -- has-nothing user
  v_trip_owned_by_a uuid;
  v_trip_owned_by_b uuid;
  v_proposal_by_a uuid;
  v_proposal_by_b uuid;
BEGIN
  -- Insert minimal auth.users rows so FKs hold. Supabase uses auth.users(id).
  INSERT INTO auth.users (id, email, instance_id, aud, role)
  VALUES
    (v_user_a, 'a@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
    (v_user_b, 'b@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
    (v_user_c, 'c@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')
  ON CONFLICT (id) DO NOTHING;

  -- Two trips: one owned by A, one owned by B.
  INSERT INTO public.trips (id, user_id, title, visibility, is_hidden, share_token)
  VALUES
    (gen_random_uuid(), v_user_a, 'A-owned trip', 'private', false, NULL)
  RETURNING id INTO v_trip_owned_by_a;

  INSERT INTO public.trips (id, user_id, title, visibility, is_hidden, share_token)
  VALUES
    (gen_random_uuid(), v_user_b, 'B-owned public-shared trip', 'public', false, 'TEST-TOKEN-B')
  RETURNING id INTO v_trip_owned_by_b;

  -- B is a collaborator on A's trip (editor role).
  INSERT INTO public.trip_collaborators (trip_id, user_id, role)
  VALUES (v_trip_owned_by_a, v_user_b, 'editor');

  -- Proposals: one by A (owner of trip A), one by B (collaborator) on trip A.
  INSERT INTO public.activity_proposals (id, trip_id, proposed_by, status)
  VALUES (gen_random_uuid(), v_trip_owned_by_a, v_user_a, 'pending')
  RETURNING id INTO v_proposal_by_a;

  INSERT INTO public.activity_proposals (id, trip_id, proposed_by, status)
  VALUES (gen_random_uuid(), v_trip_owned_by_a, v_user_b, 'pending')
  RETURNING id INTO v_proposal_by_b;

  -- Referral codes / tiers for A.
  INSERT INTO public.referral_codes (user_id, code) VALUES (v_user_a, 'CODE-A') ON CONFLICT DO NOTHING;
  INSERT INTO public.referral_tiers (user_id, tier) VALUES (v_user_a, 'silver') ON CONFLICT DO NOTHING;

  -- Stash IDs for downstream sections via temp table.
  CREATE TEMP TABLE _t (k text PRIMARY KEY, v text) ON COMMIT DROP;
  INSERT INTO _t VALUES
    ('user_a', v_user_a::text),
    ('user_b', v_user_b::text),
    ('user_c', v_user_c::text),
    ('trip_a', v_trip_owned_by_a::text),
    ('trip_b', v_trip_owned_by_b::text),
    ('prop_a', v_proposal_by_a::text),
    ('prop_b', v_proposal_by_b::text);

  RAISE NOTICE 'Fixtures created: user_a=%, user_b=%, trip_a=%, trip_b=%',
    v_user_a, v_user_b, v_trip_owned_by_a, v_trip_owned_by_b;
END $$;

-- Helper macro: set the JWT-claim-driven auth.uid() that RLS reads from.
-- We jump into the `authenticated` role for each test so policies bound TO
-- authenticated also engage.
\set ON_ERROR_STOP on


-- ============================================================================
-- TEST GROUP 7: trips.SELECT (HOT)
-- ============================================================================
-- Expectations:
--   user_a sees trip_a (owner) and trip_b (it has share_token)
--   user_b sees trip_a (collaborator) and trip_b (owner)
--   user_c sees only trip_b (share_token branch — open by design)
-- ============================================================================

DO $$
DECLARE
  v_count int;
  v_user_a uuid := (SELECT v::uuid FROM _t WHERE k='user_a');
  v_user_b uuid := (SELECT v::uuid FROM _t WHERE k='user_b');
  v_user_c uuid := (SELECT v::uuid FROM _t WHERE k='user_c');
  v_trip_a uuid := (SELECT v::uuid FROM _t WHERE k='trip_a');
  v_trip_b uuid := (SELECT v::uuid FROM _t WHERE k='trip_b');
BEGIN
  -- as user_a
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_user_a::text, true);
  SELECT count(*) INTO v_count FROM public.trips WHERE id IN (v_trip_a, v_trip_b);
  ASSERT v_count = 2, format('user_a should see 2 trips, saw %s', v_count);

  -- as user_b
  PERFORM set_config('request.jwt.claim.sub', v_user_b::text, true);
  SELECT count(*) INTO v_count FROM public.trips WHERE id IN (v_trip_a, v_trip_b);
  ASSERT v_count = 2, format('user_b should see 2 trips (collab + own), saw %s', v_count);

  -- as user_c (no rights to trip_a, but trip_b has a share_token → visible)
  PERFORM set_config('request.jwt.claim.sub', v_user_c::text, true);
  SELECT count(*) INTO v_count FROM public.trips WHERE id IN (v_trip_a, v_trip_b);
  ASSERT v_count = 1, format('user_c should see only trip_b, saw %s', v_count);

  RAISE NOTICE 'GROUP 7 trips.SELECT: PASS';
END $$;


-- ============================================================================
-- TEST GROUP 8: trip_collaborators.SELECT (HOT)
-- ============================================================================
-- Expectations on the (trip_a, user_b) collab row:
--   user_a (trip owner)        → sees the row
--   user_b (the collaborator)  → sees the row (own row + co-collab branch)
--   user_c (unrelated)         → does NOT see the row
-- ============================================================================

DO $$
DECLARE
  v_count int;
  v_user_a uuid := (SELECT v::uuid FROM _t WHERE k='user_a');
  v_user_b uuid := (SELECT v::uuid FROM _t WHERE k='user_b');
  v_user_c uuid := (SELECT v::uuid FROM _t WHERE k='user_c');
  v_trip_a uuid := (SELECT v::uuid FROM _t WHERE k='trip_a');
BEGIN
  PERFORM set_config('role', 'authenticated', true);

  PERFORM set_config('request.jwt.claim.sub', v_user_a::text, true);
  SELECT count(*) INTO v_count FROM public.trip_collaborators WHERE trip_id = v_trip_a;
  ASSERT v_count >= 1, format('user_a (owner) should see collab row, saw %s', v_count);

  PERFORM set_config('request.jwt.claim.sub', v_user_b::text, true);
  SELECT count(*) INTO v_count FROM public.trip_collaborators WHERE trip_id = v_trip_a;
  ASSERT v_count >= 1, format('user_b (collaborator) should see own row, saw %s', v_count);

  PERFORM set_config('request.jwt.claim.sub', v_user_c::text, true);
  SELECT count(*) INTO v_count FROM public.trip_collaborators WHERE trip_id = v_trip_a;
  ASSERT v_count = 0, format('user_c (unrelated) should see 0 collab rows, saw %s', v_count);

  RAISE NOTICE 'GROUP 8 trip_collaborators.SELECT: PASS';
END $$;


-- ============================================================================
-- TEST GROUP 9: trip_collaborators.DELETE (HOT)
-- ============================================================================
-- Expectations:
--   user_b can delete their OWN collab row (self-leave branch)  → expect 1
--   user_a (trip owner) can delete a collab row on their trip   → expect 1
--   user_c cannot delete any collab row                          → expect 0
-- Each delete is rolled back via SAVEPOINT so subsequent asserts see fixtures.
-- ============================================================================

DO $$
DECLARE
  v_deleted int;
  v_user_a uuid := (SELECT v::uuid FROM _t WHERE k='user_a');
  v_user_b uuid := (SELECT v::uuid FROM _t WHERE k='user_b');
  v_user_c uuid := (SELECT v::uuid FROM _t WHERE k='user_c');
  v_trip_a uuid := (SELECT v::uuid FROM _t WHERE k='trip_a');
BEGIN
  PERFORM set_config('role', 'authenticated', true);

  -- self-leave
  PERFORM set_config('request.jwt.claim.sub', v_user_b::text, true);
  WITH d AS (
    DELETE FROM public.trip_collaborators WHERE trip_id = v_trip_a AND user_id = v_user_b RETURNING 1
  ) SELECT count(*) INTO v_deleted FROM d;
  ASSERT v_deleted = 1, format('user_b self-leave should delete 1 row, deleted %s', v_deleted);

  -- restore the row for the next sub-test
  INSERT INTO public.trip_collaborators (trip_id, user_id, role) VALUES (v_trip_a, v_user_b, 'editor');

  -- owner-delete
  PERFORM set_config('request.jwt.claim.sub', v_user_a::text, true);
  WITH d AS (
    DELETE FROM public.trip_collaborators WHERE trip_id = v_trip_a AND user_id = v_user_b RETURNING 1
  ) SELECT count(*) INTO v_deleted FROM d;
  ASSERT v_deleted = 1, format('user_a owner-delete should delete 1 row, deleted %s', v_deleted);

  INSERT INTO public.trip_collaborators (trip_id, user_id, role) VALUES (v_trip_a, v_user_b, 'editor');

  -- unrelated
  PERFORM set_config('request.jwt.claim.sub', v_user_c::text, true);
  WITH d AS (
    DELETE FROM public.trip_collaborators WHERE trip_id = v_trip_a AND user_id = v_user_b RETURNING 1
  ) SELECT count(*) INTO v_deleted FROM d;
  ASSERT v_deleted = 0, format('user_c should delete 0 rows, deleted %s', v_deleted);

  RAISE NOTICE 'GROUP 9 trip_collaborators.DELETE: PASS';
END $$;


-- ============================================================================
-- TEST GROUP 4: activity_proposals.UPDATE
-- ============================================================================
-- Expectations:
--   user_a (trip owner) can update either proposal (owner branch)
--   user_b (proposer of prop_b, status='pending') can update prop_b (proposer branch)
--   user_c (unrelated)  cannot update anything → row count 0
-- ============================================================================

DO $$
DECLARE
  v_updated int;
  v_user_a uuid := (SELECT v::uuid FROM _t WHERE k='user_a');
  v_user_b uuid := (SELECT v::uuid FROM _t WHERE k='user_b');
  v_user_c uuid := (SELECT v::uuid FROM _t WHERE k='user_c');
  v_prop_a uuid := (SELECT v::uuid FROM _t WHERE k='prop_a');
  v_prop_b uuid := (SELECT v::uuid FROM _t WHERE k='prop_b');
BEGIN
  PERFORM set_config('role', 'authenticated', true);

  -- owner branch
  PERFORM set_config('request.jwt.claim.sub', v_user_a::text, true);
  WITH u AS (UPDATE public.activity_proposals SET status='voting' WHERE id = v_prop_a RETURNING 1)
  SELECT count(*) INTO v_updated FROM u;
  ASSERT v_updated = 1, format('user_a (owner) should update prop_a, updated %s', v_updated);

  -- proposer branch
  PERFORM set_config('request.jwt.claim.sub', v_user_b::text, true);
  WITH u AS (UPDATE public.activity_proposals SET status='voting' WHERE id = v_prop_b RETURNING 1)
  SELECT count(*) INTO v_updated FROM u;
  ASSERT v_updated = 1, format('user_b (proposer) should update prop_b, updated %s', v_updated);

  -- unrelated
  PERFORM set_config('request.jwt.claim.sub', v_user_c::text, true);
  WITH u AS (UPDATE public.activity_proposals SET status='resolved' WHERE id = v_prop_a RETURNING 1)
  SELECT count(*) INTO v_updated FROM u;
  ASSERT v_updated = 0, format('user_c should update 0 proposals, updated %s', v_updated);

  RAISE NOTICE 'GROUP 4 activity_proposals.UPDATE: PASS';
END $$;


-- ============================================================================
-- TEST GROUP 5: referral_codes.SELECT
-- ============================================================================
-- Old policies OR'd to `true` (public can view by code). New policy = true.
-- Sanity: everyone (incl. user_c) can read the row.
-- ============================================================================

DO $$
DECLARE
  v_count int;
  v_user_a uuid := (SELECT v::uuid FROM _t WHERE k='user_a');
  v_user_c uuid := (SELECT v::uuid FROM _t WHERE k='user_c');
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_user_a::text, true);
  SELECT count(*) INTO v_count FROM public.referral_codes WHERE code = 'CODE-A';
  ASSERT v_count = 1, format('owner user_a should see own code, saw %s', v_count);

  PERFORM set_config('request.jwt.claim.sub', v_user_c::text, true);
  SELECT count(*) INTO v_count FROM public.referral_codes WHERE code = 'CODE-A';
  ASSERT v_count = 1, format('stranger user_c should also see code by-code (public lookup), saw %s', v_count);

  RAISE NOTICE 'GROUP 5 referral_codes.SELECT: PASS';
END $$;


-- ============================================================================
-- TEST GROUP 6: referral_tiers.SELECT
-- ============================================================================
-- Same logic — OR was already `true` (leaderboard read).
-- ============================================================================

DO $$
DECLARE
  v_count int;
  v_user_a uuid := (SELECT v::uuid FROM _t WHERE k='user_a');
  v_user_c uuid := (SELECT v::uuid FROM _t WHERE k='user_c');
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_user_a::text, true);
  SELECT count(*) INTO v_count FROM public.referral_tiers WHERE user_id = v_user_a;
  ASSERT v_count = 1, format('user_a should see own tier, saw %s', v_count);

  PERFORM set_config('request.jwt.claim.sub', v_user_c::text, true);
  SELECT count(*) INTO v_count FROM public.referral_tiers WHERE user_id = v_user_a;
  ASSERT v_count = 1, format('stranger user_c should also see (leaderboard), saw %s', v_count);

  RAISE NOTICE 'GROUP 6 referral_tiers.SELECT: PASS';
END $$;


-- ============================================================================
-- TEST GROUPS 1-3: destination_activity_bank — SELECT / INSERT / UPDATE
-- ============================================================================
-- Old + new both effectively `true` for anon+authenticated. We just sanity
-- check that all three operations still work for an authenticated user, and
-- that DELETE is service-role-only (user_a cannot delete).
-- ============================================================================

DO $$
DECLARE
  v_count int;
  v_dab_id uuid;
  v_user_a uuid := (SELECT v::uuid FROM _t WHERE k='user_a');
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_user_a::text, true);

  -- INSERT (anyone)
  INSERT INTO public.destination_activity_bank (destination_slug, activity_name)
  VALUES ('test-slug-day11', 'Test Activity Day 11')
  RETURNING id INTO v_dab_id;
  ASSERT v_dab_id IS NOT NULL, 'authenticated INSERT should succeed';

  -- SELECT
  SELECT count(*) INTO v_count FROM public.destination_activity_bank WHERE id = v_dab_id;
  ASSERT v_count = 1, 'authenticated SELECT should see the inserted row';

  -- UPDATE
  UPDATE public.destination_activity_bank SET activity_name = 'Renamed' WHERE id = v_dab_id;
  SELECT count(*) INTO v_count FROM public.destination_activity_bank WHERE id = v_dab_id AND activity_name='Renamed';
  ASSERT v_count = 1, 'authenticated UPDATE should succeed';

  -- DELETE should fail silently (RLS hides the row from DELETE for non-service-role)
  DELETE FROM public.destination_activity_bank WHERE id = v_dab_id;
  SELECT count(*) INTO v_count FROM public.destination_activity_bank WHERE id = v_dab_id;
  ASSERT v_count = 1,
    format('authenticated DELETE should be blocked (service-role-only); rows remaining = %s', v_count);

  RAISE NOTICE 'GROUPS 1-3 destination_activity_bank: PASS';
END $$;


-- ============================================================================
-- DONE — roll back all fixtures + writes so prod is untouched.
-- ============================================================================
ROLLBACK;
