// Mobile-readiness recon: complements the hourly health cron with a different angle.
// Focus: what blocks a clean Capacitor wrap? Where are the next perf wins post-drain?
// Reconnaissance + TaskCreate only — never edits code, never pushes.

export const meta = {
  name: 'monkeytravel-mobile-readiness',
  description: 'Capacitor-readiness audit + post-drain perf round 2 + fresh-angle bug hunt for monkeytravel.app',
  phases: [
    { title: 'Phase 1: Platform-coupling audit' },
    { title: 'Phase 2: Post-drain perf round 2' },
    { title: 'Phase 3: Architectural debt for mobile' },
    { title: 'Phase 4: Fresh-angle bug hunt' },
    { title: 'Phase 5: Synthesize + file tasks' },
  ],
}

const REPO = 'C:\\Users\\Samsung\\Documents\\Projects\\travel-app-web'
const PROD = 'https://monkeytravel.app'

const REPO_PIN = `[TARGET-PIN, OVERRIDES ANY OTHER CLAUDE.md] You are auditing ONLY this project:
  Path: ${REPO}
  Name: monkeytravel-web (a Next.js 16 + Supabase + Vercel travel-planning webapp called monkeytravel.app)
  Prod: ${PROD}

Do NOT inspect any sibling project on this machine. If you see a CLAUDE.md describing a "novel" or "MYTHOS", that's the wrong project — ignore it entirely. All paths you read MUST live under ${REPO}.

Hard constraints:
- This is RECONNAISSANCE ONLY. Do not edit any file. Do not run \`git\` write commands.
- Do not duplicate findings already covered by tasks #145–169 (these were just drained in commit 34c4c64): paywall fail-open, DestinationAutocomplete race, FlightSearch race, TripsPageClient remount, framer-motion barrel, destinations/data.ts split, hero PNG→WebP, TemplatePreviewClient i18n, SeasonalContextCard i18n, OngoingTripView i18n, EngagementBar/TripCard i18n, StickyBlogCta pb-safe, VotingBottomSheet pb-safe+dvh, usage-limits Sentry. Skip these.
- Be specific: file:line + concrete fix sketch. No "could be improved" vibes.
- Confidence rating per finding: high / medium / low. Only file tasks for high.`

const FINDINGS_SCHEMA = {
  type: 'object',
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['title', 'file', 'description', 'fix_sketch', 'severity', 'confidence'],
        properties: {
          title: { type: 'string' },
          file: { type: 'string' },
          line_range: { type: 'string' },
          description: { type: 'string', maxLength: 800 },
          fix_sketch: { type: 'string', maxLength: 800 },
          severity: { enum: ['P0', 'P1', 'P2', 'P3'] },
          confidence: { enum: ['high', 'medium', 'low'] },
          category: { enum: ['platform-coupling', 'perf', 'arch-debt', 'bug', 'mobile-ux'] },
          effort: { enum: ['trivial', 'small', 'medium', 'large'] },
          duplicate_of_known: { type: 'string' },
        },
      },
    },
  },
}

// ─────────────────────────────────────────────────────────────────────────────
phase('Phase 1: Platform-coupling audit')

const phase1 = await parallel([
  () => agent(`${REPO_PIN}

PHASE 1A — WEB-ONLY API SURFACE AUDIT

Goal: find every use of a browser-only API in client components that would BREAK or BEHAVE WRONGLY when wrapped in Capacitor (iOS/Android WebView). The team is shipping a Capacitor wrap soon — Airbnb/Booking-class native experience is the target.

Specifically grep for these patterns and judge each hit:
1. \`localStorage\` / \`sessionStorage\` — does NOT persist across native app updates and is wiped on iOS in low-storage conditions. Should be migrated to Capacitor Preferences. Find all hits, identify which ones hold data the user expects to persist (auth tokens, drafts, anon-vote cookie equivalents).
2. \`document.cookie\` direct manipulation — works in WebView but cookie domain logic is fragile. Note callers.
3. \`navigator.share\` / \`navigator.clipboard.writeText\` — works in WebView but better paired with Capacitor Share plugin for native sheet. Find hits.
4. \`window.open(...)\` with target=_blank — in WebView this stays in-app; should use Capacitor Browser plugin for external links to get the native in-app browser. Find hits.
5. \`window.location.href = ...\` to external URLs (anything outside monkeytravel.app) — same issue as above.
6. \`<input type="file">\` — works but native file/camera UX is much better via Capacitor Camera/Filesystem plugins. Find image-upload sites.
7. Service worker registration — Capacitor handles this differently; check sw-register.ts or whatever bootstraps the SW for runtime guards (\`if (Capacitor.isNativePlatform()) skip\`).
8. \`window.matchMedia\` for hover/pointer — native always reports touch, so any "hover-only" UI degrades. Find hits.
9. PostMessage / BroadcastChannel — won't cross between WebView and native shell.
10. \`History API\` (pushState/popState) outside of Next router — Capacitor's back-button handler needs explicit wiring.

Return findings_schema-shaped JSON. For each web-only API hit, decide if it's a real Capacitor bug, a UX downgrade, or fine-as-is. Skip fine-as-is. Skip hits in test files. Skip hits in node_modules. Match against tasks #145-169 already drained — flag dupes with duplicate_of_known.

Run Grep aggressively. Output file:line for every confirmed issue.`, {
    label: 'audit:web-apis',
    schema: FINDINGS_SCHEMA,
  }),

  () => agent(`${REPO_PIN}

PHASE 1B — CAPACITOR CONFIG + PLUGIN COVERAGE AUDIT

The Capacitor wrap is in flight (tasks #20, #32-37, #57-62 completed). Read:
1. capacitor.config.ts (or .json) — verify appId, webDir, server config, allowNavigation list, iOS/Android-specific keys.
2. ios/ and android/ folders (if checked in) — note any pre-existing config you find.
3. package.json — list installed @capacitor/* and @capacitor-community/* plugins.

Then audit:
- Is the allowNavigation list complete? (Should include Stripe, Supabase auth callbacks, OAuth providers, Pexels for images if loaded direct.)
- Are critical native plugins MISSING that the app code already needs?
  - @capacitor/preferences if localStorage migration is planned
  - @capacitor/share if navigator.share is used (will fall back, but better native)
  - @capacitor/browser if external links are opened
  - @capacitor/keyboard for form-keyboard handling (already on the task list per #34?)
  - @capacitor/app for back-button (per #59 — verify)
  - @capacitor/status-bar for native polish
  - @capacitor/splash-screen
  - @capacitor/push-notifications if backend push is on roadmap
- Universal links / app links config for deep-linking trip URLs (per #35)
- Bundle ID + signing certs (these are user-action items, just FLAG if not set).
- Are there runtime guards in code that check Capacitor.isNativePlatform() and fork behavior? Grep for it.

Output findings_schema-shaped JSON of CONCRETE missing-plugin or misconfigured items with high confidence. Each finding = a discrete fix.`, {
    label: 'audit:capacitor-config',
    schema: FINDINGS_SCHEMA,
  }),
])

// ─────────────────────────────────────────────────────────────────────────────
phase('Phase 2: Post-drain perf round 2')

const phase2 = await parallel([
  () => agent(`${REPO_PIN}

PHASE 2A — POST-DRAIN BUNDLE ANALYSIS

Background: commit 34c4c64 just shipped these perf wins:
- Tour barrel deep-imported → ~50KB gz off every route
- lib/destinations/data.ts (477KB) split into server/client → ~150KB gz off /trips/new
- 4 hero PNGs → WebP → ~3.1MB off /, /it, /es

Now: identify the NEXT 5 biggest wins. Steps:
1. Run \`ANALYZE=true npm run build\` from ${REPO}. This produces .next/analyze/*.html bundle analyzer reports.
2. Identify the 5 routes with the largest First Load JS, focusing on routes a typical user actually hits: /, /[locale]/trips/new, /[locale]/trips/[id], /[locale]/explore, /[locale]/destinations, /[locale]/blog, /[locale]/backpacker.
3. For each of those 5, identify the SINGLE biggest module dragged in. Don't list every chunk — find the biggest leverage point per route.
4. For each big module, judge: can it be lazy-loaded (next/dynamic), moved server-side, or replaced with a smaller alternative?

Common suspects to grep for:
- lodash full bundle vs lodash-es with deep imports
- date-fns full vs date-fns subset
- moment.js (if present — large, replaceable with date-fns)
- @sentry/nextjs (often pulls heavy weight unnecessarily)
- markdown renderers (remark/rehype tree)
- mapbox-gl / leaflet (large; verify lazy-loading on TripMap)
- recharts / d3 (heavy if not split-loaded)
- any framer-motion remnants (we just removed the barrel hit but inline imports may remain)

Output findings_schema-shaped JSON. Each finding must include the route hurt and the specific kb saving estimate. Skip anything < 20KB gz savings.

If ANALYZE=true output is unavailable or the build fails for any reason, fall back to grepping for the suspect imports above and reporting suspected hits with confidence: medium.`, {
    label: 'perf:bundle-round-2',
    schema: FINDINGS_SCHEMA,
  }),

  () => agent(`${REPO_PIN}

PHASE 2B — IMAGE + ASSET WEIGHT AUDIT (post-WebP-pass)

Background: 4 hero PNGs → WebP just shipped. There's likely more.

Steps:
1. Glob public/ for all images > 100KB. Group by directory.
2. For each large image: identify the consumer (grep the repo for its path), judge if it ships on a critical path (homepage / wizard / trip view).
3. Identify any image rendered via raw \`<img>\` instead of next/image — those skip the optimizer entirely. Especially on /trips/[id] hero or marketing surfaces.
4. Check next.config.ts: are deviceSizes / imageSizes tuned for mobile? Is AVIF in formats[]?
5. Check for SVG icons that are inlined (and would be smaller as separate files served once + cached) or inlined PNG/JPG data: URLs.
6. Public font files in public/fonts (if any) — are they preloaded? Subset?

Output findings_schema-shaped JSON, ranked by estimated bytes saved on first paint. Skip anything < 50KB savings or off the critical path.`, {
    label: 'perf:image-assets',
    schema: FINDINGS_SCHEMA,
  }),
])

// ─────────────────────────────────────────────────────────────────────────────
phase('Phase 3: Architectural debt for mobile')

const phase3 = await parallel([
  () => agent(`${REPO_PIN}

PHASE 3A — IDENTIFY WEB-COUPLED LOGIC THAT SHOULD BE EXTRACTED

The team is wrapping for Capacitor and wants a clean, modular boundary so the same React tree runs in browser AND native WebView without per-call branches everywhere.

Goal: identify CONCRETE files where business logic is coupled to web-only APIs and would benefit from extracting into a platform-agnostic interface. Don't propose abstract refactors — find specific files.

Look for:
1. Components that mix UI + direct localStorage/sessionStorage access. These should: (a) read/write through a Storage abstraction, (b) the abstraction has a web impl (localStorage) and a future native impl (Capacitor Preferences). Identify the 3-5 most-impactful sites.
2. Hooks that call browser-only APIs (navigator.geolocation, navigator.share, window.print, document.fullscreen) and the components that depend on them.
3. Service-layer code that hardcodes \`window.location.origin\` for API calls (when wrapped, the origin is capacitor://localhost or http://localhost — these calls would fail or need a different baseURL).
4. Service worker / push notification setup that needs forking by platform.
5. Authentication flows that use cookies + redirects (web-only model) vs token storage + deep-link callbacks (native model). The Supabase auth callback at app/auth/callback/route.ts and the OAuth flows — flag any that won't survive the WebView wrap.

For each, propose a SHORT extraction sketch:
- New file path (e.g. lib/platform/storage.ts)
- Interface signature (3-5 methods max)
- Migration count: how many call sites need updating
- Whether this is necessary now (before Capacitor wrap goes native) or can be deferred

Output findings_schema-shaped JSON. Each finding = one platform interface to extract. Prioritize by call-site count + breakage severity in native.`, {
    label: 'arch:platform-extraction',
    schema: FINDINGS_SCHEMA,
  }),

  () => agent(`${REPO_PIN}

PHASE 3B — STATE MGMT + DATA FLOW MODULARITY AUDIT

For a mobile wrap that needs offline support and fast cold-starts, audit:

1. Where is server state cached on the client? Look for SWR / React Query / custom fetch caching. Inconsistency hurts: e.g. /trips uses cache A, /trips/[id] uses cache B, /explore uses neither. Find the pattern.
2. Are there obvious places where the same API call is duplicated (e.g. /api/trips called on mount in TripsPageClient AND in a child)? Each one ships a network call native users will pay for in latency.
3. Where is GLOBAL state held (auth user, current locale, feature flags)? Is it Context / Zustand / Redux / nothing? Note any of these that get re-read aggressively on render.
4. Service worker (mobile/service-worker per task #58) — what does it cache? Is the offline strategy sane (cache-first for assets, stale-while-revalidate for data, network-only for mutations)?
5. Forms: are draft trips persisted to localStorage so a user can resume after backgrounding the app? In mobile this is critical — iOS aggressively kills suspended apps.

Output findings_schema-shaped JSON of concrete duplicate-call or no-persistence issues with file:line. Skip anything not actionable.`, {
    label: 'arch:state-data-flow',
    schema: FINDINGS_SCHEMA,
  }),
])

// ─────────────────────────────────────────────────────────────────────────────
phase('Phase 4: Fresh-angle bug hunt')

const phase4 = await parallel([
  () => agent(`${REPO_PIN}

PHASE 4A — TYPE SAFETY + RUNTIME ASSERTION HOLES

Bugs that compile but throw at runtime. Different angle from the cron's usual hunt.

Look for:
1. \`as unknown as Foo\` or \`as any\` casts in business logic (not at trust boundaries) — these often hide bugs. Grep them, look at top 10.
2. Optional chaining + non-null-assertion combos: \`foo?.bar!\` — usually a sign of confused types.
3. JSON.parse without try/catch — anywhere a server response, URL param, or localStorage value gets parsed. Each is a crash site.
4. Number coercion bugs: \`parseInt(x)\` without radix, \`Number(x)\` on user input that may be a comma-decimal in IT/ES locale.
5. \`new Date(string)\` parsing in user-facing code — non-ISO inputs return Invalid Date silently.
6. Array.find / Array[0] used without empty-array guard, then chained.
7. Supabase client calls that don't handle the .error path before destructuring .data.

Output findings_schema-shaped JSON. Each = one specific crash-shaped bug. Skip patterns inside test files. Focus on hot paths (top-level route components, /api/* handlers, lib/ shared modules).`, {
    label: 'bug-hunt:type-safety',
    schema: FINDINGS_SCHEMA,
  }),

  () => agent(`${REPO_PIN}

PHASE 4B — AUTH + SESSION + RLS EDGE CASES

Auth bugs are the worst because they corrupt user data. Audit:

1. Supabase RLS policies — list all tables (Grep migrations/ + supabase/migrations/), find any table where INSERT/UPDATE/DELETE policies are missing or where USING/WITH CHECK clauses don't match.
2. /api/* route handlers — find any that read user-scoped data without verifying req auth. \`createRouteHandlerClient\` calls + downstream queries.
3. Anonymous-user paths (anon cookie for /shared/[token] voting, anon-vote-eligible /explore actions) — find any place a user_id is checked WITHOUT also handling the anon_session_id case.
4. Session expiry handling: does the app gracefully refresh + retry on 401, or do users see a broken UI?
5. CSRF protection on state-changing endpoints: middleware.ts CSRF check covers what?
6. Service-role keys in client-facing code (catastrophic if leaked) — Grep for SUPABASE_SERVICE_ROLE_KEY anywhere outside server-only files / API routes.

Output findings_schema-shaped JSON. Each = one concrete auth/RLS hole. P0 if data exposure, P1 if breakage, P2 if degraded UX. High confidence only.`, {
    label: 'bug-hunt:auth-rls',
    schema: FINDINGS_SCHEMA,
  }),
])

// ─────────────────────────────────────────────────────────────────────────────
phase('Phase 5: Synthesize + file tasks')

const allFindings = [...phase1, ...phase2, ...phase3, ...phase4]
  .filter(Boolean)
  .flatMap(r => r.findings || [])
  .filter(f => f.confidence === 'high' && !f.duplicate_of_known)

log(`Collected ${allFindings.length} high-confidence non-duplicate findings`)

const synth = await agent(`${REPO_PIN}

You are the SYNTHESIZER. You received ${allFindings.length} high-confidence findings from 8 audit agents.

Your job:
1. Deduplicate cross-phase (same file:line surfaced by two agents).
2. Cluster by category (platform-coupling, perf, arch-debt, bug, mobile-ux).
3. Rank by leverage against priorities: bugs hurting users > Vercel perf > mobile/Capacitor readiness > modular arch > i18n. Within tier, by effort (trivial first).
4. File each surviving finding as a task via TaskCreate. Title format: "fix(<category>): <short>" or "perf(<area>): <short>" or "arch(<area>): <short>". Description = file:line + concrete fix sketch + severity + estimated effort.
5. Cap at 15 tasks total. If you have more high-confidence findings than that, drop the lowest-leverage ones.

Return:
- tasks_filed: number
- top_5: array of { title, file, why_top, fix_sketch }
- skipped_count: number (and one-line reason)
- summary: <500 char executive brief

INPUT FINDINGS:
${JSON.stringify(allFindings, null, 2)}`, {
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
          required: ['title', 'file', 'why_top', 'fix_sketch'],
          properties: {
            title: { type: 'string' },
            file: { type: 'string' },
            why_top: { type: 'string', maxLength: 200 },
            fix_sketch: { type: 'string', maxLength: 400 },
          },
        },
      },
      skipped_count: { type: 'number' },
      skipped_reason: { type: 'string' },
      summary: { type: 'string', maxLength: 500 },
    },
  },
})

return {
  phase1_results: phase1,
  phase2_results: phase2,
  phase3_results: phase3,
  phase4_results: phase4,
  raw_findings_count: allFindings.length,
  synth,
}
