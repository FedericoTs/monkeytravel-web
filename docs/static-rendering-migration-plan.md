> ⛔ **SUPERSEDED 2026-06-25 — DO NOT EXECUTE PHASES 2–5.** (Phases 0–1 shipped; harmless.)
> Measurement + first-principles stopped this migration. Two independent reasons:
> 1. **Phase 2 is broken for Next App Router.** Prod pages carry the per-request nonce on **56 inline `self.__next_f` framework scripts**, not "just the 3 JSON-LD blocks" this plan assumes. A cached page cannot hold a per-request nonce (info-theoretic), and 56 dynamic inline scripts cannot be hashed → dropping the nonce breaks hydration site-wide. The `csp-hashes.ts` approach does NOT work.
> 2. **The win is ~$0.** Vercel compute is dominated by inherently-dynamic app pages (un-cacheable); the cacheable content-page slice ≈ 6–20 GB-hrs/mo, inside Vercel Pro's included quota. SEO benefit ≈ 0 (indexation is gated by authority/content, not render mode).
> Net EV is negative vs the CSP security regression. Full rationale: memory `project_monkeytravel_seo_2026_06`.

---

All facts verified against source. I have what I need to synthesize. The three reports agree on the core mechanism; the only divergence is the homepage-redirect and `<html lang>` approach, which I'll resolve explicitly. One nuance worth surfacing: middleware.ts:231 strips `/(en|es|it|pt)` but canonical `en` is unprefixed — the homepage-redirect logic must account for that. Writing the deliverable now.

---

# MONKEYTRAVEL STATIC/ISR MIGRATION PLAN — FINAL DELIVERABLE

**Scope:** Convert SEO/marketing/content surfaces from 100% dynamic to static/ISR. **No code is changed by this document** — it is the executable plan. Every fact below was re-verified against the working tree at `C:\Users\Samsung\Documents\Projects\travel-app-web` (branch `master`).

---

## 1. EXECUTIVE SUMMARY

### The goal
Every route in the app currently renders dynamically (`ƒ`): a Vercel function invocation, ~0.7s render, `no-store` on every request — *including every Googlebot crawl of ~516 sitemap URLs*. This is simultaneously the #1 Vercel function-invocation cost driver and the cause of declining Google indexation (uncacheable pages starve crawl budget). The goal is to make the ~23 SEO/content surfaces static or ISR (`○`/`●`) while leaving every genuinely-dynamic surface (auth, `/trips`, `/admin`, all `/api`, user-specific) untouched and dynamic.

### Root cause (verified, three independent confirmations agree)
One file forces the entire app dynamic:
- **`app/layout.tsx:187`** — `const locale = await getLocale()` (next-intl reads request config).
- **`app/layout.tsx:193`** — `const nonce = await getNonce()` → `lib/security/nonce.ts:60` `await headers()`.

Because the root layout sits **above** `app/[locale]/layout.tsx:33` (where `setRequestLocale(locale)` already correctly runs), the existing `setRequestLocale` machinery — present in ~24 leaf pages plus `generateStaticParams` on `blog/[slug]` and `destinations/[slug]` — is **inert today**. It is suppressed, not missing. Removing the two root forcers *activates infrastructure that is already in place*.

Three secondary forcer classes must also be removed for the prize pages to actually flip:
- **20 leaf pages** re-poison themselves with a direct `getNonce()` call (verified: exactly 20 files via `grep`).
- **`lib/explore/fetcher.ts:22`** reads `headers()` (host/proto) — poisons `/destinations/[slug]` + `/explore`.
- **`app/[locale]/page.tsx:99-100`** reads `cookies()` via `createClient()` for a logged-in→`/trips` redirect — poisons the homepage.

### Expected outcome
| Metric | Before | After |
|---|---|---|
| **Static/ISR page routes** | 0 | **~23** (7 pillar landings, 3 tools, 3 blog surfaces, destinations hub + style + `[slug]`, authors, contact, templates, privacy, terms; homepage anon-static; `/destinations/[slug]` fully ISR) |
| **Routes still `ƒ` (correct)** | all | ~135 `/api/*`, 4 `/admin/*`, all `/auth/*`, `/trips/*`, `/profile/*`, `/settings/*`, `/saved`, `/shared/[token]`, `/explore` (reads `searchParams`), token/redirect pages |
| **Googlebot crawl of a content URL** | function invocation + ~0.7s + `no-store` | CDN `HIT`, 0 function invocations after first render |
| **Vercel function invocations** | 100% of page requests | Only dynamic routes + ISR revalidations (TTL-bounded) |
| **SEO** | uncacheable → crawl-budget starvation | cacheable HTML, faster TTFB, healthier crawl budget |

### The single biggest risk + neutralization
**The CSP/nonce change is the one place a mistake takes the whole site down** (a wrong `script-src` blocks Next's hydration bootstrap → every page renders blank/unhydrated). The plan neutralizes this by: (1) isolating the CSP change in its own phase/commit, behind every cheaper win; (2) exploiting the fact that `'strict-dynamic'` is **already in the policy** (`csp.ts:35`) — so dropping the nonce in favor of hashes for the 3 deterministic JSON-LD blocks is a *narrow* change, not a rewrite; (3) a mandatory **preview-deploy gate** (preview runs `NODE_ENV=production` → CSP enforced) with a concrete zero-console-violation checklist before any promotion to prod; (4) full per-commit `git revert` reversibility, with the pre-CSP `middleware.ts`/`csp.ts`/`nonce.ts` as a known-good restore point.

---

## 2. THE KEY DECISION — CSP / NONCE PATH

### Chosen option
**Drop the per-request nonce. Move to a build-constant strict CSP using `'strict-dynamic'` + SHA-256 hashes for the 3 deterministic JSON-LD blocks rendered by the root layout. Keep the CSP attached in middleware as a response header (constant string, identical every request).**

### Why (the security ↔ static-rendering tradeoff)
The nonce is the *only* reason the policy can't be static: a per-request nonce requires `headers()` at render time, which forces dynamic. But the nonce was never doing the heavy lifting — **`'strict-dynamic'` already is** (present today at `csp.ts:35`). `strict-dynamic` says "trust scripts loaded by an already-trusted script," which covers Next's entire hydration/prefetch/RSC chain and the `<Script>`-injected GA + Travelpayouts loaders. The only inline scripts *we author* are JSON-LD blocks:
- The **3 global JSON-LD blocks** (`generateOrganizationSchema`, `generateWebSiteSchema`, `generateSoftwareApplicationSchema`, rendered at `app/layout.tsx:198-200`) are byte-identical on every page → **3 constant SHA-256 hashes** computed at build time.
- **Per-page JSON-LD** (FAQ on homepage `page.tsx:123`, Article/Breadcrumb/Tourist on blog/destination pages) are `type="application/ld+json"` — **data, not executable script**. Chrome 90+ explicitly exempts `application/ld+json` from `script-src` execution checks. They need no nonce and no hash to function.

So: nonce → hashes for the 3 global blocks, `strict-dynamic` keeps everything else, `'unsafe-inline'`/`'unsafe-eval'` stay OFF `script-src` (the task #199 posture is preserved).

### What is explicitly given up (owner sign-off required)
1. **Per-request nonce entropy on `script-src`.** Replaced by hashes (for our 3 inline blocks) + `strict-dynamic` (for everything else). These are **equivalent trust anchors** under the CSP spec; the modern Google-recommended strict-CSP shape (`strict-dynamic` + `object-src 'none'` + `base-uri 'self'`) is fully intact. Net XSS posture: **unchanged-to-stronger and more consistent** (the policy is now identical and auditable on every response).
2. **A hard coupling: the 3 global JSON-LD blocks must not drift from their hashes.** If anyone edits `generateOrganizationSchema`/`generateWebSiteSchema`/`generateSoftwareApplicationSchema` without regenerating the hash, those blocks get CSP-blocked in prod. **Mitigation: a drift test** (`lib/security/csp-hashes.test.ts`) that asserts the hash array equals the SHA-256 of the exact bytes `jsonLdScriptProps` emits — it fails in CI before prod breaks.

### Rejected alternatives
- **Keep the nonce, scope dynamic-vs-static per route in middleware.** Adds a branch that must stay in sync with which pages are static — a maintenance landmine, exactly "the kind of mistake we cannot make." Rejected.
- **Allow `'unsafe-inline'` as a modern-browser-ignored fallback.** Reintroduces what task #199 deliberately removed. Rejected.

### Edge-runtime constraint (load-bearing implementation detail)
`middleware.ts` runs on the **Edge runtime**, where `node:crypto.createHash` is unavailable. Therefore the hashes must be computed at **build/module-eval time in a Node context** and carried into the Edge bundle as a plain `string[]`. The hash module is imported by `csp.ts` (which is imported by middleware), and the `createHash` calls run at module top-level during the Node build — the Edge bundle carries only the frozen resulting strings. **No `createHash` call ever runs on the Edge hot path.** This is verified-safe but MUST be confirmed in the Phase-2 preview build (a Node-only API leaking into the Edge bundle fails the build loudly — which is the desired early signal).

---

## 3. COMPLETE ROUTE INVENTORY

### 3A. STATIC-TARGET (becomes `○`/`●`) — with exact forcers to remove

All rows are blocked by the structural forcers `app/layout.tsx:187,193` first. The "leaf forcer" column is what remains after the structural fix.

| Route | `setRequestLocale`? | Leaf forcer to remove | Notes |
|---|---|---|---|
| `app/[locale]/page.tsx` (homepage) | ✅ via params/`getTranslations` | `getNonce():117` **+ `createClient()`/`getUser():99-100`** | Homepage redirect handled in middleware (§4 Phase 1b) |
| `free-ai-trip-planner/page.tsx` | ✅ :186 | `getNonce():205` | pillar |
| `group-trip-planner/page.tsx` | ✅ :232 | `getNonce():252` | pillar |
| `budget-trip-planner/page.tsx` | ✅ :185 | `getNonce():204` | pillar |
| `family-trip-planner/page.tsx` | ✅ :185 | `getNonce():204` | pillar |
| `solo-trip-planner/page.tsx` | ✅ :186 | `getNonce():205` | pillar |
| `weekend-trip-planner/page.tsx` | ✅ :195 | `getNonce():214` | pillar |
| `ai-itinerary-generator/page.tsx` | ✅ :185 | `getNonce():204` | pillar |
| `tools/page.tsx` | ✅ :70 | **none** | free once structural fixed |
| `tools/packing-list/page.tsx` | ✅ :78 | `getNonce():93` | |
| `tools/visa-checker/page.tsx` | ✅ :106 | `getNonce():177` | **also reads `searchParams`** (prefill from/to) → stays dynamic-but-cheap unless prefill moves client-side; see §4 Phase 4 note |
| `blog/page.tsx` | ✅ :105 | `getNonce():153` | `revalidate=3600` already present (`:36`) — inert today, activates on fix |
| `blog/[slug]/page.tsx` | ✅ :155 | `getNonce():271` | `generateStaticParams:36` → `●` |
| `blog/tag/[tag]/page.tsx` | ✅ :103 | `getNonce():129` | `revalidate=3600` (`:30`); `generateStaticParams:20` |
| `destinations/page.tsx` | ✅ :70 | `getNonce():109` | |
| `destinations/style/[tag]/page.tsx` | ✅ :77 | `getNonce():95` | `generateStaticParams:25` |
| `destinations/[slug]/page.tsx` | ✅ :125 | `getNonce():203` **+ `fetchExploreFeed`→`headers()`** (called :179) | highest-value SEO page; `generateStaticParams:46` → `●` once §4 Phase 1a + Phase 4 land |
| `about/authors/[slug]/page.tsx` | ✅ :62 | `getNonce():94` | `generateStaticParams:20` |
| `contact/page.tsx` | ✅ :34 | **none** | free once structural fixed |
| `templates/page.tsx` | ❌ **missing** | none, but **add `setRequestLocale`** | calls `getTranslations` w/o it |
| `privacy/page.tsx` | ❌ **missing** | none, but **add `setRequestLocale`** | calls `getTranslations('common')` w/o it |
| `terms/page.tsx` | ❌ none | **none** | pure static JSX; add `setRequestLocale` defensively |

**NEEDS-DECISION (intended static, extra `headers()`):**
| Route | Decision |
|---|---|
| `explore/page.tsx` | Remove `headers()` (via fetcher + local `fetchExploreFeedWithStyle` at `:447-451`). **Still reads `searchParams:156` → stays `ƒ` by Next's rules.** Win is "dynamic-but-cheap" (no per-request CSP `headers()`), not full static. The big static win is `/destinations/[slug]`, which shares the fetcher fix but has no `searchParams`. |
| `backpacker/page.tsx` | Reads `headers()` directly at `:38,:64` + `getNonce():241`. Same host/proto swap → ISR. |
| `welcome/page.tsx` | `redirect('/trips/new')` only — trivial; leave as-is or convert to middleware rule. Non-blocking. |

### 3B. MUST-STAY-DYNAMIC (untouched — `ƒ` is correct)

- **Homepage auth path** — moved to middleware (the page body becomes static; the *behavior* stays).
- **`app/[locale]/`**: `trips/*` (`createClient`), `profile/*`, `settings/*`, `saved` (cookies+auth), `onboarding` (client), all `auth/*` (client forms, `useSearchParams`), `oauth/authorize`, `feedback/[token]` (`force-dynamic`), `from-chatgpt/[ref]`, `invite/[token]`, `join/[code]`, `unsubscribe` (token + noindex), `shared/[token]` (`getNonce` + token + noindex — **stays `ƒ`; do NOT remove its getNonce blindly** — see §6 risk).
- **`app/admin/*`** (4 pages, OUTSIDE `[locale]`, depend on root `<html>/<body>`) — `createClient`.
- **`app/api/**`** (~135 handlers) — auth/user/admin/cron/AI/mutations. Dynamic by nature. **Not touched.**
- **`app/auth/callback/route.ts`, `app/auth/signout/route.ts`** — route handlers, no HTML.
- **`app/.well-known/*`, `app/feed.xml`, `app/sitemap.ts`, `app/robots.ts`, `app/opengraph-image.tsx`** — non-HTML / already cache-friendly. Leave. (Minor: `feed.xml` has no `revalidate` — optional follow-up, out of scope.)

---

## 4. PHASE-BY-PHASE PLAN

**Principle:** unblock cheap, CSP-independent routes first (proves the static pipeline end-to-end at near-zero risk), isolate the one scary change (CSP), then sweep. Each phase = one commit (sub-commits where noted) = one `git revert` unit. No phase depends on a later phase for correctness in prod.

> **VISIBILITY CAVEAT (critical — prevents false alarms):** because root forcers A/B poison the whole tree, **the route table will NOT show any `ƒ→○/●` flips until Phase 3 removes the root `getLocale()`.** Phases 1 and 2 are verified *behaviorally* (curl/console/QA), not by the route marker. The table flips at Phase 3. Do not panic when Phase 1 ships green and everything still shows `ƒ`.

---

### PHASE 0 — Baseline & instrumentation (no behavior change)

**Goal:** capture the "before" so every later gate is a diff, not a guess.

**Changes:** none functional. Add helper scripts and a baseline snapshot.
- `scripts/route-table.sh`: `next build 2>&1 | sed -n '/Route (app)/,/First Load JS/p'` → capture the `○/●/ƒ` table.
- `scripts/cache-probe.sh`: curl the canary URLs, print `x-vercel-cache`, `<html lang>`, CSP presence.
- Save `docs/static-migration/baseline.txt` = route table + `curl -sI` headers for all canary URLs.

**Verification gate:** baseline file exists and shows **every page route as `ƒ`** (confirms the starting state). `npm run build` green.

**Rollback:** delete the scripts. Zero risk.

---

### PHASE 1 — Remove forcers E (explore fetcher) + D (homepage redirect); CSP untouched

Two independent sub-commits so they revert separately.

#### 1a — Kill `headers()` in the explore fetcher (forcer E)

**Files:** `lib/explore/fetcher.ts:2,22-24,35`; `app/[locale]/explore/page.tsx:447-451` (local `fetchExploreFeedWithStyle`).

**Before** (`fetcher.ts:22-24,35`):
```ts
const h = await headers();
const host = h.get("x-forwarded-host") ?? h.get("host") ?? "monkeytravel.app";
const proto = h.get("x-forwarded-proto") ?? "https";
...
const url = `${proto}://${host}/api/explore/trips?${params.toString()}`;
```
**After:**
```ts
// Static base URL — no headers() read, so callers can render statically/ISR.
// Tradeoff: Vercel preview/branch deploys point at PRODUCTION's explore feed
// instead of the preview's own host (a static page cannot know its own URL
// without a dynamic read). Acceptable: the feed is read-only public data.
const base =
  process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "https://monkeytravel.app";
const url = `${base}/api/explore/trips?${params.toString()}`;
```
Remove `import { headers } from "next/headers";` (`fetcher.ts:2`). Keep `next: { revalidate: 60 }` (`:39`) — it now actually contributes to ISR. Apply the identical `NEXT_PUBLIC_APP_URL` swap in `explore/page.tsx:447-451`.

> **Resolved divergence:** the three reports name the env var inconsistently (`NEXT_PUBLIC_SITE_URL` vs `NEXT_PUBLIC_APP_URL`). **Before writing code, grep the repo for the canonical name** (`grep -rn "NEXT_PUBLIC_.*URL\|monkeytravel.app" lib/ app/ | grep -i "process.env"`) and use whichever is already defined in Vercel. If neither exists, introduce `NEXT_PUBLIC_APP_URL` and set it. Do not assume.

**Vercel env:** set `NEXT_PUBLIC_APP_URL=https://monkeytravel.app` for **Production**. Leave **Preview** unset → previews read prod's public feed (harmless). For local: `.env.local` → `http://localhost:3000`.

**Unblocks:** `/destinations/[slug]` and `/explore` lose forcer E.

**Verification gate (behavioral, NOT route marker):**
- `npm run build` green; `grep -n "headers()" lib/explore/fetcher.ts "app/[locale]/explore/page.tsx"` → **zero matches**.
- `next build && next start`, then `/explore` and `/destinations/paris` render the trending feed (not the coming-soon fallback).
- **On a preview deploy specifically** (validates the constant base URL resolves cross-deploy): same two URLs render the feed.

**Rollback:** `git revert <1a>`. Restores host-header sniffing exactly.

#### 1b — Homepage logged-in redirect → middleware (forcer D)

**Decision (owner lever #1 — recommended: do it):** move the logged-in→`/trips` redirect to middleware (homepage is the top crawl target; keeping it `ƒ` forfeits the single highest-value cache). The alternative (leave homepage `ƒ`) is the safe fallback if auth-gating risk is unacceptable.

**Files:** `app/[locale]/page.tsx:1-2,98-105`; `middleware.ts`.

**Before** (`page.tsx:98-105`):
```ts
const supabase = await createClient();
const { data: { user } } = await supabase.auth.getUser();
if (user) redirect('/trips');
```
**After:** delete lines 98-105 and the now-unused `createClient` import (line 1) + `redirect` import (line 2 — **verify** it's the next-intl `redirect`; if other code in the file still uses it, keep the import). Page body becomes static (only `getTranslations` + static FAQ data remain).

**Middleware addition** — a **cookie-presence** check (presence only, NOT validation; do NOT call Supabase here). Place it **after** `intlMiddleware` resolves locale and **before** `captureUtmCookies`/`isPublicOnly` (i.e. right after line 224):
```ts
// Logged-in users skip the marketing homepage. PRESENCE check only — we look
// for the Supabase auth cookie, not validate it (validation = a network call
// we must not add to the hot path). A stale cookie sends them to /trips, where
// the real auth guard bounces them to /auth/login if needed. Loop-safe: /trips
// is never the homepage; this fires only when strippedPath === '/'.
const strippedPathForHome = pathname.replace(/^\/(en|es|it|pt)/, '') || '/';
if (strippedPathForHome === '/') {
  const hasSession = request.cookies
    .getAll()
    .some((c) => c.name.startsWith('sb-') && c.name.includes('-auth-token'));
  if (hasSession) {
    const url = request.nextUrl.clone();
    url.pathname = '/trips';
    return attachSecurityHeaders(NextResponse.redirect(url));
  }
}
```
> **Resolved nuance (the reports under-specify this):** `middleware.ts:231` already computes `strippedPath` — but it does so AFTER the `isPublicOnly` block, and our redirect must run earlier (right after the intl redirect check at line 224). Compute a local `strippedPathForHome` rather than reordering existing code (reordering risks the UTM/session logic). The cookie test uses `.includes('-auth-token')` not `.endsWith(...)` to also match **chunked** cookie names (`sb-<ref>-auth-token.0`, `.1`). **Verify the exact cookie name in staging** with `curl -sI` + an authed session.

**Unblocks:** homepage anon → static; logged-in → redirected at the edge.

**Verification gate:**
- `grep -n "createClient\|auth.getUser" "app/[locale]/page.tsx"` → zero.
- `next start`: anon `curl -sI http://localhost:3000/` → `200`; with a real `sb-…-auth-token` cookie → single `307 location: /trips` (no redirect chain).
- Loop check: `curl -sIL` with the cookie → exactly one hop to `/trips`, which then `307`s to `/auth/login` only if the cookie is stale (a *different* path — no cycle).

**Rollback:** `git revert <1b>`. Restores in-page redirect.

---

### PHASE 2 — The CSP/nonce change (the crux, isolated)

**Goal:** make the CSP a build-constant string so no page needs `headers()` for a nonce. This removes root forcer B and is the prerequisite for removing the 20 leaf `getNonce()` calls.

**Files:** new `lib/security/csp-hashes.ts`; `lib/security/csp.ts`; `lib/security/nonce.ts`; `middleware.ts`; `app/layout.tsx`; `components/AffiliateScript.tsx`; new `lib/security/csp-hashes.test.ts`.

**Step 2.1 — `lib/security/csp-hashes.ts` (NEW):**
```ts
import { createHash } from "crypto";
import {
  generateOrganizationSchema,
  generateWebSiteSchema,
  generateSoftwareApplicationSchema,
} from "@/lib/seo/structured-data";

// SHA-256 (base64) in CSP source form. Runs at MODULE-EVAL (Node build) time;
// the Edge middleware bundle carries only the resulting strings — createHash
// never executes on the Edge hot path. MUST serialize exactly as
// jsonLdScriptProps does (JSON.stringify, no spaces). Guarded by csp-hashes.test.ts.
const sha256Csp = (payload: string): string =>
  `'sha256-${createHash("sha256").update(payload, "utf8").digest("base64")}'`;

export const GLOBAL_JSONLD_HASHES: string[] = [
  sha256Csp(JSON.stringify(generateOrganizationSchema())),
  sha256Csp(JSON.stringify(generateWebSiteSchema())),
  sha256Csp(JSON.stringify(generateSoftwareApplicationSchema())),
];
```
> **MUST verify before coding:** open `lib/seo/structured-data.ts` and confirm how `jsonLdScriptProps` serializes the schema into the script body. If it uses anything other than bare `JSON.stringify(schema)` (e.g. pretty-printing, a wrapper, HTML-escaping of `<`), the hash input string MUST match that exact transformation byte-for-byte, or the hash won't match and the JSON-LD gets CSP-blocked in prod. This is the highest-precision step in the whole migration.

**Step 2.2 — `lib/security/csp.ts`:** drop the `nonce` param; make the policy constant.
```ts
import { GLOBAL_JSONLD_HASHES } from "./csp-hashes";

export function buildCspHeader(): string {   // no nonce param
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": [
      "'self'",
      ...GLOBAL_JSONLD_HASHES,   // replaces `'nonce-${nonce}'`
      "'strict-dynamic'",        // unchanged — already present at :35
      // ...the entire host-fallback allowlist (:39-50) UNCHANGED
    ],
    // style-src / font-src / img-src / connect-src / frame-src /
    // frame-ancestors / object-src / base-uri / form-action — ALL UNCHANGED
  };
  return Object.entries(directives).map(([k, v]) => `${k} ${v.join(" ")}`).join("; ");
}
```
`shouldEnforceCsp()` (`:106`) — **unchanged**.

**Step 2.3 — `lib/security/nonce.ts`:** neuter `getNonce()` so the 20 leaf call sites keep compiling AND stop calling `headers()`. *This is the single highest-leverage change* — it un-poisons all 20 leaves at once.
```ts
export async function getNonce(): Promise<string | undefined> {
  // DEPRECATED. CSP is now hash + strict-dynamic based (lib/security/csp.ts);
  // no per-request nonce exists. Returns undefined WITHOUT calling headers(),
  // which is what previously forced every page dynamic. jsonLdScriptProps(schema,
  // undefined) omits the nonce attribute — correct under the hash policy.
  // Kept as a no-op so the 20 call sites compile; remove in Phase 5 cleanup.
  return undefined;
}
```
`generateNonce()` can stay (deleted in Phase 5).

**Step 2.4 — `middleware.ts`:** remove nonce generation + request-header mutation.
- Delete `import { generateNonce } from "@/lib/security/nonce";` (line 6).
- Delete `const nonce = generateNonce();` (line 148) and `request.headers.set("x-nonce", nonce);` (line 152).
- `attachSecurityHeaders` (lines 159-166):
```ts
const attachSecurityHeaders = (response: NextResponse): NextResponse => {
  if (!shouldEnforceCsp(request.nextUrl.pathname)) return response;
  response.headers.set("Content-Security-Policy", buildCspHeader());  // no arg
  return response;                                                     // drop x-nonce echo
};
```
> Removing `request.headers.set("x-nonce", …)` matters: that mutation was a request-scoped write that, combined with leaf pages reading it back, coupled pages to the request. After §2.3 nothing reads `x-nonce`, so this is safe.

**Step 2.5 — `app/layout.tsx`:** remove forcer B and the nonce plumbing (forcer A is removed in Phase 3 — keeping them in separate commits preserves clean reverts).
- Delete `import { getNonce } from "@/lib/security/nonce";` (line 10).
- Delete `const nonce = await getNonce();` (line 193).
- `<script {...jsonLdScriptProps(organizationSchema, nonce)} />` → `jsonLdScriptProps(organizationSchema)` (lines 198-200; `jsonLdScriptProps` omits nonce when undefined — **no change to that helper**).
- `<GoogleAnalytics gaId={…} nonce={nonce} />` → drop `nonce={nonce}` (line 229).
- `<AffiliateScript nonce={nonce} />` → `<AffiliateScript />` (line 236).
- **Leave `const locale = await getLocale()` (line 187) and `<html lang={locale}>` (line 195) for Phase 3.** (RootLayout stays `async` until then.)

**Step 2.6 — `components/AffiliateScript.tsx`:** drop the `nonce` prop from the interface + the `<Script nonce={…}>` attribute (strict-dynamic trusts the `<Script>`-injected loader). **Read this file first** to confirm the prop name/usage before editing.

**Step 2.7 — `lib/security/csp-hashes.test.ts` (NEW, drift guard):** assert `GLOBAL_JSONLD_HASHES` equals the SHA-256 of the exact bytes `jsonLdScriptProps` would emit for each global schema. Fails CI if anyone edits a schema without regenerating the hash.

**Unblocks:** removes forcer B; prerequisite for Phase 4. (No route flips yet — forcer A still at root.)

**Verification gate (the careful one — PREVIEW DEPLOY MANDATORY):**
- `next build` green (confirms no Node `crypto` leaked into the Edge bundle — a leak fails the build here).
- `next start` AND a **preview deploy** (preview = `NODE_ENV=production` → CSP enforced). Open DevTools console on homepage + one blog post + `/destinations/<slug>`:
  - **Zero CSP violations.** Specifically confirm: (a) Next hydration runs (no "Refused to execute inline script"); (b) GA `gtag.js` loads; (c) Travelpayouts script loads after interaction; (d) the 3 JSON-LD blocks present in DOM — `curl -s <url> | grep -c 'application/ld+json'`.
  - `curl -sI <url> | grep -i content-security-policy` → present, `script-src` has **no `'unsafe-inline'`/`'unsafe-eval'`**, and is **byte-identical across two requests** (proves it's constant → cacheable).
  - Google Rich Results Test on the preview URL: Organization/WebSite/SoftwareApp + per-page Article/FAQ/Tourist still parse.

**Rollback (hardest revert — keep the pre-Phase-2 trio as the known-good restore):** `git revert <2>` restores `middleware.ts`+`csp.ts`+`nonce.ts`+`app/layout.tsx` nonce path exactly (task #199 state). Validate restore: CSP header again contains `'nonce-…'`, JSON-LD again carries `nonce`.

---

### PHASE 3 — Root-layout `lang` (forcer A) — the flip

**Goal:** remove the last whole-tree forcer. After this + Phase 2, the static machinery is live and the route table flips.

**Decision (owner lever #3):** **static `<html lang="en">` at the root + a tiny client component correcting `lang` per-locale in the `[locale]` subtree.** Rationale: a nested layout cannot re-emit `<html>` (only the root owns it), and there is no non-dynamic source for locale at the root (`getLocale()` itself reads `headers()`). Root `lang="en"` is correct for `/admin` (English-only) and the API-adjacent pages; per-locale `lang` is a *weak* signal — the **authoritative** locale signals (`<link rel="canonical">`, `hreflang`, `og:locale`) are emitted per-page by `generateMetadata` and are unaffected. Googlebot renders JS, so it sees the corrected `lang` anyway.

**Files:** `app/layout.tsx`; new `components/HtmlLangSync.tsx`; `app/[locale]/layout.tsx`.

**`app/layout.tsx`:**
- Delete `import { getLocale } from "next-intl/server";` (line 8).
- Make `RootLayout` non-`async` (remove `async`, line 182).
- Delete `const locale = await getLocale();` (line 187).
- `<html lang={locale}>` → `<html lang="en">` (line 195).

**`components/HtmlLangSync.tsx` (NEW, client, ~12 lines):**
```tsx
"use client";
import { useEffect } from "react";
// Corrects <html lang> on the client to the active locale. Root renders a
// static lang="en" so it stays statically rendered; this patches it for
// non-en locales without forcing the server render dynamic.
export default function HtmlLangSync({ locale }: { locale: string }) {
  useEffect(() => {
    if (document.documentElement.lang !== locale) {
      document.documentElement.lang = locale;
    }
  }, [locale]);
  return null;
}
```

**`app/[locale]/layout.tsx`:** mount it inside `NextIntlClientProvider` (`locale` already in scope from params; `setRequestLocale(locale)` already at `:33`):
```tsx
<NextIntlClientProvider messages={messages} locale={locale}>
  <HtmlLangSync locale={locale} />   {/* NEW */}
  {/* ...existing children... */}
```

**Why this doesn't break `/admin` or `/api`:** `/admin/**` renders through the unchanged root → `<html lang="en">` (correct). `/api/**` and `/auth/**` are route handlers (no `<html>`). `feed.xml`/`sitemap.ts`/`robots.ts` are non-HTML. None mount `[locale]/layout`, so none get `HtmlLangSync` — exactly right.

**Unblocks:** the route table flips. Leaves whose only remaining forcer is the leaf `getNonce()` flip after Phase 4; `tools`, `contact`, `terms`, `templates`, `privacy` (the "free" ones) flip to `○` immediately.

**Verification gate:**
- `npm run build` route table vs baseline: the "free" pages (`tools`, `contact`, `terms`, `privacy`, `templates` after `setRequestLocale` added — see Phase 4) now show `○`; `blog/[slug]`, `destinations/[slug]` show `●` once Phase 4's leaf-nonce removal lands.
- **`/admin` still renders WITH `<html>/<body>`** (highest-value check — admin has no own layout): `curl -s <preview>/admin` (anon → redirect, but the redirect target page must still have a valid shell) and an authed admin load with no "missing html"/hydration crash.
- Per-locale: `curl -s <preview>/it/blog | grep -oE '<html[^>]*lang="[^"]*"'` → ships `lang="en"` in raw HTML (corrected to `it` on client — acceptable); `grep -E 'hreflang|og:locale'` confirms authoritative locale signals intact.

**Rollback:** `git revert <3>`. One-line restore of `getLocale()`.

---

### PHASE 4 — Per-leaf `getNonce()` removal + `setRequestLocale` adds + `revalidate` (forcer C + ISR)

**Goal:** the final per-route flip + ISR cadence. Batched into sub-commits by page family so the QA matrix can isolate any regression.

**Files (20 leaf `getNonce()` files, verified via grep):**
`app/[locale]/page.tsx`, `backpacker`, `ai-itinerary-generator`, `budget-trip-planner`, `family-trip-planner`, `group-trip-planner`, `weekend-trip-planner`, `solo-trip-planner`, `free-ai-trip-planner`, `tools/visa-checker`, `tools/packing-list`, `blog/[slug]`, `blog/page`, `blog/tag/[tag]`, `destinations/style/[tag]`, `destinations/page`, `destinations/[slug]`, `about/authors/[slug]`, **`shared/[token]`** (⚠️ stays `ƒ` — see below), `app/layout.tsx` (already done in Phase 2).

**Per file:** delete `const nonce = await getNonce();` and the `getNonce` import; change `jsonLdScriptProps(schema, nonce)` → `jsonLdScriptProps(schema)`. Because Phase 2 already neutered `getNonce()`, these edits are **functionally no-ops** (cosmetic) — the pages already went static at Phase 3. This makes Phase 4 low-risk: a missed file still works.

**⚠️ `shared/[token]/page.tsx`:** removing its `getNonce` is fine cosmetically, but this page **stays `ƒ`** (token-gated, `noindex`) — do NOT add `revalidate` or expect it to cache. Leave its dynamic nature intact.

**Add `setRequestLocale` (sub-commit):** `templates/page.tsx` and `privacy/page.tsx` call `getTranslations` without `setRequestLocale` in the body — add `setRequestLocale(locale)` at the top of each (after resolving `locale` from params). Add defensively to `terms/page.tsx` too. **Without this, these pages may throw or mis-render under static generation.**

**Add `revalidate` (sub-commit):** add `export const revalidate = <n>` to content routes that benefit:
- blog already has `revalidate=3600` (`blog/page:36`, `blog/tag/[tag]:30`) — leave.
- Mirror `3600` on: `blog/[slug]`, `destinations/page`, `destinations/[slug]`, `destinations/style/[tag]`, the 7 pillars, `tools/*`, `about/authors/[slug]`. (Pure-static legal/contact need none — they're `○`.)

**`tools/visa-checker` searchParams note:** it reads `searchParams` (`:52/:105`) for from/to prefill → **Next treats any `searchParams`-reading page as dynamic regardless of CSP.** Options: (i) accept it stays `ƒ`-but-cheap (no `headers()`), or (ii) move the prefill to a client component reading `useSearchParams` so the page shell goes static. Recommend (i) for v1 (smaller diff); flag (ii) as a follow-up.

**Verification gate:** per sub-commit, on preview: `x-vercel-cache` flips `MISS→HIT` on a 2nd curl of each affected URL; JSON-LD still present (nonce-free); ISR honored (edit a blog frontmatter, redeploy, confirm refresh after TTL). Route table: every targeted leaf → `●`/`○`; `shared/[token]`, `trips/*`, auth, admin **stay `ƒ`**.

**Rollback:** `git revert` the specific leaf-group sub-commit. Independent of all other phases.

---

### PHASE 5 — Cleanup (hygiene)

**Goal:** remove dead code now that nothing uses the nonce.

**Changes:** delete `generateNonce()` + `getNonce()` from `nonce.ts` if `grep -rn "getNonce\|generateNonce" app/ lib/ components/` shows zero remaining references; prune any dead CSP fallback hosts; update `docs/static-migration/`.

**Verification gate:** full route-table + QA-matrix re-run identical to end-of-Phase-4 (cleanup changed nothing). `npm run build` green; `grep` confirms zero `getNonce` references.

**Rollback:** `git revert <5>`.

---

## 5. FULL QA MATRIX (run in `next start` + preview, then prod canary)

Run **page type × {en (unprefixed), es, it, pt} × {anon, logged-in, Googlebot UA}**. Googlebot UA: `curl -A "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" <url>` — **`next.config.ts:43 htmlLimitedBots` forces synchronous metadata for these UAs**, so canonical/hreflang must appear in the *initial* HTML for the bot path, not streamed. Verify that path explicitly.

| Page type | Example URLs | Must-check |
|---|---|---|
| Homepage | `/`, `/it` | renders; JSON-LD (Org/WebSite/SoftwareApp + FAQ); **anon = landing (`200`, cache HIT), logged-in = `307 /trips`**; no console CSP error |
| Blog index | `/blog`, `/es/blog` | renders; `revalidate=3600`; canonical+hreflang in `<head>`; cache HIT |
| Blog post | `/blog/<slug>`, `/it/blog/<slug>` | Article+Breadcrumb+FAQ JSON-LD; `●`; cache HIT |
| Destinations hub | `/destinations`, `/pt/destinations` | grid; JSON-LD; cache HIT |
| Destination detail | `/destinations/paris`, `/it/destinations/rome` | Tourist/Breadcrumb JSON-LD; **trending-trips block loads (forcer-E fix)**; `●`; cache HIT |
| Explore | `/explore`, `/it/explore` | feed renders (forcer-E fix); hreflang present (tasks #209/#210); robots=index; filters work; **stays `ƒ` (searchParams) — cache MISS is OK here** |
| Tools | `/tools`, `/tools/packing-list`, `/tools/visa-checker` | render; JSON-LD; cache HIT (visa-checker may stay `ƒ` — searchParams) |
| Landings ×7 | `/free-ai-trip-planner`, `/es/group-trip-planner`, … | render; JSON-LD; canonical/hreflang; cache HIT |
| Authors | `/about/authors/<slug>` | renders; `●`; cache HIT |
| Legal/contact | `/privacy`, `/terms`, `/contact`, `/it/privacy` | render (correct locale strings — the `setRequestLocale` adds); cache HIT |
| Backpacker | `/backpacker`, `/it/backpacker` | renders; live stats block; cache HIT |
| /trips (dynamic) | `/trips` | **stays `ƒ`**; anon→`/auth/login?redirect=`; logged-in dashboard; no-store |
| /admin (dynamic) | `/admin` | **stays `ƒ`**; has `<html>/<body>`; anon→login; non-admin→`/`; admin sees page |
| Auth | `/auth/login`, `/it/auth/signup` | render; logged-in→`/trips`; `/auth/callback` OAuth works |
| Shared (dynamic) | `/shared/<token>` | **stays `ƒ`**; trip renders; OG image; **noindex preserved** |

For **every** cell: renders without error · correct `lang`/locale strings · JSON-LD present where expected · images load · **no hydration error in console** · **no CSP violation in console** · CSP header present · auth-redirect behavior unchanged.

---

## 6. RISK REGISTER

| # | Failure mode | Likelihood | Pre-prod detection | Mitigation |
|---|---|---|---|---|
| R1 | **CSP blocks Next bootstrap** (strict-dynamic/hash wrong) → whole site blank/unhydrated | Med | Phase-2 preview console: "Refused to execute inline script"; canary checks for hydration marker | strict-dynamic already proven in prod today; preview gate mandatory before promote; `git revert <2>` |
| R2 | **CSP blocks the 3 JSON-LD blocks** (hash ≠ emitted bytes) → SEO silently breaks | Med | `curl \| grep -c application/ld+json`; Google Rich Results on preview; drift test `csp-hashes.test.ts` | hash input MUST match `jsonLdScriptProps` serialization byte-for-byte (verify in structured-data.ts first); drift test in CI |
| R3 | **Node `crypto` leaks into Edge bundle** (csp-hashes imported at request time) | Low | `next build` fails loudly at Phase 2 | hashes computed at module-eval (build) only; Edge carries frozen strings |
| R4 | **Homepage redirect loop** (middleware + page both redirect, or cookie test wrong) | Med | `curl -sIL` with auth cookie on preview: must be single `307→/trips` | presence-only check; `/trips` never matches `strippedPath==='/'`; cookie name verified in staging (`.includes('-auth-token')` for chunked) |
| R5 | **GA / Travelpayouts / Sentry / PostHog scripts die** (nonce dropped) | Low | Phase-2 preview network tab: confirm `gtag`/affiliate/ingest fire | strict-dynamic trusts `<Script>`-injected loaders; host-allowlist fallback retained |
| R6 | **`/admin` loses `<html>/<body>`** (root layout edit) | Med | Phase-3 QA `/admin` cell in `next start`: raw HTML has `<html>`+`<body>` | root keeps emitting shell (only `getLocale` removed, not `<html>`); admin English-only so `lang="en"` correct |
| R7 | **Locale detection breaks** → `/es /it /pt` serve EN content | Med | QA all-locales row; `setRequestLocale` in `[locale]/layout:33` must still drive messages | only `getLocale()` removed at root; `setRequestLocale` untouched and now finally effective |
| R8 | **OG/canonical/hreflang regression** (static metadata) | Low | `curl \| grep -E 'canonical\|hreflang\|og:'` per type vs baseline; Googlebot-UA curl (htmlLimitedBots sync path) | metadata is per-page `generateMetadata`, unaffected by render mode |
| R9 | **`templates`/`privacy` throw under static** (missing `setRequestLocale`) | Med | Phase-4 build + QA legal/templates cells | add `setRequestLocale` (Phase 4 sub-commit) before expecting them static |
| R10 | **Preview-deploy explore fetch fails** (constant base URL unreachable from preview) | Low | Phase-1a gate runs ON a preview deploy specifically | base falls through to prod public feed (read-only, harmless) |
| R11 | **`x-vercel-cache` never HITs** (hidden `cookies()/headers()` remains) | Low | route table shows unexpected `ƒ` → `grep` route's import graph for `headers()/cookies()/draftMode()` | per-leaf forcer table is exhaustive; drift caught by route-table diff |
| R12 | **`shared/[token]` mistakenly made static** (loses noindex/token gating) | Low | QA shared cell: must stay `ƒ`, noindex preserved | explicitly excluded from `revalidate` adds; flagged in Phase 4 |

**Detection ladder (every change):** (1) `next build` route table → (2) local `next start` (hydration + CSP console) → (3) **preview deploy** (`x-vercel-cache`, real CDN, real bot UA) → (4) prod canary (§7). Nothing reaches users without clearing 1-3.

---

## 7. THE ONE CANARY (post-deploy, per phase)

Single probe, run after every phase's prod deploy:
```bash
for U in / /it/blog /destinations/paris /explore /trips /admin; do
  curl -sI "https://monkeytravel.app$U" \
    | grep -iE 'HTTP/|x-vercel-cache|content-security-policy|location'
done
# JSON-LD survival check:
curl -s https://monkeytravel.app/ | grep -q 'application/ld+json' && echo "JSON-LD OK"
```
**Healthy (after Phase 4):** `/` → `200` + `x-vercel-cache: HIT` (anon); `/it/blog` → `200` HIT; `/destinations/paris` → `200` HIT; `/explore` → `200` (MISS OK — `searchParams`); `/trips` → `307 location:/auth/login` (anon, `ƒ`/MISS — correct); `/admin` → `307 location:/auth/login` (`ƒ` — correct); CSP header present on all with **no `'unsafe-inline'`** in `script-src`; `JSON-LD OK`.

**Any deviation = immediate `git revert` of the last deployed phase:** a static route showing `MISS` twice · a `ƒ` route that should be cached · missing CSP · missing JSON-LD · `/admin` returning `200` to anon · a redirect chain on `/`.

**Per-phase canary expectations:** Phases 0-2 → everything still `ƒ`/`MISS` (CSP header constant across two requests is the Phase-2 signal, NOT cache HIT). Phase 3 → "free" pages flip to HIT. Phase 4 → all targeted leaves HIT.

---

## RESOLVED DIVERGENCES (where the three reports disagreed or left gaps)

1. **`getNonce` call-site count:** reports said "13", "18", and "20." **Verified: exactly 20 files** (grep result above). Phase 4 lists all 20.
2. **Env var name** for the explore base URL: reports used `NEXT_PUBLIC_SITE_URL` and `NEXT_PUBLIC_APP_URL` interchangeably. **Resolution: grep the repo for the already-defined name before coding; do not assume.**
3. **Homepage redirect placement:** `middleware.ts:231` strips locale AFTER `isPublicOnly`, but the redirect must run earlier (after line 224). **Resolution: compute a local `strippedPathForHome`; do not reorder existing UTM/session code.**
4. **Cookie test:** `endsWith('-auth-token')` misses chunked cookies. **Resolution: use `.includes('-auth-token')`; verify exact name in staging.**
5. **`<html lang>`:** Report 3 floated "accept `lang="en"` + rely on hreflang" vs Report 2's client-sync component. **Resolution: client-sync component (`HtmlLangSync`)** — keeps user-facing/a11y `lang` correct at zero render-mode cost, while hreflang remains the SEO authority. Both are compatible; the component is strictly better for screen readers.
6. **`jsonLdScriptProps` serialization** is the load-bearing unknown for R2. **Resolution: MUST read `lib/seo/structured-data.ts` and match the hash input to its exact serialization before writing `csp-hashes.ts`.**

**Files to open first when execution begins (in order):** `lib/seo/structured-data.ts` (confirm `jsonLdScriptProps` serialization — gates R2), `components/AffiliateScript.tsx` (confirm nonce prop), `app/[locale]/layout.tsx` (confirm `locale` scope for `HtmlLangSync`), then grep for the canonical `NEXT_PUBLIC_*_URL` env var.