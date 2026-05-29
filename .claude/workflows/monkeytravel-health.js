/**
 * monkeytravel-health — periodic health + opportunity workflow
 *
 * RUNS: every hour via CronCreate (`<<autonomous-loop>>` sentinel).
 *
 * MISSION: every cycle, find one or two specific, high-leverage things
 * to either fix immediately (if safe) or surface as a tracked task.
 * Bias toward bug catches + Vercel perf wins + mobile-readiness gaps —
 * those are the user's stated priorities. Do NOT push to master from
 * inside this workflow; only file findings or open PRs after a fix.
 *
 * BUDGET DISCIPLINE: this fires hourly so we cannot afford the full
 * fan-out every time. The workflow self-tiers based on `budget.total`:
 *   - lightweight tier  (≤ 30k):  Sentry pulse + Vercel deploy state
 *                                  + image-rot probe + one short audit
 *   - standard tier     (30-150k): adds a parallel codebase audit
 *                                  + i18n drift detection + bundle size
 *   - deep tier         (>150k):  adds market research + accessibility
 *                                  + adversarial verify of findings
 *
 * SHAPE: pipeline() so each finding can move through verify→act
 * without barriers. parallel() only used for the initial fan-out
 * inside discover() where we genuinely need all dimensions before
 * deciding what to dig into.
 */

export const meta = {
  name: 'monkeytravel-health',
  description: 'Periodic codebase + Vercel + market health sweep for monkeytravel.app',
  whenToUse: 'Triggered hourly by the autonomous-loop cron. Also runnable manually for a one-off audit.',
  phases: [
    { title: 'Discover',  detail: 'Parallel pulse + audit fan-out' },
    { title: 'Verify',    detail: 'Adversarial check of each finding' },
    { title: 'Synthesize', detail: 'Pick top items + open tasks / draft fixes' },
  ],
}

// ─── Tier resolution ─────────────────────────────────────────────────
const totalBudget = budget.total ?? 30_000
const tier =
  totalBudget > 150_000 ? 'deep'     :
  totalBudget >= 30_000 ? 'standard' :
                          'light'

log(`[health] tier=${tier} budget=${totalBudget}`)

// ─── Schemas ─────────────────────────────────────────────────────────
const FINDING = {
  type: 'object',
  required: ['title', 'severity', 'category', 'detail'],
  properties: {
    title:    { type: 'string', description: 'Single-sentence headline' },
    severity: { enum: ['p0', 'p1', 'p2'] },
    category: { enum: ['bug', 'perf', 'i18n', 'a11y', 'security', 'opportunity', 'tech-debt'] },
    detail:   { type: 'string', description: 'What & where, with file:line if applicable' },
    fixSketch:{ type: 'string', description: '1–3 line proposed fix path' },
    confidence:{ enum: ['low', 'medium', 'high'] },
  },
}
const REPORT = {
  type: 'object',
  required: ['findings'],
  properties: {
    findings: { type: 'array', items: FINDING },
    notes:    { type: 'string' },
  },
}
const VERDICT = {
  type: 'object',
  required: ['isReal', 'reasoning'],
  properties: {
    isReal:   { type: 'boolean' },
    reasoning:{ type: 'string' },
    correctedFix: { type: 'string' },
  },
}

const REPO = 'C:\\Users\\Samsung\\Documents\\Projects\\travel-app-web'
const PROD = 'https://monkeytravel.app'

// ─── Phase 1: Discover (parallel fan-out, tier-gated) ────────────────
phase('Discover')

const dimensions = [
  {
    key: 'health-pulse',
    always: true,
    prompt:
`You are the HEALTH PULSE dimension. Cheapest pass — should fire even on
the lightweight tier. Use Bash + WebFetch to check the following and
report only items that need action:

1. Vercel deploy state for the master branch — is the latest commit
   ${' '}deployed and serving (curl ${PROD} headers + check x-vercel-id)?
2. Spot-check 5 random Pexels URLs from
   ${REPO}\\app\\api\\images\\destination\\route.ts to detect any
   newly-404 image (data rot — same pattern that bit us on 2026-05-28).
3. Curl 3 critical paths (/, /trips/new, /api/explore/trips) and check
   they return 2xx + no MISSING_MESSAGE in serialized HTML.
4. Check Supabase: any rows in trips where created_at > 1 hour ago
   AND cover_image_url IS NULL (broken save path) using execute_sql.

Report findings under 250 words via schema. Only file P0/P1 things.`,
  },
  {
    key: 'code-audit',
    tier: ['standard', 'deep'],
    prompt:
`You are the CODE AUDIT dimension. Use Grep + Read + the Explore agent.

Hunt one specific anti-pattern that's likely to be silently shipping
bugs to users RIGHT NOW. Pick a category that hasn't been audited in
the last few runs, and dig into it specifically:

- Cached-image race (still <img onLoad> + useState(false) without ref check)
- Hardcoded "en-US" or "August"-style English month names
- Silent error swallowing (try/catch with no log + no fallback)
- AbortController leaks (fetch() inside useEffect without abort on unmount)
- N+1 Supabase calls inside loops
- Hardcoded production URLs in env fallbacks
- TODO/FIXME tagged with bug/HACK that's >30 days old

Report concrete file:line findings. Skip nits — only flag things you'd
ship a fix for. Under 350 words.`,
  },
  {
    key: 'vercel-perf',
    tier: ['standard', 'deep'],
    prompt:
`You are the VERCEL PERF dimension. The user MUST keep optimizing
Vercel performance. Identify ONE concrete perf win this cycle.

Methods (pick the cheapest one with the highest signal):
- Read .next/build output stats if accessible (look for chunks >250kb,
  routes that ship more than they need)
- WebFetch ${PROD} + 2 inner pages with Lighthouse-style probes (size,
  TTFB, image dimensions wrong for viewport, no font-display swap)
- Grep for dynamic imports / barrel-file imports that prevent
  tree-shaking
- Check if any /api/ routes are calling LLM/AI APIs synchronously
  inside the page render path (huge cold-start cost)
- Look at the Image component usage for cover/hero images — are they
  using \`priority\`, \`sizes\`, the right \`unoptimized\` flag?

Report one specific fix that would shave >100ms TTFB or >50kb bundle.
Under 250 words.`,
  },
  {
    key: 'mobile-readiness',
    tier: ['standard', 'deep'],
    prompt:
`You are the MOBILE READINESS dimension. We are heading toward an
Airbnb/Booking-style native app (Capacitor wrap already in repo at
capacitor.config.ts). Each cycle, find ONE component or page that
isn't mobile-friendly enough — taps too small, text too thin, modal
that doesn't respect safe-area inset, layout that breaks under 360px
width, fixed elements that overlap with the iOS bottom bar, etc.

Method: Grep + Read for common anti-patterns (h-screen without dvh,
fixed bottom without env(safe-area-inset-bottom), w-{px} not w-{full},
text-xs without min-touch sizing, dialog without focus-trap on mobile).

Report ONE finding with the file:line and the specific tweak. Under
200 words.`,
  },
  {
    key: 'market-gap',
    tier: ['deep'],
    prompt:
`You are the MARKET GAP dimension. Use WebSearch + WebFetch.

We compete with Layla, Mindtrip, Roam Around, Wonderplan, Trip Planner
AI, plus the legacy big players (Booking, Airbnb, Expedia). The user
wants the PERFECT travel planner companion.

Identify ONE specific opportunity gap a competitor has recently shipped
or that the market is asking for (Reddit r/travel, Hacker News, X) that
we DON'T have and could ship in <2 weeks. Examples of what would
qualify: realtime weather-aware re-planning, offline mode, in-trip
expense splitting, AI translator overlay, "what's nearby right now",
group voting on hotels, etc.

Report ONE opportunity with:
- the competitor or signal you saw (URL)
- why it's leverage for us (one sentence)
- the smallest MVP scope (one paragraph)
- mobile readiness note (does it map to the upcoming Capacitor app?)

Under 350 words.`,
  },
  {
    key: 'i18n-drift',
    tier: ['standard', 'deep'],
    prompt:
`You are the i18N DRIFT dimension. We've shipped multiple i18n bundles
this week (commits 4c3e2a3, a5a9e1d, 7db5fd8 + round 4). Each round
caught new English strings on /it and /es.

Find any NEW hardcoded English strings introduced since the last audit.
Bias toward visitor-facing JSX text (not console.warn, not commented
code, not URLs/identifiers).

Method: Grep for common English signal words inside JSX (text >, '>"
followed by Latin-only words with 3+ letters), filter out files that
already have useTranslations imported.

Report file:line of suspects. Under 200 words. Empty findings is a
valid + likely result here.`,
  },
]

const enabled = dimensions.filter((d) => d.always || d.tier?.includes(tier))
log(`[health] running ${enabled.length} dimensions: ${enabled.map((d) => d.key).join(', ')}`)

// Pipeline: each dimension's report flows immediately to a per-finding
// verifier as soon as it returns. Saves wall-clock vs a barrier.
const verifiedFindings = await pipeline(
  enabled,
  (dim) =>
    agent(dim.prompt, { label: `discover:${dim.key}`, phase: 'Discover', schema: REPORT }),
  async (report) => {
    if (!report?.findings?.length) return []
    // Verify each finding adversarially before letting it through
    const verdicts = await parallel(
      report.findings.map((f) => () =>
        agent(
`Adversarial verifier. Default to refuted unless the finding is
clearly real + actionable.

Finding:
  title: ${f.title}
  severity: ${f.severity}
  category: ${f.category}
  detail: ${f.detail}
  fixSketch: ${f.fixSketch ?? '(none)'}

Tasks:
1. Is this a REAL issue that hurts users or measurably degrades
   the platform RIGHT NOW (not a theoretical purity concern)?
2. Is the fix sketch viable as written? If not, propose a corrected
   one in 1-3 lines.

Be strict — false positives waste our hourly cycle.`,
          { label: `verify:${f.title.slice(0, 28)}`, phase: 'Verify', schema: VERDICT },
        ),
      ),
    )
    return report.findings
      .map((f, i) => ({ ...f, verdict: verdicts[i] }))
      .filter((f) => f.verdict?.isReal)
  },
)

const all = verifiedFindings.flat().filter(Boolean)
log(`[health] ${all.length} verified findings`)

// ─── Phase 3: Synthesize ─────────────────────────────────────────────
phase('Synthesize')

if (!all.length) {
  return {
    tier,
    findingsCount: 0,
    message: 'No actionable findings this cycle. Nothing to do — everything healthy.',
  }
}

// Single synthesizer agent gets the deduplicated list, picks the top
// items, and decides per-item: open a TaskCreate, or write a brief.
const top = all
  .slice() // copy
  .sort((a, b) => {
    const sev = { p0: 0, p1: 1, p2: 2 }
    return sev[a.severity] - sev[b.severity]
  })
  .slice(0, tier === 'deep' ? 8 : tier === 'standard' ? 5 : 3)

const synthesis = await agent(
`You are the SYNTHESIZER. You have ${top.length} verified findings from
this cycle of the monkeytravel-health workflow. The user has stated
priorities:
  1. Bug fixes that hurt users RIGHT NOW
  2. Vercel performance gains
  3. Mobile readiness (Capacitor wrap going to native)
  4. Market gaps that can ship in <2 weeks

Findings (already verified as real):
${JSON.stringify(top, null, 2)}

Your job:
- Order by leverage given the priorities above
- For each item, decide: "open task" (call TaskCreate) OR "ready to fix
  now in a future session" (just describe in brief)
- For "open task" items, use the TaskCreate tool now with a tight,
  actionable subject + description that includes file:line if known
- Output a brief markdown summary (under 400 words total) the user can
  scan at a glance. Lead with the headline ("Found N items this cycle,
  opened M tasks, top item: X").

Do NOT make code changes. Do NOT push anything. This is reconnaissance
+ task-filing only.`,
  { label: 'synthesize', phase: 'Synthesize' },
)

return {
  tier,
  findingsCount: all.length,
  topItems: top.length,
  brief: synthesis,
}
