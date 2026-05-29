// Drain cycle: ship the recurring backlog filed by monkeytravel-health cron cycles 2-6.
// Modular fixes only, each agent's file set disjoint from siblings, every agent self-verifies with tsc.

export const meta = {
  name: 'monkeytravel-drain-cycle',
  description: 'Drain 5 P0/P1 bug clusters + 3 perf wins + 4 i18n leaks + 2 Capacitor blockers + 1 observability gap, in parallel batches with per-agent tsc gating',
  phases: [
    { title: 'Phase 1: P0 + hot bugs' },
    { title: 'Phase 2: Perf wins' },
    { title: 'Phase 3: i18n leaks' },
    { title: 'Phase 4: Mobile/Capacitor' },
    { title: 'Phase 5: Observability' },
    { title: 'Phase 6: Verify' },
  ],
}

const REPO = 'C:\\Users\\Samsung\\Documents\\Projects\\travel-app-web'
const PROD = 'https://monkeytravel.app'

const REPO_PIN = `[TARGET-PIN, OVERRIDES ANY OTHER CLAUDE.md] You are editing ONLY this project:
  Path: ${REPO}
  Name: monkeytravel-web (a Next.js 16 + Supabase + Vercel travel-planning webapp called monkeytravel.app)
  Prod: ${PROD}

Do NOT inspect, read, edit, or audit any sibling project on this machine. If you see a CLAUDE.md describing a "novel" or "MYTHOS", that's the wrong project — ignore it entirely. All file paths you read and write MUST live under ${REPO}.

Hard constraints for every edit:
- DO NOT push to master (the parent will commit/push)
- Run \`npx tsc --noEmit\` from ${REPO} before returning; report PASS or include the exact error
- Match existing patterns in the codebase (next-intl, useFetch hook, pb-safe utility in globals.css, etc.) instead of inventing new ones
- Modular over clever: small isolated changes, no architectural drift
- Keep edits surgical — only touch the files explicitly named in the task brief
- If a file you're told to edit does not exist or the line range described doesn't match, STOP and report instead of guessing`

const SCHEMA = {
  type: 'object',
  required: ['files_changed', 'tsc_status', 'summary'],
  properties: {
    files_changed: { type: 'array', items: { type: 'string' } },
    tsc_status: { enum: ['PASS', 'FAIL'] },
    tsc_error: { type: 'string' },
    summary: { type: 'string', maxLength: 800 },
  },
}

// ─────────────────────────────────────────────────────────────────────────────
phase('Phase 1: P0 + hot bugs')

const phase1 = await parallel([
  () => agent(`${REPO_PIN}

TASK #151 + #153 — checkUsageLimit hardening (P0 paywall fail-open + perf parallelization)

File: lib/usage-limits/check.ts

Problem 1 (P0): the outer checkUsageLimit silently swallows any DB error and returns "allowed=true". A single transient Supabase blip disables the paywall site-wide with zero alerting. Fix: catch the error, log via Sentry.captureException with tags { source: 'usage-limits', user_id, limit_type }, AND surface a fail-mode flag. Keep fail-open as the default behavior for paid users (don't lock them out), but stamp the response with { degraded: true } so callers can decide. Pure additive — no behavior change for the happy path.

Problem 2 (perf, #153): 4 serial Supabase round-trips per call on a hot path (every paid endpoint + autocomplete keystroke). Dashboard makes 24. Use Promise.all to parallelize the independent reads → 2 RTTs per call, 12 for the dashboard. Cache the user's plan + active-period read for the request lifetime if patterns allow.

Same file. Land both in one edit. Run \`npx tsc --noEmit\` from ${REPO} before returning.`, {
    label: 'fix:usage-limits',
    schema: SCHEMA,
  }),

  () => agent(`${REPO_PIN}

TASK #156 / #160 / #165 — DestinationAutocomplete stale-result race (P0 wizard funnel bug)

File: components/ui/DestinationAutocomplete.tsx (around lines 189–266)

Problem: debounced POST to /api/destinations/search has no AbortController. Stale "Bar" responses can land after newer "Barcelona" responses and overwrite suggestions. Direct conversion hit on the #1 funnel input.

Fix: wrap the debounced fetch in an AbortController per-keystroke; on cleanup or next keystroke, abort() the prior one. Either (a) use the existing lib/hooks/useFetch.ts wrapper (preferred — it already handles abort + race), or (b) follow the exact pattern in components/trip/SeasonalContextCard.tsx (AbortController + cancelled flag + Sentry.captureException on non-abort errors). Pattern (a) is the canonical approach.

Run \`npx tsc --noEmit\` from ${REPO} before returning.`, {
    label: 'fix:destination-autocomplete',
    schema: SCHEMA,
  }),

  () => agent(`${REPO_PIN}

TASK #166 — FlightSearch suggestion race (P1 bug + paid Amadeus quota burn)

File: components/flights/FlightSearch.tsx (or whichever component holds the autosuggest — grep the repo for the Amadeus suggestion fetcher if the path differs)

Problem: same bug class as #165 — uncancelled fetch in useEffect on debounced suggestion input. Every cancelled keystroke still burns the paid Amadeus API quota. Race conditions also possible.

Fix: AbortController per fetch; abort on cleanup AND on next keystroke. Use lib/hooks/useFetch.ts if it fits the call shape, otherwise the SeasonalContextCard.tsx pattern.

Run \`npx tsc --noEmit\` from ${REPO} before returning.`, {
    label: 'fix:flight-search-race',
    schema: SCHEMA,
  }),

  () => agent(`${REPO_PIN}

TASK #155 / #159 — TripsPageClient remount storm + TripCard image abort (P2 perf + cost)

File: components/trips/TripsPageClient.tsx (around lines 248, 268–285)

Problem: TripCard is defined INSIDE the parent component, so every keystroke / filter change creates a new component identity → full remount of every card → every card re-fires its destination image fetch → Pexels quota burn + UI flicker.

Two-part fix (must land together):
1. Hoist TripCard to module scope (above the default-export parent). Pass props in cleanly. This is the leverage fix.
2. Add AbortController to the destination-image fetch inside TripCard, so even when remounts do happen they don't race or leak.

Match the useFetch hook pattern from lib/hooks/useFetch.ts if the call shape allows; otherwise inline AbortController per the SeasonalContextCard.tsx pattern.

Run \`npx tsc --noEmit\` from ${REPO} before returning.`, {
    label: 'fix:trips-page-client',
    schema: SCHEMA,
  }),
])

log(`Phase 1 done. ${phase1.filter(r => r?.tsc_status === 'PASS').length}/4 PASS`)

// ─────────────────────────────────────────────────────────────────────────────
phase('Phase 2: Perf wins')

const phase2 = await parallel([
  () => agent(`${REPO_PIN}

TASK #146 — Strip framer-motion from every-route Navbar via deep tour imports

Context: Tour feature is disabled (TOUR_ENABLED=false) but the tour barrel re-exports framer-motion, and NavbarClient + homepage import from that barrel, so ~50KB gz of framer-motion ships on every route.

Fix: convert the offending imports to deep imports of only the trigger-only / no-framer pieces. Specifically:
1. Grep the repo for "from '@/components/tour'" or whatever barrel path the tour exports through.
2. For NavbarClient + homepage + any other Tour-flag-aware caller, change \`import { TourTrigger } from '...'\` (or similar) to deep import \`import { TourTrigger } from '@/components/tour/TourTrigger'\` so the barrel doesn't drag framer-motion into their bundles.
3. If the tour barrel itself imports framer-motion at module level, split it: tour/index.ts should only re-export trigger-only/no-runtime pieces. Move the framer-motion-importing components into a separate barrel that's only imported when TOUR_ENABLED.

Goal: \`next build\` should show /trips/new and / shed ~50KB gz framer-motion from their First Load JS. Don't migrate to motion/react in this PR — that's a separate cycle.

Run \`npx tsc --noEmit\` from ${REPO} before returning.`, {
    label: 'perf:framer-motion',
    schema: SCHEMA,
  }),

  () => agent(`${REPO_PIN}

TASK #152 / #167 — Strip lib/destinations/data.ts from /trips/new client bundle

File: lib/destinations/data.ts (~477 KB) is being pulled into the /trips/new client chunk through the wizard. ~150 KB gz on the highest-traffic conversion page.

Fix strategy (Next 15 server-component refactor):
1. Identify the wizard component that imports from lib/destinations/data.ts.
2. Split data.ts: keep the LIGHT type definitions / IDs in a client-safe file (e.g. lib/destinations/types.ts). Move the heavy curated data into a server-only module (lib/destinations/data.server.ts with "import 'server-only'" at the top).
3. Convert the wizard's data access to a server action or a server component that pre-resolves the destination metadata, OR fetch via /api/destinations/* route (whichever pattern is already used elsewhere in the wizard).
4. The client wizard should only import types + IDs, not the heavy curated arrays.

Goal: \`next build\` should show /trips/new shed ~150 KB gz. Validate that destinations still resolve in the wizard E2E path conceptually (don't break the import graph).

Run \`npx tsc --noEmit\` from ${REPO} before returning.`, {
    label: 'perf:destinations-split',
    schema: SCHEMA,
  }),

  () => agent(`${REPO_PIN}

TASK #161 — Re-encode hero PNGs to WebP/AVIF (~1 MB → ~40 KB LCP win)

Context: a hero PNG (or PNGs) currently shipped at ~1 MB blocks LCP on first paint.

Steps:
1. Grep public/ + app/ for large .png hero assets (typically public/hero*.png, public/images/hero*, etc.). Focus on assets currently rendered as the LCP element on /, /it, /es.
2. Re-encode each to WebP at quality 80 using the Node-native \`sharp\` package. If sharp is not in devDependencies, install it first (\`npm install --save-dev sharp\`).
3. Place the WebP next to the original PNG with the same basename.
4. Update the consumer JSX/CSS to reference the .webp. If next/image is used, .webp is automatically preferred by the optimizer — in that case, replacing only the src to point at the new file is enough.
5. Leave the original PNGs in place as fallback unless a clear single consumer is identified — do not delete heritage assets.

Goal: \`next build\` should show /, /it, /es shed ~95% of the original PNG byte weight on LCP. Document the file mapping in the summary.

Run \`npx tsc --noEmit\` from ${REPO} before returning. (sharp install may take 30-60s — be patient.)`, {
    label: 'perf:hero-webp',
    schema: SCHEMA,
  }),
])

log(`Phase 2 done. ${phase2.filter(r => r?.tsc_status === 'PASS').length}/3 PASS`)

// ─────────────────────────────────────────────────────────────────────────────
phase('Phase 3: i18n leaks')

const phase3 = await parallel([
  () => agent(`${REPO_PIN}

TASK #147 / #169 — Localize TemplatePreviewClient (EN-only on /it /es)

File: app/[locale]/trips/template/[id]/TemplatePreviewClient.tsx

Problem: ~20 raw English strings + English date formatting on what is a visitor-facing SEO entry point for /it and /es.

Fix:
1. Add keys under "trips.template" namespace in messages/en/trips.json, messages/it/trips.json, messages/es/trips.json. Mirror the existing trips.* structure.
2. Wire useTranslations('trips.template') into the client component. Replace every raw English string with t('key').
3. Date formatting: use lib/datetime/format.ts formatDateRange(start, end, locale) — the function already accepts a locale param. useLocale() from next-intl to pull current locale.
4. Match the IT/ES translation quality used in messages/{it,es}/common.json for similar phrases (don't machine-translate — use the existing voice).

Run \`npx tsc --noEmit\` from ${REPO} before returning.`, {
    label: 'i18n:template-preview',
    schema: SCHEMA,
  }),

  () => agent(`${REPO_PIN}

TASK #148 — Localize SeasonalContextCard (10+ EN strings on wizard /it /es)

File: components/trip/SeasonalContextCard.tsx

Problem: 10+ raw English strings on the primary conversion funnel (/[locale]/trips/new). Visible English mid-funnel on /it and /es.

Fix:
1. Add keys under "trips.seasonalContext" namespace in messages/{en,it,es}/trips.json.
2. Wire useTranslations('trips.seasonalContext') + useLocale into the component.
3. Replace every raw string with t('key'). Where strings include weather/temperature data, use the t() ICU MessageFormat syntax for interpolation (existing pattern in the codebase).
4. Mirror IT/ES tone/voice from sibling translated components (SeasonalContextCard's siblings in components/trip/ should provide reference quality).

Run \`npx tsc --noEmit\` from ${REPO} before returning.`, {
    label: 'i18n:seasonal-context',
    schema: SCHEMA,
  }),

  () => agent(`${REPO_PIN}

TASK #158 — Localize remaining strings in OngoingTripView

File: components/trip/OngoingTripView.tsx (lines 27, 293, 295, 302, 363, 365, 437, 485)

Problem: ~8 remaining raw English strings (the first pass from cycle 4 only caught 5). On /it /es trip viewers see English mid-engagement.

Fix:
1. Audit ALL 8 line numbers above plus any additional raw EN strings you spot in the same file. Add keys to messages/{en,it,es}/trips.json under "trips.ongoing.*" (the namespace already exists from prior work — extend it).
2. Wire t('ongoing.key') via useTranslations('trips'). useLocale is already imported per cycle's earlier pass.
3. Don't refactor — keep edits surgical, only converting strings to t() calls.

Run \`npx tsc --noEmit\` from ${REPO} before returning.`, {
    label: 'i18n:ongoing-trip',
    schema: SCHEMA,
  }),

  () => agent(`${REPO_PIN}

TASK #163 + #164 — Localize EngagementBar and TripCard on /explore

Files:
- components/explore/EngagementBar.tsx
- components/explore/TripCard.tsx

Problem: visitor-facing on /it/explore and /es/explore — both components leak English on a conversion-critical localized surface.

Fix:
1. Add keys under "explore.engagement" + "explore.card" namespaces in messages/{en,it,es}/common.json. NOTE: the existing namespace for explore is "common.share.explore" — extend that nested structure or create a sibling "common.explore.engagement" / "common.explore.card", following whichever pattern is already used by sibling explore components.
2. Wire useTranslations through that namespace.
3. TripCard's day count formatting: use {count} ICU plural syntax (en: "one {# day} other {# days}", it/es appropriately). Reuse common.days if it already exists; otherwise add.
4. Mirror tone from existing IT/ES translations in common.json's share.explore.* block.

Run \`npx tsc --noEmit\` from ${REPO} before returning.`, {
    label: 'i18n:explore',
    schema: SCHEMA,
  }),
])

log(`Phase 3 done. ${phase3.filter(r => r?.tsc_status === 'PASS').length}/4 PASS`)

// ─────────────────────────────────────────────────────────────────────────────
phase('Phase 4: Mobile/Capacitor')

const phase4 = await parallel([
  () => agent(`${REPO_PIN}

TASK #149 — Add pb-safe to StickyBlogCta inner panel

File: components/blog/StickyBlogCta.tsx (or whatever the sticky CTA component is called; grep for "StickyBlogCta")

Problem: iPhone home-indicator overlaps the CTA tap target on Capacitor wrap. The blog post CTA is the only conversion path on blog posts.

Fix: add Tailwind utility \`pb-safe\` to the INNER panel (not the outer wrapper — putting it on the outer wrapper leaves a transparent gap between content and the safe area). \`pb-safe\` is defined in app/globals.css around L626.

This is a 1-line change. Don't refactor anything else.

Run \`npx tsc --noEmit\` from ${REPO} before returning.`, {
    label: 'mobile:sticky-blog-cta',
    schema: SCHEMA,
  }),

  () => agent(`${REPO_PIN}

TASK #154 / #157 / #162 / #168 — VotingBottomSheet pb-safe + dvh

File: components/collaboration/proposals/VotingBottomSheet.tsx (around lines 271, 316, 366, 379)

Problem: Vote/Close CTAs clip under iPhone home indicator; \`vh\` jumps when iOS URL bar collapses/expands. Capacitor wrap launch blocker.

Fix:
1. Add \`pb-safe\` to the inner panel of the bottom sheet (the actual scrollable/button-containing div, not the backdrop).
2. Replace \`h-screen\` / \`vh\` units with \`dvh\` (dynamic viewport height) where they appear on the sheet — \`min-h-[100dvh]\` or \`h-[100dvh]\` depending on the existing pattern. NOTE: Tailwind v4 supports dvh natively as a length unit — write as \`h-dvh\` if the utility exists in the codebase, or fall back to the arbitrary-value syntax \`h-[100dvh]\`.
3. \`pb-safe\` is already defined in app/globals.css L626.

Match the 16 sibling components in components/ that already use this pattern (grep for "pb-safe" to find them).

Run \`npx tsc --noEmit\` from ${REPO} before returning.`, {
    label: 'mobile:voting-bottom-sheet',
    schema: SCHEMA,
  }),
])

log(`Phase 4 done. ${phase4.filter(r => r?.tsc_status === 'PASS').length}/2 PASS`)

// ─────────────────────────────────────────────────────────────────────────────
phase('Phase 5: Observability')

const phase5 = await parallel([
  () => agent(`${REPO_PIN}

TASK #150 — Add logging + Sentry to swallowed catches in usage-limits/check.ts (referral + early-access only)

File: lib/usage-limits/check.ts

Problem: silent try/catch blocks around the referral bonus and early-access custom limits paths swallow errors. The synthesizer downgraded severity (the outer checkUsageLimit is being hardened in phase 1, task #151) — the real harm here is silent loss of referral bonuses + early-access custom limits with zero visibility.

Fix:
1. Locate the catch blocks specific to referral-bonus resolution and early-access custom-limit resolution.
2. In each catch, add console.error('[usage-limits] referral bonus resolution failed', err) (or analogous for early-access).
3. Also call Sentry.captureException(err, { tags: { source: 'usage-limits', subsystem: 'referral' | 'early-access' }, level: 'warning' }).
4. KEEP the fail-open default — don't change behavior. Just add observability.
5. IMPORTANT: do NOT touch the catches around amadeus calls — those are correct as silent (per the synthesizer's note).
6. COORDINATION: Phase 1's task #151 agent is also editing this file. Read the file FRESH at the start of your edit. If phase 1's changes are already present, layer on top of them. If not, your changes should be additive and non-conflicting.

Run \`npx tsc --noEmit\` from ${REPO} before returning.`, {
    label: 'observability:usage-limits',
    schema: SCHEMA,
  }),
])

log(`Phase 5 done. ${phase5.filter(r => r?.tsc_status === 'PASS').length}/1 PASS`)

// ─────────────────────────────────────────────────────────────────────────────
phase('Phase 6: Verify')

const verify = await agent(`${REPO_PIN}

You are the FINAL VERIFIER. Do not edit any code. Run these commands from ${REPO} and report results:

1. \`npx tsc --noEmit\` — must exit 0
2. \`npm run build\` — must exit 0, capture the route summary (look for the First Load JS column for / and /trips/new specifically, and report any unexpected size changes)
3. \`git status --short\` — list every modified file
4. \`git diff --stat\` — line counts per file

Return a structured report with these exact keys:
- tsc: "PASS" | "FAIL" + error if FAIL
- build: "PASS" | "FAIL" + error if FAIL
- bundle_changes: { route_path: first_load_kb_or_unknown }  // for / and /trips/new at minimum
- modified_files: string[]
- diff_stat_summary: "X files changed, Y insertions, Z deletions"
- ready_to_commit: boolean
- blockers: string[]  // empty if ready

Do NOT commit. Do NOT push. Verifier only.`, {
  label: 'verify:tsc+build',
  schema: {
    type: 'object',
    required: ['tsc', 'build', 'modified_files', 'ready_to_commit'],
    properties: {
      tsc: { enum: ['PASS', 'FAIL'] },
      tsc_error: { type: 'string' },
      build: { enum: ['PASS', 'FAIL'] },
      build_error: { type: 'string' },
      bundle_changes: { type: 'object', additionalProperties: { type: 'string' } },
      modified_files: { type: 'array', items: { type: 'string' } },
      diff_stat_summary: { type: 'string' },
      ready_to_commit: { type: 'boolean' },
      blockers: { type: 'array', items: { type: 'string' } },
    },
  },
})

return {
  phase1_results: phase1,
  phase2_results: phase2,
  phase3_results: phase3,
  phase4_results: phase4,
  phase5_results: phase5,
  verify,
}
