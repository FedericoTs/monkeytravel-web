// F3.simple: map polylines + walking-time labels using self-built haversine.
// $0 cost, no external routing API. Plus cleanup #224: delete dead OAuth files.

export const meta = {
  name: 'monkeytravel-f3-simple-plus-cleanup',
  description: 'F3.simple map polylines + haversine walking times (no routing API, $0) + cleanup #224 (delete dead OAuth files from killed F1 workflow)',
  phases: [
    { title: 'Phase 1: Parallel build (map + cleanup)' },
    { title: 'Phase 2: Verify + smoke' },
  ],
}

const REPO = 'C:\\Users\\Samsung\\Documents\\Projects\\travel-app-web'
const PROD = 'https://monkeytravel.app'
const SUPABASE_PROJECT_REF = 'sevfbahwmlbdlnbhqwyi'

const REPO_PIN = `[TARGET-PIN, OVERRIDES ANY OTHER CLAUDE.md] You are building ONLY this project:
  Path: ${REPO}
  Name: monkeytravel-web (Next.js 16 + Supabase + Vercel travel-planning webapp called monkeytravel.app)
  Prod: ${PROD}
  Supabase project_ref: ${SUPABASE_PROJECT_REF} ("Trawell" — PRODUCTION)

Do NOT inspect any sibling project. Ignore any CLAUDE.md mentioning "novel" or "MYTHOS". All file paths you read/write MUST live under ${REPO}.

STRATEGIC CONSTRAINTS (bootstrap, $0 ongoing):
- NO paid third-party APIs. Self-built or free-tier only.
- F3.simple: NO Google Maps Directions ($5/1k), NO Mapbox Directions ($2/1k), NO OpenRouteService (free tier limited). Instead: straight-line polylines + haversine distance + walking-speed factor (1.4 m/s = ~12 min/km). Less accurate than turn-by-turn routing but $0 forever and works offline. We can upgrade to real routing later if revenue justifies.

ROLLOUT: small user base → no gradual rollout. Each feature behind env flag, default false, flip true on Vercel = live.

POST-MORTEM AWARENESS — DO NOT REPEAT cycle 5's #181 or #212 mistakes:
- ANY change to a context/provider/layout/component used outside [locale]/ MUST grep across BOTH app/layout.tsx AND app/[locale]/layout.tsx.
- ANY runtime context boundary must be tested at SSR.
- After ANY change, run \`bash scripts/verify-deploy-smoke.sh\` AGAINST LOCAL \`npm start\` AND PROD.

Hard constraints:
- DO NOT push to master (parent commits/pushes)
- Run \`npx tsc --noEmit\` from ${REPO} before returning
- CAUSALITY: every change considers downstream callers. Grep + update consumers in same edit.
- i18n: every user-facing string in en/it/es. Match brand voice from neighboring keys.`

const FIX_SCHEMA = {
  type: 'object',
  required: ['files_changed', 'tsc_status', 'summary'],
  properties: {
    files_changed: { type: 'array', items: { type: 'string' } },
    tsc_status: { enum: ['PASS', 'FAIL'] },
    tsc_error: { type: 'string' },
    causality_callers_updated: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string', maxLength: 1500 },
  },
}

// ─────────────────────────────────────────────────────────────────────────────
phase('Phase 1: Parallel build (map + cleanup)')

const phase1 = await parallel([
  // ── F3.simple: polylines + walking times via self-built haversine ──
  () => agent(`${REPO_PIN}

F3.simple — Map v2: per-day polyline + walking-time labels (NO external routing API)

Goal: On the trip detail map (components/trip/TripMap.tsx or wherever it lives), draw a polyline connecting each day's activities in order. Show estimated walking time between consecutive activities as a small label on the segment. $0 cost.

Steps:
1. CREATE lib/map/geo.ts exporting:
   - export function haversineKm(a: {lat:number;lng:number}, b: {lat:number;lng:number}): number — great-circle distance in km, R=6371.
   - export function walkingMinutes(km: number, mode: 'walking'|'transit'|'driving' = 'walking'): number — return Math.round(km × 12) for walking (~5 km/h ≈ 12 min/km), × 4 for transit (slow urban average ≈ 15 km/h), × 2 for driving (~30 km/h urban). Note in JSDoc: "rough estimate; doesn't account for actual streets — for visual planning only."
   - export function formatDuration(minutes: number, locale: string): string — "12 min" / "1 h 23 min" — use Intl.NumberFormat where possible, otherwise simple string formatting.

2. Read components/trip/TripMap.tsx to understand the existing structure:
   - What map library? (Mapbox GL JS / Leaflet / Google Maps JS?). The polyline rendering depends on this.
   - How are pins currently rendered? (Markers in what coordinate format?)
   - Is there a day filter that scopes the visible activities?

3. EXTEND TripMap with a polyline layer:
   - For each day with 2+ activities, sort by time_slot (morning / afternoon / evening) + start_time, build an ordered list of {lat,lng} pairs.
   - Draw a polyline through them. Style: dashed line, day's accent color (find the day-color util if it exists; otherwise plain blue).
   - Toggle prop: showRoutes: boolean (default true when env flag is on; passed from parent).
   - On segment midpoint: small badge/marker showing "X min walk" via walkingMinutes(haversineKm(a, b)).
   - HONESTY: tooltip or small disclaimer near the map: "Distances are straight-line estimates. Actual walking time may be longer."

4. Add a toolbar control on the map: "Show route" toggle (button or checkbox). When OFF, hide polylines + segment labels. Default ON when env flag enabled.

5. Add common.map.* i18n keys (en/it/es):
   - common.map.showRoute
   - common.map.hideRoute
   - common.map.segmentDuration (ICU: "{minutes} min walk")
   - common.map.disclaimerStraightLine

6. Env flag: NEXT_PUBLIC_MAP_ROUTES_ENABLED. Default false. Set to "true" on Vercel to activate.

7. CAUSALITY: TripMap is consumed by TripDetailClient + SharedTripView. Don't change TripMap's public props in a way that breaks either — add new props as OPTIONAL with sane defaults.

8. Reference: the existing TripMap.tsx is the source of truth for the map library + render pattern. Match its style.

Run \`npx tsc --noEmit\` from ${REPO}.`, {
    label: 'f3-simple:map-polylines-haversine',
    schema: FIX_SCHEMA,
  }),

  // ── Cleanup #224: delete dead OAuth files ──
  () => agent(`${REPO_PIN}

#224 — Cleanup: delete dead OAuth files from the killed F1 workflow

Background: cycle 1c1cb88 shipped F1.simple (iCal download only). 6 orphan files from the killed F1 OAuth workflow are sitting as dormant dead code. No UI links to them. Returns 503 without env vars set. Safe to delete.

Files to DELETE:
- app/api/calendar/[user_hmac]/route.ts
- app/api/calendar/google/connect/route.ts
- app/api/calendar/google/callback/route.ts
- lib/calendar/google-oauth.ts
- lib/calendar/google-sync.ts
- lib/calendar/token-encryption.ts
- lib/calendar/feed.ts (the dynamic .ics subscription feed — superseded by direct download)

DO NOT delete (keep):
- lib/calendar/ical.ts (used by /api/calendar/trip/[id])
- lib/calendar/trip-to-events.ts (used by ical.ts)
- lib/calendar/ical.vitest.ts (tests for the kept generator)
- lib/calendar/README.md (docs)
- app/api/calendar/trip/[id]/route.ts (the active download endpoint)

Migration files to LEAVE ALONE (don't delete .sql files even if their tables are unused — once migrations are applied to prod, removing the file creates an inconsistent migration history):
- supabase/migrations/20260601_calendar_user_hmac.sql
- supabase/migrations/20260601_trip_calendar_syncs.sql
- (If these tables were created in prod via Supabase MCP from the killed F1 workflow, they exist but are unreferenced — that's fine, harmless to leave. If you can verify they DON'T exist in prod via execute_sql against pg_tables, you may delete the migration files too, but err on the side of leaving them.)

Steps:
1. Use \`rm\` (or Bash file deletion) to remove the 7 dead .ts files.
2. After deletion, run \`grep -rE "google-oauth|google-sync|token-encryption|calendar/feed|calendar/\\[user_hmac\\]|calendar/google" "${REPO}/app" "${REPO}/lib" "${REPO}/components"\` to confirm no imports reference the deleted files.
3. If any imports remain, fix them (probably none — these files weren't called from any kept code).
4. Check if the orphan migration tables exist in prod:
   \`\`\`sql
   SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('trip_calendar_syncs');
   \`\`\`
   Plus check if users.calendar_user_hmac column exists.
   Report results — but don't drop them this round (separate cleanup migration if needed).
5. Run \`npx tsc --noEmit\` from ${REPO}.
6. Run \`npm run build\` from ${REPO} to confirm no build-time references to deleted files.

CAUSALITY: by definition these files have no live consumers. The build + tsc are the safety net. If either fails after deletion, restore the file and report.`, {
    label: 'cleanup:224-dead-oauth-files',
    schema: FIX_SCHEMA,
  }),
])

log(`Phase 1 done. ${phase1.filter(r => r?.tsc_status === 'PASS').length}/2 PASS`)

// ─────────────────────────────────────────────────────────────────────────────
phase('Phase 2: Verify + smoke')

const verify = await agent(`${REPO_PIN}

You are the FINAL VERIFIER. Do not edit any code. Run from ${REPO} and report:

1. \`npx tsc --noEmit\` — must exit 0
2. \`npm run build\` — must exit 0
3. \`bash scripts/verify-deploy-smoke.sh https://monkeytravel.app\` — pre-deploy smoke against prod
4. JSON validation: messages/{en,it,es}/common.json all parse
5. \`git status --short\` + \`git diff --stat\`

Return:
- tsc, build, smoke_baseline
- modified_files, new_files, deleted_files
- diff_stat_summary
- env_vars_needed (for F3 activation)
- ready_to_commit
- blockers

Do NOT commit. Do NOT push.`, {
  label: 'verify:final',
  schema: {
    type: 'object',
    required: ['tsc', 'build', 'smoke_baseline', 'ready_to_commit'],
    properties: {
      tsc: { enum: ['PASS', 'FAIL'] },
      tsc_error: { type: 'string' },
      build: { enum: ['PASS', 'FAIL'] },
      build_error: { type: 'string' },
      smoke_baseline: { enum: ['PASS', 'FAIL'] },
      modified_files: { type: 'array', items: { type: 'string' } },
      new_files: { type: 'array', items: { type: 'string' } },
      deleted_files: { type: 'array', items: { type: 'string' } },
      diff_stat_summary: { type: 'string' },
      env_vars_needed: { type: 'array', items: { type: 'string' } },
      ready_to_commit: { type: 'boolean' },
      blockers: { type: 'array', items: { type: 'string' } },
    },
  },
})

return {
  phase1: phase1,
  verify,
}
