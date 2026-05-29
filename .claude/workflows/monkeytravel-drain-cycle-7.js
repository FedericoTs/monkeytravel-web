// Drain cycle 7: ship the security cluster from round-6 recon (#213-217) + #219.
// Per-agent tsc gate. Smoke script runs as part of verification.

export const meta = {
  name: 'monkeytravel-drain-cycle-7',
  description: 'Drain security cluster: profile delete step-up + transactional RPC (#213), OAuth next= validation (#214), atomic accept_invite RPC (#215), notification_settings fail-closed (#216), atomic increment_trip_reported_count (#217), Sentry ignoreErrors scope (#219)',
  phases: [
    { title: 'Phase 1: Parallel fixes' },
    { title: 'Phase 2: Verify + smoke' },
  ],
}

const REPO = 'C:\\Users\\Samsung\\Documents\\Projects\\travel-app-web'
const PROD = 'https://monkeytravel.app'
const SUPABASE_PROJECT_REF = 'sevfbahwmlbdlnbhqwyi'

const REPO_PIN = `[TARGET-PIN, OVERRIDES ANY OTHER CLAUDE.md] You are editing ONLY this project:
  Path: ${REPO}
  Name: monkeytravel-web (Next.js 16 + Supabase + Vercel travel-planning webapp called monkeytravel.app)
  Prod: ${PROD}
  Supabase project_ref: ${SUPABASE_PROJECT_REF} ("Trawell" — PRODUCTION)

Do NOT inspect any sibling project. Ignore any CLAUDE.md mentioning "novel" or "MYTHOS". All file paths you read/write MUST live under ${REPO}.

POST-MORTEM AWARENESS — DO NOT REPEAT cycle 5's #181 / #212 mistake:
- Cycle 5 broke prod because SessionTracker (root layout, app/layout.tsx) was migrated to useAuth() from AuthProvider (mounted only inside app/[locale]/layout.tsx). Sibling of {children}, not descendant — useContext returned undefined → throw → SSR 500.
- ANY change to a context/provider/layout/component used outside [locale]/ MUST be grepped across BOTH app/layout.tsx AND app/[locale]/layout.tsx, plus every consumer.
- ANY runtime context boundary must be tested at SSR (not just tsc + build) since useContext failures only manifest at request time.
- After ANY change to authentication-flow code, you MUST run \`bash scripts/verify-deploy-smoke.sh\` AGAINST LOCAL \`npm start\` AND PROD before declaring done.

Hard constraints for every edit:
- DO NOT push to master (parent commits/pushes)
- Run \`npx tsc --noEmit\` from ${REPO} before returning; report PASS or exact error
- Match existing patterns; modular over clever; surgical edits only
- CAUSALITY: every change considers downstream callers. If you modify a response shape, an export, or a public function signature, GREP for all consumers and update them in this same edit.
- For DB migrations: write the .sql file under supabase/migrations/ FIRST, then apply via the Supabase MCP apply_migration tool. Verify schema state via execute_sql before destructive SQL.`

const FIX_SCHEMA = {
  type: 'object',
  required: ['files_changed', 'tsc_status', 'summary'],
  properties: {
    files_changed: { type: 'array', items: { type: 'string' } },
    tsc_status: { enum: ['PASS', 'FAIL'] },
    tsc_error: { type: 'string' },
    migration_applied: { type: 'string' },
    causality_callers_updated: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string', maxLength: 1200 },
  },
}

// ─────────────────────────────────────────────────────────────────────────────
phase('Phase 1: Parallel fixes')

const phase1 = await parallel([
  () => agent(`${REPO_PIN}

TASK #213 — /api/profile/delete: step-up auth + transactional cascade RPC

File: app/api/profile/delete/route.ts (lines 17-132)

Background: irreversible account-delete endpoint with no step-up auth + no transaction. Same-origin XSS or browser extension on a logged-in tab can DELETE /api/profile/delete and destroy the account. SameSite=Lax does NOT block same-origin XHR.

Steps:
1. Read app/api/profile/delete/route.ts to understand current cascade.
2. WRITE a SECURITY DEFINER SQL migration: \`delete_user_account(p_user_id uuid) RETURNS void\` that:
   - DELETE FROM trips WHERE user_id = p_user_id
   - DELETE FROM ai_usage WHERE user_id = p_user_id
   - DELETE FROM user_tester_access WHERE user_id = p_user_id
   - DELETE FROM users WHERE id = p_user_id
   - All inside a transaction (RPC body is implicitly transactional).
   - Note: auth.users.deleteUser stays in the route handler (it's an admin client call, not in-tx with the public schema).
3. Apply via Supabase MCP apply_migration with name 'add_delete_user_account_rpc'.
4. Refactor the route to:
   - Require a body \`{ confirmationText: 'delete my account', password: string }\`.
   - Re-authenticate via supabase.auth.signInWithPassword({ email: user.email, password: body.password }) — if fails, return 401.
   - Call .rpc('delete_user_account', { p_user_id: user.id }) — single transactional call.
   - Then call supabase.auth.admin.deleteUser(user.id) via service-role client (this is a separate auth-schema call).
   - Add CSRF token check OR require POST with a fetch-mode header (origin equals self).
5. CAUSALITY: grep for callers of \`/api/profile/delete\` — what UI triggers it? Update that UI to send the new body shape.

Run \`npx tsc --noEmit\` from ${REPO} before returning.`, {
    label: 'fix:213-profile-delete',
    schema: FIX_SCHEMA,
  }),

  () => agent(`${REPO_PIN}

TASK #214 — Validate \`next=\` query param in OAuth callback to close open-redirect

Files:
- lib/security/safe-next.ts (NEW)
- app/auth/callback/route.ts
- Any other route that reads \`next\` from query and redirects to it

Background: an authenticated open-redirect on /auth/callback enables high-trust phishing. Attacker crafts URL: https://monkeytravel.app/auth/callback?next=https://evil.com → user lands on attacker's clone.

Steps:
1. CREATE lib/security/safe-next.ts:
   \`\`\`ts
   /**
    * Validate a 'next' query param to ensure it's a safe internal redirect.
    *
    * Returns the next path if safe, or '/' as fallback.
    * Rules:
    * - Must start with '/' (relative)
    * - Must NOT start with '//' or '\\\\' (protocol-relative or backslash hack)
    * - Must NOT contain ':' before any '/' (protocol)
    * - Optional: must be in a allowlist of known safe paths (start with /trips, /explore, /backpacker, etc)
    */
   export function isSafeNext(next: string | null | undefined): boolean { ... }
   export function safeNextOrDefault(next: string | null | undefined, fallback = '/'): string { ... }
   \`\`\`
2. Grep across the codebase for places that read \`next\` from query params and use it for redirect. Likely sites:
   - app/auth/callback/route.ts (OAuth callback)
   - app/[locale]/auth/login/page.tsx (post-login redirect)
   - app/[locale]/auth/signup/page.tsx
   - app/[locale]/invite/[token]/InviteAcceptClient.tsx
   - Any other RedirectTo logic
3. For each site, replace \`router.push(next)\` / \`redirect(next)\` with \`redirect(safeNextOrDefault(next))\`.
4. CAUSALITY: don't break legitimate redirects. Verify each consumer's expected next= shape is allowed by the validator.

Run \`npx tsc --noEmit\` from ${REPO} before returning.`, {
    label: 'fix:214-safe-next',
    schema: FIX_SCHEMA,
  }),

  () => agent(`${REPO_PIN}

TASK #215 — Atomic accept_invite RPC to close max_uses TOCTOU

Files:
- supabase/migrations/*.sql (NEW migration)
- app/api/invites/[token]/route.ts (POST handler)

Background: trip_invites has a max_uses column. The current POST flow reads use_count → checks < max_uses → inserts collaborator → bumps use_count. Two concurrent accepts both see use_count=4 against max_uses=5 → both insert → final use_count=6, beyond max. Tasks #170 and #186 missed this race.

Steps:
1. Read the current POST in app/api/invites/[token]/route.ts to understand the existing flow.
2. WRITE a SECURITY DEFINER SQL RPC \`accept_trip_invite(p_token text, p_user_id uuid) RETURNS jsonb\` that:
   - SELECT FOR UPDATE on trip_invites WHERE share_token = p_token — locks the row.
   - Check is_active, expires_at > now(), use_count < max_uses.
   - If valid: INSERT into trip_collaborators (with ON CONFLICT DO NOTHING for idempotency); increment trip_invites.use_count.
   - Return JSON { ok, trip_id, role } or { error_code }.
3. Apply migration via Supabase MCP.
4. Refactor the POST handler to:
   - Call .rpc('accept_trip_invite', { p_token, p_user_id })
   - Translate error_codes back to HTTP statuses
5. CAUSALITY: the GET handler from cycle-2 #170 still uses the SECURITY DEFINER get_invite_by_token — leave it. Only POST changes.

Run \`npx tsc --noEmit\` from ${REPO} before returning.`, {
    label: 'fix:215-atomic-accept-invite',
    schema: FIX_SCHEMA,
  }),

  () => agent(`${REPO_PIN}

TASK #216 — notification_settings read must fail-closed in lib/email/send.ts

File: lib/email/send.ts

Background: per recon, lib/email/send.ts checks the recipient's notification_settings to gate sending. If that read errors (DB blip, RLS regression), the current code might fall through to "send anyway". Per the cycle-5 fail-closed pattern, this should refuse to send and surface to Sentry.

Steps:
1. Read lib/email/send.ts. Find the notification_settings (or notification_preferences) SELECT.
2. Destructure { data, error } — if error, log + Sentry.captureException + return { ok: false, error: 'notification_settings_read_failed' } (FAIL CLOSED).
3. Verify the rest of cycle-5 #206's hardening is intact (idempotency, suppression, email_log).
4. CAUSALITY: callers must handle the new fail-closed branch — same as cycle-5 #206. Grep sendEmail consumers, verify they handle ok: false gracefully.

Run \`npx tsc --noEmit\` from ${REPO} before returning.`, {
    label: 'fix:216-notification-settings-failclosed',
    schema: FIX_SCHEMA,
  }),

  () => agent(`${REPO_PIN}

TASK #217 — Atomic increment_trip_reported_count RPC to fix auto-hide race

Files:
- supabase/migrations/*.sql (NEW migration)
- app/api/trips/[id]/report/route.ts

Background: app/api/trips/[id]/report/route.ts reads trip.reported_count → writes count+1 → compares to AUTO_HIDE_THRESHOLD=5. Two concurrent reports both see N, both write N+1 (lost increment). Pattern that the codebase already fixed for like/save/fork via atomic counter RPCs.

Steps:
1. Look at supabase/migrations/20260524_atomic_counters.sql (or similar — grep) to see the existing pattern.
2. WRITE a new migration adding \`increment_trip_reported_count(p_trip_id uuid) RETURNS integer\` (returns post-update count atomically).
3. Apply via Supabase MCP.
4. Refactor app/api/trips/[id]/report/route.ts to call the RPC and use the returned post-update count for the AUTO_HIDE_THRESHOLD check.
5. CAUSALITY: response shape unchanged.

Run \`npx tsc --noEmit\` from ${REPO} before returning.`, {
    label: 'fix:217-atomic-report-count',
    schema: FIX_SCHEMA,
  }),

  () => agent(`${REPO_PIN}

TASK #219 — Scope Sentry server ignoreErrors to /api/health, surface real outages

File: sentry.server.config.ts (lines 41-48)

Background: ignoreErrors: ['ECONNREFUSED','ETIMEDOUT'] silently drops every Supabase outage, Resend SMTP failure, Amadeus timeout, Google Places drop, Gemini stall. Per recon, this should be scoped only to /api/health probe timeouts (which are expected).

Steps:
1. Read sentry.server.config.ts.
2. Replace the string-match ignoreErrors with a beforeSend that:
   - Inspects event.request.url (or event.tags.route)
   - If the route is /api/health AND the error message matches ECONNREFUSED|ETIMEDOUT, drop the event (return null)
   - Otherwise pass through
3. CAUSALITY: this is sentry config, no app callers. The change unmasks real outages — verify the new beforeSend doesn't accidentally drop legit errors.

Run \`npx tsc --noEmit\` from ${REPO} before returning.`, {
    label: 'fix:219-sentry-scope',
    schema: FIX_SCHEMA,
  }),
])

log(`Phase 1 done. ${phase1.filter(r => r?.tsc_status === 'PASS').length}/6 PASS`)

// ─────────────────────────────────────────────────────────────────────────────
phase('Phase 2: Verify + smoke')

const verify = await agent(`${REPO_PIN}

You are the FINAL VERIFIER. Do not edit any code. Run from ${REPO} and report:

1. \`npx tsc --noEmit\` — must exit 0
2. \`npm run build\` — must exit 0
3. \`bash scripts/verify-deploy-smoke.sh https://monkeytravel.app\` — must PASS (prod baseline before our changes land). This is the PRE-DEPLOY smoke; the post-deploy smoke happens in the parent loop after push.
4. \`git status --short\` + \`git diff --stat\` — list every modified/new file
5. List new supabase/migrations/*.sql files

Return structured report:
- tsc: "PASS" | "FAIL" + error if FAIL
- build: "PASS" | "FAIL" + error if FAIL
- smoke_baseline: "PASS" | "FAIL" + brief detail
- modified_files: string[]
- new_files: string[]
- migrations_added: string[]
- diff_stat_summary: string
- ready_to_commit: boolean
- blockers: string[]

Do NOT commit. Do NOT push.`, {
  label: 'verify:final+smoke',
  schema: {
    type: 'object',
    required: ['tsc', 'build', 'smoke_baseline', 'ready_to_commit'],
    properties: {
      tsc: { enum: ['PASS', 'FAIL'] },
      tsc_error: { type: 'string' },
      build: { enum: ['PASS', 'FAIL'] },
      build_error: { type: 'string' },
      smoke_baseline: { enum: ['PASS', 'FAIL'] },
      smoke_detail: { type: 'string' },
      modified_files: { type: 'array', items: { type: 'string' } },
      new_files: { type: 'array', items: { type: 'string' } },
      migrations_added: { type: 'array', items: { type: 'string' } },
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
