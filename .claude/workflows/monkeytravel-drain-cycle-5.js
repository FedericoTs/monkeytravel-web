// Drain cycle 5: ship all remaining round-5 recon items (10 tasks).
// Phase 1 (8 agents parallel): mechanical fixes with disjoint file sets.
// Phase 2 (2 agents sequential): #205 → #207 (both touch app/auth/callback/route.ts).
// Phase 3: verify.

export const meta = {
  name: 'monkeytravel-drain-cycle-5',
  description: 'Drain final 10 round-5 recon items: blog revalidate + JSON index, 3 rate-limits, robots i18n, /explore hreflang, email fail-closed, auth-callback errors, PostHog identify',
  phases: [
    { title: 'Phase 1: Parallel light + medium fixes' },
    { title: 'Phase 2: Auth-callback (sequential)' },
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

// ─────────────────────────────────────────────────────────────────────────────
phase('Phase 1: Parallel light + medium fixes')

const phase1 = await parallel([
  () => agent(`${REPO_PIN}

TASK #196 — /blog index missing revalidate (ISR)

Files:
- app/[locale]/blog/page.tsx
- app/[locale]/blog/tag/[tag]/page.tsx (if it lacks revalidate too)

Problem: page may render dynamically on every prod hit when ISR could cache for hours.

Fix:
1. Read app/[locale]/blog/page.tsx. Check for existing \`export const revalidate\` or \`dynamic\` directive.
2. Add \`export const revalidate = 3600\` (1 hour) at the top of /blog index. MDX content changes only on commits, so 1h is conservative.
3. Same for /blog/tag/[tag] if it doesn't have one.
4. SKIP /blog/[slug] detail pages if they already use generateStaticParams (they're SSG, no revalidate needed).
5. CAUSALITY: verify the page doesn't use cookies() or headers() — those force dynamic. If it does (e.g. for nonce after the CSP migration), the revalidate is ignored; in that case file a note.

Run \`npx tsc --noEmit\` from ${REPO}.`, {
    label: 'fix:196-blog-revalidate',
    schema: FIX_SCHEMA,
  }),

  () => agent(`${REPO_PIN}

TASK #197 — Build-time JSON index for MDX frontmatter

Goal: eliminate per-request fs.readFileSync + gray-matter parsing of every MDX file. Build a JSON index at build time + read from it at runtime.

Steps:
1. Read lib/blog/api.ts (or wherever getAllFrontmatter lives — the helper just used by cycle-4 #195).
2. Design:
   - Option A: Build a JSON file at \`lib/blog/.cache/frontmatter-index.json\` (generated at build time via a pre-build script run from package.json's \`prebuild\` script).
   - Option B: At runtime, cache the parsed result in-memory via a React cache() wrapper (still does fs but only once per server lifetime). Simpler, less invasive.
3. CHOOSE Option B if simpler — it gives 90% of the benefit (each Lambda/server instance parses once, not per request). Skip Option A unless Lambda cold-starts dominate.
4. Implementation Option B:
   - Wrap getAllFrontmatter in React's cache() helper: \`import { cache } from 'react'; export const getAllFrontmatter = cache((args) => { ...existing fs logic... })\`.
   - This memoizes across the SAME request and (with Next 15+) across server instances using the data cache.
   - Verify any module-level state isn't already preventing this from working.
5. If Option B is insufficient and Option A is needed: write \`scripts/build-blog-index.ts\` that runs at build time, glob/parses all MDX frontmatter, writes JSON to a stable path (e.g. \`lib/blog/.cache/frontmatter-index.json\`). Update getAllFrontmatter to read the JSON. Add the script to package.json prebuild.
6. CAUSALITY: getAllFrontmatter is used by the blog index + /trips page (from cycle-4) + possibly RSS feeds. Verify all callers still get the expected shape.

Run \`npx tsc --noEmit\` from ${REPO}.`, {
    label: 'fix:197-mdx-cache',
    schema: FIX_SCHEMA,
  }),

  () => agent(`${REPO_PIN}

TASK #200 — Places autocomplete: per-IP anon rate-limit

File: app/api/places/autocomplete/route.ts (or whichever file proxies Google Places Autocomplete — grep "places/autocomplete" or "places.googleapis")

Problem: unbounded Google Places Autocomplete calls at $0.00283/req open to all anon visitors. Easy DoS-on-credit-card.

Steps:
1. Grep for "createRateLimiter" in the codebase to confirm the helper exists. Read its API.
2. Wrap the route with:
   \`const limiter = createRateLimiter('places-autocomplete', 60, 60_000); // 60/min/IP\`
   At top of handler:
   \`const { allowed } = await limiter.check(request); if (!allowed) return errors.rateLimit('Too many searches');\`
3. For ANON callers (no auth header / user check failed), enforce the limit strictly. For authed callers, lift the limit or skip.
4. Verify other API rate-limited routes (e.g. /api/contact, /api/trips/[id]/report per existing code) to match the pattern.
5. CAUSALITY: DestinationAutocomplete consumes this. The 401 / 429 response shape must be handleable by the client — verify the client either retries gracefully or shows a polite "slow down" message.

Run \`npx tsc --noEmit\` from ${REPO}.`, {
    label: 'fix:200-places-ratelimit',
    schema: FIX_SCHEMA,
  }),

  () => agent(`${REPO_PIN}

TASK #201 — Activities search: rate-limit + force includeGoogle=false for anon

File: app/api/activities/search/route.ts (the one that uses the activity_index materialized view from cycle 3 #191)

Problem: includeGoogle=true fallback to Google Places Text Search at $0.032/req is open to anon callers. 11× higher per-request cost than autocomplete.

Steps:
1. Read the route. Locate the auth check + the includeGoogle parameter handling.
2. Force \`includeGoogle = !!user\` (or equivalent — only authed users can opt into Google fallback). This caps cost exposure to the user count, not the visitor count.
3. Add a rate-limit similar to task #200:
   \`const limiter = createRateLimiter('activity-search', 30, 60_000); // 30/min/IP\`
4. CAUSALITY: AddActivityButton calls this. Verify the UI handles the case where includeGoogle is silently dropped (local-only results, no Google fallback). Likely fine — the local MV has 444 rows of curated activities. Display behavior: same as before for the local match path.

Run \`npx tsc --noEmit\` from ${REPO}.`, {
    label: 'fix:201-activities-ratelimit',
    schema: FIX_SCHEMA,
  }),

  () => agent(`${REPO_PIN}

TASK #202 — Shared-vote endpoint: rate-limit cookie-reset abuse

File: app/api/shared/[token]/vote/route.ts (around lines 37-92)

Problem: POST mints a fresh nanoid(21) cookie when none present, so attacker can curl in a loop with no cookie and ballot-stuff. No IP rate-limit.

Steps:
1. Read the file. Note current vote logic.
2. Add IP rate-limit modeled on /api/trips/[id]/report:
   \`const voteLimiter = createRateLimiter('shared-vote', 20, 60_000); // 20 votes/min/IP\`
3. Additional defense: count anonymous_activity_votes rows where share_token=$token AND ip_hash=hash(ip) created in last hour; reject above N. (If IP hashing not already in schema, just rate-limit by IP via the existing limiter — the limiter keys on IP.)
4. Optionally: reject requests with no incoming cookie when the User-Agent appears to be curl/wget/etc — force the bootstrap endpoint flow.
5. CAUSALITY: legit voters with no cookie should still be able to vote ONCE. The rate-limit kicks in only after the 20th vote/min — well above honest usage. Don't break the flow for normal users.

Run \`npx tsc --noEmit\` from ${REPO}.`, {
    label: 'fix:202-vote-ratelimit',
    schema: FIX_SCHEMA,
  }),

  () => agent(`${REPO_PIN}

TASK #203 — Migrate robots.txt to app/robots.ts with locale-aware wildcards + page-level noindex

Files:
- app/robots.ts (NEW or update existing — check first)
- public/robots.txt (if existing static — verify it's not overriding)

Problem: per recon, robots.txt currently leaks locale-specific paths or lacks proper noindex hints for non-canonical pages.

Steps:
1. Read existing app/robots.ts if it exists, otherwise public/robots.txt.
2. Build a Next.js robots() function that:
   - Allows / (homepage), /blog, /destinations, /explore, /backpacker, /tools/*
   - Disallows /api/*, /auth/*, /admin/*, /saved (user-specific), /trips (user trips)
   - Disallows /shared/* (private trip shares — these are noindex per cycle-3 finding)
   - Disallows /unsubscribe, /invite/*, /reset-password
   - Locale-aware: wildcards work cross-locale (/en/*, /it/*, /es/*) — Next handles via segment patterns
3. Set sitemap pointing to /sitemap.xml.
4. Set host pointing to https://monkeytravel.app.
5. CAUSALITY: removal of /robots.txt static (if present) — confirm Next routes /robots.txt to the dynamic handler.

Run \`npx tsc --noEmit\` from ${REPO}.`, {
    label: 'fix:203-robots-i18n',
    schema: FIX_SCHEMA,
  }),

  () => agent(`${REPO_PIN}

TASK #204 — /explore hreflang map for IT/ES indexability

File: app/[locale]/explore/page.tsx

Problem: per recon, /explore lacks hreflang alternates linking en↔it↔es. Google can't deduplicate the localized pages without this.

Steps:
1. Read app/[locale]/explore/page.tsx. Find generateMetadata.
2. Look at a sibling that DOES have hreflang correctly (likely /blog/[slug] or homepage). Copy the alternates.languages pattern. Shape (with \${locale} as the route param interpolation):
   - canonical: '/\${locale}/explore'
   - languages: { 'en': '/en/explore', 'it': '/it/explore', 'es': '/es/explore', 'x-default': '/en/explore' }
3. Use absolute URLs (https://monkeytravel.app/...) if that's what siblings use; otherwise use relative paths and let Next resolve.
4. CAUSALITY: if there's a global metadata helper (e.g. lib/seo/metadata.ts), prefer extending IT rather than hardcoding here. Check first.

Run \`npx tsc --noEmit\` from ${REPO}.`, {
    label: 'fix:204-explore-hreflang',
    schema: FIX_SCHEMA,
  }),

  () => agent(`${REPO_PIN}

TASK #206 — email/send.ts: fail-closed on idempotency + suppression + log errors

File: lib/email/send.ts (lines 104, 122, 128, 154, 206, 219, 269, 276, 286 per recon)

Problem: 8 Supabase calls destructure only \`data\` and ignore \`error\`. Failures cause:
- idempotency read error → \`existing\` null → re-send duplicate
- suppression read error → may send to bounced/complained address
- email_log insert error → send still fires but no audit trail; final status UPDATE silently no-ops

Steps:
1. For EACH listed line range, destructure { data, error } instead of just { data }.
2. On idempotency + suppression read errors: log console.error + Sentry.captureException + FAIL CLOSED (return ok:false instead of risking duplicate/suppressed send).
3. On email_log INSERT failure: log + Sentry + SHOULD STILL SEND (don't block transactional email on logging failure), but mark SendOutcome.needsReconciliation=true so a reconciler can identify orphaned sends.
4. Use the lazy Sentry import pattern from lib/usage-limits/check.ts (don't pull @sentry/nextjs into module top-level).
5. CAUSALITY: SendOutcome shape change — if needsReconciliation is added, callers may want to react. Grep callers of sendEmail; if any explicitly destructure ok/error, verify the additive change doesn't break them.

Run \`npx tsc --noEmit\` from ${REPO}.`, {
    label: 'fix:206-email-failclosed',
    schema: FIX_SCHEMA,
  }),
])

log(`Phase 1 done. ${phase1.filter(r => r?.tsc_status === 'PASS').length}/8 PASS`)

// ─────────────────────────────────────────────────────────────────────────────
phase('Phase 2: Auth-callback (sequential)')

const fix205 = await agent(`${REPO_PIN}

TASK #205 — auth-callback: destructure + handle errors on users SELECT + OAuth upsert

File: app/auth/callback/route.ts (lines 64-69 SELECT, 153-187 upsert per recon)

Problem:
- Line 64-69 SELECT existing user profile destructures only \`data\` → on transient Supabase error, existingProfile is null → silently routes returning user into the NEW-USER fallback branch → user redirected to /trips/new instead of next= + login_count not bumped.
- Line 153-187 OAuth upsert has no error variable → if RLS or network fails, redirect proceeds with no users row → paywall, usage limits, notifications all break silently.

Steps:
1. Read app/auth/callback/route.ts.
2. SELECT path (line 64-69): destructure { data: existingProfile, error: selectError }. If selectError: console.error + Sentry.captureException(selectError, { tags: { source: 'auth-callback', step: 'select-existing-user', user_id: user.id } }) + DO NOT fall through to new-user branch. Instead redirect to /auth/login?error=profile_lookup_failed.
3. Upsert path (line 153-187): destructure { error: upsertError }. If upsertError: console.error + Sentry.captureException + redirect to /auth/login?error=profile_creation_failed instead of silently shipping a borked user into /trips/new.
4. CAUSALITY: the login page (/auth/login) must handle ?error= query params — verify it does. If not, add a small client-side toast or surface the error visibly. (If complex, file a follow-up task — don't block on the UX layer.)
5. Use lazy Sentry import (don't add @sentry/nextjs to module top).

Run \`npx tsc --noEmit\` from ${REPO}.`, {
  label: 'fix:205-auth-callback-errors',
  schema: FIX_SCHEMA,
})

const fix207 = await agent(`${REPO_PIN}

TASK #207 — PostHog: wire captureUserSignedUp + captureUserLoggedIn + identify() at all auth entry points

Background: per recon E, zero PostHog signup/login events + no anon→known identity stitching. Every funnel is broken until this lands.

Files to modify:
- app/auth/callback/route.ts (just edited by #205 — re-read fresh)
- app/[locale]/auth/signup/page.tsx (email signup, if exists — check)
- app/[locale]/auth/login/page.tsx (email login, if exists — check)
- components/auth/AuthProvider.tsx (cycle-2 context — may be a clean place to call identify() once on user-load)

Steps:
1. Read lib/posthog/events.ts (lazy-loaded per cycle-2 #179). Check for existing captureUserSignedUp / captureUserLoggedIn helpers. If absent, ADD them following the pattern of the other captureXxx exports.
2. ADD lib/posthog/identify.ts: identify(userId, properties: { email?, name?, signupMethod?, locale? }) — uses await getPosthog() then posthog.identify(userId, properties). Also expose aliasAnonToUser(userId) for anon→known stitching.
3. Wire on AUTH CALLBACK (OAuth):
   - NEW-USER branch: identify(user.id, { email, signupMethod: 'oauth-google', locale }); captureUserSignedUp({ method: 'oauth-google' })
   - EXISTING-USER branch: identify(user.id, { email, locale }); captureUserLoggedIn({ method: 'oauth-google' })
   - Both: posthog.alias() to stitch the anon distinct_id to the user.id (if posthog SDK exposes this).
4. Wire on EMAIL SIGNUP (if /auth/signup page exists): after successful signup, identify(user.id, {...}); captureUserSignedUp({ method: 'email' }).
5. Wire on EMAIL LOGIN (if /auth/login page exists): after successful sign-in, identify(user.id, {...}); captureUserLoggedIn({ method: 'email' }).
6. Wire on AuthProvider mount with non-null user: identify(user.id, {...}) — idempotent, handles returning-user page-loads where the auth-callback event isn't fired. Skip duplicate if the same user.id is already identified (PostHog dedupes anyway, but cheap to short-circuit).
7. CAUSALITY: all callers of identify/capture* must handle the async return (fire-and-forget with .catch noop is fine). DO NOT block redirects on PostHog calls — they should run in the background.
8. Re-read app/auth/callback/route.ts to merge with #205's changes. If conflicts arise, layer on top.

Run \`npx tsc --noEmit\` from ${REPO}.`, {
  label: 'fix:207-posthog-identify',
  schema: FIX_SCHEMA,
})

log(`Phase 2 done. #205 ${fix205?.tsc_status}, #207 ${fix207?.tsc_status}`)

// ─────────────────────────────────────────────────────────────────────────────
phase('Phase 3: Verify')

const verify = await agent(`${REPO_PIN}

You are the FINAL VERIFIER. Do not edit any code. Run from ${REPO} and report:

1. \`npx tsc --noEmit\` — must exit 0
2. \`npm run build\` — must exit 0
3. \`git status --short\` + \`git diff --stat\` — list every modified/new file

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
  fix205,
  fix207,
  verify,
}
