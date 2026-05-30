// F1 implementation: Calendar export (iCal + Google Calendar OAuth) + smart notifications.
// Builds per docs/specs/calendar-export-smart-notifs.md. Ships behind a single env flag
// (NEXT_PUBLIC_CALENDAR_EXPORT_ENABLED) — flip to true in Vercel dashboard to enable for
// everyone simultaneously; flip to false to kill in 60s.

export const meta = {
  name: 'monkeytravel-feature-1-calendar',
  description: 'Implement F1 from roadmap: iCal export, dynamic .ics subscription feed, Google Calendar OAuth, smart notification cascade (14d/7d/3d/1d/morning-of)',
  phases: [
    { title: 'Phase 1: iCal core + subscription feed' },
    { title: 'Phase 2: Google Calendar OAuth + sync' },
    { title: 'Phase 3: Smart notification cascade' },
    { title: 'Phase 4: UI integration + i18n' },
    { title: 'Phase 5: Verify + smoke' },
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

PRD: docs/specs/calendar-export-smart-notifs.md — READ FIRST. The PRD is the spec; deviation from it requires noting in your summary.

ROLLOUT STRATEGY: small user base (sub-100 active users) → no gradual rollout. Ship behind a SINGLE env flag NEXT_PUBLIC_CALENDAR_EXPORT_ENABLED that:
- Defaults to false in code (so PR merge doesn't go live).
- When set to "true" on Vercel, the feature is live for ALL users immediately.
- Kill switch: flip env to "false" in Vercel dashboard → 60s rollback.
- DO NOT build PostHog flag UI infrastructure for this feature — the env flag is sufficient.

POST-MORTEM AWARENESS — DO NOT REPEAT cycle 5's #181 or #212 mistakes:
- ANY change to a context/provider/layout/component used outside [locale]/ MUST grep across BOTH app/layout.tsx AND app/[locale]/layout.tsx.
- ANY runtime context boundary must be tested at SSR.
- After ANY change, run \`bash scripts/verify-deploy-smoke.sh\` AGAINST LOCAL \`npm start\` AND PROD.

Hard constraints:
- DO NOT push to master (parent commits/pushes)
- Run \`npx tsc --noEmit\` from ${REPO} before returning
- For DB migrations: write .sql first, apply via Supabase MCP, verify schema state
- CAUSALITY: every change considers downstream callers. Grep + update consumers in same edit.
- i18n: every user-facing string in en/it/es. Match brand voice from neighboring keys.`

const FIX_SCHEMA = {
  type: 'object',
  required: ['files_changed', 'tsc_status', 'summary'],
  properties: {
    files_changed: { type: 'array', items: { type: 'string' } },
    tsc_status: { enum: ['PASS', 'FAIL'] },
    tsc_error: { type: 'string' },
    migration_applied: { type: 'string' },
    causality_callers_updated: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string', maxLength: 1500 },
  },
}

// ─────────────────────────────────────────────────────────────────────────────
phase('Phase 1: iCal core + subscription feed')

const phase1 = await parallel([
  () => agent(`${REPO_PIN}

PHASE 1A — iCal generator (lib/calendar/ical.ts)

Goal: build a pure-function module that turns a Trip + its days into a valid iCal (RFC 5545) string.

Steps:
1. Read docs/specs/calendar-export-smart-notifs.md to understand the data flow.
2. Check package.json for an existing ics or ical-generator npm package. If absent, use the \`ics\` npm package (or implement RFC 5545 inline — it's straightforward, ~150 lines).
3. CREATE lib/calendar/ical.ts exporting:
   \`\`\`ts
   export type IcalEvent = {
     uid: string;          // stable per activity_id
     summary: string;      // activity title
     description?: string;
     location?: string;
     geo?: { lat: number; lng: number };
     dtstart: Date;        // in trip's local time
     dtend: Date;
     tzid?: string;        // IANA tz (e.g. Europe/Lisbon)
   };
   export function buildIcal(events: IcalEvent[], opts: { calName: string; productId?: string }): string;
   \`\`\`
4. RFC 5545 essentials:
   - VCALENDAR wrapper with PRODID + VERSION:2.0 + CALSCALE:GREGORIAN + METHOD:PUBLISH
   - VTIMEZONE blocks for each unique TZID (date-fns-tz has the offset data)
   - VEVENT blocks with UID + DTSTAMP + DTSTART;TZID= + DTEND;TZID= + SUMMARY + LOCATION + GEO + DESCRIPTION
   - Line folding at 75 octets per RFC 5545 §3.1
5. UID format: \`activity-{activity_id}@monkeytravel.app\` for stability (clients dedupe on UID).
6. Use date-fns-tz (likely already in deps) for tz handling. Don't depend on a new heavy lib.
7. Add a small test file lib/calendar/ical.test.ts (vitest if it's the project's test runner — check) with 2-3 cases: simple event, all-day event, multi-tz trip.

Run \`npx tsc --noEmit\` from ${REPO}.`, {
    label: 'phase1a:ical-generator',
    schema: FIX_SCHEMA,
  }),

  () => agent(`${REPO_PIN}

PHASE 1B — Dynamic .ics subscription feed (/api/calendar/[user_hmac].ics)

Goal: a calendar URL the user adds to Apple Calendar / Google Calendar / Outlook that auto-refreshes when their trips change.

Steps:
1. CREATE app/api/calendar/[user_hmac]/route.ts:
   - GET handler.
   - Path param user_hmac = HMAC(user_id, CALENDAR_HMAC_SECRET). User-stable so the URL doesn't change.
   - Verify the HMAC matches a known user via service-role lookup OR reverse-compute (better: store user_hmac on the users table as a derived column at signup).
   - Query trips + days + activities for this user where end_date > now() - INTERVAL '7 days' (don't expose ancient trips).
   - Build iCal via lib/calendar/ical.ts (Phase 1A).
   - Return: Content-Type: text/calendar; charset=utf-8 + Cache-Control: max-age=900, stale-while-revalidate=3600 (15 min cache — calendar apps poll ~hourly).
   - HMAC failure: 404 (don't leak that the route exists for invalid HMACs).
2. CAUSALITY: this is a NEW route, no consumers to update. BUT add the route path to robots.txt Disallow list (app/robots.ts) so crawlers don't index personalized .ics URLs.
3. Env var: CALENDAR_HMAC_SECRET — add a note in lib/calendar/README.md (or docs/) telling the user to set it in Vercel. Use crypto.subtle or node:crypto for HMAC; both are available on the edge runtime.
4. Rate limit: createRateLimiter('calendar-feed', 60, 60_000) — 60 req/min/IP (calendar apps poll, not spam).

Run \`npx tsc --noEmit\` from ${REPO}.`, {
    label: 'phase1b:ics-feed',
    schema: FIX_SCHEMA,
  }),
])

log(`Phase 1 done. ${phase1.filter(r => r?.tsc_status === 'PASS').length}/2 PASS`)

// ─────────────────────────────────────────────────────────────────────────────
phase('Phase 2: Google Calendar OAuth + sync')

const phase2 = await agent(`${REPO_PIN}

PHASE 2 — Google Calendar OAuth + one-shot sync

Goal: user clicks "Add to Google Calendar" → OAuth dance → we POST trip events directly into their primary calendar via Google Calendar API.

Steps:
1. Setup:
   - Need Google Cloud project + OAuth client ID (env: GOOGLE_OAUTH_CLIENT_ID + GOOGLE_OAUTH_CLIENT_SECRET).
   - Scope: https://www.googleapis.com/auth/calendar.events (write-only, narrowest). NOT calendar (which is broader).
   - Redirect URI: https://monkeytravel.app/api/calendar/google/callback (and localhost variant for dev).
2. CREATE app/api/calendar/google/connect/route.ts:
   - GET. Builds Google OAuth consent URL with PKCE + state param (HMAC-signed with trip_id we want to sync).
   - Redirects user to Google.
3. CREATE app/api/calendar/google/callback/route.ts:
   - GET. Verifies state HMAC + Supabase auth. Exchanges code for tokens.
   - Decrypts trip_id from state. Fetches trip + builds events (same shape as iCal events from Phase 1A).
   - POST each event to Google Calendar Events API. Extended property: monkeytravel_trip_id={id} + monkeytravel_activity_id={id} for future sync detection.
   - Stores refresh_token encrypted (use pgsodium IF available; otherwise just store as bytea and call out the env-var-based encryption todo).
   - Redirects to /[locale]/trips/[id]?gcal_sync=done.
4. Schema: trip_calendar_syncs (id, trip_id, user_id, provider='google', external_calendar_id, last_synced_at, status). Migration via Supabase MCP.
5. RLS: only the trip owner + collaborators can read their syncs.
6. CAUSALITY: the success redirect adds ?gcal_sync=done — TripDetailClient should show a toast. Wire that via a useSearchParams check + clear the param.

Run \`npx tsc --noEmit\` from ${REPO}.

NOTE: Without env vars set, the endpoint will throw on connect. Handle gracefully: if GOOGLE_OAUTH_CLIENT_ID is unset, return 503 with a clear "Calendar sync not configured" message. User can still use the .ics feed.`, {
  label: 'phase2:google-calendar-oauth',
  schema: FIX_SCHEMA,
})

log(`Phase 2 done. ${phase2?.tsc_status === 'PASS' ? 'PASS' : 'FAIL'}`)

// ─────────────────────────────────────────────────────────────────────────────
phase('Phase 3: Smart notification cascade')

const phase3 = await agent(`${REPO_PIN}

PHASE 3 — Smart notification cascade (14d/7d/3d/1d/morning-of)

Goal: zero-config per-trip notification cascade that fires from a daily cron without user setup.

Steps:
1. Schema: scheduled_notifications (id, trip_id, user_id, slot enum('t-14','t-7','t-3','t-1','morning'), scheduled_for timestamptz, sent_at nullable, status enum('pending','sent','suppressed','failed')). Migration via Supabase MCP.
   - UNIQUE INDEX (trip_id, slot) prevents double-scheduling.
2. CREATE app/api/cron/scheduled-notifications/route.ts:
   - Vercel cron (add to vercel.json with schedule "*/15 * * * *" — every 15 min, captures all 5 slots regardless of trip start time).
   - Auth: Vercel CRON_SECRET header check (mirror existing crons).
   - Query: SELECT scheduled_notifications WHERE status='pending' AND scheduled_for <= now().
   - For each: pick the right email template, call dispatchEmail from lib/email/send.ts (already hardened in cycle-5 #206 + cycle-7 #216 — fail-closed on notification_settings).
   - Update status='sent' OR 'failed'.
   - Honor the user's notification_settings.tripReminders preference (fail-closed if read errors).
   - RATE LIMIT: 1 email per trip per 24h (suppress if a sibling slot was sent in the last 24h to avoid cascade flooding).
3. Scheduler trigger: when a trip is saved (or trip start_date changes), enqueue the 5 slots. CREATE a SECURITY DEFINER RPC \`enqueue_trip_notifications(p_trip_id uuid, p_user_id uuid)\` called from /api/trips/save or wherever the save lives.
4. Email templates: components/emails/TripReminderEmail.tsx (React Email if already in use; else inline HTML).
   - 5 variants, one per slot.
   - Each links to the trip + a 1-click unsubscribe (use the HMAC-signed unsub URL from /api/unsubscribe — already exists).
   - Localized via getTranslations from next-intl (server-side render of email body in user's preferred_language).
5. Add cron entry to vercel.json.
6. CAUSALITY: the trip save flow already exists somewhere — find it (grep "INSERT INTO trips" + grep "from(\"trips\").insert"), wire the enqueue call. If the save is in a transaction, the enqueue should be inside it (or use a trigger).
7. Cancel scheduled notifications on trip delete or start_date change (re-enqueue with new times).

Run \`npx tsc --noEmit\` from ${REPO}.`, {
  label: 'phase3:smart-notifications',
  schema: FIX_SCHEMA,
})

log(`Phase 3 done. ${phase3?.tsc_status === 'PASS' ? 'PASS' : 'FAIL'}`)

// ─────────────────────────────────────────────────────────────────────────────
phase('Phase 4: UI integration + i18n')

const phase4 = await agent(`${REPO_PIN}

PHASE 4 — UI: "Add to calendar" dropdown on /trips/[id]

Goal: a single visible button on the trip detail page that surfaces 3 options when clicked.

Steps:
1. Find the trip detail page: app/[locale]/trips/[id]/page.tsx + TripDetailClient.tsx.
2. CREATE components/calendar/AddToCalendarMenu.tsx:
   - Renders ONLY if process.env.NEXT_PUBLIC_CALENDAR_EXPORT_ENABLED === 'true' — kill switch.
   - Button label: t('addToCalendar') (key under common.calendar.addToCalendar in messages/{en,it,es}/common.json).
   - On click: opens menu with:
     a. "Download .ics" → triggers download of /api/calendar/[user_hmac].ics (one-shot snapshot).
     b. "Subscribe (auto-update)" → webcal:// link with the same path; user adds to Apple/Outlook for auto-refresh.
     c. "Sync to Google Calendar" → navigate to /api/calendar/google/connect?trip_id=...
3. Mount in TripDetailClient (probably in the sticky action bar — check existing pattern).
4. Add common.calendar.* keys in EN/IT/ES:
   - addToCalendar, downloadIcs, subscribeAutoUpdate, syncGoogleCalendar, syncing, syncedSuccess, syncFailed
5. CAUSALITY: TripDetailClient is in the [locale] subtree → useAuth() is safe (descendant of AuthProvider, not root sibling like SessionTracker). Verify before adding any hook.
6. After Google sync redirect (?gcal_sync=done): show a Sonner toast (if Sonner is installed — check package.json) OR a styled success banner. Clear the query param.

Run \`npx tsc --noEmit\` from ${REPO}.`, {
  label: 'phase4:ui-integration',
  schema: FIX_SCHEMA,
})

log(`Phase 4 done. ${phase4?.tsc_status === 'PASS' ? 'PASS' : 'FAIL'}`)

// ─────────────────────────────────────────────────────────────────────────────
phase('Phase 5: Verify + smoke')

const verify = await agent(`${REPO_PIN}

You are the FINAL VERIFIER. Do not edit code. Run from ${REPO} and report:

1. \`npx tsc --noEmit\` — must exit 0
2. \`npm run build\` — must exit 0
3. \`bash scripts/verify-deploy-smoke.sh https://monkeytravel.app\` — pre-deploy smoke against prod (baseline)
4. JSON validation: messages/{en,it,es}/common.json all valid
5. \`git status --short\` + \`git diff --stat\`
6. List new supabase/migrations/

Return:
- tsc, build, smoke_baseline (PASS/FAIL)
- modified_files, new_files, migrations_added
- diff_stat_summary
- env_vars_needed: list of new env vars that must be set on Vercel for the feature to work (CALENDAR_HMAC_SECRET, GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, NEXT_PUBLIC_CALENDAR_EXPORT_ENABLED, CRON_SECRET if not already)
- ready_to_commit: boolean
- blockers: string[]

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
      migrations_added: { type: 'array', items: { type: 'string' } },
      diff_stat_summary: { type: 'string' },
      env_vars_needed: { type: 'array', items: { type: 'string' } },
      ready_to_commit: { type: 'boolean' },
      blockers: { type: 'array', items: { type: 'string' } },
    },
  },
})

return {
  phase1: phase1,
  phase2,
  phase3,
  phase4,
  verify,
}
