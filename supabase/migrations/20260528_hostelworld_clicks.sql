-- hostelworld_clicks — pitch-ready CTR data for the Hostelworld partnership.
--
-- Every click on the "Find hostels for this trip" CTA (rendered by
-- components/trip/BackpackerHostelCta.tsx) writes a row here.
-- PostHog already covers analytics, but a dedicated table gives us a
-- defensible "exact count" number for the partner conversation
-- ("we drove N searches to you in the last 30 days").
--
-- Writes are service-role-only via /api/affiliates/hostelworld/click.
-- No client-side direct inserts: that path would let an attacker
-- inflate the count. The API does the rate-limit + dedup.
--
-- Applied to prod 2026-05-28 via Supabase MCP. See docs/MIGRATION_PLAN.md
-- Tier 1.3 for context.

CREATE TABLE IF NOT EXISTS public.hostelworld_clicks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id         UUID REFERENCES public.trips(id) ON DELETE SET NULL,
  user_id         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Cookie id for anonymous click attribution (matches /saved pattern).
  visitor_cookie  TEXT,
  -- Trip context at click time (denormalised so the row survives trip
  -- deletion + lets us aggregate without joining).
  destination     TEXT,
  start_date      DATE,
  end_date        DATE,
  -- Where did the click come from? "/trips/[id]" vs "/shared/[token]"
  -- vs "/backpacker" landing. Helps split intent-to-book vs casual.
  source_path     TEXT,
  -- User agent class — drop full UA for privacy. Just "mobile" / "desktop".
  device_class    TEXT CHECK (device_class IS NULL OR device_class IN ('mobile','tablet','desktop','bot')),
  -- Whether the click flowed through the Awin affiliate redirect
  -- (i.e. whether HOSTELWORLD_AWIN_AFFILIATE_ID was set at click time).
  -- Lets us segment "tracked vs untracked" clicks in reporting.
  is_tracked      BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.hostelworld_clicks IS
  'Audit log of clicks on the Backpacker Mode → Hostelworld CTA. Service-role writes only via /api/affiliates/hostelworld/click. Powers the "we drove N searches to you" metric for the partnership pitch.';

CREATE INDEX IF NOT EXISTS idx_hostelworld_clicks_created_at
  ON public.hostelworld_clicks(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_hostelworld_clicks_trip
  ON public.hostelworld_clicks(trip_id, created_at DESC)
  WHERE trip_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_hostelworld_clicks_destination
  ON public.hostelworld_clicks(destination, created_at DESC)
  WHERE destination IS NOT NULL;

ALTER TABLE public.hostelworld_clicks ENABLE ROW LEVEL SECURITY;

-- No SELECT/INSERT/UPDATE/DELETE policies — service-role only. Admin
-- reports query via the service-role client; no user-facing surface.
