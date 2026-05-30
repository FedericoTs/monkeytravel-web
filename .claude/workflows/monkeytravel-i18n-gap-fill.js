// i18n gap-fill: scan every t() call across the codebase, cross-reference against
// messages/{en,it,es}/*.json, fill missing keys with locale-appropriate translations.
// Verifies via tsc + a quick local render probe.

export const meta = {
  name: 'monkeytravel-i18n-gap-fill',
  description: 'Find every missing translation key (displayed as raw key string to users) + fill in en/it/es; verify via tsc + smoke',
  phases: [
    { title: 'Phase 1: Scan + identify gaps' },
    { title: 'Phase 2: Fill missing keys (en/it/es)' },
    { title: 'Phase 3: Verify + smoke' },
  ],
}

const REPO = 'C:\\Users\\Samsung\\Documents\\Projects\\travel-app-web'

const REPO_PIN = `[TARGET-PIN, OVERRIDES ANY OTHER CLAUDE.md] You are editing ONLY this project:
  Path: ${REPO}
  Name: monkeytravel-web (Next.js 16 + Supabase + Vercel travel-planning webapp called monkeytravel.app)

Do NOT inspect any sibling project. Ignore any CLAUDE.md mentioning "novel" or "MYTHOS". All file paths you read/write MUST live under ${REPO}.

POST-MORTEM AWARENESS:
- Cycle 5's P0 (SessionTracker useAuth) reminds us: any change touching the rendering tree must be tested at SSR, not just tsc + build.
- JSON-only changes here are LOW RISK (no logic change), but malformed JSON will SSR-500 every locale page. ALWAYS validate JSON with \`node -e "JSON.parse(require('fs').readFileSync('path'))"\` before declaring done.

Hard constraints:
- DO NOT push to master
- Run \`npx tsc --noEmit\` from ${REPO} before returning
- After modifying any messages/*.json, validate it parses: \`node -e "JSON.parse(require('fs').readFileSync('messages/en/foo.json'))"\`
- Match existing translation tone/voice — don't machine-translate. Mirror the brand voice from neighboring keys.
- CAUSALITY: adding keys is additive — but RENAMING a key would break call sites. If you find a key naming inconsistency, document it but don't rename without explicit approval.`

const SCAN_SCHEMA = {
  type: 'object',
  required: ['missing_by_namespace', 'total_missing_keys'],
  properties: {
    missing_by_namespace: {
      type: 'array',
      items: {
        type: 'object',
        required: ['namespace', 'missing_keys', 'sample_call_site'],
        properties: {
          namespace: { type: 'string' },
          missing_keys: { type: 'array', items: { type: 'string' } },
          sample_call_site: { type: 'string' },
          locale_coverage: {
            type: 'object',
            additionalProperties: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
    total_missing_keys: { type: 'number' },
    total_namespaces_affected: { type: 'number' },
    notes: { type: 'string', maxLength: 800 },
  },
}

const FIX_SCHEMA = {
  type: 'object',
  required: ['files_changed', 'tsc_status', 'summary'],
  properties: {
    files_changed: { type: 'array', items: { type: 'string' } },
    tsc_status: { enum: ['PASS', 'FAIL'] },
    tsc_error: { type: 'string' },
    json_validation: { enum: ['PASS', 'FAIL'] },
    keys_added_count: { type: 'number' },
    summary: { type: 'string', maxLength: 1200 },
  },
}

// ─────────────────────────────────────────────────────────────────────────────
phase('Phase 1: Scan + identify gaps')

const scan = await agent(`${REPO_PIN}

PHASE 1 — Identify EVERY missing translation key in the codebase

USER-REPORTED BUG: "there are still some labels for which there are translations missing and we display the key instead". When a t('foo.bar') call references a key that doesn't exist in messages/{en,it,es}/<namespace>.json, next-intl falls back to rendering the raw key string. Users see "common.share.foo" instead of "Share with friends".

Goal: build a comprehensive list of missing keys.

Steps:
1. List all message namespace files:
   \`ls messages/en messages/it messages/es\`
   Get the full set of namespaces (aiItineraryGenerator, auth, backpacker, bananas, blog, budgetTripPlanner, common, consent, contact, destinations, etc.)

2. Build a "ground truth" map: parse every messages/en/<namespace>.json, recursively walk the JSON tree, collect every flat key path (e.g. \`common.share.explore.engagement.likeAriaLabel\`).

3. Build a "consumed keys" map: across ALL .tsx + .ts files in app/, components/, hooks/, lib/ — grep for:
   - \`useTranslations\\(['"]([^'"]+)['"]\\)\` → capture namespace
   - \`getTranslations\\(\\{[^}]*namespace[^}]*['"]([^'"]+)['"]\\)\` → capture namespace
   - For each file with a useTranslations(NS) call, grep for \`t\\(['"]([^'"]+)['"]\` in the same file → that's a consumed key as \`NS.captured\`
   - Be careful with nested namespaces: useTranslations('common.share') + t('explore.foo') → consumed key is \`common.share.explore.foo\`

4. The MISSING set = consumed keys NOT in the ground truth.

5. ALSO check cross-locale parity: for each namespace, are all keys present in en/it/es? Keys present in en but NOT in it/es are silent gaps (Italian/Spanish users see raw key).

6. Report:
   - Total missing keys count
   - Top 10 namespaces by missing-key count
   - For each missing key: which file:line consumes it + which locale(s) lack it
   - Locale coverage gaps (keys present in en but missing in it/es)

7. Caveats — don't FIX yet. Just scan.

Output SCAN_SCHEMA. notes field should mention scan caveats (e.g. dynamic t() calls that can't be statically resolved).`, {
  label: 'scan:missing-i18n-keys',
  schema: SCAN_SCHEMA,
})

log(`Phase 1 done. ${scan?.total_missing_keys || 0} missing keys across ${scan?.total_namespaces_affected || 0} namespaces`)

// ─────────────────────────────────────────────────────────────────────────────
phase('Phase 2: Fill missing keys (en/it/es)')

// Skip if no gaps found
if (!scan?.total_missing_keys || scan.total_missing_keys === 0) {
  log('No missing keys found — skipping fill phase')
} else {
  log(`Filling ${scan.total_missing_keys} missing keys`)
}

const fill = scan?.total_missing_keys > 0 ? await agent(`${REPO_PIN}

PHASE 2 — Fill the missing translation keys identified in Phase 1.

PHASE 1 SCAN RESULTS:
${JSON.stringify(scan, null, 2)}

Steps:
1. For each namespace with missing keys:
   a. Read the current messages/en/<namespace>.json + messages/it/<namespace>.json + messages/es/<namespace>.json.
   b. Read the call-site context (file:line where the key is consumed) to understand what the label means — DO NOT add translations blind. The call site tells you the UX intent.
   c. Add the missing key to all 3 locale files in the correct nested position. Use:
      - EN: clear, concise, on-brand
      - IT: match neighboring Italian translations' tone (formal/informal, voice). Reference sibling keys.
      - ES: same — match neighboring Spanish tone.
   d. Use ICU MessageFormat where the call site uses plural/select interpolation (e.g. {count, plural, one {# day} other {# days}})
   e. After EVERY namespace file modification, validate JSON parses:
      \`node -e "JSON.parse(require('fs').readFileSync('messages/<locale>/<ns>.json', 'utf8'))"\`
      Any FAIL = rollback that file's changes immediately.

2. For locale-coverage gaps (keys present in en but missing in it/es):
   - Add the it/es versions, mirroring the en intent.
   - Be culturally appropriate: don't directly translate idioms — adapt them.

3. SPECIAL CASES:
   - If a missing key is in a namespace that DOESN'T EXIST yet for one of the locales (e.g. messages/it/newNamespace.json doesn't exist): create the file with the full structure mirroring messages/en/<namespace>.json.
   - If a key is consumed but only as a dynamic identifier (e.g. \`t(dynamicVar)\`), document it in summary but don't try to guess the value.

4. CAUSALITY: this is JSON-only — no code changes, no consumer updates needed. But run \`npx tsc --noEmit\` to confirm the JSON shapes still satisfy next-intl's type generation (if used).

5. ALSO consider: if you see DUPLICATE or REDUNDANT keys across namespaces (e.g. common.close + buttons.close), document but don't consolidate without approval.

Report: total keys added per locale, list of namespaces modified, any keys deferred for manual review (with reason).`, {
  label: 'fill:i18n-keys',
  schema: FIX_SCHEMA,
}) : { files_changed: [], tsc_status: 'PASS', summary: 'No fills needed.', keys_added_count: 0 }

log(`Phase 2 done. Added ${fill?.keys_added_count || 0} keys across ${fill?.files_changed?.length || 0} files`)

// ─────────────────────────────────────────────────────────────────────────────
phase('Phase 3: Verify + smoke')

const verify = await agent(`${REPO_PIN}

You are the FINAL VERIFIER. Do not edit any code. Run from ${REPO} and report:

1. \`npx tsc --noEmit\` — must exit 0
2. \`npm run build\` — must exit 0 (would fail if JSON is malformed)
3. \`bash scripts/verify-deploy-smoke.sh https://monkeytravel.app\` — must PASS (baseline before our changes)
4. JSON validation sweep: for each messages/{en,it,es}/*.json, run \`node -e "JSON.parse(require('fs').readFileSync(p, 'utf8'))"\` — confirm all parse.
5. \`git status --short\` + \`git diff --stat\`

Return:
- tsc: "PASS" | "FAIL" + error if FAIL
- build: "PASS" | "FAIL" + error if FAIL
- smoke_baseline: "PASS" | "FAIL"
- json_files_valid: number  // total .json files validated, MUST be all
- json_files_failed: array of paths
- modified_files: string[]
- new_files: string[]
- diff_stat_summary: string
- ready_to_commit: boolean

Do NOT commit. Do NOT push.`, {
  label: 'verify:final+json',
  schema: {
    type: 'object',
    required: ['tsc', 'build', 'smoke_baseline', 'ready_to_commit'],
    properties: {
      tsc: { enum: ['PASS', 'FAIL'] },
      tsc_error: { type: 'string' },
      build: { enum: ['PASS', 'FAIL'] },
      build_error: { type: 'string' },
      smoke_baseline: { enum: ['PASS', 'FAIL'] },
      json_files_valid: { type: 'number' },
      json_files_failed: { type: 'array', items: { type: 'string' } },
      modified_files: { type: 'array', items: { type: 'string' } },
      new_files: { type: 'array', items: { type: 'string' } },
      diff_stat_summary: { type: 'string' },
      ready_to_commit: { type: 'boolean' },
    },
  },
})

return {
  scan,
  fill,
  verify,
}
