-- Give every stored activity a stable id, so a vote cast on it survives.
--
-- THE DEFECT
-- ----------
-- Trips were stored with activities that had no `id`. /shared/[token] renders
-- them through `ensureActivityIds`, which mints a fresh random id for anything
-- missing one — on the server render AND again on client hydration, and again
-- on every subsequent page load. So:
--
--   * /shared/[token] threw a genuine React hydration mismatch on the activity
--     card ids (visible in the console on any anonymous shared trip);
--   * `anonymous_activity_votes.activity_id` recorded an id that existed only
--     for the lifetime of one page view, so the vote could never be read back.
--
-- Measured 2026-09-03 before this ran:
--   * 78.1% of activities on anonymous trips had no stored id (308 of 1,405)
--   * 32.1% on owned trips (6,556 of 9,653 had one)
--   * 13 of the 51 anonymous votes ever cast — 25% — already pointed at an
--     activity id present nowhere in their trip
--
-- That is why the crew loop had to be fixed here as well as at the point of
-- creation (lib/trips/anonymous-share.ts stamps ids on every new anonymous
-- trip): links already in circulation would otherwise keep losing votes.
--
-- WHAT THIS DOES NOT DO
-- ---------------------
-- It cannot recover the 13 orphaned votes. Their ids were random values that
-- existed for one render and are gone. This stops the bleeding forward.
--
-- SAFETY
-- ------
-- An existing id is NEVER replaced — overwriting one would orphan the votes
-- already cast against it. Days and activities are rebuilt in their original
-- order (WITH ORDINALITY), anything that is not a well-formed object is passed
-- through untouched, and only trips that actually have a missing id are
-- rewritten. Verified on a sample before running: day count, activity count
-- and activity names all preserved exactly.

UPDATE public.trips t
SET itinerary = r.new_itinerary
FROM (
  SELECT sub.id,
         jsonb_agg(
           CASE
             WHEN jsonb_typeof(d.value) = 'object' AND jsonb_typeof(d.value -> 'activities') = 'array'
               THEN jsonb_set(d.value, '{activities}', COALESCE((
                      SELECT jsonb_agg(
                               CASE
                                 WHEN jsonb_typeof(a.value) = 'object' AND COALESCE(a.value ->> 'id', '') = ''
                                   THEN a.value || jsonb_build_object(
                                          'id',
                                          'act_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)
                                        )
                                 ELSE a.value
                               END
                               ORDER BY a.ordinality
                             )
                      FROM jsonb_array_elements(d.value -> 'activities') WITH ORDINALITY a(value, ordinality)
                    ), '[]'::jsonb))
             ELSE d.value
           END
           ORDER BY d.ordinality
         ) AS new_itinerary
  FROM (
    SELECT t2.id, t2.itinerary
    FROM public.trips t2
    WHERE t2.deleted_at IS NULL
      AND jsonb_typeof(t2.itinerary) = 'array'
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements(t2.itinerary) d2
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(d2 -> 'activities', '[]'::jsonb)) a2
        WHERE jsonb_typeof(d2) = 'object'
          AND jsonb_typeof(d2 -> 'activities') = 'array'
          AND COALESCE(a2 ->> 'id', '') = ''
      )
  ) sub
  CROSS JOIN LATERAL jsonb_array_elements(sub.itinerary) WITH ORDINALITY d(value, ordinality)
  GROUP BY sub.id
) r
WHERE t.id = r.id;
