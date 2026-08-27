-- Infer a signed-in user's real UI language from the locale prefix of the
-- pages they actually viewed.
--
-- WHY THIS IS NEEDED
-- ------------------
-- users.preferred_language is the only input to the language of every email
-- we send, and it was wrong at scale. Measured 2026-08-27: all 478 users are
-- stored as 'en', while 36% of human traffic is on /es, /it and /pt paths.
--
-- Root cause (fixed in app/auth/callback/route.ts): the confirm-email
-- round-trip only carries ?locale= when a referral code is present, so for
-- every other email signup the callback fell back to "en" and its UPSERT
-- overwrote the correct value the signup page had already written.
--
-- Auth user_metadata proves it independently: 3 users have 'it'/'es' there
-- and 'en' in their profile. Only 24 users have that metadata at all, so it
-- sizes the bug but cannot repair it. Page-view prefixes cover 411 users and
-- can.
--
-- WHY A FUNCTION AND NOT A ONE-OFF QUERY
-- --------------------------------------
-- Two callers need exactly the same definition: the backfill that repairs
-- stored values, and scripts/audit-queued-emails.mts, which now warns when a
-- queued email is about to go out in a language the recipient does not appear
-- to browse in. If those two disagreed, the audit would bless the backfill's
-- own mistakes.
--
-- DELIBERATELY CONSERVATIVE
-- -------------------------
-- The two errors are not symmetric. Leaving a Spanish speaker on English is
-- the status quo; flipping an English speaker to Spanish is a new harm we
-- would have caused. So a non-English verdict requires BOTH a strict majority
-- of that user's views and a minimum volume — a single stray visit to a
-- translated blog post must never re-language someone's mail.
--
-- Reads page_views_human, so declared crawler traffic cannot vote.

CREATE OR REPLACE FUNCTION public.user_inferred_ui_locale(
  p_min_views INT DEFAULT 3,
  p_min_share NUMERIC DEFAULT 0.6
)
RETURNS TABLE (
  user_id       UUID,
  inferred      TEXT,
  views_for     BIGINT,
  views_total   BIGINT,
  share         NUMERIC,
  confident     BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  WITH v AS (
    SELECT
      pv.user_id AS uid,
      CASE
        WHEN pv.path ~ '^/es(/|$)' THEN 'es'
        WHEN pv.path ~ '^/it(/|$)' THEN 'it'
        WHEN pv.path ~ '^/pt(/|$)' THEN 'pt'
        ELSE 'en'
      END AS lp,
      COUNT(*) AS n
    FROM page_views_human pv
    WHERE pv.user_id IS NOT NULL
    GROUP BY 1, 2
  ),
  totals AS (
    SELECT uid, SUM(n) AS total FROM v GROUP BY uid
  ),
  top AS (
    -- Highest-volume prefix per user. Ties break toward 'en' via the second
    -- ORDER BY key, which is the safe direction: it declines to re-language
    -- someone on a coin flip.
    SELECT DISTINCT ON (v.uid)
      v.uid, v.lp, v.n
    FROM v
    ORDER BY v.uid, v.n DESC, (v.lp = 'en') DESC
  )
  SELECT
    t.uid,
    t.lp,
    t.n,
    tot.total,
    ROUND(t.n::numeric / NULLIF(tot.total, 0), 3),
    -- 'en' needs no evidence: it is the existing stored default, so calling
    -- it confident changes nothing. Only a non-English verdict must clear
    -- the bar, because only that one causes a write.
    (t.lp = 'en')
      OR (t.n >= p_min_views AND t.n::numeric / NULLIF(tot.total, 0) >= p_min_share)
  FROM top t
  JOIN totals tot ON tot.uid = t.uid;
$fn$;

REVOKE ALL ON FUNCTION public.user_inferred_ui_locale(INT, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_inferred_ui_locale(INT, NUMERIC) TO service_role;

COMMENT ON FUNCTION public.user_inferred_ui_locale(INT, NUMERIC) IS
  'Best-effort UI language per signed-in user, from the locale prefix of their human page views. Used to repair users.preferred_language (all 478 rows were stored as en) and by scripts/audit-queued-emails.mts to warn before mailing someone in a language they do not browse in. confident=false means do not write.';
