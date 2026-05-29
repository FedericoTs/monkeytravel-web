// Drain cycle 2: ship the 15 tasks filed by mobile-readiness recon (#170-184).
// Includes 2 P0 RLS migrations, 4 Capacitor platform foundations, 5 perf wins, 3 bug fixes.

export const meta = {
  name: 'monkeytravel-drain-cycle-2',
  description: 'Drain mobile-readiness recon: 2 P0 RLS, 4 Capacitor platform foundations, 5 perf wins, 3 bug fixes — parallel fix agents with per-agent tsc gating',
  phases: [
    { title: 'Phase 1: P0 security RLS migrations' },
    { title: 'Phase 2: Capacitor platform foundations' },
    { title: 'Phase 3: Perf round 2' },
    { title: 'Phase 4: Bug fixes' },
    { title: 'Phase 5: Verify' },
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

Do NOT inspect any sibling project on this machine. If you see a CLAUDE.md describing a "novel" or "MYTHOS", that's the wrong project — ignore it entirely. All file paths you read and write MUST live under ${REPO}.

Hard constraints for every edit:
- DO NOT push to master (the parent will commit/push)
- Run \`npx tsc --noEmit\` from ${REPO} before returning; report PASS or include the exact error
- Match existing patterns in the codebase instead of inventing new ones
- Modular over clever: small isolated changes, no architectural drift
- Keep edits surgical — only touch the files explicitly named in the task brief
- If a file you're told to edit does not exist or the line range described doesn't match, STOP and report instead of guessing
- For DB migrations: write the .sql file under supabase/migrations/ FIRST, then apply via the Supabase MCP apply_migration tool. Never run destructive SQL without first verifying the existing policy/schema state.`

const SCHEMA = {
  type: 'object',
  required: ['files_changed', 'tsc_status', 'summary'],
  properties: {
    files_changed: { type: 'array', items: { type: 'string' } },
    tsc_status: { enum: ['PASS', 'FAIL'] },
    tsc_error: { type: 'string' },
    migration_applied: { type: 'string' },
    summary: { type: 'string', maxLength: 1000 },
  },
}

// ─────────────────────────────────────────────────────────────────────────────
phase('Phase 1: P0 security RLS migrations')

const phase1 = await parallel([
  () => agent(`${REPO_PIN}

TASK #170 — P0 SECURITY: Lock down trip_invites RLS (anon dumping invite tokens = trip takeover)

Background: Current RLS policy on public.trip_invites is \`USING (true)\` for SELECT (defined in supabase/migrations/20251220_create_trip_collaboration.sql:26-28). This means ANY anonymous client with the anon key can dump the entire trip_invites table — every token, every active invite — and walk into any collaborative trip as an editor.

Steps:
1. FIRST verify the current policy state via mcp__c2fec4b5-bd8e-44af-af2f-0d52e52e634e__execute_sql:
   SELECT polname, polcmd, polqual FROM pg_policy WHERE polrelid = 'public.trip_invites'::regclass;
2. Write a new migration: supabase/migrations/$(YYYYMMDD)_lockdown_trip_invites_rls.sql (date = 20260529 based on current date context provided to you in the session).
   Migration content:
   - DROP the public-read policy: \`DROP POLICY "Anyone can view invites" ON public.trip_invites;\` (verify exact name from step 1's pg_policy output)
   - REPLACE with: trip owners + collaborators can SELECT their own trip's invites; anonymous reads must go through a SECURITY DEFINER RPC keyed by token only.
   - CREATE OR REPLACE FUNCTION public.get_invite_by_token(p_token text) RETURNS TABLE (...all the trip_invites columns...) SECURITY DEFINER SET search_path = public AS $$ ... $$ — returns at most 1 row matching the token, with NO leakage of other trips. Function MUST also check trip_invites.expires_at > now() AND trip_invites.revoked_at IS NULL.
   - GRANT EXECUTE ON FUNCTION public.get_invite_by_token(text) TO anon, authenticated;
3. Apply the migration via mcp__c2fec4b5-bd8e-44af-af2f-0d52e52e634e__apply_migration with name "lockdown_trip_invites_rls" and the SQL.
4. Update application code: grep for direct .from('trip_invites').select() calls that read by token from anonymous-reachable code paths (app/api/invites/[token]/route.ts, components reading invites, etc.). Refactor those to use .rpc('get_invite_by_token', { p_token }). Authenticated callers (trip owner viewing their invites for management) can keep direct .from() reads — the new policy still permits owners.
5. Run \`npx tsc --noEmit\` from ${REPO} before returning.

CRITICAL: Do not break the invite-acceptance flow. Verify the data shape returned by the RPC matches what the route handler currently destructures. Test the new RPC via execute_sql with a known-good token before declaring done.`, {
    label: 'security:trip-invites-rls',
    schema: SCHEMA,
  }),

  () => agent(`${REPO_PIN}

TASK #171 — P0 SECURITY: Tighten trip_collaborators RLS (any auth user can dump the full social graph)

Background: Per recon — trip_collaborators RLS allows authenticated users to read rows beyond their own trips, leaking the full collaboration graph (who collaborates with whom across the entire user base). File reference: supabase/migrations/20251220_create_trip_collaboration.sql.

Steps:
1. FIRST verify current policy state via mcp__c2fec4b5-bd8e-44af-af2f-0d52e52e634e__execute_sql:
   SELECT polname, polcmd, polqual FROM pg_policy WHERE polrelid = 'public.trip_collaborators'::regclass;
2. Read the actual data shape and current callers:
   - Grep src for \`.from('trip_collaborators')\` to find all read sites.
   - Identify what scope each caller needs: their own collaborator rows? Trip-owner reads of all collaborators on their trip?
3. Write a new migration: supabase/migrations/$(YYYYMMDD)_tighten_trip_collaborators_rls.sql.
   Migration content:
   - DROP the overly-broad SELECT policy.
   - ADD scoped policies:
     a. "Collaborator can view their own rows" USING (user_id = auth.uid())
     b. "Trip owner can view all collaborators on their trip" USING (trip_id IN (SELECT id FROM public.trips WHERE owner_id = auth.uid()))
     c. NO anonymous SELECT.
4. Apply the migration via mcp__c2fec4b5-...__apply_migration.
5. Validate no existing application caller breaks: for each grep hit, confirm the new policy still allows the read context. If any caller reads collaborators for trips they don't own (e.g. /shared/[token] anonymous view) — flag it; don't break it; either widen the policy with a token-based check OR migrate that caller to a SECURITY DEFINER RPC like task #170.
6. Run \`npx tsc --noEmit\` from ${REPO}.

CRITICAL: Trip-card avatar bundles + invite-management UIs often join trip_collaborators. Verify they still work after the policy tightens.`, {
    label: 'security:trip-collaborators-rls',
    schema: SCHEMA,
  }),
])

log(`Phase 1 done. ${phase1.filter(r => r?.tsc_status === 'PASS').length}/2 PASS`)

// ─────────────────────────────────────────────────────────────────────────────
phase('Phase 2: Capacitor platform foundations')

const phase2 = await parallel([
  () => agent(`${REPO_PIN}

TASK #172 — Add server.allowNavigation in capacitor.config.ts (OAuth ejects from WebView without it)

File: capacitor.config.ts (around lines 36-41 per recon)

Problem: Without an allowNavigation allowlist, Capacitor WebView ejects to system browser on every redirect outside the configured origin. OAuth flows (Sign in with Apple, Google, etc.), Stripe checkout, and Supabase auth callbacks all break — user lands in Safari and the session never returns to the app.

Fix:
1. Read current capacitor.config.ts.
2. Add to the server: { ... } block:
   allowNavigation: [
     '*.supabase.co',
     '*.supabase.in',
     'accounts.google.com',
     'appleid.apple.com',
     'images.pexels.com',
     'maps.googleapis.com',
     'maps.gstatic.com',
     'checkout.stripe.com',
     'js.stripe.com',
     'hooks.stripe.com',
     'm.stripe.com',
     'm.stripe.network',
   ]
3. If the codebase loads from any other external auth provider, Pexels variants, or affiliate domains in OAuth-like flows that need to keep the WebView session, add those too. Be conservative: only add what's actually navigated TO during auth/payment flows. (External booking links like booking.com SHOULD open via @capacitor/browser instead — that's task #175.)
4. Run \`npx tsc --noEmit\` from ${REPO} (capacitor.config.ts is TypeScript).`, {
    label: 'platform:allow-navigation',
    schema: SCHEMA,
  }),

  () => agent(`${REPO_PIN}

TASK #174 — No-op service worker on Capacitor (shadows native asset loading, breaks live-URL strategy)

File: lib/sw/register.ts (around lines 16-42)

Problem: registerServiceWorker() only guards on \`'serviceWorker' in navigator\`, NODE_ENV, and path /trips/* — NO check for Capacitor native platform. Inside iOS/Android WebView the SW installs and intercepts fetches, defeating the "load live URL on every cold launch" strategy in capacitor.config.ts.

Fix (one-line insert):
1. Read lib/sw/register.ts.
2. After the existing \`registered\` guard (line ~18), add:
   \`\`\`
   const cap = (window as typeof window & { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
   if (cap?.isNativePlatform?.()) return;
   \`\`\`
3. Optionally add a one-time cleanup on native bootstrap: \`if (cap?.isNativePlatform?.()) { caches.keys().then(k => k.forEach(c => caches.delete(c))); }\` — only if there's a clean native bootstrap location (likely lib/native/boot.ts or components/NativeBoot.tsx if it exists). If unclear, SKIP the cleanup; the guard alone is the fix.
4. Run \`npx tsc --noEmit\` from ${REPO}.`, {
    label: 'platform:sw-noop-capacitor',
    schema: SCHEMA,
  }),

  () => agent(`${REPO_PIN}

TASK #176 — Build lib/platform/storage.ts wrapper + migrate auth-handoff keys to @capacitor/preferences

Background: iOS WKWebView evicts localStorage under storage pressure + after 7-day ITP inactivity. Three critical auth-handoff keys live there:
- pendingTripGeneration (anon hits Generate → login → wizard auto-runs)
- pendingSaveTripAction (anon hits Save → login → auto-save)
- pendingTripDuplicate (anon hits Fork → login → auto-fork)

Eviction = user lands on empty wizard / no-op page after signup. Highest-friction handoff in the funnel.

Steps:
1. CREATE lib/platform/storage.ts as a NEW file. Export:
   - export interface Storage { get(key: string): Promise<string | null>; set(key: string, value: string): Promise<void>; remove(key: string): Promise<void>; }
   - export const prefs: Storage = isNative() ? capacitorPrefs : webPrefs
   Implementation:
   - isNative() = \`typeof window !== 'undefined' && (window as any).Capacitor?.isNativePlatform?.()\`
   - webPrefs: thin async wrapper around localStorage (try/catch, ignore quota errors)
   - capacitorPrefs: \`const { Preferences } = await import('@capacitor/preferences'); return await Preferences.get/set/remove\` — dynamic-import so the plugin doesn't enter the web bundle.
2. Migrate the 3 callers:
   - components/ui/AuthPromptModal.tsx (lines 36, 42): \`localStorage.setItem(KEY, json)\` → \`await prefs.set(KEY, json)\`
   - components/trip/SaveTripModal.tsx (lines 147, 425, 443): same pattern
   - components/trip/DuplicateTripCTA.tsx (lines 93, 288): same pattern
   - app/[locale]/trips/new/NewTripWizard.tsx (lines 426, 472): the READER side — \`localStorage.getItem(KEY)\` → \`await prefs.get(KEY)\`. Wrap useEffect's async work in an inner async function (standard React pattern).
3. DO NOT touch decoration keys (tour-completed, value-banner-dismissed, etc.) — those are fine on localStorage. Surgical to the 3 auth keys.
4. Run \`npx tsc --noEmit\` from ${REPO}.

CRITICAL: All readers MUST become async. Don't break the call sites by leaving them sync.`, {
    label: 'platform:storage-wrapper',
    schema: SCHEMA,
  }),

  () => agent(`${REPO_PIN}

TASK #175 — Add openExternal() helper + migrate booking/share CTAs off target=_blank

Background: 12+ sites render \`<a target='_blank'>\` or call \`window.open(url, '_blank')\` for booking partners (Booking.com, Expedia, Hostelworld, activities) and social shares. On iOS Capacitor WebView, target=_blank is SILENTLY SWALLOWED — nothing happens OR the URL replaces the WebView, breaking back-nav. @capacitor/browser ^8.0.3 is already installed but never imported.

Steps:
1. CREATE lib/native/external-link.ts (mirror lib/native/share.ts pattern):
   \`\`\`
   export async function openExternal(url: string) {
     if (typeof window === 'undefined') return;
     const cap = (window as any).Capacitor;
     if (cap?.isNativePlatform?.()) {
       const { Browser } = await import('@capacitor/browser');
       await Browser.open({ url, presentationStyle: 'popover' });
       return;
     }
     window.open(url, '_blank', 'noopener,noreferrer');
   }
   \`\`\`
2. Migrate the highest-leverage shared primitive FIRST: components/booking/PartnerButton.tsx (line ~65). Change \`<a target='_blank' href={partnerUrl}>\` to \`<button type='button' onClick={() => { trackPartnerClick(...); openExternal(partnerUrl); }}>\`. Preserve all existing accessibility attrs (rel='sponsored', aria-label, etc. as data-* on the button if needed for analytics).
3. Migrate the remaining direct callers (those NOT going through PartnerButton):
   - components/booking/BookingDrawer.tsx (line 142: window.open)
   - Any other direct \`window.open\` for external URLs — grep first to confirm sites
4. SKIP the social-share callers (ShareModal/ShareAndInviteModal/ReferralModal/ExportMenu) for THIS task — those should go through lib/native/share.ts which is task-out-of-scope.
5. DO preserve analytics tracking: most CTAs call \`trackPartnerClick\` or similar BEFORE opening. Keep that order.
6. Run \`npx tsc --noEmit\` from ${REPO}.

Don't migrate every site exhaustively — focus on PartnerButton (covers ~6 hits via the shared primitive) + the 1-2 direct window.open callers in booking flows. The remaining hits can be a follow-up.`, {
    label: 'platform:external-link',
    schema: SCHEMA,
  }),
])

log(`Phase 2 done. ${phase2.filter(r => r?.tsc_status === 'PASS').length}/4 PASS`)

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2b: Supabase Preferences adapter (depends on Phase 2's #176 storage wrapper landing first conceptually,
// but operates on a different file — lib/supabase/client.ts — so safe to run after the storage wrapper exists)

phase('Phase 2: Capacitor platform foundations')

const phase2b = await agent(`${REPO_PIN}

TASK #173 — Wire Supabase client to @capacitor/preferences storage adapter (PKCE)

File: lib/supabase/client.ts (around lines 1-11)

Background: Currently Supabase auth tokens live in WKWebView localStorage. iOS evicts under storage pressure + 7-day ITP → users silently logged out. Blocks any reliable native session lifetime. Reference: docs/MOBILE_HANDOFF.md "Path A".

Steps:
1. Read docs/MOBILE_HANDOFF.md if it exists. Follow Path A specifically.
2. Read lib/supabase/client.ts.
3. Implement a native storage adapter that wraps @capacitor/preferences in the shape Supabase expects (getItem/setItem/removeItem — all async). Place the adapter inline in lib/supabase/client.ts OR in lib/supabase/native-storage.ts if cleaner.
4. Modify the createBrowserClient / createClient call:
   - Detect native: \`const isNative = typeof window !== 'undefined' && (window as any).Capacitor?.isNativePlatform?.()\`
   - On native, pass \`auth: { storage: nativeStorageAdapter, flowType: 'pkce', persistSession: true, detectSessionInUrl: true }\`
   - On web, KEEP existing behavior (do not change web auth flow).
5. Add a one-shot migration: on native bootstrap (NativeBoot.tsx if it exists, else create lib/native/migrate-auth.ts and import once at lib/supabase/client.ts module top), copy any existing localStorage keys matching \`sb-*-auth-token\` into Preferences. This makes existing wrapped users not get logged out by the storage change. Migration runs once then sets a Preferences key like \`mt_auth_migrated_v1=true\` to short-circuit on next launch.
6. Run \`npx tsc --noEmit\` from ${REPO}.

CRITICAL: Web auth must be UNCHANGED. Only native gets the new adapter. Test that the createBrowserClient call still type-checks for web callers (most of the app).
COORDINATION: Phase 2 task #176 is creating lib/platform/storage.ts in parallel. You're creating a SEPARATE Supabase-specific adapter — they don't share code. Read your file fresh; don't merge with #176's wrapper.`, {
  label: 'platform:supabase-preferences',
  schema: SCHEMA,
})

log(`Phase 2b done. ${phase2b?.tsc_status === 'PASS' ? '1/1 PASS' : '0/1 FAIL'}`)

// ─────────────────────────────────────────────────────────────────────────────
phase('Phase 3: Perf round 2')

const phase3 = await parallel([
  () => agent(`${REPO_PIN}

TASK #177 — Drop unoptimized prop on blog hero + BlogCard + DestinationCard + related/CTA images

Files (per recon): app/[locale]/blog/[slug]/page.tsx:266-274 + 4 more (grep for \`unoptimized\` on <Image> components).

Problem: 5 <Image> sites have \`unoptimized\` prop set, bypassing Next.js image optimizer. /blog index ships ~5-9MB of unsized JPGs; blog hero is the LCP element at ~590KB priority+unoptimized.

Steps:
1. Grep the codebase: \`unoptimized\` (case-sensitive, JSX prop syntax) — get exact file:line list.
2. For each hit on an <Image>: REMOVE the \`unoptimized\` prop. Keep all other props (priority, src, alt, sizes, fill/width/height, etc.) unchanged.
3. For blog hero specifically: KEEP \`priority\` (it IS the LCP element) and ensure \`sizes\` prop exists with a reasonable mobile/desktop split — otherwise next/image errors. Pattern reference: components/destinations/DestinationFeatured.tsx (already correct, uses blurDataURL).
4. If any <Image> uses an external URL not in next.config.ts images.remotePatterns, ADD that pattern. Otherwise the optimizer rejects it. Verify by checking next.config.ts current remotePatterns.
5. Run \`npx tsc --noEmit\` from ${REPO}.

Cap scope at the 5 sites recon called out. Don't refactor unrelated <Image> calls.`, {
    label: 'perf:image-unoptimized',
    schema: SCHEMA,
  }),

  () => agent(`${REPO_PIN}

TASK #178 — Add experimental.optimizePackageImports for lucide-react, framer-motion, @dnd-kit, date-fns

File: next.config.ts

Problem: Several heavy packages with barrel exports aren't being tree-shaken efficiently. Next 15+ supports experimental.optimizePackageImports which rewrites barrel imports to deep imports at build time, saving ~30-60KB gz per route that imports from these.

Steps:
1. Read next.config.ts.
2. In the config object, add (or extend) the experimental block:
   \`\`\`
   experimental: {
     ...(existingExperimental || {}),
     optimizePackageImports: [
       'lucide-react',
       'framer-motion',
       '@dnd-kit/core',
       '@dnd-kit/sortable',
       '@dnd-kit/utilities',
       'date-fns',
       // Add more after verifying they exist in package.json
     ],
   },
   \`\`\`
3. Verify each named package IS in package.json before adding. Skip any not present. If lodash-es or ramda are present, add them too. Don't add 'react-icons' (already known to be optimized by Next default).
4. Run \`npx tsc --noEmit\` from ${REPO}.

This is a config-only change. No code edits.`, {
    label: 'perf:optimize-package-imports',
    schema: SCHEMA,
  }),

  () => agent(`${REPO_PIN}

TASK #179 — Lazy-load posthog-js + @sentry/nextjs from analytics helpers

Files: lib/posthog/events.ts (lines 1-4) + lib/analytics.ts (line 10) + any sibling files that top-level import the SDKs (lib/posthog/identify.ts, lib/posthog/client.ts).

Problem: Top-level \`import posthog from 'posthog-js'\` + \`import * as Sentry from '@sentry/nextjs'\` in these helpers — which are imported by 18+/21+ components — leaks ~200KB combined into the shared first-load chunk on every route. Both SDKs document deferred init.

Steps:
1. Read each file above + grep for any other lib/posthog/* and lib/analytics* / lib/sentry* files.
2. For each captureXxx / identify / etc. function: replace the top-level import with:
   \`\`\`
   const getPosthog = () => import('posthog-js').then(m => m.default);
   \`\`\`
   And inside each function:
   \`\`\`
   export async function captureEvent(name: string, props?: ...) {
     const ph = await getPosthog();
     ph.capture(name, props);
   }
   \`\`\`
3. For lib/analytics.ts: replace \`import * as Sentry from '@sentry/nextjs'\` with \`const sentry = () => import('@sentry/nextjs')\`. Inside each function: \`(await sentry()).addBreadcrumb(...)\` etc.
4. Callers may need updating if they call these synchronously and assume void return. If a caller assumed sync, wrap their call in a fire-and-forget pattern: \`captureEvent('foo', {}).catch(() => {})\`.
5. Verify the SDKs are still INITIALIZED somewhere (instrumentation-client.ts or PostHogProvider component) — those single-site inits should keep their top-level imports if they're already isolated. Goal is to remove SDK from the SHARED chunk, not from init code.
6. Run \`npx tsc --noEmit\` from ${REPO}.

Be careful: if the synthesizer's read is wrong and these helpers AREN'T pulled into the shared chunk, the lazy-load is harmless but useless. Still ship it — defensive coding.`, {
    label: 'perf:lazy-analytics',
    schema: SCHEMA,
  }),

  () => agent(`${REPO_PIN}

TASK #180 — next/dynamic 9 heavy hidden components in TripDetailClient + SharedTripView

Files: components/trip/TripDetailClient.tsx + components/shared/SharedTripView.tsx (and analogues)

Problem: 9 components (BookingDrawer, ExportMenu, ShareModal, ShareAndInviteModal, ActivityModal, ImagePreview, TripMap, weather panels, etc.) are imported at module top of these route components but rendered conditionally (modals + lazy panels). They ship in the initial bundle even though they're never rendered on first paint.

Steps:
1. Read TripDetailClient.tsx and SharedTripView.tsx. Identify imports that are rendered ONLY conditionally (behind isModalOpen, isDrawerOpen, showMap, etc.).
2. For each such import:
   - Replace \`import BookingDrawer from '@/components/booking/BookingDrawer'\` with:
     \`const BookingDrawer = dynamic(() => import('@/components/booking/BookingDrawer'), { ssr: false });\`
   - Keep render site unchanged. dynamic() returns a component, so <BookingDrawer ... /> still works.
3. Components that ARE rendered on first paint (the activity timeline, day cards, sticky bar) MUST stay statically imported.
4. TripMap specifically: it almost certainly uses Mapbox/Leaflet (heavy). Confirm it's lazy-loaded. If currently \`import dynamic ... ssr:false\` already, skip.
5. ssr:false is correct for modals (no SEO/SSR value). For above-the-fold panels that should SSR, use \`{ ssr: true, loading: () => <Skeleton /> }\`.
6. Run \`npx tsc --noEmit\` from ${REPO}.

Cap: do at most 9 components. Don't dynamic-import everything; static imports for above-the-fold critical UI is correct.`, {
    label: 'perf:trip-detail-dynamic',
    schema: SCHEMA,
  }),

  () => agent(`${REPO_PIN}

TASK #181 — Collapse 4 getUser calls + 2 onAuthStateChange listeners per page into single AuthContext

Problem: Per recon, the app fires 4 separate \`supabase.auth.getUser()\` calls + 2 \`onAuthStateChange\` listeners on every page render. Each getUser is a network call. Each listener is a memory subscription.

Steps:
1. Read components/auth/AuthContext.tsx if it exists; otherwise check components/providers/ for similar.
2. If a single AuthContext already exists, identify the components that bypass it and call getUser directly. Grep \`auth.getUser\` + \`onAuthStateChange\` across the codebase.
3. For each bypassing component, replace direct calls with:
   - \`const { user, loading } = useAuth()\` from the existing context
   - Remove their direct supabase.auth.getUser() and onAuthStateChange handlers
4. If NO AuthContext exists: CREATE one at components/auth/AuthProvider.tsx with:
   - One \`useEffect\` calling \`supabase.auth.getUser()\` on mount
   - One \`useEffect\` subscribing to onAuthStateChange
   - Exposes { user, loading } via context
   - Provider wraps the [locale] layout
5. Run \`npx tsc --noEmit\` from ${REPO}.

CAUTION: If existing components do BUSINESS LOGIC inside their onAuthStateChange handler (e.g. analytics, navigation, modal toggle), preserve that logic — move it into the context's central listener OR keep the per-component listener if it's clearly local-state. Don't break per-component reactivity.

If the refactor is genuinely large (>5 file changes needed), SCOPE DOWN: just collapse the 2 worst offenders in the highest-traffic routes (Navbar + Header components are typical). The full unification can be a follow-up.`, {
    label: 'perf:auth-context',
    schema: SCHEMA,
  }),
])

log(`Phase 3 done. ${phase3.filter(r => r?.tsc_status === 'PASS').length}/5 PASS`)

// ─────────────────────────────────────────────────────────────────────────────
phase('Phase 4: Bug fixes')

const phase4 = await parallel([
  () => agent(`${REPO_PIN}

TASK #182 — Validate startDate in /api/trips/[id]/fork + /api/templates/[id]/copy (RangeError 500s)

Files:
- app/api/trips/[id]/fork/route.ts
- app/api/templates/[id]/copy/route.ts

Problem: Both routes pass user-supplied startDate to date math (e.g. \`new Date(startDate)\`) without validating. Bad input (empty string, malformed, far-future) produces "Invalid Date" → downstream RangeError → 500 → user sees broken fork/copy.

Steps:
1. Read both files. Identify exactly where startDate enters and where it's first parsed.
2. Add validation IMMEDIATELY after parsing input. Pattern:
   \`\`\`
   const parsed = new Date(startDate);
   if (isNaN(parsed.getTime())) {
     return NextResponse.json({ error: 'Invalid startDate' }, { status: 400 });
   }
   // Optional: bounds check
   const now = Date.now();
   if (parsed.getTime() < now - 365*24*3600*1000 || parsed.getTime() > now + 5*365*24*3600*1000) {
     return NextResponse.json({ error: 'startDate out of reasonable range' }, { status: 400 });
   }
   \`\`\`
3. If startDate is OPTIONAL, only validate if present and skip the check if undefined.
4. Run \`npx tsc --noEmit\` from ${REPO}.`, {
    label: 'bug:startdate-validation',
    schema: SCHEMA,
  }),

  () => agent(`${REPO_PIN}

TASK #183 — Activity-timeline GET returns empty for collaborators (filters by user_id=auth.uid())

Files:
- app/api/trips/[id]/activities/route.ts (or wherever the activity-timeline GET handler lives — grep for activity_timelines table reads)
- app/api/trips/[id]/activities/[activityId]/route.ts (line 23-29 per recon)

Problem: GET handler calls verifyTripAccess (owner OR collaborator), then queries .eq('trip_id', tripId).eq('user_id', user.id). Activity_timelines rows are written with user_id = trip-owner. Collaborators pass access check but always get empty rows → live-tracking feature silently broken for collaborators.

Steps:
1. Read the activity-timeline writer (PATCH at app/api/trips/[id]/activities/[activityId]/route.ts:131-146 per recon) to confirm: are timelines OWNER-scoped or PER-USER?
2. Look at the actual data: via execute_sql, sample SELECT user_id, trip_id, COUNT(*) FROM activity_timelines GROUP BY trip_id, user_id LIMIT 10. Is it one user_id per trip? Or many?
3. Decide:
   - If TIMELINES ARE SHARED (one source-of-truth per trip): DROP the .eq('user_id', user.id) filter from GET. The verifyTripAccess gate is sufficient.
   - If TIMELINES ARE PER-USER (each collaborator tracks their own): keep the filter, but ALSO loosen the PATCH from verifyTripOwnership → verifyTripAccess(editor) so collaborators can create their own rows.
4. Apply the chosen fix (likely the SHARED interpretation, simpler and matches typical collaboration semantics).
5. Run \`npx tsc --noEmit\` from ${REPO}.

DECISION FRAMEWORK: If unsure, default to SHARED — the simpler model. Single-line fix to drop the filter. Document the choice in the commit-prep summary.`, {
    label: 'bug:activity-timeline-collab',
    schema: SCHEMA,
  }),

  () => agent(`${REPO_PIN}

TASK #184 — /api/unsubscribe mutates on GET (Gmail/Outlook scanners silently unsubscribe users)

File: app/api/unsubscribe/route.ts (around lines 85-119)

Problem: GET handler unconditionally writes to users.notification_settings on every valid-token GET. Gmail link prefetcher, Outlook Safe Links, Bitdefender, Slack unfurlers — every automated GET silently unsubscribes the user before they click. RFC 8058 one-click requires POST + List-Unsubscribe-Post header.

Steps:
1. Read app/api/unsubscribe/route.ts.
2. Split handlers:
   - GET: verifies token only, returns the key/email/preferences for the confirmation page to render. Does NOT mutate.
   - POST: performs the unsubscribe mutation. Gated by user click on the confirmation page.
3. On the confirmation page (likely app/(unauth)/unsubscribe/page.tsx or similar — grep "unsubscribe" page route), wire the button to POST.
4. Add response headers on the GET: \`Cache-Control: no-store, max-age=0\` to prevent scanner caching.
5. If legacy GET-based unsubscribe must be supported (some old clients), gate the mutation behind \`?confirm=1\` only; the bare GET is read-only.
6. Run \`npx tsc --noEmit\` from ${REPO}.

CRITICAL: don't break the user-facing flow. If the confirmation page currently expects an already-unsubscribed state (because GET mutates), it needs updating to call POST on click.`, {
    label: 'bug:unsubscribe-get-mutation',
    schema: SCHEMA,
  }),
])

log(`Phase 4 done. ${phase4.filter(r => r?.tsc_status === 'PASS').length}/3 PASS`)

// ─────────────────────────────────────────────────────────────────────────────
phase('Phase 5: Verify')

const verify = await agent(`${REPO_PIN}

You are the FINAL VERIFIER. Do not edit any code. Run these commands from ${REPO} and report results:

1. \`npx tsc --noEmit\` — must exit 0
2. \`npm run build\` — must exit 0
3. \`git status --short\` — list every modified/new file (M, ??, A, etc.)
4. \`git diff --stat\` — line counts per file (tracked changes only)
5. List supabase/migrations/*.sql new files created in this session

Return a structured report with these keys:
- tsc: "PASS" | "FAIL" + error if FAIL
- build: "PASS" | "FAIL" + error if FAIL
- modified_files: string[]
- new_files: string[]  // untracked
- migrations_added: string[]  // new .sql files under supabase/migrations/
- diff_stat_summary: string
- ready_to_commit: boolean
- blockers: string[]  // empty if ready

Do NOT commit. Do NOT push. Verifier only.`, {
  label: 'verify:final',
  schema: {
    type: 'object',
    required: ['tsc', 'build', 'modified_files', 'ready_to_commit'],
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
  phase1_security: phase1,
  phase2_capacitor: phase2,
  phase2b_supabase: phase2b,
  phase3_perf: phase3,
  phase4_bugs: phase4,
  verify,
}
