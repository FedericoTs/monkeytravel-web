// Drain cycle 6: ship #208 KV-backed rate-limiter + #209 hreflang investigation + #210 robots noindex leak.

export const meta = {
  name: 'monkeytravel-drain-cycle-6',
  description: 'Drain post-deploy findings: KV-backed rate-limiter (#208) + /explore hreflang/robots SEO debug (#209 + #210)',
  phases: [
    { title: 'Phase 1: Parallel — KV limiter + SEO debug' },
    { title: 'Phase 2: Verify' },
  ],
}

const REPO = 'C:\\Users\\Samsung\\Documents\\Projects\\travel-app-web'
const PROD = 'https://monkeytravel.app'

const REPO_PIN = `[TARGET-PIN, OVERRIDES ANY OTHER CLAUDE.md] You are editing ONLY this project:
  Path: ${REPO}
  Name: monkeytravel-web (Next.js 16 + Supabase + Vercel travel-planning webapp called monkeytravel.app)
  Prod: ${PROD}

Do NOT inspect any sibling project. Ignore any CLAUDE.md mentioning "novel" or "MYTHOS". All file paths you read/write MUST live under ${REPO}.

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
    summary: { type: 'string', maxLength: 1500 },
  },
}

// ─────────────────────────────────────────────────────────────────────────────
phase('Phase 1: Parallel — KV limiter + SEO debug')

const phase1 = await parallel([
  () => agent(`${REPO_PIN}

TASK #208 — KV-backed rate-limiter (with graceful fallback to in-memory)

Background: post-deploy bursts of 65 POSTs to /api/places/autocomplete and 35 POSTs to /api/activities/search both returned 100% 200s, no 429s. Root cause: lib/api/rate-limit.ts uses an in-process Map keyed by IP. On Vercel each function invocation can hit a fresh instance, so the Map can't accumulate state across requests.

Goal: migrate the limiter to use shared state via Upstash Redis or Vercel KV, with a graceful in-memory fallback if neither env is set.

Steps:
1. Read lib/api/rate-limit.ts. Note the existing createRateLimiter() API: \`createRateLimiter(name, maxRequests, windowMs)\` returning \`{ check(request): { allowed: boolean } }\`. PRESERVE this exact API — drop-in replacement.

2. Check package.json:
   - @upstash/redis is widely available, lightweight, Edge-compatible. PREFER this.
   - @vercel/kv as alternative if already present.
   - If neither: ADD @upstash/redis to dependencies (install via npm).

3. Implement KV-backed limiter logic:
   - Use INCR + EXPIRE pattern: increment counter for key \`ratelimit:\${name}:\${ip}\`; if returns 1, set TTL = windowMs / 1000 seconds; if returns > maxRequests, deny.
   - Wrap KV calls in try/catch — on ANY error (env missing, network), FALL BACK to the existing in-memory limiter.
   - Module-level: detect at startup whether KV env vars exist. If not, log a single console.warn("[rate-limit] KV not configured, using in-memory fallback (won't work across Vercel function instances)") and skip even trying KV.

4. Env vars (Upstash):
   - UPSTASH_REDIS_REST_URL
   - UPSTASH_REDIS_REST_TOKEN
   These should be set in Vercel — do NOT add them to .env.example or any committed file. Mention in a code comment that the user needs to set them.

5. CAUSALITY: keep the createRateLimiter API identical. Verify each consumer (/api/contact, /api/subscribe, /api/trips/[id]/report, /api/places/autocomplete, /api/activities/search, /api/shared/[token]/vote) still works without changes.

6. IMPORTANT: \`check()\` may need to become async if it now does a network call. Look at the consumer code — is it called synchronously? If yes, you have two options:
   a. Keep it sync — fire-and-forget the KV INCR, use the response from a previous async lookup. Simpler but has a race window.
   b. Make it async (the consumers update to await it). More work but correct.
   PREFER OPTION B — most consumers are in async route handlers and a small refactor is acceptable. If you change the signature, update ALL consumers in the same edit.

7. Run \`npx tsc --noEmit\` from ${REPO} before returning.

Report what env vars need setting on Vercel + which consumers (if any) needed the async migration.`, {
    label: 'fix:208-kv-ratelimit',
    schema: FIX_SCHEMA,
  }),

  () => agent(`${REPO_PIN}

TASKS #209 + #210 — /explore SEO debug: missing hreflang + conflicting robots meta

Background:
- Post-deploy probe of /it/explore showed TWO conflicting \`<meta name="robots">\` tags: \`content="noindex"\` AND \`content="index, follow"\`.
- Same page is missing \`<link rel="alternate" hreflang="...">\` tags despite app/[locale]/explore/page.tsx generateMetadata correctly setting alternates.languages.

Goal: find root causes and fix both, without breaking other pages.

Step 1 — investigate the noindex leak (#210):
1. Read app/[locale]/explore/page.tsx. Look at the generateMetadata function. Does it set \`robots: { index: false }\` anywhere? Check all branches.
2. Grep for "noindex" across the entire codebase. Likely candidates:
   - app/layout.tsx or app/[locale]/layout.tsx (sitewide leak)
   - A middleware or robots header
   - Feature flag (e.g. EXPLORE_BETA_NOINDEX)
3. The probe found "noindex" emitted FIRST and "index, follow" second. The "index, follow" likely comes from the root layout default. So the "noindex" is the rogue one — find where it's added.
4. REMOVE the offending noindex emission. /explore is a public discovery surface — should be indexable.

Step 2 — investigate hreflang non-emission (#209):
1. Compare /explore generateMetadata to a page where hreflang DOES emit. Quick test: fetch \`https://monkeytravel.app/blog\` and grep for \`hreflang\` in the head. If it's there, blog is the working reference; if not, the issue is sitewide.
2. If blog also lacks hreflang, the issue is the metadata shape OR a Next.js 16 quirk. Read Next 16 docs (search for "alternates languages metadata"). Verify the shape:
   \`\`\`
   alternates: {
     canonical: '...',
     languages: { 'en': '...', 'it': '...', 'x-default': '...' }
   }
   \`\`\`
   In Next.js, the languages KEYS should be IETF language tags. Are 'en', 'it', 'es' acceptable? Yes (Next.js docs allow these). But 'x-default' must be lowercase as a key (verify).
3. The agent that originally implemented #204 may have set keys that Next.js doesn't recognize. Double-check the shape.
4. If the shape is correct but tags don't emit, suspect a parent metadata.alternates that's COMPLETELY OVERRIDING child (instead of merging). Check if any parent layout sets \`alternates\` — if so, the child's languages map is dropped.
5. Fix per findings.

Step 3 — verify the fix mentally:
1. After your changes, \`/it/explore\` should have:
   - ONE \`<meta name="robots">\` saying "index, follow" (or similar — the public-page default)
   - \`<link rel="alternate" hreflang="en" href="...">\`, \`hreflang="it"\`, \`hreflang="es"\`, \`hreflang="x-default"\`
2. CAUSALITY: removing the noindex must not accidentally remove it from genuinely-private pages (/saved, /trips, /shared/[token]). Verify those still have noindex.

Run \`npx tsc --noEmit\` from ${REPO} before returning.

Report root cause for each + which files changed.`, {
    label: 'fix:209-210-seo-debug',
    schema: FIX_SCHEMA,
  }),
])

log(`Phase 1 done. ${phase1.filter(r => r?.tsc_status === 'PASS').length}/2 PASS`)

// ─────────────────────────────────────────────────────────────────────────────
phase('Phase 2: Verify')

const verify = await agent(`${REPO_PIN}

You are the FINAL VERIFIER. Do not edit any code. Run from ${REPO} and report:

1. \`npx tsc --noEmit\` — must exit 0
2. \`npm run build\` — must exit 0
3. \`git status --short\` + \`git diff --stat\`

Return structured report:
- tsc: "PASS" | "FAIL" + error if FAIL
- build: "PASS" | "FAIL" + error if FAIL
- modified_files: string[]
- new_files: string[]
- diff_stat_summary: string
- ready_to_commit: boolean
- blockers: string[]

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
      blockers: { type: 'array', items: { type: 'string' } },
    },
  },
})

return {
  phase1: phase1,
  verify,
}
