// F1.simple + F2.simple + F1.notifications: all free-and-self-built.
// - Calendar export = iCal download (no OAuth, no SaaS, no Google verification)
// - Email parse = paste-to-extract via Gemini (no Gmail OAuth, no Resend inbound webhook)
// - Smart notifications = scheduled_notifications + Vercel cron + existing Resend
// All gated by per-feature env flags so each can be killed independently in 60s.

export const meta = {
  name: 'monkeytravel-features-simple',
  description: 'F1.simple iCal download + F2.simple paste-to-parse + F1.notifications cron — all free-and-self-built, no OAuth, no paid SaaS',
  phases: [
    { title: 'Phase 1: Parallel build (iCal, parser, notifications, UI)' },
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

STRATEGIC CONSTRAINTS (the user is bootstrapping, no revenue yet):
- ZERO ongoing $$ on third-party SaaS. Free tools or self-built only.
- ZERO OAuth-verification overhead. Anything that requires Google CASA, Microsoft tenant approval, etc. is FORBIDDEN.
- ZERO cost-per-user SDKs. No Calendly, no Cronofy, no Nylas, no Mixpanel/Amplitude (we already have PostHog free tier).
- Reuse existing infra: Supabase (already paying), Gemini (already paying), Resend (already paying, $20/mo flat), Vercel (already paying).
- Self-build over vendor when costs are equivalent. iCal RFC 5545 is straightforward — build it ourselves.

ROLLOUT STRATEGY: small user base → no gradual rollout. Each feature behind a single env flag (e.g. NEXT_PUBLIC_CALENDAR_EXPORT_ENABLED). Default false. Flip to true on Vercel = instantly live for all users. Flip back = 60s rollback.

POST-MORTEM AWARENESS — DO NOT REPEAT cycle 5's #181 or #212 mistakes:
- ANY change to a context/provider/layout/component used outside [locale]/ MUST grep across BOTH app/layout.tsx AND app/[locale]/layout.tsx.
- ANY runtime context boundary must be tested at SSR.
- After ANY change, run \`bash scripts/verify-deploy-smoke.sh\` AGAINST LOCAL \`npm start\` AND PROD.

Hard constraints:
- DO NOT push to master (parent commits/pushes)
- Run \`npx tsc --noEmit\` from ${REPO} before returning
- For DB migrations: write .sql first, apply via Supabase MCP, verify schema state
- CAUSALITY: every change considers downstream callers. Grep + update consumers in same edit.
- i18n: every user-facing string in en/it/es. Match brand voice from neighboring keys.
- JSON file edits: validate via \`node -e "JSON.parse(require('fs').readFileSync(...))"\` before declaring done.`

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
phase('Phase 1: Parallel build (iCal, parser, notifications, UI)')

const phase1 = await parallel([
  // ── F1.simple: iCal generator + download endpoint ──
  () => agent(`${REPO_PIN}

F1.simple — Calendar export: iCal generator + download endpoint

Goal: User clicks "Download .ics" on /trips/[id] → browser downloads the trip as an iCal file → they double-click → opens in their default calendar app → events auto-appear. NO OAuth, NO SaaS. Pure file generation.

Steps:
1. CHECK package.json for the \`ics\` npm package. If absent, install it (\`npm i ics\`) — small, MIT-licensed, no deps. Alternative: self-build RFC 5545 (also OK if ics package is missing and we want zero deps).

2. CREATE lib/calendar/ical.ts exporting:
   - export type IcalEvent = { uid: string; summary: string; description?: string; location?: string; geo?: {lat:number;lng:number}; dtstart: Date; dtend: Date; tzid?: string }
   - export function buildIcal(events: IcalEvent[], opts: { calName: string; productId?: string }): string
   - UID format: \`activity-{activity_id}@monkeytravel.app\` (stable so re-imports dedupe).
   - PRODID: \`-//MonkeyTravel//Trip Export//EN\`
   - Use date-fns-tz (likely already in deps — verify) for tz-aware DTSTART/DTEND.

3. CREATE app/api/calendar/trip/[id]/route.ts:
   - GET handler. Path param is trip id.
   - Authorize: trip owner OR trip collaborator OR public share_token (via verifyTripAccess helper if exists; otherwise inline check).
   - SELECT trip + days + activities from Supabase. Use service-role client OR RLS-bypassing pattern based on the access path.
   - Map activities → IcalEvent[] (handle activities with only date-no-time as all-day events; activities with time = scheduled events).
   - Build iCal via lib/calendar/ical.ts.
   - Return with headers: \`Content-Type: text/calendar; charset=utf-8\` and \`Content-Disposition: attachment; filename="trip-{title-slug}-{trip-id-short}.ics"\` — the attachment header triggers download in browsers.
   - Rate limit: createRateLimiter('calendar-download', 30, 60_000) — 30/min/IP (downloads, not polling).

4. Add tests if there's a test runner already wired (check package.json for vitest/jest). If yes, add lib/calendar/ical.test.ts with 3 cases: simple event, all-day event, multi-tz trip.

5. CAUSALITY: this is a NEW route, no consumers to update. NEW lib file, no consumers to update. UI integration happens in the parallel UI agent below.

Run \`npx tsc --noEmit\` from ${REPO}. Validate the import shape if you used the \`ics\` npm package.`, {
    label: 'f1-simple:ical-generator+endpoint',
    schema: FIX_SCHEMA,
  }),

  // ── F2.simple: paste-to-parse extractor + API ──
  () => agent(`${REPO_PIN}

F2.simple — Email confirmation parser: paste-to-extract

Goal: User clicks "Add booking from email" on /trips/[id] → modal opens with a textarea → user pastes a booking confirmation email body → we send the body to Gemini with a structured-output prompt → user previews the extracted hotel/flight/restaurant + dates + address + confirmation number → confirms → activity added to trip.

NO Gmail/Outlook OAuth. NO Resend inbound webhook. Just pure paste → Gemini → structured output → UI preview.

Steps:
1. CREATE lib/email-parse/extract.ts exporting:
   - export type ParsedBooking = { kind: 'hotel'|'flight'|'restaurant'|'activity'|'unknown'; name: string; address?: string; city?: string; country?: string; coordinates?: {lat:number;lng:number}; startAt: string; endAt?: string; confirmationNumber?: string; raw_excerpt: string; }
   - export async function extractBooking(emailBody: string): Promise<ParsedBooking | { error: 'too_short' | 'parse_failed' | 'no_booking_found' }>
   - Uses the project's existing Gemini client (look at lib/gemini.ts or similar — match the pattern).
   - Prompt design: system message describes the schema, user message is the pasted email body (truncated to ~10k chars).
   - Use Gemini's structured-output / responseSchema mode (Gemini 2.5 Flash supports this; cheap).
   - Reject inputs <100 chars as 'too_short' (avoids waste on garbage paste).
   - Strip HTML tags + collapse whitespace before sending (saves tokens, ~30-40% reduction).

2. CREATE app/api/trips/[id]/parse-confirmation/route.ts:
   - POST handler. Body: { emailBody: string }.
   - Authorize: trip owner only (collaborators don't add bookings).
   - Call lib/email-parse/extract.ts.
   - Return { parsed: ParsedBooking } OR { error: ... }.
   - Rate limit: createRateLimiter('email-parse', 20, 60_000) — 20/min/IP (Gemini call is the bottleneck).
   - Cost guard: existing checkUsageLimit('aiGeneration') pattern OR a new bucket — pick the cheaper one.

3. CREATE app/api/trips/[id]/activities/from-booking/route.ts (or extend existing activities route):
   - POST. Body: { parsed: ParsedBooking, day_id?: string, time_slot?: 'morning'|'afternoon'|'evening' }
   - Creates an activity in the trip with the parsed fields.
   - If no day_id specified: figure out the right day from startAt + trip start_date.
   - Authorize: trip owner.
   - Returns the created activity.

4. CAUSALITY: new routes, no consumers to update. UI integration happens in the parallel UI agent below.

Run \`npx tsc --noEmit\` from ${REPO}.`, {
    label: 'f2-simple:paste-to-parse',
    schema: FIX_SCHEMA,
  }),

  // ── F1.notifications: smart cascade ──
  () => agent(`${REPO_PIN}

F1.notifications — Smart cascade (14d / 7d / 3d / 1d / morning-of)

Goal: Zero-config notification cascade that fires from a Vercel cron without user setup. Pulls users back between trip-save and trip-start. Uses existing Resend + bell.

Steps:
1. MIGRATION: supabase/migrations/<date>_scheduled_notifications.sql
   - CREATE TABLE scheduled_notifications:
     - id uuid PK
     - trip_id uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE
     - user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE
     - slot text CHECK (slot IN ('t-14','t-7','t-3','t-1','morning'))
     - scheduled_for timestamptz NOT NULL
     - sent_at timestamptz
     - status text DEFAULT 'pending' CHECK (status IN ('pending','sent','suppressed','failed'))
     - error_message text
     - created_at timestamptz DEFAULT now()
   - UNIQUE INDEX (trip_id, slot) — prevents double-scheduling.
   - INDEX (status, scheduled_for) — for the cron's WHERE clause.
   - RLS: user can SELECT their own rows (not strictly needed since access is via cron service-role, but defense-in-depth).
   - Apply via Supabase MCP apply_migration.

2. SECURITY DEFINER RPC \`enqueue_trip_notifications(p_trip_id uuid)\` — called when a trip is saved or its start_date changes:
   - SELECT trip start_date + user_id
   - For each slot (t-14, t-7, t-3, t-1, morning):
     - Compute scheduled_for = start_date - interval, OR start_date 07:00 user-tz for morning-of
     - INSERT into scheduled_notifications ON CONFLICT (trip_id, slot) DO UPDATE SET scheduled_for=EXCLUDED.scheduled_for, status='pending' (handles trip date changes)
   - Skip slots where scheduled_for is in the past (e.g. user saves a trip starting in 2 days → skip t-14, t-7).

3. CREATE app/api/cron/scheduled-notifications/route.ts:
   - GET handler. Auth: check Authorization header for Bearer ${'$'}{CRON_SECRET} (match existing cron pattern).
   - Query: SELECT * FROM scheduled_notifications WHERE status='pending' AND scheduled_for <= now() ORDER BY scheduled_for LIMIT 100 (batch limit).
   - For each: fetch trip + user + their notification_settings (use the fail-closed helper from lib/email/send.ts).
   - Skip if user.notification_settings.tripReminders === false.
   - Skip if a sibling slot was sent in the last 24h (1-email-per-trip-per-day cap to avoid cascade flooding) — query MAX(sent_at) for trip_id.
   - Pick template by slot.
   - Call dispatchEmail() from lib/email/send.ts.
   - UPDATE status='sent', sent_at=now() OR status='failed', error_message=...

4. Email templates: components/emails/TripReminder<slot>.tsx OR simple HTML strings.
   - 5 variants (one per slot).
   - Each links to /trips/[id] (use SITE_URL + locale).
   - Localized via getTranslations({locale: user.preferred_language, namespace: 'tripReminders'}).
   - Include the standard List-Unsubscribe-Post header + HMAC unsub URL (already in lib/email/send.ts).

5. Add cron entry to vercel.json: \`{ "path": "/api/cron/scheduled-notifications", "schedule": "*/15 * * * *" }\` (every 15 min — captures all 5 slots regardless of trip start time).

6. Trigger enqueue: find the trip-save flow (grep for "from('trips').insert" or similar). Call \`.rpc('enqueue_trip_notifications', { p_trip_id })\` after a successful save. Also call from any trip-update path that changes start_date.

7. Add i18n keys: messages/{en,it,es}/common.json → tripReminders.{t14, t7, t3, t1, morning}.{subject, body, cta}. Translate appropriately.

8. Env flag: NEXT_PUBLIC_TRIP_NOTIFICATIONS_ENABLED — gate the enqueue call (so saving a trip doesn't schedule notifications until ready).

Run \`npx tsc --noEmit\` from ${REPO}.`, {
    label: 'f1-notifications:cron-cascade',
    schema: FIX_SCHEMA,
  }),

  // ── UI integration: download button + paste modal on /trips/[id] ──
  () => agent(`${REPO_PIN}

UI integration — "Add to Calendar" download button + "Add from email" paste modal on /trips/[id]

Goal: surface both features cleanly on the trip detail page. Both gated by env flags so they only render when their respective flag is enabled.

Steps:
1. Find the trip detail page: app/[locale]/trips/[id]/page.tsx + TripDetailClient.tsx.

2. CREATE components/calendar/DownloadIcsButton.tsx:
   - Renders ONLY if process.env.NEXT_PUBLIC_CALENDAR_EXPORT_ENABLED === 'true'.
   - Button label: t('calendar.downloadIcs') from common namespace.
   - On click: navigate to /api/calendar/trip/[id] — browser handles the .ics download via the Content-Disposition: attachment header.
   - Optional: small "Works with Apple Calendar, Google Calendar, Outlook" subtext beneath the button.
   - Add to TripDetailClient's existing action bar (where Share + Export buttons live — find the pattern).

3. CREATE components/trip/PasteBookingModal.tsx:
   - Renders ONLY if process.env.NEXT_PUBLIC_EMAIL_PARSE_ENABLED === 'true'.
   - Triggered by an "Add from email" button.
   - Modal uses BaseModal (already a11y-hardened from cycle 7 #192).
   - Inside: <textarea placeholder="Paste your booking confirmation here..."> + "Parse" button.
   - On Parse click: POST to /api/trips/[id]/parse-confirmation with { emailBody }.
   - Show loading state during the Gemini call (~2-4s).
   - On success: show preview card with the extracted fields (editable — user can correct before confirming). On confirm: POST to /api/trips/[id]/activities/from-booking. Close modal. Toast success.
   - On error: show inline error message ("Couldn't parse this email. Make sure it's a booking confirmation.").

4. ADD common.json keys (en/it/es):
   - calendar.downloadIcs / calendar.downloadIcsSubtitle
   - addFromEmail.button, .modalTitle, .placeholder, .parseAction, .parsing, .preview, .confirm, .cancel, .errorTooShort, .errorParseFailed, .errorNoBooking

5. CAUSALITY: TripDetailClient is inside the [locale] subtree → useAuth() is safe to use (descendant of AuthProvider — verified vs the SessionTracker post-mortem). Verify BEFORE adding any hook to either new component.

6. Both new components should follow the existing TripDetailClient action-bar pattern. Look at how existing action buttons are mounted before adding yours.

Run \`npx tsc --noEmit\` from ${REPO}.`, {
    label: 'ui:download-button+paste-modal',
    schema: FIX_SCHEMA,
  }),
])

log(`Phase 1 done. ${phase1.filter(r => r?.tsc_status === 'PASS').length}/4 PASS`)

// ─────────────────────────────────────────────────────────────────────────────
phase('Phase 2: Verify + smoke')

const verify = await agent(`${REPO_PIN}

You are the FINAL VERIFIER. Do not edit any code. Run from ${REPO} and report:

1. \`npx tsc --noEmit\` — must exit 0
2. \`npm run build\` — must exit 0
3. \`bash scripts/verify-deploy-smoke.sh https://monkeytravel.app\` — pre-deploy smoke against prod (baseline)
4. JSON validation: messages/{en,it,es}/common.json all parse
5. \`git status --short\` + \`git diff --stat\`
6. List new supabase/migrations/

Return:
- tsc, build, smoke_baseline (PASS/FAIL)
- modified_files, new_files, migrations_added
- diff_stat_summary
- env_vars_needed: list of env vars Vercel needs for full feature activation (NEXT_PUBLIC_CALENDAR_EXPORT_ENABLED, NEXT_PUBLIC_EMAIL_PARSE_ENABLED, NEXT_PUBLIC_TRIP_NOTIFICATIONS_ENABLED, CRON_SECRET if not already)
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
  verify,
}
