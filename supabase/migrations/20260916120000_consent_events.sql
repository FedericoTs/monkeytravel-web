-- Consent events (2026-09-16): measure the cookie banner.
--
-- After the banner started governing GA4 and PostHog (2026-09-02) GA4 fell to
-- ~11% of real visitors and the acceptance rate of anonymous traffic was
-- unknowable: only signed-in users' choices are stored (users.cookie_consent,
-- 40 accept / 24 essential-only since 2026-09-02, the most engaged people we
-- have). This table records every banner impression, minimisation and
-- decision from every visitor, with the banner variant and the page, keyed on
-- the analytics session cookie and nothing else. Written only by
-- /api/consent-event through the service role; read by admins through the
-- RPC below.

CREATE TABLE IF NOT EXISTS public.consent_events (
  id                bigserial PRIMARY KEY,
  session_id        text,
  event             text NOT NULL CHECK (event IN ('shown', 'minimized', 'accept_all', 'essential_only', 'settings_saved')),
  variant           text NOT NULL DEFAULT 'generic' CHECK (variant IN ('generic', 'contextual')),
  analytics         boolean,
  marketing         boolean,
  session_recording boolean,
  path              text,
  locale            text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.consent_events IS
  'One row per cookie-banner event (shown, minimized, accept_all, essential_only, settings_saved) with the banner variant and page. Written by /api/consent-event (service role). No identifier beyond the analytics session cookie. Labelling only; nothing is blocked.';

CREATE INDEX IF NOT EXISTS consent_events_created_idx ON public.consent_events (created_at DESC);
CREATE INDEX IF NOT EXISTS consent_events_session_idx ON public.consent_events (session_id) WHERE session_id IS NOT NULL;

ALTER TABLE public.consent_events ENABLE ROW LEVEL SECURITY;
-- No anon/authenticated policy at all: the only writer is the API route via
-- the service role, the only reader is the admin RPC (also service role).
REVOKE ALL ON public.consent_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.consent_events TO service_role;
REVOKE ALL ON SEQUENCE public.consent_events_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SEQUENCE public.consent_events_id_seq TO service_role;

-- Acceptance per variant: sessions that saw the card, and what they chose.
-- Counted per session (not per row) so a card shown on five pages of one
-- visit is one impression, and a visitor who accepted counts once.
CREATE OR REPLACE FUNCTION public.get_consent_funnel(p_from timestamptz, p_to timestamptz)
RETURNS TABLE (
  variant text,
  sessions_shown bigint,
  sessions_minimized bigint,
  sessions_accept_all bigint,
  sessions_essential_only bigint,
  sessions_settings_saved bigint,
  acceptance_pct numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH per_session AS (
    SELECT coalesce(session_id, 'row:' || id::text) AS sid,
           variant,
           bool_or(event = 'shown')          AS shown,
           bool_or(event = 'minimized')      AS minimized,
           bool_or(event = 'accept_all')     AS accept_all,
           bool_or(event = 'essential_only') AS essential_only,
           bool_or(event = 'settings_saved') AS settings_saved
    FROM public.consent_events
    WHERE created_at >= p_from AND created_at < p_to
    GROUP BY 1, 2
  )
  SELECT variant,
         count(*) FILTER (WHERE shown),
         count(*) FILTER (WHERE minimized),
         count(*) FILTER (WHERE accept_all),
         count(*) FILTER (WHERE essential_only),
         count(*) FILTER (WHERE settings_saved),
         round(100.0 * count(*) FILTER (WHERE accept_all)
               / nullif(count(*) FILTER (WHERE shown OR accept_all OR essential_only OR settings_saved), 0), 1)
  FROM per_session
  GROUP BY variant
  ORDER BY variant;
$$;

REVOKE EXECUTE ON FUNCTION public.get_consent_funnel(timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_consent_funnel(timestamptz, timestamptz) TO service_role;
