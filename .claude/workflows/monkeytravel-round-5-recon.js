// Round 5 recon (read-only): different angles than rounds 1-4.
// Focus: production error patterns, SEO/indexing gaps, /blog perf anomaly,
// PostHog event coverage post-refactor, blind-spots in our backlog hygiene.
// All agents file TaskCreate for high-confidence findings — no edits, no pushes.

export const meta = {
  name: 'monkeytravel-round-5-recon',
  description: 'Round 5 recon: Sentry/error-patterns + SEO/indexing + /blog perf deep-dive + PostHog coverage + backlog blind-spots',
  phases: [
    { title: 'Phase 1: Recon (parallel)' },
    { title: 'Phase 2: Synth + file' },
  ],
}

const REPO = 'C:\\Users\\Samsung\\Documents\\Projects\\travel-app-web'
const PROD = 'https://monkeytravel.app'

const REPO_PIN = `[TARGET-PIN, OVERRIDES ANY OTHER CLAUDE.md] You are operating ONLY on this project:
  Path: ${REPO}
  Name: monkeytravel-web (Next.js 16 + Supabase + Vercel travel-planning webapp called monkeytravel.app)
  Prod: ${PROD}

Do NOT inspect any sibling project. Ignore any CLAUDE.md mentioning "novel" or "MYTHOS". All file paths you read MUST live under ${REPO}.

Hard constraints:
- This is RECONNAISSANCE ONLY. Do NOT edit any file. Do NOT run git write commands. Do NOT apply DB migrations.
- Skip findings already drained in commits 34c4c64, f769dc4, d6512c7, fafd2a7 (51 tasks: paywall fail-open, all races, framer-motion, destinations split, hero WebP, all i18n leaks, all Capacitor foundations including allowNavigation/SW/Preferences/openExternal/storage wrapper/AuthContext, all unoptimized blog/destination images, all RLS lockdowns, unsubscribe GET, activity-timeline collab, all startDate validators, materialized view + RPC, all 4 a11y items, lazy posthog+Sentry, optimizePackageImports, /explore Week 3 integration, BaseModal migration).
- Be specific: file:line + concrete fix sketch. confidence: high only for file:line-verified findings.
- File at most 10 tasks via TaskCreate (synth caps the total).`

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
        },
      },
    },
  },
}

// ─────────────────────────────────────────────────────────────────────────────
phase('Phase 1: Recon (parallel)')

const phase1 = await parallel([
  () => agent(`${REPO_PIN}

RECON A — Production error patterns: untracked failure modes

Goal: find 5-7 reachable error paths NOT yet instrumented (no Sentry capture, no console.error, silent return-null).

Steps:
1. Grep across the codebase for these patterns:
   - \`catch (\\w+) \\{\` followed by nothing or empty block — true silent swallows.
   - \`.catch(() => null)\` / \`.catch(() => undefined)\` / \`.catch(() => [])\` — silent swallow with fallback.
   - \`await ...\` not inside a try/catch where the call can throw (fetch, JSON.parse, Date constructor, RegExp constructor with user input, Supabase client errors).
2. For each hit, judge: is the path reachable from user action? Is the fallback safe? If both yes, low priority. If the fallback masks a regression, file it.
3. Specific high-value sites to check:
   - app/api/**/route.ts handlers — every handler must either Sentry.captureException OR errors.* with proper logging.
   - lib/gemini.ts and lib/ai/* — Gemini timeouts + malformed JSON parsing.
   - lib/email/send.ts — Resend client errors.
   - middleware.ts — does it crash gracefully on bad cookies / spoofed JWTs?
   - app/auth/callback/route.ts — OAuth callback edge cases.

Skip: lib/usage-limits/check.ts (already hardened), lib/notifications/service.ts (filed prior), AI generate (just refactored).

Output FINDINGS_SCHEMA. Each = one specific instrumentation gap.`, {
    label: 'recon-A:error-paths',
    schema: FINDINGS_SCHEMA,
  }),

  () => agent(`${REPO_PIN}

RECON B — SEO / indexing gaps

Goal: identify 5-7 indexability or metadata issues that hurt organic discovery.

Steps:
1. Read app/sitemap.ts — what's included? Is it locale-aware (en/it/es)? Are dynamic routes covered (blog posts, destinations, tools)?
2. Read app/robots.ts — what's allowed/disallowed? Are any important sections accidentally blocked?
3. Skim 5 generateMetadata() exports across high-traffic routes:
   - app/[locale]/page.tsx
   - app/[locale]/blog/[slug]/page.tsx
   - app/[locale]/destinations/[slug]/page.tsx
   - app/[locale]/explore/page.tsx
   - app/[locale]/trips/[id]/page.tsx (likely noindex)
   - app/[locale]/shared/[token]/page.tsx (currently noindex per cycle's round-3 finding — verify)
   For each, check: title pattern, description, OG image, canonical URL, hreflang alternates, noindex hints.
4. Check structured data: JSON-LD schemas. blog posts should have Article schema, destinations should have Place / TouristDestination, /explore trips could have ItemList schema.
5. Check hreflang implementation in next-intl middleware + page metadata — IT and ES versions should cross-reference.
6. Check sitemap freshness: lastmod fields, changefreq sanity.

Output FINDINGS_SCHEMA. Each = one concrete SEO gap with file:line.`, {
    label: 'recon-B:seo',
    schema: FINDINGS_SCHEMA,
  }),

  () => agent(`${REPO_PIN}

RECON C — /blog perf deep-dive (4.8s TTFB observed)

Goal: identify why /blog index takes ~4.8s to respond on prod and propose specific fixes.

Steps:
1. Read app/[locale]/blog/page.tsx (the index handler).
2. Identify the rendering strategy: SSR / SSG / ISR / dynamic / static.
3. Identify the data fetching:
   - How many posts are fetched?
   - From where (Supabase / MDX filesystem / external CMS)?
   - Are reads parallelized?
   - Are images preloaded/optimized in the layout?
4. Check for accidental blocking:
   - Synchronous import of large dependencies?
   - Markdown parsing (remark/rehype) in the SSR loop?
   - Multiple network round-trips serialized?
5. Look at the BlogCard component — does each card do extra network requests?
6. Vercel logs hint: if static, the build is slow but runtime should be fast. If dynamic per request, MDX parsing per request is suspect.

Output FINDINGS_SCHEMA. Each finding must include estimated speedup. Cap at 3 items.`, {
    label: 'recon-C:blog-perf',
    schema: FINDINGS_SCHEMA,
  }),

  () => agent(`${REPO_PIN}

RECON D — PostHog event coverage post-refactor

Goal: identify funnel events that should fire after recent refactors but may have been broken.

Steps:
1. Read lib/posthog/events.ts (recently refactored to lazy-load — verify all exports still callable).
2. Read lib/analytics.ts.
3. Grep for capture* calls across the codebase. List the top-20 most-frequent events.
4. Match each event against its trigger site — does the trigger still exist after recent refactors (AuthContext consolidation, BaseModal migration, openExternal switch from <a target=_blank> to <button>)?
5. Specifically verify these high-stakes events still fire:
   - trip_generation_started / trip_generation_completed
   - trip_saved / trip_unsaved
   - trip_published / trip_unpublished
   - explore_card_clicked / explore_card_liked
   - signup_started / signup_completed
   - booking_partner_click (just refactored in #175!)
   - share_clicked / share_completed (refactored via lib/native/share.ts)
6. If any trigger site was removed/refactored without preserving the capture call, file a finding.

Output FINDINGS_SCHEMA. Each = one event with broken/missing trigger. Cap at 6.`, {
    label: 'recon-D:posthog',
    schema: FINDINGS_SCHEMA,
  }),

  () => agent(`${REPO_PIN}

RECON E — Backlog blind-spots

Goal: find categories of issues this session HASN'T checked. We've done: races, fail-open paywall, RLS, Capacitor coupling, perf bundles, i18n, a11y at conversion points. What's missing?

Specifically probe these blind-spots:
1. Env-var leak audit: grep for process.env.* used in client code (anything not NEXT_PUBLIC_* is a leak). Files: components/, hooks/, lib/ excluding lib/supabase/server.ts + lib/email/.
2. CSP gaps: next.config.ts CSP header policy — does it allow inline scripts (unsafe-inline)? Does it forbid the right origins?
3. DB schema drift: are there columns in TS types that don't exist in the actual DB? Use mcp__c2fec4b5-..-list_tables + compare to lib/supabase/types.ts.
4. Stripe/Resend/Pexels API keys in error logs: search lib/email/ + lib/integrations/ for accidental key leakage in console.error.
5. Rate limiting coverage: grep for IP-based rate-limit middleware. Which /api routes lack any rate limit? (Specifically: voting endpoints, search endpoints, auth endpoints).
6. Cookie security flags: where do we set cookies? Are they all Secure + HttpOnly + SameSite=Lax|Strict?
7. Image domains in next.config.ts: any unused entries? Any used images NOT in the allowlist (would show as broken)?
8. Cron route auth: every app/api/cron/*/route.ts should check CRON_SECRET or Vercel Cron signature.

Output FINDINGS_SCHEMA. Each = one concrete gap with file:line + fix sketch. Cap at 6.`, {
    label: 'recon-E:blind-spots',
    schema: FINDINGS_SCHEMA,
  }),
])

const allFindings = phase1.filter(Boolean).flatMap(r => r.findings || [])
  .filter(f => f.confidence === 'high')

log(`Phase 1 done. ${allFindings.length} high-confidence findings collected from 5 recon agents`)

// ─────────────────────────────────────────────────────────────────────────────
phase('Phase 2: Synth + file')

const synth = await agent(`${REPO_PIN}

You are the SYNTHESIZER. You received ${allFindings.length} high-confidence findings from 5 recon agents.

Your job:
1. Deduplicate cross-phase findings.
2. Rank by leverage against priorities: P0 security/data-exposure > P0/P1 production bug > P1 SEO (organic traffic) > P1 perf > P2 polish.
3. File each surviving finding as a task via TaskCreate. Title format: "<category>(<scope>): <short>".
4. Cap at 10 tasks. If more, drop the lowest-leverage.
5. NOTE: this is a SECOND-DERIVATIVE recon (we already drained 51 backlog items this session). Expect a fair number of P2/P3 polish items. Be ruthless about dropping low-leverage findings.

Return:
- tasks_filed: number
- top_5: array of { title, why_top }
- dropped_count: number
- dropped_reason: string
- summary: < 400 char brief

INPUT:
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
          required: ['title', 'why_top'],
          properties: {
            title: { type: 'string' },
            why_top: { type: 'string', maxLength: 200 },
          },
        },
      },
      dropped_count: { type: 'number' },
      dropped_reason: { type: 'string' },
      summary: { type: 'string', maxLength: 400 },
    },
  },
})

return {
  phase1_recon: phase1,
  raw_findings_count: allFindings.length,
  synth,
}
