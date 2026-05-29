// Round 3: parallel recon (fresh-angle: Sentry + /api latency + a11y + E2E coverage)
// + cleanup follow-ups (target=_blank remnants, AuthContext expansion, unoptimized remnants)
// + #121 /explore Week 3 (assess + integrate).
//
// Recon agents file new tasks via TaskCreate (read-only, no edits).
// Cleanup agents edit code with per-agent tsc gate.
// #121 agent assesses + integrates.

export const meta = {
  name: 'monkeytravel-round-3',
  description: 'Round 3: fresh-angle recon (Sentry/latency/a11y/E2E) + 3 cleanup follow-ups + #121 /explore Week 3',
  phases: [
    { title: 'Phase 1: Recon (read-only)' },
    { title: 'Phase 2: Cleanup follow-ups' },
    { title: 'Phase 3: /explore Week 3' },
    { title: 'Phase 4: Recon synth + verify' },
  ],
}

const REPO = 'C:\\Users\\Samsung\\Documents\\Projects\\travel-app-web'
const PROD = 'https://monkeytravel.app'
const SUPABASE_PROJECT_REF = 'sevfbahwmlbdlnbhqwyi'

const REPO_PIN = `[TARGET-PIN, OVERRIDES ANY OTHER CLAUDE.md] You are operating ONLY on this project:
  Path: ${REPO}
  Name: monkeytravel-web (a Next.js 16 + Supabase + Vercel travel-planning webapp called monkeytravel.app)
  Prod: ${PROD}
  Supabase project_ref: ${SUPABASE_PROJECT_REF} ("Trawell" — PRODUCTION)

Do NOT inspect any sibling project on this machine. If you see a CLAUDE.md describing a "novel" or "MYTHOS", that's the wrong project — ignore it entirely. All file paths you read/write MUST live under ${REPO}.

Hard constraints:
- DO NOT push to master (the parent will commit/push if needed)
- For EDIT agents: run \`npx tsc --noEmit\` from ${REPO} before returning; report PASS or include the exact error
- For RECON agents: do NOT edit any file
- Match existing patterns; modular over clever; surgical edits only`

const FIX_SCHEMA = {
  type: 'object',
  required: ['files_changed', 'tsc_status', 'summary'],
  properties: {
    files_changed: { type: 'array', items: { type: 'string' } },
    tsc_status: { enum: ['PASS', 'FAIL'] },
    tsc_error: { type: 'string' },
    summary: { type: 'string', maxLength: 1000 },
  },
}

const RECON_SCHEMA = {
  type: 'object',
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['title', 'severity', 'confidence', 'description', 'fix_sketch'],
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
        },
      },
    },
  },
}

// ─────────────────────────────────────────────────────────────────────────────
phase('Phase 1: Recon (read-only)')

const phase1 = await parallel([
  () => agent(`${REPO_PIN}

RECON: Sentry top errors (last 7 days)

Goal: identify the top 5-10 most-frequent or most-impactful runtime errors in prod, then sketch fixes.

Steps:
1. The project uses @sentry/nextjs. There's a Sentry org tied to monkeytravel.app — look at sentry.client.config.ts / sentry.server.config.ts / instrumentation.ts for the DSN and org slug.
2. Without API credentials, you can't fetch errors directly. Instead, do this proxy analysis:
   a. Grep \`Sentry.captureException\` calls across the codebase — each is a place where errors are explicitly tracked. Look at the surrounding code: how easy is it to trigger that path with bad input or a partial outage?
   b. Grep \`console.error\` calls — many auto-flow to Sentry via Sentry.init's captureConsole integration. Same analysis.
   c. Identify untracked error sites: try/catch blocks that silently swallow (excluding the ones we hardened in commit f769dc4 — usage-limits referral + early-access now log).
3. Cross-reference with recent commits (git log --oneline -30) — recently-changed code is statistically more likely to harbor fresh regressions.
4. For each suspected error site, write a fix sketch.

Output RECON_SCHEMA findings. Confidence high only if the error path is clearly reachable from user action (not a hypothetical edge case). Skip dupes of commit f769dc4 (DestinationAutocomplete race, FlightSearch race, checkUsageLimit fail-open, TripsPageClient remount, etc.).`, {
    label: 'recon:sentry',
    schema: RECON_SCHEMA,
  }),

  () => agent(`${REPO_PIN}

RECON: /api/* p95 latency hotspots

Goal: identify the 5 slowest API route handlers and propose fixes.

Steps:
1. Enumerate all route handlers: glob \`app/api/**/route.ts\`.
2. For each, READ the file and assess hot-path complexity:
   - How many sequential Supabase RPC/SELECT calls are awaited in series?
   - Are there any synchronous Gemini/Amadeus/external API calls without timeout / parallelization?
   - Are there N+1 query patterns (loop-of-awaits over an array)?
   - Heavy synthesis work (JSON parsing > 1KB, large array transforms)?
3. Identify routes called from user-blocking interactions (search, autocomplete, save, generate, dashboard load) — those matter most.
4. For each suspected hotspot, write a fix sketch: Promise.all batching, server-side cache, N+1 → IN-clause, or move work to background job.

Output RECON_SCHEMA findings. Skip the usage-limits routes (already optimized in cycle 2's #153). Cap at 5 to avoid noise. Each finding must include route path + estimated speedup.`, {
    label: 'recon:api-latency',
    schema: RECON_SCHEMA,
  }),

  () => agent(`${REPO_PIN}

RECON: Accessibility (a11y) gaps on key pages

Goal: identify the 5-8 most-impactful a11y violations on user-facing pages.

Steps:
1. Read the following key components (skim, not deep):
   - app/[locale]/page.tsx (homepage)
   - components/NavbarClient.tsx + Navbar.tsx
   - app/[locale]/trips/new/NewTripWizard.tsx + step components
   - components/trip/TripDetailClient.tsx + TripCard
   - components/ui/Modal*.tsx / Dialog*.tsx / Drawer*.tsx (modal/drawer patterns)
   - components/ui/AuthPromptModal.tsx (auth flow)
   - components/explore/ TripCard + EngagementBar (just-localized)
2. For each, look for:
   - Buttons without accessible names (no aria-label, no children text)
   - Form inputs missing <label> association or aria-labelledby
   - Modals/dialogs without role="dialog" + aria-modal + focus trap
   - Color-only state indicators (hover, error, active)
   - Click handlers on non-interactive elements (div onClick without role + keyboard handler)
   - Images missing alt= (or alt="" when decorative)
   - Heading hierarchy jumps (h1 → h3 with no h2)
   - Focus outline removed without :focus-visible replacement
   - aria-hidden="true" on focusable elements
3. Skip what's already been addressed (commit a5a9e1d ShareAndInviteModal aria-labels per task #89).

Output RECON_SCHEMA findings. Each = one concrete a11y violation with file:line + WCAG criterion if known + fix sketch. Cap at 8.`, {
    label: 'recon:a11y',
    schema: RECON_SCHEMA,
  }),

  () => agent(`${REPO_PIN}

RECON: E2E test coverage gaps

Goal: identify the 5-7 highest-value untested user paths and propose Playwright specs.

Steps:
1. List existing Playwright tests: glob \`e2e/**/*.spec.ts\` + \`tests/**/*.spec.ts\` + \`playwright/**/*.spec.ts\` (whichever directory the project uses).
2. Map each spec to the user flow it covers.
3. Cross-reference against the actual user flows the codebase supports (look at app/[locale]/* route segments + key API routes).
4. Identify untested critical paths. Highest-value gaps:
   - Recently-changed code (last 5 commits) without test coverage
   - Auth flows (login, signup, password reset, OAuth callback)
   - Paywall + usage-limit gating
   - Trip generation full flow (Start Anywhere included)
   - Save → fork → publish → unpublish full lifecycle
   - /explore feed pagination + filters + voting
   - Invite acceptance (the RLS-protected flow just refactored in f769dc4)
   - Mobile-viewport critical paths
5. For each gap, propose a SPEC OUTLINE: file path, describe block, key assertions.

Output RECON_SCHEMA findings. Each = one missing test outline. Cap at 7. Don't propose adding tests for already-tested flows.`, {
    label: 'recon:e2e-coverage',
    schema: RECON_SCHEMA,
  }),
])

log(`Phase 1 done. ${phase1.filter(Boolean).flatMap(r => r.findings || []).length} findings collected`)

// ─────────────────────────────────────────────────────────────────────────────
phase('Phase 2: Cleanup follow-ups')

const phase2 = await parallel([
  () => agent(`${REPO_PIN}

CLEANUP #175 REMNANTS: 12 other booking target=_blank anchors → openExternal()

Background: commit f769dc4 added \`lib/native/external-link.ts\` and migrated PartnerButton + BookingDrawer. Cycle 2's recon flagged 10-12 OTHER \`<a target='_blank'>\` or \`window.open\` sites in booking flows still using direct browser nav.

Steps:
1. Grep the codebase for booking-related target=_blank + window.open sites EXCLUDING already-migrated PartnerButton + BookingDrawer:
   - components/booking/BookingCTA.tsx (line ~134)
   - components/booking/ActivityBookingCTA.tsx (lines 80/115/142/162/182)
   - components/booking/EnhancedBookingPanel.tsx (line ~64)
   - components/booking/PostConfirmationBanner.tsx (lines 91/110/119/142)
   - components/booking/TripBookingLinks.tsx
   - components/booking/HotelRecommendations.tsx
2. For each, replace the anchor pattern with a button calling openExternal(href):
   - Preserve any tracking analytics that fire before the click (capture('booking_xxx_click'))
   - Preserve sponsorship signal via data-rel='sponsored noopener noreferrer'
   - Preserve aria-label
   - Preserve any disabled state / loading state
3. If a component re-uses an existing primitive component (like a Button), prefer wrapping the button's onClick rather than restructuring the JSX.
4. Skip mailto: links (those are a separate concern — different handler).
5. SKIP share/social callers (ShareModal/ShareAndInviteModal/ReferralModal/ExportMenu — those route via lib/native/share.ts).

Run \`npx tsc --noEmit\` from ${REPO} before returning.`, {
    label: 'cleanup:target-blank-remnants',
    schema: FIX_SCHEMA,
  }),

  () => agent(`${REPO_PIN}

CLEANUP #181 REMNANTS: migrate remaining getUser callers to AuthContext

Background: commit f769dc4 created \`components/auth/AuthProvider.tsx\` exposing { user, loading } via useAuth(). NavbarClient + NotificationBell already migrated. ~8 more callers still bypass:
- components/ConsentWrapper.tsx
- components/MaintenanceWrapper.tsx
- components/ProfileCompletionProvider.tsx
- components/SessionTracker.tsx
- components/AuthEventTracker.tsx
- lib/hooks/useTrial.ts
- lib/hooks/useEarlyAccess.ts
- components/trip/SaveTripModal.tsx (auth check before save)
- app/[locale]/invite/[token]/InviteAcceptClient.tsx
- components/trip/DuplicateTripCTA.tsx
- app/[locale]/trips/new/NewTripWizard.tsx

Steps:
1. For each file, identify the supabase.auth.getUser() call + the onAuthStateChange listener (if any).
2. Replace getUser() with useAuth() context read — drop the per-component useEffect + state.
3. For components with BUSINESS LOGIC inside their onAuthStateChange handler (SessionTracker, AuthEventTracker may track auth events), KEEP that listener — the AuthProvider's central listener doesn't replace per-component analytics. Just verify they don't ALSO call getUser().
4. For hooks (useTrial, useEarlyAccess), the React rule is they can call other hooks — so useAuth() is fine inside them.
5. If a caller uses .then() on getUser (sync expectation), adapt to use the context's { loading, user } shape with a guard.
6. CAUTION: don't break the F1 (no flash of logged-out state) behavior. AuthProvider should render children immediately with loading=true so consumers can decide.

Cap scope: aim for 6+ callers migrated. If a caller is genuinely complex (own state machine, heavy logic), SKIP and note it in summary — don't break things to hit a number.

Run \`npx tsc --noEmit\` from ${REPO} before returning.`, {
    label: 'cleanup:auth-context-expansion',
    schema: FIX_SCHEMA,
  }),

  () => agent(`${REPO_PIN}

CLEANUP #177 REMNANTS: drop remaining unoptimized props on <Image>

Background: commit f769dc4 dropped \`unoptimized\` from 5 blog/destination <Image> sites. Several more remain (Navbar, Footer, BlogByline, ProductTour, TourPhone, TripCard).

Steps:
1. Grep the codebase: \`unoptimized\` JSX prop on <Image>.
2. For each hit:
   - Remove \`unoptimized\` prop.
   - Verify the <Image> has a \`sizes\` prop. If missing, add a reasonable one (\`sizes="(max-width: 768px) 100vw, 50vw"\` is a safe default for fluid images).
   - Verify the src is either local (/images/...) OR matches an entry in next.config.ts \`images.remotePatterns\`. If external and missing pattern, ADD the pattern.
3. EXCEPT: skip cases where unoptimized is intentional. Look for nearby comments like "must be unoptimized because". If the prop has a sibling \`loader={...}\` prop pointing to a custom loader, that's intentional too — skip.
4. Recently-shipped components (TripCard from cycle 1's hoist, etc.) — check carefully, they may have been intentionally optimized differently.

Run \`npx tsc --noEmit\` from ${REPO} before returning.`, {
    label: 'cleanup:unoptimized-remnants',
    schema: FIX_SCHEMA,
  }),
])

log(`Phase 2 done. ${phase2.filter(r => r?.tsc_status === 'PASS').length}/3 PASS`)

// ─────────────────────────────────────────────────────────────────────────────
phase('Phase 3: /explore Week 3')

const week3assess = await agent(`${REPO_PIN}

#121 /explore Week 3 — ASSESS

Background: /explore is the public feed of published user trips. Week 1 shipped DB migrations + atomic RPCs + RLS + API routes + Editor's Picks cron. Week 2 shipped the page + filters + TripCard + EngagementBar + PublishTripModal + /saved page. Week 3 task is: "assess → integrate → live test (full methodology)."

Your job is the ASSESS step. Read:
1. app/[locale]/explore/page.tsx (current SSR feed implementation)
2. components/explore/ExploreFilters.tsx, TripCard.tsx, EngagementBar.tsx
3. app/api/explore/* route handlers
4. supabase/migrations/20260525_explore_ugc_feed.sql (or similar — find the explore migrations)
5. app/api/cron/explore-editors-picks/route.ts (or similar cron)
6. components/explore/PublishToggle.tsx
7. ShareModal Publish-to-Explore auto-prompt (task #123 — wired in cycle pre-1)

Then identify CONCRETE INTEGRATION GAPS — things that should connect /explore to the rest of the app but don't:
- Deep-linking from result-page sticky bar / share modal back to /explore
- /explore link in main navbar (is it there? prominent enough?)
- /explore link in footer
- /explore mentioned in onboarding / empty-state of /trips
- /shared/[token] page — "browse more like this" → /explore
- /destinations/[slug] — "trips to this destination on /explore"
- /backpacker landing — "see what other backpackers planned" → /explore?budget=budget
- Trip detail page — "publish this to /explore" CTA always visible (not just auto-prompt)
- /explore — empty state for filters that return no results (UX, not just "0 trips")
- /explore — pagination (cursor or page-based?) + scroll-restore on back
- /explore — performance: is the SSR feed query optimized? Count limit on Editor's Picks cron?
- /explore — for IT/ES users: does the feed locale-filter or show all? Should it?
- Sitemap entries for indexable published trips (/shared/[token] or /trip/[id]?)

Return a structured assessment: array of integration gaps, each with severity (P1 = revenue/discovery impact, P2 = UX polish), concrete file:line if applicable, and a fix sketch.

DO NOT EDIT ANY CODE. Pure assessment. The next agent will fix based on your findings.`, {
  label: 'explore-week-3:assess',
  schema: {
    type: 'object',
    required: ['gaps', 'recommended_order'],
    properties: {
      gaps: {
        type: 'array',
        items: {
          type: 'object',
          required: ['title', 'severity', 'fix_sketch'],
          properties: {
            title: { type: 'string' },
            severity: { enum: ['P0', 'P1', 'P2', 'P3'] },
            file: { type: 'string' },
            line: { type: 'string' },
            current_behavior: { type: 'string', maxLength: 300 },
            desired_behavior: { type: 'string', maxLength: 300 },
            fix_sketch: { type: 'string', maxLength: 500 },
            effort: { enum: ['trivial', 'small', 'medium', 'large'] },
          },
        },
      },
      recommended_order: { type: 'array', items: { type: 'string' } },
      summary: { type: 'string', maxLength: 500 },
    },
  },
})

log(`/explore Week 3 assessment: ${week3assess?.gaps?.length || 0} gaps identified`)

const week3fix = await agent(`${REPO_PIN}

#121 /explore Week 3 — INTEGRATE (based on assessment below)

ASSESSMENT FROM PRIOR AGENT:
${JSON.stringify(week3assess, null, 2)}

Your job: implement the gaps marked P1 effort:trivial/small AND any P2 effort:trivial. Skip P2 medium/large and P3 entirely — those become follow-up tasks.

Constraints:
- Surgical edits matching existing patterns (next-intl for any new strings, useTranslations, etc.)
- For each new entry-point link to /explore, ensure it's wired in en/it/es message JSON if it's user-facing text
- For SSR query optimization: profile the query mentally — is it doing N+1? Can it be combined?
- For sitemap entries: only add if the trips have proper public URLs + canonical metadata
- DO NOT make architectural changes — this is integration polish, not refactor
- DO NOT add new heavy dependencies

If the assessment turned up a P0, ESCALATE: do that one first, then continue.

Run \`npx tsc --noEmit\` from ${REPO} before returning. Report which gaps you closed and which were deferred.`, {
  label: 'explore-week-3:integrate',
  schema: FIX_SCHEMA,
})

log(`/explore Week 3 integration: ${week3fix?.tsc_status === 'PASS' ? 'PASS' : 'FAIL'}`)

// ─────────────────────────────────────────────────────────────────────────────
phase('Phase 4: Recon synth + verify')

// Recon synth — files high-confidence findings as TaskCreate tasks
const allRecon = phase1.filter(Boolean).flatMap(r => r.findings || [])
  .filter(f => f.confidence === 'high')

const synth = await agent(`${REPO_PIN}

You are the RECON SYNTHESIZER. You received ${allRecon.length} high-confidence findings from 4 recon agents (Sentry, /api latency, a11y, E2E coverage).

Your job:
1. Deduplicate cross-phase findings.
2. Rank by leverage: P0 bug > P1 with revenue impact > P1 a11y if blocking screen-reader users > P1 perf > P2 polish.
3. File each surviving finding as a task via TaskCreate. Title format: "<category>(<scope>): <short>".
4. Cap at 10 tasks. If more high-confidence findings, drop the lowest-leverage.

Return:
- tasks_filed: number
- top_5: array of { title, why_top }
- summary: < 400 char brief

INPUT:
${JSON.stringify(allRecon, null, 2)}`, {
  label: 'recon:synth+file',
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
      summary: { type: 'string', maxLength: 400 },
    },
  },
})

// Final verifier
const verify = await agent(`${REPO_PIN}

You are the FINAL VERIFIER. Do not edit any code. Run from ${REPO} and report:

1. \`npx tsc --noEmit\` — must exit 0
2. \`npm run build\` — must exit 0
3. \`git status --short\` — list every modified/new file
4. \`git diff --stat\` — line counts per file

Return:
- tsc: "PASS" | "FAIL" + error if FAIL
- build: "PASS" | "FAIL" + error if FAIL
- modified_files: string[]
- new_files: string[]
- diff_stat_summary: string
- ready_to_commit: boolean

Do NOT commit. Do NOT push.`, {
  label: 'verify:final',
  schema: {
    type: 'object',
    required: ['tsc', 'build', 'ready_to_commit'],
    properties: {
      tsc: { enum: ['PASS', 'FAIL'] },
      tsc_error: { type: 'string' },
      build: { enum: ['PASS', 'FAIL'] },
      build_error: { type: 'string' },
      modified_files: { type: 'array', items: { type: 'string' } },
      new_files: { type: 'array', items: { type: 'string' } },
      diff_stat_summary: { type: 'string' },
      ready_to_commit: { type: 'boolean' },
    },
  },
})

return {
  phase1_recon: phase1,
  phase2_cleanup: phase2,
  phase3_explore_week_3: { assess: week3assess, integrate: week3fix },
  synth,
  verify,
}
