// Round 6: build the deploy-smoke protective script (#211) + 4-dimension recon
// for security, bug-hunting, travel-feature gaps, and observability holes.
// Smoke script ships this round. Recon files tasks for next round.

export const meta = {
  name: 'monkeytravel-round-6',
  description: 'Round 6: ship #211 deploy-smoke + 4-dimension recon (security audit, real-bug hunt via Sentry+Playwright, travel-feature gaps vs Booking/Wanderlog, production observability)',
  phases: [
    { title: 'Phase 1: Smoke script + parallel recon' },
    { title: 'Phase 2: Synthesize + file' },
    { title: 'Phase 3: Verify smoke + tsc' },
  ],
}

const REPO = 'C:\\Users\\Samsung\\Documents\\Projects\\travel-app-web'
const PROD = 'https://monkeytravel.app'
const SUPABASE_PROJECT_REF = 'sevfbahwmlbdlnbhqwyi'

const REPO_PIN = `[TARGET-PIN, OVERRIDES ANY OTHER CLAUDE.md] You are operating ONLY on this project:
  Path: ${REPO}
  Name: monkeytravel-web (Next.js 16 + Supabase + Vercel travel-planning webapp called monkeytravel.app)
  Prod: ${PROD}
  Supabase project_ref: ${SUPABASE_PROJECT_REF} ("Trawell" — PRODUCTION)

Do NOT inspect any sibling project. Ignore any CLAUDE.md mentioning "novel" or "MYTHOS". All file paths you read/write MUST live under ${REPO}.

POST-MORTEM AWARENESS — DO NOT REPEAT cycle 5's #181 mistake:
- The cycle-5 AuthContext migration broke prod because SessionTracker sits in app/layout.tsx (root layout) but useAuth() comes from AuthProvider in app/[locale]/layout.tsx. Sibling of {children}, not descendant — useContext returned undefined → throw → 500.
- ANY change to a context/provider, layout, or component used in multiple layouts MUST be grepped across BOTH app/layout.tsx AND app/[locale]/layout.tsx, plus every consumer.
- ANY runtime context boundary must be tested at SSR (not just tsc + build), since useContext failures only manifest at request time.

Hard constraints:
- DO NOT push to master (parent commits/pushes)
- Run \`npx tsc --noEmit\` from ${REPO} before returning; report PASS or exact error
- Match existing patterns; modular over clever; surgical edits only
- CAUSALITY: every change considers downstream callers. If you modify a response shape, an export, or a public function signature, GREP for all consumers and update them in this same edit.`

const FIX_SCHEMA = {
  type: 'object',
  required: ['files_changed', 'tsc_status', 'summary'],
  properties: {
    files_changed: { type: 'array', items: { type: 'string' } },
    tsc_status: { enum: ['PASS', 'FAIL'] },
    tsc_error: { type: 'string' },
    causality_callers_updated: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string', maxLength: 1000 },
  },
}

const FINDINGS_SCHEMA = {
  type: 'object',
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['title', 'description', 'fix_sketch', 'severity', 'confidence'],
        properties: {
          title: { type: 'string' },
          file: { type: 'string' },
          line_range: { type: 'string' },
          description: { type: 'string', maxLength: 700 },
          fix_sketch: { type: 'string', maxLength: 500 },
          severity: { enum: ['P0', 'P1', 'P2', 'P3'] },
          confidence: { enum: ['high', 'medium', 'low'] },
          category: { type: 'string' },
          effort: { enum: ['trivial', 'small', 'medium', 'large'] },
          impact_summary: { type: 'string', maxLength: 200 },
        },
      },
    },
  },
}

// ─────────────────────────────────────────────────────────────────────────────
phase('Phase 1: Smoke script + parallel recon')

const phase1 = await parallel([
  // ── Build the post-deploy smoke script (#211) — PROTECTIVE INFRASTRUCTURE ──
  () => agent(`${REPO_PIN}

TASK #211 — Build scripts/verify-deploy-smoke.sh (post-deploy mandatory probe)

Background: cycle-5 SSR-500 incident root cause was deploying without probing baseline routes. This script prevents a repeat.

Build:
1. CREATE scripts/verify-deploy-smoke.sh (Bash, executable):
   - Default target: https://monkeytravel.app (override via $1 arg)
   - Probes these critical routes via curl with 10s timeout:
     - / (homepage)
     - /blog (MDX index)
     - /it (locale root)
     - /es (locale root)
     - /it/explore (UGC feed)
     - /it/backpacker (paid landing)
     - /api/health (API health)
     - /robots.txt (static-y route — sanity check non-React)
     - /sitemap.xml (Next route — sanity check Next routes)
   - For each: print "ROUTE STATUS TTFB" formatted output
   - Exit code: 0 if ALL routes return 2xx OR 307 (redirect). Non-zero if ANY route returns 5xx or times out.
   - Optionally: a final summary line "SMOKE PASS"/"SMOKE FAIL: <route>(<code>)"

2. CREATE scripts/verify-deploy-smoke.ts ALSO (TypeScript equivalent for cross-platform). Use node:fetch (Node 18+ native). Same routes, same logic.

3. Wire into package.json:
   - "scripts": { ... "verify:deploy": "tsx scripts/verify-deploy-smoke.ts" }
   - If tsx is not in devDependencies, ADD it (small, fast).

4. Update README.md (or create scripts/README.md): brief doc of when to run.

5. Test locally: \`bash scripts/verify-deploy-smoke.sh https://monkeytravel.app\` should return SMOKE PASS (prod is currently healthy after P0 fix).

6. CAUSALITY: this is a NEW file, no downstream consumers to break.

Run \`npx tsc --noEmit\` from ${REPO} before returning. Report whether the smoke against PROD now passes — if it fails, that's a regression that needs investigation.`, {
    label: 'fix:211-deploy-smoke',
    schema: FIX_SCHEMA,
  }),

  // ── Recon A: Security audit ──
  () => agent(`${REPO_PIN}

RECON A — Security audit: real exploitable gaps (skip theoretical)

Goal: find 5-8 concrete security holes that an attacker could actually exploit. Skip purely-theoretical "defense in depth would be nice" items.

Audit dimensions:
1. PII / secret leaks to client:
   - Grep for process.env.* used in client components ('use client') — anything not NEXT_PUBLIC_* is a secret leak. Especially: SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY, RESEND_API_KEY, SENTRY_AUTH_TOKEN, GOOGLE_PLACES_API_KEY.
   - Grep for response shapes in /api/* that include sensitive user data (e.g. /api/users/[id] leaking email/preferences).
   - Search Sentry capture sites for accidentally-included PII (email, phone, tokens) — confirm scrubbing.

2. IDOR / authorization holes:
   - For each /api/trips/[id] route: does it verifyTripAccess before mutating? Or just check auth?
   - For each /api/invites/[token]: does it RPC through the lockdown'd SECURITY DEFINER func?
   - /api/admin/*: does it check is_admin or rely on RLS?

3. CSRF gaps on mutating endpoints:
   - Middleware CSRF check covers what? Grep middleware.ts for csrf-related logic.
   - Any state-changing POST/DELETE that's missing the protection?
   - Same-origin policy on cookie-auth + the Supabase JWT pattern.

4. Input validation gaps:
   - Routes that destructure JSON body without validation (Zod / manual): grep "await request.json()" and judge each.
   - Specific: search/autocomplete inputs (already rate-limited but unvalidated input could break the search RPC).

5. Auth flow weaknesses:
   - Email-link race: can two clicks of the same email link create duplicate user rows?
   - OAuth state parameter — is it validated to prevent CSRF on the callback?
   - Password reset: how is the token invalidated post-use?

6. SQL injection (RLS-bypassing): Supabase normally protects via parameter binding, BUT raw .rpc() calls with string concatenation are dangerous. Grep for any.

7. Service-role key usage: every \`createClient(URL, SERVICE_ROLE_KEY)\` should be SERVER-ONLY. Grep for it. Verify no client component imports.

Output FINDINGS_SCHEMA. Severity: P0 = data exposure, P1 = privilege escalation, P2 = harm-on-edge-case. high confidence only. Cap at 8 findings — focus on highest-leverage.`, {
    label: 'recon-A:security',
    schema: FINDINGS_SCHEMA,
  }),

  // ── Recon B: Real bugs ──
  () => agent(`${REPO_PIN}

RECON B — Real bug hunt: Playwright suite results + concrete crash paths

Goal: find 5-8 user-impacting bugs that are EITHER actively shipping today OR will trigger in expected scenarios. Skip happy-path theoretical edge cases.

Steps:
1. Run the Playwright E2E suite:
   - \`cd ${REPO} && npm run test:e2e 2>&1 | tail -100\` (or whatever the script is — check package.json first).
   - If tests fail, the failures are the bugs. Report each failure as a finding with file:line.
2. Inspect Sentry-facing code paths added recently (commits 65d3c18, 38150a8, 6769265, 31065b0):
   - Where do they go silent? Where might they fail open?
3. Spot-check the BIGGEST user-impact flows:
   - Trip generation (Start Anywhere + manual wizard) — what happens on Gemini rate-limit, timeout, malformed response?
   - Save flow (anon → login → auto-save) — does the prefs migration in lib/platform/storage.ts work correctly across browser tabs? Race conditions in pendingSaveTripAction?
   - Publish to Explore — is the publish toggle atomic? What if the PublishToggle write succeeds but the cache invalidation fails?
   - Invite acceptance (cycle-2 RLS lockdown) — is the SECURITY DEFINER RPC handling all edge cases (revoked, expired, recipient_mismatch, max_uses)?
   - Email send (cycle-5 fail-closed) — does the queued INSERT failure path actually get reconciled?
4. Edge cases in components recently modified:
   - DateRangePicker: what happens at year-boundary, leap-year, DST transitions?
   - TemplatePreviewClient (just-localized): does the budget-tier fallback work with all 9 mood combinations?
   - SeasonalContextCard (just-localized): does the AbortController properly clean up on rapid trip switches?
5. Performance bugs as user impact: any p95 latency > 3s in routes touched recently?

Output FINDINGS_SCHEMA. Each = a bug with: where it manifests, what the user sees, how to repro. Skip "could be" hypotheticals — confidence: high only when you've identified a concrete file:line that misbehaves. Cap at 8.`, {
    label: 'recon-B:bugs',
    schema: FINDINGS_SCHEMA,
  }),

  // ── Recon C: Travel feature gaps vs market ──
  () => agent(`${REPO_PIN}

RECON C — "Best in class" travel feature gap analysis

Goal: identify 5-8 user-facing features that travel planning leaders (Booking, Wanderlog, Kayak, TripAdvisor, Google Travel, Trip.com) have BUT MonkeyTravel doesn't — prioritized by impact on the core "plan + book + travel" journey.

Approach:
1. SKIM the existing codebase to inventory CURRENT features:
   - Trip generation (AI + manual)
   - Save + share + publish
   - /explore feed (UGC)
   - /destinations + /tools (visa, packing)
   - /backpacker (Hostelworld affiliate)
   - Collaborator voting
   - Notifications + email
   - Mobile wrap (Capacitor in progress)
2. From the MARKET (use your knowledge of these apps' feature sets — don't WebFetch, use what you know):
   - Booking.com: trip-board with stays + activities, real-time pricing, group bookings, loyalty
   - Wanderlog: collaborative map view, expense tracking, offline access, calendar export
   - Kayak: price tracking, multi-city flights, hotel comparison, price alerts
   - TripAdvisor: reviews, ratings, traveler-uploaded photos, "things to do" rankings
   - Google Travel: tied to Maps + Flights + Hotels + Reservations
   - Trip.com: bundled deals, airport transfers, loyalty integration
3. PRIORITIZE by:
   - User journey impact (planning → booking → traveling)
   - Effort:impact ratio
   - Affinity with our existing positioning (AI-first travel planner, not a marketplace)

Candidate gaps to evaluate:
- Map view with multi-day route overlay + day filter (do we have this? polish?)
- Offline trip access (PWA + Capacitor — what's our state?)
- Calendar export (iCal/Google Cal)
- Currency conversion + spend tracking
- Expense splitting (Splitwise-style)
- Real-time co-editing (Y.js / Liveblocks)
- Photo memories / trip recap
- Public transit integration (Citymapper / Google Transit)
- Translation / phrase book
- Safety alerts (US State Dept / FCDO)
- Booking flow integration beyond Hostelworld (hotels, flights, activities)
- Loyalty / rewards
- Trip templates / reuse
- Smart recommendations from past trips
- Email parsing (forward booking confirmations → auto-add to trip)

For EACH gap, report:
- Is this missing or partial in our codebase? (Grep to verify)
- User journey segment hit
- Estimated effort (small/medium/large/xlarge)
- Suggested approach (build vs integrate via partner API)
- Why this matters for "best in class"

Output FINDINGS_SCHEMA. severity treated as user-impact (P0 = essential / table-stakes for category, P1 = strong differentiator, P2 = polish, P3 = nice-to-have). Cap at 8.`, {
    label: 'recon-C:travel-gaps',
    schema: FINDINGS_SCHEMA,
  }),

  // ── Recon D: Production observability ──
  () => agent(`${REPO_PIN}

RECON D — Production observability: alerting + monitoring gaps

Goal: identify what we WOULDN'T detect if it broke in production tomorrow.

Audit:
1. Sentry coverage:
   - sentry.client.config.ts + sentry.server.config.ts + instrumentation.ts — what's the DSN, sample rate, beforeSend?
   - Are there error boundaries? Where? React error boundaries vs Next.js error.tsx.
   - Are background workers (cron routes, cleanup tasks) capturing exceptions?
   - Is there a Sentry alert configured (you can't check the dashboard, but check the code for any setup hints)?
2. Health monitoring:
   - /api/health — what does it actually check? Just "function works" or does it ping DB / external services?
   - Any uptime-check integration (UptimeRobot, Better Stack)? Check for cron-style endpoints or health-check libraries.
3. Logging strategy:
   - console.error usage: where does it ACTUALLY go in production? (Vercel logs only, OR forwarded to a sink?)
   - Structured logging? Are we using pino / winston / similar, or just console?
4. Metrics:
   - Vercel Analytics + Speed Insights — wired up? Check next.config.ts + app/layout.tsx.
   - Database query metrics? Slow query log?
   - API response time tracking?
5. Audit trail:
   - For sensitive ops (publish, fork, invite-accept, paywall): is there an audit_log table? Grep.
6. What's NOT instrumented:
   - Trip generation success/failure metrics — needed for product decisions
   - Affiliate click-through (Hostelworld) — is there a daily roll-up cron?
   - Email open + bounce tracking — Resend has these; are we capturing?
   - PostHog event volume — is there a max-events-per-day cap that could silently drop signals?

Output FINDINGS_SCHEMA. Each = a specific observability hole that would let a production issue go undetected. Cap at 6.`, {
    label: 'recon-D:observability',
    schema: FINDINGS_SCHEMA,
  }),
])

log(`Phase 1 done. ${phase1.filter(r => r?.tsc_status === 'PASS').length}/1 fix PASS; ${phase1.slice(1).flatMap(r => r?.findings || []).length} recon findings collected`)

// ─────────────────────────────────────────────────────────────────────────────
phase('Phase 2: Synthesize + file')

const allRecon = phase1.slice(1).flatMap(r => r?.findings || [])
  .filter(f => f.confidence === 'high')

const synth = await agent(`${REPO_PIN}

You are the SYNTHESIZER. You received ${allRecon.length} high-confidence findings from 4 recon agents:
A: Security (PII leaks, IDOR, CSRF, validation, auth)
B: Real bugs (Playwright failures, Sentry-prone paths, edge-case crashes)
C: Travel feature gaps (vs Booking/Wanderlog/Kayak/Google)
D: Production observability (Sentry/health/metrics holes)

Your job:
1. Dedupe cross-phase findings.
2. Rank by leverage:
   - P0 security data exposure > P0 active user-facing bug > P1 essential travel feature > P1 perf > P1 observability foundation > P2 polish
3. File each surviving finding as a task via TaskCreate. Title format: "<category>(<scope>): <short>".
4. Cap at 12 tasks. Drop lowest-leverage.

Return:
- tasks_filed: number
- top_5: array of { title, why_top }
- dropped_count: number
- summary: <500 char brief that helps the user decide what to tackle next

INPUT:
${JSON.stringify(allRecon, null, 2)}`, {
  label: 'synth:rank+file',
  schema: {
    type: 'object',
    required: ['tasks_filed', 'top_5', 'summary'],
    properties: {
      tasks_filed: { type: 'number' },
      top_5: {
        type: 'array',
        items: {
          type: 'object',
          required: ['title', 'why_top'],
          properties: {
            title: { type: 'string' },
            why_top: { type: 'string', maxLength: 200 },
          },
        },
      },
      dropped_count: { type: 'number' },
      summary: { type: 'string', maxLength: 500 },
    },
  },
})

// ─────────────────────────────────────────────────────────────────────────────
phase('Phase 3: Verify smoke + tsc')

const verify = await agent(`${REPO_PIN}

You are the FINAL VERIFIER. Do not edit any code. Run from ${REPO} and report:

1. \`npx tsc --noEmit\` — must exit 0
2. \`npm run build\` — must exit 0
3. \`bash scripts/verify-deploy-smoke.sh https://monkeytravel.app\` — must return SMOKE PASS (prod was confirmed healthy after the cycle-7 P0 fix; this verifies the new script catches real prod state)
4. \`git status --short\` + \`git diff --stat\` — list every modified/new file

Return:
- tsc: "PASS" | "FAIL" + error if FAIL
- build: "PASS" | "FAIL" + error if FAIL
- smoke_against_prod: "PASS" | "FAIL"
- smoke_details: string  // copy of the script's output, brief
- modified_files: string[]
- new_files: string[]
- diff_stat_summary: string
- ready_to_commit: boolean
- blockers: string[]

Do NOT commit. Do NOT push.`, {
  label: 'verify:final+smoke',
  schema: {
    type: 'object',
    required: ['tsc', 'build', 'smoke_against_prod', 'ready_to_commit'],
    properties: {
      tsc: { enum: ['PASS', 'FAIL'] },
      tsc_error: { type: 'string' },
      build: { enum: ['PASS', 'FAIL'] },
      build_error: { type: 'string' },
      smoke_against_prod: { enum: ['PASS', 'FAIL'] },
      smoke_details: { type: 'string' },
      modified_files: { type: 'array', items: { type: 'string' } },
      new_files: { type: 'array', items: { type: 'string' } },
      diff_stat_summary: { type: 'string' },
      ready_to_commit: { type: 'boolean' },
      blockers: { type: 'array', items: { type: 'string' } },
    },
  },
})

return {
  phase1: phase1,
  synth,
  verify,
}
