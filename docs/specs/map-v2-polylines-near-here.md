# Map v2 — Per-Day Polylines, Mode-Aware Travel Times, and "Near Here"

## TL;DR
TripMap today drops disconnected dots on a Google Map and the user has to mentally connect them. Map v2 draws the actual per-day walking/transit route between consecutive activities, prints a "12 min walk" badge on every segment, and pops a "Near here" bottom sheet when the user taps the next-activity pin. This is the #1 in-trip surface — making it actually useful is the single highest-leverage move for trip-day retention.

## Problem & User Pain
- **JTBD:** "I'm standing outside the museum. What's next, how do I get there, how long, and is there anything worth grabbing on the way?"
- **Current workaround:** Users tap a pin, copy the address, paste it into Google Maps app, lose context, then bounce. Session replays on `/trips/[id]` show ~35% of mobile sessions open Google Maps in a new tab and never return.
- **Quantified pain:** PostHog `trip_map_pin_clicked` → `trip_map_open_in_maps_clicked` conversion is 71% — meaning the app is a glorified directory. The "near here" question isn't answered at all; users open Yelp/TripAdvisor.
- **Compounding:** Once the user leaves to a competitor surface in-trip, they often don't come back for day 2 planning. Day-2-engagement is 41% lower than day-1 (PostHog cohort, 30d).

## Success Metrics
- **Primary:** `% of in-trip sessions that view 2+ days on the map` — currently 18%, target 45%.
- **Secondary:**
  - `% segments with rendered polyline & time label` (correctness gauge, target >92% of activity pairs that have coordinates on both sides).
  - `near_here_sheet_opened` → `near_here_poi_clicked` CTR (target >25%).
  - Trip-day-2 return rate (target +15pp vs. baseline within 60 days).
  - Average Distance Matrix cost per saved trip (target < $0.08 — see calc below).
- **Anti-metrics:**
  - "Open in Google Maps" click-through stays flat (we want to keep them in-app, not push them out — anti-metric if it climbs).
  - Routing API cost per trip > $0.20 (means caching broke).
  - Map TTI on mid-tier Android > 2.5s (means we shipped too much JS).

## User Flow (happy path)
1. User opens `/trips/[id]`, scrolls to the map (already lazy-loaded via `next/dynamic`).
2. Map renders pins as today (no regression). Behind the scenes, a single batched request fires to `POST /api/travel/route` with all consecutive activity pairs grouped by day.
3. As route data streams back per-day, a colored polyline (matching the day chip color from `DAY_COLORS`) is drawn connecting that day's pins in order. A small label on the midpoint of each segment shows `12 min walk` or `8 min transit`.
4. A floating segmented control top-right: `Walking | Transit` (default = whichever is optimal per-segment, with the segment mode shown on its badge). Toggling re-fetches segments that don't have the chosen mode cached.
5. User taps the next-activity pin (the next chronologically-upcoming activity for "today", based on `trip.start_date + dayNumber`). A bottom sheet slides up (`BottomSheet` component, dvh + safe-area aware) titled "Near [Activity Name]" with 5–10 POIs grouped into tabs: **Food** · **Sights** · **Transit**. Each POI is a card with name, distance, walking time, category icon, and a "Show on map" / "Open in Maps" action.
6. Tapping a POI drops a temporary translucent pin on the map (doesn't enter activity_index — just a session marker) and closes the sheet.

## Edge Cases & Failure Modes
- **No coordinates for an activity:** segment skipped, render a dashed grey line between the previous and next known points with a `?` label that opens a tooltip "Travel time unknown — address missing coordinates."
- **Single-activity day:** no polyline, no segments. Pin still rendered.
- **Cross-day continuity:** never draw lines across day boundaries (day 1's last pin does NOT connect to day 2's first).
- **`disableApiCalls=true`** (anonymous result page, saved-trip cost-guard): show pins only, no polylines, no near-here sheet. Display a "Sign in to see routes" CTA on the map's empty-segment legend.
- **Routing API returns ZERO_RESULTS** (e.g. island activity, transit unavailable): fall back to Haversine + `estimateTravelTime()` (already in `lib/utils/travel-estimation.ts`), draw a straight dashed line, label with `~24 min walk` (the `~` distinguishes estimates from API results).
- **Transit mode unavailable in region** (e.g. rural Tuscany): silently fall back to walking, badge says "walk only".
- **Auth issues:** `/api/travel/route` and `/api/travel/near-here` use Supabase RLS to scope to `trip_id` the caller can read (owner OR collaborator OR explore-public). Anon users on `/shared/[token]` get a signed JWT scope check against `shared_tokens`. No data leak.
- **Privacy:** Near-here POIs come from `activity_index` (which is already `visibility IN ('public','shared')` filtered in the materialized view). No private user trips ever surface as suggestions.
- **Rate abuse:** anonymous shared-token visitors get `createRateLimiter` namespace `route-anon` at 30 req/min/IP. Authed users get 120 req/min/user.
- **Tile loading on iOS Capacitor WebView:** Google Maps gesture handling must use `gestureHandling: 'greedy'` to prevent the WebView from hijacking pinch-zoom. Test on physical iPhone via Capacitor wrap.

## Technical Architecture

### Data model
Two new tables and a column on `activity_index`. All migrations follow the existing 20260530_*-style.

`supabase/migrations/20260602_postgis_route_cache.sql`:
```sql
CREATE EXTENSION IF NOT EXISTS postgis;

-- Per-pair route cache. Key by md5(origin|dest|mode) for stable joins.
CREATE TABLE public.route_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_hash text NOT NULL UNIQUE,         -- md5(origin_key|dest_key|mode)
  origin_lat double precision NOT NULL,
  origin_lng double precision NOT NULL,
  destination_lat double precision NOT NULL,
  destination_lng double precision NOT NULL,
  mode text NOT NULL CHECK (mode IN ('walking','transit','driving')),
  polyline_encoded text NOT NULL,          -- Google encoded polyline; ~1KB/segment
  distance_meters int NOT NULL,
  duration_seconds int NOT NULL,
  steps_summary jsonb,                     -- ["Head NW on Via X", "Turn R", ...]; null for transit
  source text NOT NULL CHECK (source IN ('google','mapbox','ors','estimate')),
  hit_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_accessed_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days')
);
CREATE INDEX route_cache_hash_idx ON public.route_cache (route_hash);
CREATE INDEX route_cache_expires_idx ON public.route_cache (expires_at);

-- Anon + service can SELECT/INSERT via SECURITY DEFINER RPC only; no direct RLS grants.
ALTER TABLE public.route_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY route_cache_no_direct ON public.route_cache FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
GRANT SELECT, INSERT, UPDATE ON public.route_cache TO service_role;
```

`supabase/migrations/20260603_activity_index_geog.sql`:
```sql
ALTER TABLE public.activity_index_base ADD COLUMN IF NOT EXISTS geog geography(Point, 4326);

-- Materialized view rebuild adds geog. Re-create with PostGIS point from coordinates JSONB.
DROP MATERIALIZED VIEW public.activity_index CASCADE;
CREATE MATERIALIZED VIEW public.activity_index AS
SELECT
  -- ... existing columns ...
  CASE
    WHEN (act->'coordinates'->>'lat') IS NOT NULL AND (act->'coordinates'->>'lng') IS NOT NULL
    THEN ST_SetSRID(ST_MakePoint(
      (act->'coordinates'->>'lng')::double precision,
      (act->'coordinates'->>'lat')::double precision
    ), 4326)::geography
    ELSE NULL
  END AS geog
FROM ... -- existing FROM/WHERE
;
CREATE INDEX activity_index_geog_gist ON public.activity_index USING GIST (geog);
-- preserve existing trgm + uniq indexes
```

`supabase/migrations/20260604_near_here_rpc.sql`:
```sql
CREATE OR REPLACE FUNCTION public.activities_near_point(
  p_lat double precision,
  p_lng double precision,
  p_radius_meters int DEFAULT 800,
  p_types text[] DEFAULT NULL,
  p_limit int DEFAULT 10
) RETURNS TABLE (...) LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT row_key, trip_id, name, type, address, coordinates, image_url,
         ST_Distance(geog, ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography)::int AS distance_m
  FROM public.activity_index
  WHERE geog IS NOT NULL
    AND ST_DWithin(geog, ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography, p_radius_meters)
    AND (p_types IS NULL OR type = ANY(p_types))
  ORDER BY geog <-> ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
  LIMIT GREATEST(p_limit, 1);
$$;
GRANT EXECUTE ON FUNCTION public.activities_near_point TO anon, authenticated, service_role;
```

### API surface
- `POST /app/api/travel/route/route.ts` — batch route fetcher.
  - Request: `{ pairs: [{ index, origin: {lat,lng}, destination: {lat,lng}, mode: 'walking'|'transit'|'auto' }], tripId?: string }`. Max 50 pairs per call.
  - Response: `{ results: [{ index, polyline_encoded, distance_meters, duration_seconds, mode, source }], stats: { cached, fetched, estimated } }`.
  - Mirrors structure of existing `/api/travel/distance/route.ts` (cache-first via `route_cache`, batched Google call for misses, fallback to Haversine estimate).
- `GET /app/api/travel/near-here/route.ts?lat=&lng=&types=food,sights&radius=800` — bottom-sheet POI fetcher.
  - Calls `activities_near_point` RPC.
  - Cached at the Vercel edge for 1 hour by full query string (POIs are static-ish).

### Key components
- `components/TripMap.tsx` — extend, do not rewrite. Add:
  - `polylines: Map<string, google.maps.Polyline>` ref.
  - `<Polyline />` from `@react-google-maps/api` per day, decoded from `polyline_encoded`.
  - `<OverlayView />` per segment midpoint with the time badge (custom DOM, not Marker, for cheap rendering).
  - Floating `<ModeToggle />` (new, ~60 LOC) with shadcn-style segmented control.
  - `gestureHandling: 'greedy'` added to `mapOptions` (Capacitor pinch-zoom fix).
- `components/trip/NearHereSheet.tsx` (new, ~180 LOC). Uses existing `BottomSheet` primitive. Props: `{ originActivity: Activity, isOpen: boolean, onClose: () => void, onPoiSelected: (poi) => void }`. Three tabs (Food/Sights/Transit) with skeleton states. Empty state copy in `messages/{en,it,es}.json` keys `map.nearHere.*`.
- `hooks/useTripRoutes.ts` (new). Returns `{ routesByDay, isLoading, mode, setMode }`. Internally calls `/api/travel/route` with all pairs grouped by day, dedups via `useMemo` on a stable hash (mirror the `getDaysHash` pattern in TripMap).

### External integrations — routing engine decision
| Engine | Cost/1k | Polyline quality | Transit coverage | Free tier | Verdict |
|---|---|---|---|---|---|
| Google Directions API | $5 (driving/walking), $10 (transit) | Best | Best (real transit data 60+ countries) | $200/mo credit | **Recommended** |
| Mapbox Directions | $2 | Good (no transit) | None | 100k/mo free | Walk-only fallback candidate |
| OpenRouteService | Free | OK | Limited | 2000/day | Not viable at scale |

**Recommendation:** Google Directions API for both modes. Reuse the existing `GOOGLE_PLACES_API_KEY` env (already enabled for Distance Matrix). Walking quotes at $5/1k, transit at $10/1k. With 80% cache hit ratio: 1000-trip cohort × 7 days × 5 segments × 20% miss = 7000 calls; mixed cost ≈ $35–50 per 1k-trip cohort. Cheap. SDK: native `fetch` against `https://maps.googleapis.com/maps/api/directions/json` — no SDK dependency.

**Future hedging:** abstract the call through `lib/travel/routing-provider.ts` so Mapbox can be swapped in for walking if Google costs spike.

### Caching strategy
- `route_cache` table, keyed by `md5(origin_key|dest_key|mode)` where each key is `lat,lng` rounded to 4 decimals (~11m, identical scheme to `distance_cache`). 30-day TTL. Pedestrian/transit networks change <0.1% in 30 days.
- Hit counter for usage analytics; nightly cron `/api/cron/prune-route-cache` deletes `expires_at < now() AND hit_count = 0`.
- Near-here results cached at Vercel edge (`Cache-Control: s-maxage=3600, stale-while-revalidate=86400`) keyed by rounded lat/lng (3 decimals = ~110m).
- Per-session client cache in `useTripRoutes` via `useMemo` — never re-fetches within a session for the same trip.

### Observability
- Sentry tag: `feature=map-v2` on every error in `/api/travel/route` and `NearHereSheet`. Include `mode` and `pairs_count` as extras.
- PostHog events: `map_v2_polyline_rendered` (with `day_count`, `cache_hit_ratio`, `mode`), `map_v2_mode_toggled` (with `from`, `to`), `near_here_sheet_opened` (with `activity_type`), `near_here_poi_clicked` (with `poi_type`, `distance_m`).
- Log shape: `[Route API] { cached, fetched, estimated, cost_usd, tripId }` mirroring the Distance API style.

### Security review
- Auth: route + near-here endpoints accept anonymous calls; the `tripId` (if provided) is RLS-checked. Anonymous flow only allowed when caller can prove read access to the trip (owner / collaborator / public-visibility / valid `shared_token` JWT).
- RLS: `route_cache` is service-role only; no direct RLS exposure. `activity_index` already public-filtered.
- Rate limit: `createRateLimiter('route', 120, 60)` for authed, `'route-anon'` 30/min/IP. Same for near-here.
- CSRF: existing `lib/security/safe-next` already covers POST. No new attack surface.
- API-key exposure: server-only — Google Directions key never sent to client. Polyline encoded strings are inert.
- Cost DOS: an attacker could bombard `/api/travel/route` with random coords to force cache misses. Mitigation: per-IP rate limit + max 50 pairs per call + check `pair.origin` lat/lng falls within ±0.5° of any of the trip's activities (sanity check; reject pairs outside that envelope).

## Implementation Phases
**Phase 1 — MVP (2 weeks, behind `FEATURE_MAP_V2` flag):**
- Migrations: `route_cache`, PostGIS extension, `activity_index` geog column + GIST index, `activities_near_point` RPC.
- `/api/travel/route` POST endpoint (cache-first, Google Directions fallback, estimate fallback).
- `/api/travel/near-here` GET endpoint.
- `useTripRoutes` hook.
- TripMap.tsx extension: polylines (single-mode, auto-select per segment), no badges yet, no mode toggle.
- `NearHereSheet` component with all three tabs.
- next-intl keys `map.routes.*` and `map.nearHere.*` for en/it/es.
- Playwright E2E: `tests/e2e/map-v2-polylines.spec.ts` — load a saved trip, assert polylines render, tap pin, assert sheet opens with POIs.
- Flag default = on for `@monkeytravel.app` internal accounts, off for everyone else.

**Phase 2 — Polish (1 week):**
- Mode toggle (Walking | Transit) with per-segment override badges.
- Time labels on segment midpoints via `OverlayView`.
- Estimate-dashed-line styling for failures.
- Capacitor gesture fix verified on physical iPhone + Pixel.
- Empty/loading skeletons in NearHereSheet.
- A11y: polyline segments have invisible accessible `<button>` overlays for keyboard navigation; mode toggle is a real `<RadioGroup>`.

**Phase 3 — Optimization (ongoing):**
- Cron `/api/cron/prune-route-cache` nightly.
- A/B: default mode = walking vs. auto-best-per-segment.
- Pre-warm cache: on `trip.save`, enqueue a Vercel background job (`waitUntil`) that fetches all routes for that trip up-front so the first map open is instant.
- Mapbox fallback for walking if Google costs trend > $0.20/trip.
- Investigate `vector tiles` + Mapbox GL for richer styling once cost-per-trip stabilizes.

## Effort & Cost
- **Engineering:** Phase 1 ≈ 2 person-weeks (1 BE on migrations + endpoints, 1 FE on TripMap + sheet, parallel). Phase 2 ≈ 1 person-week. Phase 3 spread over a quarter.
- **Infra cost:**
  - `route_cache`: ~1KB/row × 50k rows (steady state at 1000 trips) ≈ 50 MB. Negligible.
  - PostGIS extension: no extra Supabase cost on Pro tier.
  - Vercel edge cache for near-here: covered by existing plan.
- **Vendor cost (Google Directions):**
  - Per-trip avg: 7 days × 5 segments = 35 segments. Mixed walking/transit weighted 70/30: `(35 × 0.7 × $0.005) + (35 × 0.3 × $0.01) = $0.228` uncached.
  - With 80% cache hit ratio (cross-trip overlap is high in tourist hubs): `$0.228 × 0.2 = $0.046/trip`.
  - 1000-trip cohort: ~$46. 10k trips/mo (current pace): ~$460/mo. Sits inside the $200/mo Google credit + small overage.
- **Near-here:** zero vendor cost (own materialized view).

## Risks & Mitigations
1. **Risk:** Google Directions transit data is sparse outside major cities → segments fall back to walking with no indication of why. **Mitigation:** Show `transit unavailable here` tooltip on auto-fallback; log to PostHog with city as property to detect geographic dead zones.
2. **Risk:** Polyline rendering on low-end Android phones hurts FPS during pan/zoom. **Mitigation:** Cap drawn polylines at 50 segments total; for trips >10 days use `geodesic: false` and `strokeWeight: 3` to minimize draw cost; defer rendering until map idle event.
3. **Risk:** `activity_index` doesn't contain user-private trips, so "Near here" in obscure destinations returns 0 POIs. **Mitigation:** Fall back to a Google Places `nearbysearch` call (rate-limited, max 1/trip-session) when RPC returns <3 results. Display badge "Powered by Google Places" when fallback engaged.
4. **Risk:** Cache stampede on cohort launch (first 1000 trips after rollout all miss). **Mitigation:** Pre-warm via the Phase 3 background job before flag rollout to general population.
5. **Risk:** Capacitor WebView pinch-zoom regression: `gestureHandling: 'greedy'` makes the map capture all gestures and the user can't scroll past it. **Mitigation:** wrap map in a `<div>` with a `Use map` overlay button on first touch (Layla pattern); only enable greedy gestures after user opts in.

## Open Questions
- Does the bottom sheet auto-open when the user arrives at the trip in calendar-time (i.e. it's day 3 of a saved trip and the user opens the trip), or only on explicit pin tap? Default: pin tap only — auto-open feels too pushy and we don't have geofencing.
- Mode toggle persistence: per-trip user preference, or global account preference? Recommend per-trip (column on `trips.ui_state` JSONB).
- Should we draw a polyline from the user's hotel (if known) to day 1 activity 1? Out of scope for MVP; requires solid lodging-address capture, which is itself unbuilt.

## References
- `components/TripMap.tsx` — the file we extend. Note the `daysHash` dedup pattern and `disableApiCalls` flag — reuse both.
- `app/api/travel/distance/route.ts` — exact pattern to mirror for `/api/travel/route` (cache-first, batched API, Haversine fallback, cost logging).
- `supabase/migrations/20260530_activity_index_mview.sql` — materialized view + RPC structure; the new geog column piggybacks on this.
- `lib/utils/travel-estimation.ts` — `estimateTravelTime` + `determineOptimalMode` already do mode auto-selection. Reuse, don't re-implement.
- `lib/api/rate-limit.ts` — `createRateLimiter` Upstash-backed limiter, drop in for `route-anon`.
- `components/BottomSheet` (used by `VotingBottomSheet`) — dvh + safe-area aware primitive for NearHereSheet.
- `lib/posthog/identify.ts` + existing `posthog.capture()` call sites for telemetry shape.
- `lib/platform/share.ts` + `lib/platform/external-link.ts` — use `openExternal()` for "Open in Maps" CTA so Capacitor doesn't break.
- `messages/en.json`, `messages/it.json`, `messages/es.json` — every user-facing string lives here. Add a `map.routes` and `map.nearHere` block, all three locales.
- Task #221 (`feat(map): per-day route polyline + walking/transit summary in TripMap`) — this spec is the plan for that task.
