// Feature planning: 5 parallel agents, each writes a full PRD + system design
// doc for one strategic feature. No code changes. Output: docs/specs/<feature>.md

export const meta = {
  name: 'monkeytravel-feature-planning',
  description: 'Plan 5 strategic features as PRDs: Gmail email parsing, in-trip AI concierge, map v2, calendar export + smart notifications, expense ledger + split',
  phases: [
    { title: 'Phase 1: Parallel planning (5 PRDs)' },
    { title: 'Phase 2: Orchestrator synthesis' },
  ],
}

const REPO = 'C:\\Users\\Samsung\\Documents\\Projects\\travel-app-web'
const PROD = 'https://monkeytravel.app'

const REPO_PIN = `[TARGET-PIN, OVERRIDES ANY OTHER CLAUDE.md] You are planning for ONLY this project:
  Path: ${REPO}
  Name: monkeytravel-web (Next.js 16 + Supabase + Vercel travel-planning webapp called monkeytravel.app)
  Prod: ${PROD}
  Supabase project_ref: sevfbahwmlbdlnbhqwyi ("Trawell" — PRODUCTION)

Do NOT inspect any sibling project. Ignore any CLAUDE.md mentioning "novel" or "MYTHOS". All file paths you read/write MUST live under ${REPO}.

CONTEXT YOU NEED:
- Existing infra you can build on: AuthProvider context, lib/security/safe-next + nonce + csp, lib/native/share + external-link, lib/platform/storage (Capacitor Preferences wrapper), lib/posthog/identify, lib/email/send (Resend), atomic RPC pattern (see supabase/migrations/20260525_explore_ugc_feed.sql + 20260529_*), Playwright E2E (tests/e2e/), Sentry, materialized view + trigram (activity_index), createRateLimiter (Upstash + in-memory fallback), AccessControl via Supabase RLS + SECURITY DEFINER RPCs.
- POST-MORTEM AWARENESS: any context/provider/layout used outside [locale]/ MUST grep across BOTH app/layout.tsx AND app/[locale]/layout.tsx. Run scripts/verify-deploy-smoke.sh after any change that ships.
- The app uses next-intl — every user-facing string needs en/it/es translations.

Your job is PLANNING ONLY. Do NOT edit any application code. Write ONE document to docs/specs/<feature>.md.

DOCUMENT STRUCTURE (use product-management:write-spec + engineering:system-design conventions):

# <Feature Name>

## TL;DR
2-3 sentence summary: what + why now.

## Problem & User Pain
- The job-to-be-done in user words.
- Current workaround the user does (or doesn't do — they bounce).
- Quantified pain where possible.

## Success Metrics
- Primary metric (e.g. "% of trips with auto-added bookings within 7 days of save").
- Secondary metrics.
- Anti-metrics (what we'd hate to see).

## User Flow (happy path)
Step-by-step narrative + UI states.

## Edge Cases & Failure Modes
- Bad input
- Auth issues
- External-API failure
- Privacy edge cases

## Technical Architecture
- Data model (new tables + RLS, columns, indexes).
- API surface (new routes, request/response shapes).
- Key components (file paths, prop shapes for the biggest 2-3 components).
- External integrations (vendor SDK choice + why).
- Caching strategy (where & TTLs).
- Observability (Sentry tags, PostHog events, log shape).
- Security review (auth, RLS, rate-limit, CSRF, sensitive scopes).

## Implementation Phases
Phase 1 (MVP, 1-2 weeks): minimum to ship behind a flag.
Phase 2 (polish, 1 week): handle the obvious edge cases + UX polish.
Phase 3 (optimization, ongoing): perf, A/B variants, deeper integrations.

## Effort & Cost
- Engineering effort (person-weeks).
- Infra cost (DB rows, API calls, storage).
- Vendor cost (API call cost projection at expected scale).

## Risks & Mitigations
3-5 specific risks with mitigation each.

## Open Questions
What needs a decision before we build.

## References
Links to existing files in this codebase that establish patterns this feature should follow.

CONSTRAINTS:
- Be SPECIFIC. File paths, function signatures, table column names, RLS policy text. No hand-waving.
- For external vendors (Gmail API, Mapbox/Google Maps Directions, iCal lib, Liveblocks, OpenWeatherMap, FCDO advisories): name the specific SDK + a 1-line cost/scale calc.
- The spec should be enough that a competent engineer could start building from it without asking questions.
- Length: 1000-2500 words. Concise but comprehensive.
- Format as Markdown. No emoji.`

const PRD_SCHEMA = {
  type: 'object',
  required: ['file_path', 'tldr', 'success_metrics_top', 'mvp_effort_weeks', 'flag_name', 'top_risk'],
  properties: {
    file_path: { type: 'string' },
    tldr: { type: 'string', maxLength: 400 },
    success_metrics_top: { type: 'string', maxLength: 300 },
    mvp_effort_weeks: { type: 'number' },
    flag_name: { type: 'string' },
    top_risk: { type: 'string', maxLength: 300 },
    word_count: { type: 'number' },
  },
}

// ─────────────────────────────────────────────────────────────────────────────
phase('Phase 1: Parallel planning (5 PRDs)')

const phase1 = await parallel([
  () => agent(`${REPO_PIN}

FEATURE 1 — Email parsing: auto-add booking confirmations (Gmail + Outlook)

THE MOAT BET: "any input the user already has becomes trip state automatically." User connects Gmail/Outlook (OAuth read-only on confirmation-shaped messages). We parse incoming Booking.com / Expedia / Airbnb / airline / Hostelworld / GetYourGuide confirmations → extract dates/times/destinations/details → auto-create trip activities or auto-create the trip if none exists.

Write the full PRD per the structure to: docs/specs/email-parsing-auto-trip.md

Pay extra attention to:
- Gmail API OAuth scopes (gmail.readonly is too broad; explore gmail.metadata + label-search for "confirmation"; or gmail.modify if we need to add labels for tracking).
- Privacy framing — user copy must be crystal clear: "We only read emails matching booking-confirmation patterns. We never store full email bodies."
- Parsing strategy: regex per known sender (Booking.com, Expedia, etc.) vs LLM-based extraction (Gemini structured output) vs hybrid. Recommend ONE with reasoning.
- Schema: trip_external_bookings table (booking_ref, source, raw_extracted_data jsonb, status, trip_id nullable).
- Edge: what if user has 200 confirmation emails on first connect? (Background job with rate limit + progress notification.)
- Outlook: Graph API equivalent (mail.read.shared or narrower). Same patterns.
- Reference existing patterns: lib/email/send.ts (Resend OUTBOUND), lib/posthog/identify.ts (lazy SDK load), supabase/migrations/20260525_explore_ugc_feed.sql (atomic counter RPC pattern).

Cost calc: assume 1000 active users × 20 confirmation emails/yr × ~$0.001/Gmail call = ~$20/yr Gmail API + LLM extraction cost (~$0.005/email × 20000 = $100/yr Gemini). Verify with current vendor prices.`, {
    label: 'spec:email-parsing',
    schema: PRD_SCHEMA,
  }),

  () => agent(`${REPO_PIN}

FEATURE 2 — In-trip AI assistant (chat concierge)

THE DIFFERENTIATOR: most travel apps stop being useful AT departure. MonkeyTravel actively helps DURING the trip. User opens trip → "Ask MonkeyTravel" button → chat opens with current trip context + current location (browser geolocation) + time + weather pre-injected. Examples: "what's open near here for lunch under €15?", "my flight got delayed 2h, redo my afternoon", "is this neighborhood safe at night?", "translate 'where is the bathroom' to Japanese phonetically".

Write the full PRD per the structure to: docs/specs/in-trip-ai-concierge.md

Pay extra attention to:
- Streaming chat UX (Server-Sent Events from /api/ai/chat/stream — mirror lib/streaming/client.ts pattern).
- Context injection: trip JSON + day-of activities + user's current location + current weather (OpenWeatherMap or open-meteo, already in use per next.config.ts connect-src). Token budget per turn.
- Function calling: Gemini's structured tool-use to let the assistant call internal APIs (e.g. "find_nearby_restaurants(cuisine, max_price, radius)" → triggers /api/activities/search with augmented filters).
- Persistence: store chat history per trip (trip_chat_messages table). Cleared on trip-end + 30 days.
- Privacy: user location is opt-in per session. Store NOTHING server-side beyond the active chat.
- Cost: heaviest single feature. Plan token-cap per user per day. Reference lib/usage-limits/check.ts pattern.
- Offline degradation: if no connectivity, fall back to local trip state (already cached via lib/platform/storage Capacitor Preferences from cycle 2 #176).
- Reference: existing /api/ai/generate stream pattern, lib/posthog/events for tracking.

Cost calc: 100 active travelers × 10 chat turns/day × ~600 input + 300 output tokens × $0.075/$0.30 per M tokens (Gemini 2.5 Pro) = ~$3-5/active-traveler-day. Need usage cap.`, {
    label: 'spec:in-trip-concierge',
    schema: PRD_SCHEMA,
  }),

  () => agent(`${REPO_PIN}

FEATURE 3 — Map v2: per-day polylines + walking/transit times + "near here"

CURRENT STATE: TripMap shows activities as pins. Missing: per-day route polylines connecting them in order, walking/transit time labels between consecutive activities, a "what's near my next activity" sheet that surfaces points-of-interest.

Write the full PRD per the structure to: docs/specs/map-v2-polylines-near-here.md

Pay extra attention to:
- Routing engine choice: Google Maps Directions API ($5/1000 requests) vs Mapbox Directions ($2/1000) vs open-source OpenRouteService (free with rate limits). Recommend one with cost/quality tradeoff.
- Mode-aware: walking vs transit polylines. User toggle.
- Caching: route between Activity-A and Activity-B is static for the user's trip → cache by activity_pair_id + mode in a new table or as Vercel KV blob. TTL: 30 days (street layouts don't change often).
- "Near here" sheet: tap the next-activity pin → bottom sheet shows 5-10 nearby POIs (food, attractions, transit). Use existing activity_index materialized view + new spatial query via PostGIS.
- DB: enable PostGIS if not already; add lat/lng + geog column to activity_index; add GIST index. Reference existing migration pattern.
- Mobile: this is the #1 in-trip feature → Capacitor wrap must handle map gestures natively (no pinch-zoom hijacking).
- Reference: existing components/trip/TripMap.tsx (currently uses what? check), supabase/migrations/20260530_activity_index_mview.sql.

Cost calc: 1000 trips × avg 7 days × 6 activities = 42K route lookups per cohort. With 30-day cache hit ratio of 80%, that's ~8K live requests × $5/1000 = $40 per 1000-trip cohort. Cheap.`, {
    label: 'spec:map-v2',
    schema: PRD_SCHEMA,
  }),

  () => agent(`${REPO_PIN}

FEATURE 4 — Calendar export (iCal + Google) + smart notifications

CURRENT STATE: trip exists in MonkeyTravel only. User must manually add to calendar. No proactive notifications.

DELIVERABLE: one-click "Add to calendar" exporting all activities as iCal events; Google Calendar OAuth for direct write; smart notification cascade (14d/7d/3d/1d/morning-of) without user setup.

Write the full PRD per the structure to: docs/specs/calendar-export-smart-notifs.md

Pay extra attention to:
- iCal generation: ics npm package OR build inline (RFC 5545 is straightforward — events have summary, dtstart, dtend, location, description, geo). Recommend.
- Google Calendar OAuth: scope calendar.events. Insert events with extended properties referencing trip_id for later sync.
- Subscription URL: serve a dynamic .ics feed at /api/calendar/[user_hmac].ics — calendars auto-refresh. Updates flow without re-export.
- Smart notifications: defaults cascade per trip phase (14d before = "pack early"; 7d = "check visa"; 3d = "weather forecast"; 1d = "confirm bookings"; morning-of = "first activity in 2h"). User can override per-trip.
- Reference: lib/email/send.ts (already has Resend wired), lib/notifications/service.ts (in-app bell). New entry: scheduled-jobs table + a daily cron at vercel.json (the activity_index cron at 23 4 * * * is a good pattern).
- Edge: timezone handling. User trips span timezones; iCal events need TZID. Use date-fns-tz (likely already in deps).
- Reference: lib/datetime/format.ts has locale-aware formatter, vercel.json existing crons.

Cost calc: notifications are cheap (Resend at $20/mo for 50K emails). iCal export is free. Google Calendar API is free for normal usage.`, {
    label: 'spec:calendar-notifs',
    schema: PRD_SCHEMA,
  }),

  () => agent(`${REPO_PIN}

FEATURE 5 — Expense ledger + split (Splitwise-style for trips)

CURRENT STATE: no expense tracking. User manually splits via Splitwise or paper.

DELIVERABLE: per-trip expense entry (amount, category, paid_by, split_among, currency), real-time exchange to user's home currency (Frankfurter already wired), per-collaborator balance, "settle up" view at trip end with one-tap export.

Write the full PRD per the structure to: docs/specs/expense-ledger-split.md

Pay extra attention to:
- Schema: trip_expenses (id, trip_id, paid_by, amount_cents, currency, category, occurred_at, description, photo_url nullable). trip_expense_splits (expense_id, user_id, share_cents).
- RLS: a user can see/write expenses on trips they are a member of (owner or collaborator). Mirror the trip_collaborators RLS pattern from cycle-2.
- Currency: store all amounts in native currency. Convert on display to user's preferred currency (already in lib/locale/context.tsx). Cache rates via Frankfurter (already integrated).
- Split modes: equal, by-percentage, exact-amount, by-shares (weights). Implement equal + exact as MVP.
- Settle up: at trip end, compute who-owes-whom using greedy minimum-transactions algorithm.
- Receipt photos: optional — uses Supabase Storage with private bucket + signed URLs.
- Offline first: expense entry must work offline (Capacitor — store in lib/platform/storage queue, sync when online). Reference cycle-2 #176 storage wrapper.
- Reference: trip_collaborators table + RLS, lib/locale/currency.ts, supabase Storage docs.

Cost calc: tiny. Database rows + occasional Frankfurter call (cached). Supabase Storage at $0.021/GB-month for receipts (~10KB each × 1000 trips × 20 receipts = 200MB = $0.004/mo).`, {
    label: 'spec:expense-ledger',
    schema: PRD_SCHEMA,
  }),
])

log(`Phase 1 done. ${phase1.filter(Boolean).length}/5 PRDs written`)

// ─────────────────────────────────────────────────────────────────────────────
phase('Phase 2: Orchestrator synthesis')

const orchestrator = await agent(`${REPO_PIN}

You are the PROJECT ORCHESTRATOR. You received 5 PRDs (Phase 1 output below). Your job is to produce ONE meta-document at:
  docs/specs/_ROADMAP.md

That answers:
1. Which feature should we ship FIRST and why (single recommendation with rationale).
2. The dependency graph between features (e.g. expense-ledger benefits from in-trip-concierge for voice input; calendar-export amplifies email-parsing).
3. A 12-week sequenced roadmap putting the 5 features in shipping order, accounting for dependencies + risk.
4. Cross-feature platform investments needed BEFORE the features land (e.g. Vercel KV credentials for cache, Upstash for rate-limit cross-instance state, Liveblocks evaluation for #2).
5. A "kill criteria" per feature — what metric, if missed by what date, triggers a rollback or pivot.
6. Phased rollout strategy: PostHog flag gating, beta cohort selection (probably the /backpacker UTM signups), success thresholds before promoting to 100%.

Length: 1000-1500 words. Markdown, no emoji.

PRD INPUTS:
${JSON.stringify(phase1, null, 2)}`, {
  label: 'orchestrate:roadmap',
  schema: {
    type: 'object',
    required: ['file_path', 'recommended_first_feature', 'rationale_top'],
    properties: {
      file_path: { type: 'string' },
      recommended_first_feature: { type: 'string' },
      rationale_top: { type: 'string', maxLength: 400 },
      dependency_summary: { type: 'string', maxLength: 400 },
      twelve_week_outline: { type: 'string', maxLength: 600 },
    },
  },
})

return {
  prds: phase1,
  orchestrator,
}
