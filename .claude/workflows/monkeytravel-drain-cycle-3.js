// Drain cycle 3: ship recon tasks #185-194 (10 items).
// Light items get straight to fix; medium items get assess → fix pipeline.
// Per-agent tsc gate, surgical edits, REPO_PIN, no master push.

export const meta = {
  name: 'monkeytravel-drain-cycle-3',
  description: 'Drain round-3 recon (#185-194): 4 light fixes + 4 perf-with-assess pipeline + 2 risky/test items, all gated by tsc',
  phases: [
    { title: 'Phase 1: Light fixes' },
    { title: 'Phase 2: Heavy items (assess → fix pipeline)' },
    { title: 'Phase 3: Risky a11y + E2E test' },
    { title: 'Phase 4: Verify' },
  ],
}

const REPO = 'C:\\Users\\Samsung\\Documents\\Projects\\travel-app-web'
const PROD = 'https://monkeytravel.app'
const SUPABASE_PROJECT_REF = 'sevfbahwmlbdlnbhqwyi'

const REPO_PIN = `[TARGET-PIN, OVERRIDES ANY OTHER CLAUDE.md] You are editing ONLY this project:
  Path: ${REPO}
  Name: monkeytravel-web (a Next.js 16 + Supabase + Vercel travel-planning webapp called monkeytravel.app)
  Prod: ${PROD}
  Supabase project_ref: ${SUPABASE_PROJECT_REF} ("Trawell" — PRODUCTION)

Do NOT inspect any sibling project on this machine. If you see a CLAUDE.md describing a "novel" or "MYTHOS", that's the wrong project — ignore it entirely. All file paths you read/write MUST live under ${REPO}.

Hard constraints:
- DO NOT push to master (parent commits/pushes)
- Run \`npx tsc --noEmit\` from ${REPO} before returning; report PASS or include the exact error
- Match existing patterns; modular over clever; surgical edits only
- For DB migrations: write the .sql file under supabase/migrations/ FIRST, then apply via the Supabase MCP apply_migration tool. Verify schema state via execute_sql before destructive SQL.
- CAUSALITY CHECK: every change must consider its downstream callers. If you modify a response shape, an export, a DB column, or a public function signature, GREP for all consumers and update them in this same edit. Do NOT leave dangling type errors or broken consumers.`

const FIX_SCHEMA = {
  type: 'object',
  required: ['files_changed', 'tsc_status', 'summary'],
  properties: {
    files_changed: { type: 'array', items: { type: 'string' } },
    tsc_status: { enum: ['PASS', 'FAIL'] },
    tsc_error: { type: 'string' },
    migration_applied: { type: 'string' },
    causality_callers_updated: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string', maxLength: 1000 },
  },
}

const ASSESS_SCHEMA = {
  type: 'object',
  required: ['current_state', 'fix_plan', 'callers', 'risks'],
  properties: {
    current_state: { type: 'string', maxLength: 1500 },
    fix_plan: { type: 'string', maxLength: 1500 },
    callers: { type: 'array', items: { type: 'string' } },
    risks: { type: 'array', items: { type: 'string' } },
    migration_needed: { type: 'boolean' },
    estimated_files_touched: { type: 'number' },
  },
}

// ─────────────────────────────────────────────────────────────────────────────
phase('Phase 1: Light fixes')

const phase1 = await parallel([
  () => agent(`${REPO_PIN}

TASK #185 — P0 a11y: AuthPromptModal close button missing accessible name

File: components/ui/AuthPromptModal.tsx (peak-conversion auth wall)

Problem: Close button has no accessible name (no aria-label, no visible text — just an icon). Screen-reader users at the save-trip moment hit a button announced as just "button". WCAG 4.1.2 violation, immediate fix.

Steps:
1. Read components/ui/AuthPromptModal.tsx.
2. Find the close button (likely contains an X icon from lucide-react).
3. Add aria-label="Close" — but pull from next-intl since we localize. Use useTranslations('common.modal') or wherever ariaCloseLabel lives. If no key exists, ADD common.modal.closeAriaLabel = "Close" (EN), "Chiudi" (IT), "Cerrar" (ES) to messages/{en,it,es}/common.json.
4. Verify there's NO TEXT child already serving as accessible name; if there is, then this is a false positive — note in summary.
5. CAUSALITY: grep for other modal close-button patterns. If they share the same icon-button helper, do they all need the same fix? Note in summary even if not fixing here.

Run \`npx tsc --noEmit\` from ${REPO}.`, {
    label: 'fix:185-authmodal-close',
    schema: FIX_SCHEMA,
  }),

  () => agent(`${REPO_PIN}

TASK #187 — P1 bug: validate startDate in /api/trips/duplicate (3rd in RangeError family)

File: app/api/trips/duplicate/route.ts (around lines 26-90)

Background: Tasks #182 hardened /api/trips/[id]/fork and /api/templates/[id]/copy. /api/trips/duplicate was missed — used by /shared/[token] "Save to my account" CTA.

Steps:
1. Read app/api/trips/duplicate/route.ts.
2. Find where startDate is parsed (likely new Date(startDate) somewhere in the handler).
3. Mirror the existing validator from app/api/trips/[id]/fork/route.ts (commit f769dc4): NaN check + ±5y bounds, return errors.badRequest('Invalid startDate') or 'startDate out of reasonable range'.
4. Handle the optional case correctly — if startDate is null/undefined and the route falls back to default, skip validation.
5. CAUSALITY: grep for callers of this route. /shared/[token] page is the known one. Any others? Note in summary.

Run \`npx tsc --noEmit\` from ${REPO}.`, {
    label: 'fix:187-duplicate-startdate',
    schema: FIX_SCHEMA,
  }),

  () => agent(`${REPO_PIN}

TASK #193 — P1 a11y: label DestinationAutocomplete input + DateRangePicker buttons on wizard step 1

Files:
- components/ui/DestinationAutocomplete.tsx
- components/ui/DateRangePicker.tsx (or wherever the wizard's date picker lives)
- app/[locale]/trips/new/NewTripWizard.tsx (the consumer where the labels should be wired)

Problem: Wizard's destination input + date range buttons lack accessible labels. Screen reader announces "edit" with no context.

Steps:
1. Read each file.
2. For DestinationAutocomplete <input>: ensure a <label htmlFor=...> exists OR aria-label is set OR aria-labelledby points to a visible header. The wizard step likely has a visible label "Where to?" — wire it via htmlFor + id, OR via aria-labelledby.
3. For DateRangePicker buttons (likely 2: start and end): each needs aria-label like "Start date" / "End date" pulled from next-intl. If keys don't exist, add to messages/{en,it,es}/trips.json under wizard.step1.ariaLabels.
4. Add aria-required="true" where applicable.
5. CAUSALITY: are these components used elsewhere (e.g. ShareModal, /destinations, search bar)? Check before changing core component API. If used elsewhere, prefer passing aria-label as a PROP from the wizard, not hardcoding.

Run \`npx tsc --noEmit\` from ${REPO}.`, {
    label: 'fix:193-wizard-a11y',
    schema: FIX_SCHEMA,
  }),

  () => agent(`${REPO_PIN}

TASK #194 — P1 a11y: BottomSheet dialog semantics + TripsPageClient keyboard-accessible dropdown menu

Files:
- components/ui/BottomSheet.tsx
- components/trips/TripsPageClient.tsx (the action menu in TripCard)

Problem: BottomSheet renders as styled div without role="dialog" — screen readers don't announce it as a dialog, don't trap focus. The TripCard action menu (3-dot) is a styled div with onClick — not keyboard-accessible.

Steps:
1. BottomSheet:
   - Add role="dialog" + aria-modal="true" + aria-labelledby={titleId} on the panel.
   - If there's a title rendered, give it an id and reference via aria-labelledby.
   - Verify Esc key closes (likely already does via onClose — wire to keydown handler).
   - Verify focus moves into the sheet on open and returns to trigger on close. If react-focus-trap or similar isn't already used, add a simple focus-on-mount + restoreFocus-on-unmount.
2. TripsPageClient action menu:
   - Convert <div onClick>...</div> trigger to <button>.
   - Add aria-haspopup="menu" + aria-expanded={open} + aria-controls={menuId}.
   - Menu items: <button role="menuitem"> with keyboard arrow-key navigation OR use a headless library if already in deps (Radix UI, Headless UI, etc. — grep package.json first).
3. CAUSALITY: BottomSheet is used by VotingBottomSheet, AddActivityButton (probably), ShareAndInviteModal? Grep for consumers. The role="dialog" addition should be backward-compatible (additive aria), but focus-trap if added is a behavior change. Don't break existing consumers.

Run \`npx tsc --noEmit\` from ${REPO}.`, {
    label: 'fix:194-bottomsheet-a11y',
    schema: FIX_SCHEMA,
  }),
])

log(`Phase 1 done. ${phase1.filter(r => r?.tsc_status === 'PASS').length}/4 PASS`)

// ─────────────────────────────────────────────────────────────────────────────
phase('Phase 2: Heavy items (assess → fix pipeline)')

const heavyTasks = [
  {
    id: 188,
    assessPrompt: `${REPO_PIN}

ASSESS #188 — drop itinerary JSONB from /api/explore/trips feed SELECT

File: app/api/explore/trips/route.ts + lib/explore/fetchExploreFeed.ts (and any sibling /api/explore/* routes)

Goal: assess WHAT the /explore feed currently selects, what columns TripCard actually needs, what cover_image_url backfill looks like, and the safe migration path.

Steps:
1. Read app/api/explore/trips/route.ts — what does the SELECT look like? Note whether itinerary (full JSONB days) is in the response.
2. Read components/explore/TripCard.tsx + ExploreFeed.tsx — what props are rendered? Specifically: cover image, destination, duration, tags, like/save counts, owner. Does it dereference itinerary.days[*]?
3. Read the trips table schema via mcp__c2fec4b5-bd8e-44af-af2f-0d52e52e634e__execute_sql:
   SELECT column_name, data_type FROM information_schema.columns WHERE table_name='trips' ORDER BY ordinal_position;
4. Is there an existing cover_image_url column? If not, identify where TripCard currently gets the cover — likely first activity's image OR a destination-default lookup.
5. Plan the fix:
   - Option A: Add cover_image_url column with a backfill from the first activity image. Migration + backfill SQL + route SELECT slim.
   - Option B: Server-side compute cover at SELECT time using a JSONB expression.
   - Option C: Already-exists path — note it.
6. Identify CALLERS of the slim response: ExploreFeed, /destinations/[slug] now (via fetchExploreFeed), /backpacker now (via fetchExploreFeed), SharedTripView related-trips strip (Phase 3 of round-3 — verify it was/wasn't added).

Return ASSESS_SCHEMA fields. fix_plan must include the SQL migration body and the route refactor outline.`,
    fixPrompt: `${REPO_PIN}

FIX #188 — implement the assessed plan. Apply migration via Supabase MCP. Refactor route + update all callers per CAUSALITY.

Assessment from prior agent: (provided below)

Steps:
1. Apply the migration via mcp__c2fec4b5-bd8e-44af-af2f-0d52e52e634e__apply_migration with a clear name.
2. Slim the SELECT in the route handler.
3. If you added cover_image_url column, write a backfill UPDATE — verify it doesn't break null rows with no images.
4. Update TripCard.tsx if needed (most likely the prop shape change is backward-compatible if you keep optional fields).
5. CAUSALITY: every fetchExploreFeed caller must still get what they need. Specifically check /destinations/[slug] + /backpacker + /explore page itself.

Run \`npx tsc --noEmit\` from ${REPO} before returning.`,
  },
  {
    id: 189,
    assessPrompt: `${REPO_PIN}

ASSESS #189 — split /api/templates card vs detail SELECT

File: app/api/templates/route.ts + lib/templates/* + any consuming components

Goal: identify the heavy JSONB columns currently in the list SELECT that aren't needed for card render. Plan a card-vs-detail split.

Steps:
1. Read app/api/templates/route.ts. What's the SELECT shape?
2. Find consumers: components/templates/* + homepage inspiration rail + /templates landing.
3. For each consumer, identify the MINIMUM fields it needs to render its CARD view (cover, title, tags, duration, price tier). vs. DETAIL view (full itinerary).
4. Plan:
   - Option A: Single endpoint, ?detail=1 param expands itinerary JSONB.
   - Option B: Two endpoints (/api/templates for cards, /api/templates/[id] for detail).
5. Schema check: SELECT column_name, data_type FROM information_schema.columns WHERE table_name='templates' or wherever templates live.

Return ASSESS_SCHEMA. fix_plan must specify which endpoint/param shape to use and which consumers need updating.`,
    fixPrompt: `${REPO_PIN}

FIX #189 — implement the assessed plan.

Assessment from prior agent: (provided below)

Steps:
1. Refactor the route(s) per plan.
2. Update consumers — each card-rendering site uses the slim response; each detail-rendering site uses the heavy response.
3. CAUSALITY: if changing endpoint URL OR query param, every fetch site must be updated. Grep \`/api/templates\` across the codebase.
4. Do NOT remove existing fields without checking — if a consumer reads cardShape.itinerary, it'll silently render empty.

Run \`npx tsc --noEmit\` from ${REPO}.`,
  },
  {
    id: 190,
    assessPrompt: `${REPO_PIN}

ASSESS #190 — parallelize /api/ai/generate pre-Gemini serial awaits + dedupe users SELECTs

Files: app/api/ai/generate/route.ts + app/api/ai/generate/stream/route.ts

Goal: identify the 7 serial awaits before Gemini stream starts, categorize each as INDEPENDENT (Promise.all-able) vs DEPENDENT (must run after a prior await). Spot dedupable repeated SELECTs.

Steps:
1. Read both files. List every \`await\` before the Gemini call.
2. For each, write its READS (what data does it need) and WRITES (does it mutate any state used by later awaits).
3. Build the dependency graph mentally. Identify the maximal parallel set (Promise.all candidates).
4. Note any duplicate SELECTs (e.g. \`users\` table queried twice via different helpers).
5. Plan:
   - Group 1 (parallel): user lookup, locale check, feature flag read.
   - Group 2 (parallel after Group 1): usage-limit check (needs user), paywall check (needs user), draft check.
   - Group 3 (sequential): final consolidation, Gemini call.
6. Risks: do any of these mutate? Promise.all on awaits with side effects can race. Note in risks.

Return ASSESS_SCHEMA with fix_plan as the dependency graph + Promise.all groupings + dedup actions.`,
    fixPrompt: `${REPO_PIN}

FIX #190 — implement the parallelization per assessment.

Assessment from prior agent: (provided below)

Steps:
1. Refactor app/api/ai/generate/route.ts (and stream/route.ts if applicable) to use Promise.all for the identified independent groups.
2. Dedupe SELECTs — cache the read at top of handler, pass downstream.
3. PRESERVE error semantics: if a Promise.all member rejects, the whole batch fails. If today's behavior is "user check fails → 401, paywall check fails → 402", the new batch must distinguish OR each can run in .allSettled with downstream handling.
4. CAUSALITY: verify the Gemini call still receives all the data it expects in the same shape.

Run \`npx tsc --noEmit\` from ${REPO}.`,
  },
  {
    id: 191,
    assessPrompt: `${REPO_PIN}

ASSESS #191 — activity_index materialized view + trgm GIN index for /api/activities/search

Files: app/api/activities/search/route.ts + components/trip/AddActivityButton.tsx + activities table schema

Goal: design a materialized view with trigram-fuzzy search to replace the current top-100 JSONB scan.

Steps:
1. Read the current route — what's the query shape? What JSONB columns are being scanned?
2. Schema check via execute_sql:
   - List columns of activities table OR wherever they're stored.
   - Check if pg_trgm extension is installed: SELECT extname FROM pg_extension WHERE extname='pg_trgm';
3. Design the view:
   - CREATE MATERIALIZED VIEW activity_index AS SELECT activity_id, name, lower(name) AS name_norm, destination, tags, category FROM ...
   - CREATE INDEX activity_index_name_trgm ON activity_index USING GIN (name_norm gin_trgm_ops);
   - REFRESH strategy: REFRESH MATERIALIZED VIEW CONCURRENTLY on cron (existing cron infra?), OR on trigger after activity inserts.
4. CRITICAL: REFRESH MATERIALIZED VIEW CONCURRENTLY requires a UNIQUE INDEX on the view. Include that.
5. Plan the route refactor: query the view with WHERE name_norm % lower($query) AND similarity(name_norm, lower($query)) > 0.2, ORDER BY similarity DESC LIMIT 20.
6. AddActivityButton (#190's race condition noted by recon): bonus — add AbortController to its debounced fetch. Same pattern as DestinationAutocomplete.

Return ASSESS_SCHEMA. fix_plan must include the full migration SQL + the route query + refresh strategy decision.`,
    fixPrompt: `${REPO_PIN}

FIX #191 — apply migration, refactor route, fix AddActivityButton race.

Assessment from prior agent: (provided below)

Steps:
1. Write the migration file under supabase/migrations/. Apply via Supabase MCP.
2. Refactor app/api/activities/search/route.ts to query the view.
3. Add AbortController to AddActivityButton.tsx — mirror DestinationAutocomplete pattern.
4. CAUSALITY: verify the route's response shape didn't change in a way that breaks AddActivityButton's consumer. If shape changes, update both sides.
5. Set up REFRESH: if cron-based, add a route or extend existing cron infrastructure (lib/cron or similar). If trigger-based, write the trigger in the migration.

Run \`npx tsc --noEmit\` from ${REPO}.`,
  },
]

const phase2 = await pipeline(
  heavyTasks,
  (t) => agent(t.assessPrompt, { label: `assess:${t.id}`, schema: ASSESS_SCHEMA }),
  (assessResult, t) => agent(`${t.fixPrompt}\n\n---\nASSESSMENT:\n${JSON.stringify(assessResult, null, 2)}`, {
    label: `fix:${t.id}`,
    schema: FIX_SCHEMA,
  }),
)

log(`Phase 2 done. ${phase2.filter(r => r?.tsc_status === 'PASS').length}/${heavyTasks.length} PASS`)

// ─────────────────────────────────────────────────────────────────────────────
phase('Phase 3: Risky a11y + E2E test')

const phase3 = await parallel([
  () => agent(`${REPO_PIN}

TASK #192 — migrate AuthPromptModal + StartOverModal + ShareAfterSaveModal to BaseModal for dialog semantics

Files:
- components/ui/BaseModal.tsx (verify it exists; if not, skip and note in summary)
- components/ui/AuthPromptModal.tsx
- components/ui/StartOverModal.tsx (locate via grep)
- components/trip/ShareAfterSaveModal.tsx

Goal: get all 3 modals to share BaseModal's role="dialog" + aria-modal + focus-trap + escape-key behavior, so they're consistent for screen readers.

Steps:
1. Read components/ui/BaseModal.tsx. What props + behaviors does it provide?
2. If BaseModal exists and already gives dialog semantics: refactor each of the 3 modals to use it. Keep their internal layout (header, body, footer) but wrap with BaseModal.
3. If BaseModal doesn't exist or doesn't provide dialog semantics: BUILD it (or extend it) with role="dialog" + aria-modal + focus-trap (simple impl: focus first focusable on mount, capture trigger ref to restore on unmount, intercept Tab to wrap focus, Esc to close).
4. CAUSALITY: each migrated modal must preserve its EXACT behavior: animations, onClose handlers, internal state. The wrapping is purely semantic.
5. RISKS:
   - AuthPromptModal sits on the conversion path. Focus-trap regression = user can't escape modal = lost conversion. TEST mentally that Esc closes + tab cycles inside.
   - StartOverModal also high-stakes (wizard reset). Same.
   - ShareAfterSaveModal less critical but affects activation.

Run \`npx tsc --noEmit\` from ${REPO}. Report which modals successfully migrated and which deferred (if BaseModal is unsuitable, you may defer with a clear reason).`, {
    label: 'fix:192-basemodal-migration',
    schema: FIX_SCHEMA,
  }),

  () => agent(`${REPO_PIN}

TASK #186 — E2E test for RLS-locked invite flow

Goal: add a Playwright spec covering the new SECURITY DEFINER RPC + locked-down trip_invites RLS (commit f769dc4).

Steps:
1. Locate the existing Playwright test directory. Grep for \`playwright.config\` and look at the e2e/* or tests/* structure.
2. Read a few existing specs to understand conventions: test setup, helpers, login fixtures, base URL.
3. Write a new spec at the appropriate path: invite-acceptance-rls.spec.ts (or similar). It should cover:
   - Visit /invite/[bogus-token] → page renders 404/invalid state (NOT a 500, NOT a crash)
   - Visit /invite/[expired-token] → "invite expired" message (set up a fixture token in beforeAll if helper exists)
   - Visit /invite/[valid-token] as anon → sees the invite preview without authentication errors
   - Visit /invite/[valid-token] as logged-in mismatched user → RECIPIENT_MISMATCH (the recipient_email check)
   - The CRITICAL check: hitting POST /api/invites/[token] directly with no body should NOT 500 — should 400 or 401.
4. Mock or use test fixtures appropriately. If there are no fixture helpers, write the spec using real prod-shaped tokens with appropriate skips (test.skip if env var missing) — that's a known compromise.
5. If Playwright is NOT set up in this project, write the spec anyway at a sensible path with a comment explaining it should be wired into a future CI run. Don't fail the workflow over missing test infra — note it in summary.
6. CAUSALITY: this is a NEW test file, no existing callers. tsc still must pass (Playwright types).

Run \`npx tsc --noEmit\` from ${REPO}.`, {
    label: 'fix:186-invite-e2e',
    schema: FIX_SCHEMA,
  }),
])

log(`Phase 3 done. ${phase3.filter(r => r?.tsc_status === 'PASS').length}/2 PASS`)

// ─────────────────────────────────────────────────────────────────────────────
phase('Phase 4: Verify')

const verify = await agent(`${REPO_PIN}

You are the FINAL VERIFIER. Do not edit any code. Run from ${REPO} and report:

1. \`npx tsc --noEmit\` — must exit 0
2. \`npm run build\` — must exit 0
3. \`git status --short\` + \`git diff --stat\` — list every modified/new file
4. List new supabase/migrations/*.sql created in this session

Return structured report:
- tsc: "PASS" | "FAIL" + error if FAIL
- build: "PASS" | "FAIL" + error if FAIL
- modified_files: string[]
- new_files: string[]
- migrations_added: string[]
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
      migrations_added: { type: 'array', items: { type: 'string' } },
      diff_stat_summary: { type: 'string' },
      ready_to_commit: { type: 'boolean' },
      blockers: { type: 'array', items: { type: 'string' } },
    },
  },
})

return {
  phase1_light: phase1,
  phase2_heavy: phase2,
  phase3_risky_test: phase3,
  verify,
}
