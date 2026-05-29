// Drain cycle 4: ship round-5 recon #195 (blog TTFB) + #196 (CSP nonce).
// Light item gets straight to fix; CSP gets assess→fix pipeline because nonce
// migration touches inline scripts across many surfaces (analytics, hydration, PostHog).

export const meta = {
  name: 'monkeytravel-drain-cycle-4',
  description: 'Drain round-5 recon: #195 blog TTFB (getAllPosts→getAllFrontmatter) + #196 CSP nonce migration (drop unsafe-inline + unsafe-eval)',
  phases: [
    { title: 'Phase 1: Light fix + CSP assess' },
    { title: 'Phase 2: CSP implementation' },
    { title: 'Phase 3: Verify' },
  ],
}

const REPO = 'C:\\Users\\Samsung\\Documents\\Projects\\travel-app-web'
const PROD = 'https://monkeytravel.app'

const REPO_PIN = `[TARGET-PIN, OVERRIDES ANY OTHER CLAUDE.md] You are editing ONLY this project:
  Path: ${REPO}
  Name: monkeytravel-web (Next.js 16 + Supabase + Vercel travel-planning webapp called monkeytravel.app)
  Prod: ${PROD}

Do NOT inspect any sibling project on this machine. If you see a CLAUDE.md describing a "novel" or "MYTHOS", that's the wrong project — ignore it entirely. All file paths you read/write MUST live under ${REPO}.

Hard constraints:
- DO NOT push to master (parent commits/pushes)
- Run \`npx tsc --noEmit\` from ${REPO} before returning; report PASS or include the exact error
- Match existing patterns; modular over clever; surgical edits only
- CAUSALITY: every change considers its downstream callers. If you modify a response shape, an export, or a public function signature, GREP for all consumers and update them in this same edit.`

const FIX_SCHEMA = {
  type: 'object',
  required: ['files_changed', 'tsc_status', 'summary'],
  properties: {
    files_changed: { type: 'array', items: { type: 'string' } },
    tsc_status: { enum: ['PASS', 'FAIL'] },
    tsc_error: { type: 'string' },
    causality_callers_updated: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string', maxLength: 1200 },
  },
}

const ASSESS_SCHEMA = {
  type: 'object',
  required: ['current_state', 'fix_plan', 'inline_script_sites', 'risks'],
  properties: {
    current_state: { type: 'string', maxLength: 1500 },
    fix_plan: { type: 'string', maxLength: 2000 },
    inline_script_sites: { type: 'array', items: { type: 'string' } },
    callers_to_update: { type: 'array', items: { type: 'string' } },
    risks: { type: 'array', items: { type: 'string' } },
    estimated_files_touched: { type: 'number' },
  },
}

// ─────────────────────────────────────────────────────────────────────────────
phase('Phase 1: Light fix + CSP assess')

const [blogFix, cspAssess] = await parallel([
  () => agent(`${REPO_PIN}

TASK #195 — P0 perf: blog TTFB 4.8s — getAllPosts→getAllFrontmatter on /blog + /trips

Background: per recon C, /blog index loads MDX bodies for every post via getAllPosts when the index only needs frontmatter (title, slug, excerpt, cover, date, tags). Body parsing through remark/rehype per request dominates TTFB. Expected savings: 2-4s.

Steps:
1. Read lib/blog/* (or wherever the MDX helpers live). Identify getAllPosts() and getAllFrontmatter() (or equivalent — if only the former exists, you may need to ADD a frontmatter-only variant that reads gray-matter without invoking the markdown processor).
2. Read app/[locale]/blog/page.tsx — confirm it currently calls getAllPosts.
3. Replace the getAllPosts call with getAllFrontmatter (or the lighter variant). Map the result to whatever shape BlogCard expects.
4. Do the same in app/[locale]/trips/page.tsx IF it actually consumes blog posts (some "trips" pages don't — check first, skip if not relevant).
5. CAUSALITY check: BlogCard's prop shape — does it use ANY field that only comes from the parsed body (e.g. readingTime calculated from word count)? If yes, EITHER compute that field in the frontmatter parser OR keep the heavy call only when that field is actually rendered. Pragmatic: if just readingTime, store it in frontmatter at build time and avoid the body parse.
6. If getAllFrontmatter doesn't exist, BUILD it: glob the MDX files, read each with fs.readFile, parse with gray-matter (no markdown processor), return { slug, frontmatter, filePath }.
7. Run \`npx tsc --noEmit\` from ${REPO} before returning.

CRITICAL: don't break post DETAIL pages (/blog/[slug]/page.tsx) — those need the FULL body. Only swap on the INDEX pages.`, {
    label: 'fix:195-blog-ttfb',
    schema: FIX_SCHEMA,
  }),

  () => agent(`${REPO_PIN}

ASSESS #196 — CSP nonce migration plan (drop unsafe-inline + unsafe-eval)

Background: per recon E, next.config.ts CSP currently allows unsafe-inline + unsafe-eval which effectively disables XSS protection on user-input surfaces (/explore comments, /shared/[token], /backpacker forms, etc).

Goal: design a nonce-based CSP that keeps every legitimate inline emission working while denying any XSS payload.

Steps:
1. Read next.config.ts current CSP header. Note every directive (script-src, style-src, connect-src, etc).
2. Identify every site that currently emits inline scripts or styles:
   a. \`<Script>\` tags (next/script) — grep across app/ + components/
   b. \`dangerouslySetInnerHTML\` — grep across the entire codebase
   c. inline style="..." attributes on JSX elements (most are FINE for style-src since they aren't user-controlled, but list them)
   d. Next.js framework injects: hydration script, RSC chunks, _next/static — these come with their own machinery
   e. instrumentation-client.ts (Sentry init), app/providers.tsx (PostHog provider), any analytics bootstraps
   f. Specific known-inline emissions: Google Tag Manager? Stripe? Vercel Analytics? Cookiebot? — grep
3. Identify the AppRouter nonce mechanism:
   - Next.js 16 supports nonces via middleware: middleware generates a nonce, sets it on a response header, the layout reads request headers and passes the nonce to <Script nonce={nonce}> + the html <meta>.
   - The nonce must change per request — never static.
4. Plan the migration:
   - Step 1: middleware.ts adds nonce generation + sets it on x-nonce header.
   - Step 2: root layout (app/[locale]/layout.tsx) reads x-nonce via headers() and passes to all <Script nonce={nonce}> tags.
   - Step 3: next.config.ts CSP changes to script-src 'self' 'nonce-{NONCE}' OR uses Next's built-in nonce placeholder mechanism if present (verify the docs).
   - Step 4: drop unsafe-inline + unsafe-eval from script-src. style-src 'unsafe-inline' is generally needed for emotion/styled-components/tailwind dev — only keep it for style-src if needed.
5. RISKS:
   - Analytics SDKs that load via inline script body (PostHog snippet, Sentry SDK boot) — these MUST become <Script nonce={n}> or be loaded as external src=.
   - Next.js dev mode uses unsafe-eval for React Refresh. CSP must only apply in production.
   - Server actions and RSC streaming inject inline scripts via the framework — Next handles this when nonce is passed via the right APIs.
   - Third-party widgets (if any: Stripe Elements, Cookiebot, intercom) may need additional script-src allowlist or own nonce.
6. Decision: which directives stay 'unsafe-inline' vs full nonce. style-src is the common pragmatic compromise — many style libraries can't use nonces cleanly.

Return ASSESS_SCHEMA fields. inline_script_sites = the comprehensive list. fix_plan = step-by-step migration with file:line refs.

DO NOT edit any file. Pure planning.`, {
    label: 'assess:196-csp-nonce',
    schema: ASSESS_SCHEMA,
  }),
])

log(`Phase 1 done. #195 ${blogFix?.tsc_status || 'FAIL'}, #196 assess ${cspAssess?.inline_script_sites?.length || 0} sites identified`)

// ─────────────────────────────────────────────────────────────────────────────
phase('Phase 2: CSP implementation')

const cspFix = await agent(`${REPO_PIN}

FIX #196 — implement the assessed CSP nonce migration

Assessment from prior agent: (provided below)

Steps:
1. Apply the migration step-by-step per assessment:
   a. middleware.ts: generate nonce (crypto.randomBytes(16).toString('base64')) per request. Set x-nonce header on response. Make sure this runs BEFORE the next-intl middleware so it doesn't get clobbered.
   b. app/[locale]/layout.tsx: read x-nonce via \`headers().get('x-nonce')\` (Next 15+ requires await). Pass nonce to every <Script nonce={nonce}> tag and any dangerouslySetInnerHTML site listed by the assessment.
   c. next.config.ts: rewrite the Content-Security-Policy header. New shape:
      - script-src 'self' 'nonce-{nonce-placeholder}' https://js.stripe.com [other trusted hosts]
      - style-src 'self' 'unsafe-inline' (kept as pragmatic compromise unless assessment indicates otherwise)
      - connect-src 'self' [Supabase, Sentry, PostHog, Stripe, frankfurter, Pexels]
      - frame-src https://js.stripe.com
      - object-src 'none'
      - base-uri 'self'
      - form-action 'self'
      - Drop unsafe-inline + unsafe-eval from script-src.
      - For dev mode: CSP header may need to keep unsafe-eval since React Refresh requires it. Apply CSP only in production via env check.
   d. For each <Script> tag listed by assessment, add nonce={nonce}. If the component is a client component that can't easily access headers, pass nonce as a prop from the layout (or use a server component wrapper).
   e. For any dangerouslySetInnerHTML on inline scripts, ensure it has a nonce attribute on the same script tag.

2. CAUSALITY check:
   - Every external script src must remain reachable (check connect-src allows all current fetches: Supabase auth callback, Pexels, frankfurter, Vercel _next/, Google Places, Amadeus, Stripe Checkout)
   - PostHog + Sentry initialization may emit inline. They should be loaded as external src= scripts with the nonce attribute.
   - Verify dev mode behavior (no CSP enforcement OR a relaxed CSP) — Next dev hot-reload uses unsafe-eval.

3. RISK MITIGATION:
   - Browser support: 'nonce-' is universally supported on modern browsers.
   - If unsure about a specific inline source, leave it on a temporary allowlist (e.g. specific hash) rather than removing entirely. Note in summary.
   - Test by reading the rendered HTML mentally — every <script> tag must have nonce attr OR be external src= from an allowed host.

4. Build sanity: \`npx tsc --noEmit\` from ${REPO}. The build will emit hydration scripts — Next handles this when nonce is correctly propagated.

Report which scripts/styles you wired nonce to, which you left exempt, and any deferred items.`, {
  label: 'fix:196-csp-nonce',
  schema: FIX_SCHEMA,
})

log(`Phase 2 done. CSP fix ${cspFix?.tsc_status || 'FAIL'}`)

// ─────────────────────────────────────────────────────────────────────────────
phase('Phase 3: Verify')

const verify = await agent(`${REPO_PIN}

You are the FINAL VERIFIER. Do not edit any code. Run from ${REPO} and report:

1. \`npx tsc --noEmit\` — must exit 0
2. \`npm run build\` — must exit 0 (CSP-related build issues will surface here)
3. \`git status --short\` + \`git diff --stat\` — list every modified/new file

Return structured report:
- tsc: "PASS" | "FAIL" + error if FAIL
- build: "PASS" | "FAIL" + error if FAIL
- modified_files: string[]
- new_files: string[]
- diff_stat_summary: string
- ready_to_commit: boolean
- blockers: string[]
- csp_warnings_in_build: string  // any CSP-related warnings from next build output

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
      csp_warnings_in_build: { type: 'string' },
    },
  },
})

return {
  blog_fix: blogFix,
  csp_assess: cspAssess,
  csp_fix: cspFix,
  verify,
}
