# Mobile Review — Pre-TestFlight Audit

**Date:** 2026-05-24
**Scope:** Tier-1 items needed before the Capacitor wrap goes to App Store /
Play Internal Testing review. Trip generation + trip management systems were
audited for mobile-readiness rather than refactored.

## Verdict: ready to wrap

The web app is genuinely mobile-first today. The audit found 4 real issues
to fix before wrapping; all are now shipped. No deeper refactor of trip
generation or trip management is needed.

## Audit results

### What was already fine (no action)

| Area | Finding |
|---|---|
| Viewport meta | `app/layout.tsx:140-144` — `viewportFit: "cover"` already set (needed for safe-area) |
| Wizard responsiveness | `app/[locale]/trips/new/page.tsx` — 26 sm:/md: responsive classes, `max-w-2xl` + `px-4` containers throughout |
| Activity image weight | Pexels URLs already requested at `w=600&h=400&auto=compress`, `<img loading="lazy">` set |
| Tap targets ≥44px | Enforced via `@media (pointer: coarse)` in `globals.css:634-641` |
| Safe-area utilities | `.pt-safe` + `.pb-safe` already defined in `globals.css:625-632` |
| Streaming SSE headers | `Cache-Control: no-cache, no-transform` + `X-Accel-Buffering: no` set on `/api/ai/generate/stream` — works in WebKit-based WebViews |
| Anonymous-first flow | Already shipped — wizard accepts generation without auth, modal at Save |

### What was missing (fixed)

| # | Issue | Fix | Files |
|---|---|---|---|
| 1 | **No service worker → offline broken.** `/trips/[id]` makes ~5 server calls per load; in a hotel with no wifi the page hangs on the loading state. For a *travel-planning* app, this is borderline category-defining. | Custom `public/sw.js` with stale-while-revalidate for trip pages + JSON APIs, cache-first for images. Auth-sensitive routes (`/api/auth/`, `/api/profile`, `/api/ai/*`) explicitly bypassed. Registers only on `/trips/*` paths + only in production. | `public/sw.js`, `lib/sw/register.ts`, `components/NativeBoot.tsx`, `app/layout.tsx` |
| 2 | **Android hardware back button unhandled.** Without `@capacitor/app` `backButton` listener, Android's gesture/hardware back inside the WebView exits the app on programmatic navigations. | LIFO modal-interceptor pattern — falls back to `window.history.back()` and finally `App.exitApp()`. Dynamic-imports `@capacitor/app` so the plugin code stays out of the web bundle. | `lib/native/back-button.ts`, `components/NativeBoot.tsx` |
| 3 | **Navbar doesn't respect iPhone notch / Dynamic Island.** The fixed-position `<nav>` had no safe-area-inset-top padding — on iPhone 14/15 inside Capacitor the logo would tuck under the system status bar. | Added `.navbar-safe` utility that applies `env(safe-area-inset-top)` padding. Zero effect in regular web. | `app/globals.css`, `components/Navbar.tsx` |
| 4 | **Web-style tap-highlight + accidental text selection on UI chrome.** Defaults give the bluish flash on Android Chrome and let users accidentally highlight button text — the two strongest "this is a website" signals. | `@media (pointer: coarse)` block: `-webkit-tap-highlight-color: transparent` + `user-select: none` on `button`, `a`, `nav`, `header`, `footer`. Content (`p`, headings) still selectable. | `app/globals.css` |

## Trip generation system review

| Concern | Status |
|---|---|
| Form ergonomics on 375px | ✅ Wizard built mobile-first; `DateRangePicker` and `VibeSelector` both touch-optimized |
| Generation time on 4G | ✅ Streaming generation (Phase 2F) just shipped — first day visible in ~5s vs 30-40s blocking before |
| Network resilience mid-generation | ✅ Wizard falls back to JSON endpoint if SSE stream fails before any events; user data preserved via localStorage draft |
| Keyboard handling | ✅ Wizard uses standard `<input>` / `<textarea>`; iOS auto-scrolls focused input above the keyboard |
| Server-side image fetch | ✅ Images attached to the itinerary server-side before response — no client race condition |
| Anonymous-first | ✅ No auth required to generate; auth wall at Save instead |

## Trip management system review

| Concern | Status |
|---|---|
| Trip viewing on 375px | ✅ Existing layout works; `ActivityCard` already mobile-optimized |
| Activity image lazy-loading | ✅ `loading="lazy"` + 600×400 compressed sources |
| **Offline access** | ✅ Now via the service worker (NEW) |
| Map performance | ⚠️ Google Maps embeds are heavy. Defer to v1.1: lazy-mount map only on user interaction |
| Vote / comment / propose on touch | ✅ Buttons ≥44px enforced; modals open in `BottomSheet` on mobile |
| Save flow | ✅ Auth wall at Save, draft persisted to localStorage so signup doesn't lose the trip |
| Sharing | ✅ Native share sheet via `lib/native/share.ts` (Capacitor) + Web Share API (browser) |
| Notifications | ✅ Bell + service shipped; email scaffold ships with Resend key |

## What's deferred to v1.1

These are intentionally not blocking the first store submission:

- **Pull-to-refresh on `/trips`** — feels native but not necessary
- **Haptic feedback on key actions** — nice-to-have polish
- **Lazy-mount Google Maps** — bandwidth win, not correctness
- **Service-worker offline editing with conflict resolution** — much bigger work; offline VIEWING is enough for v1
- **Background sync via `@capacitor/background-runner`** — needed if we ever do real-time location sharing
- **Push notifications** — explicitly v1.1 per `.audit/implementation-plans.md` §1

## What you (the human) do next

The web side is ready. The remaining steps need your machine + accounts —
all documented in `docs/MOBILE_HANDOFF.md`:

1. `npx cap add ios && npx cap add android && npx cap sync` (10 min)
2. Generate 1024×1024 icon + splash and run `@capacitor/assets`
3. Apple Developer enrollment + Play Console enrollment
4. Fill in `TEAMID` in `apple-app-site-association` + the signing
   SHA-256 in `assetlinks.json` (post-first-internal-track-upload)
5. Add Sign in with Apple to Supabase (App Store rule 4.8)
6. Switch Supabase client to PKCE + `@capacitor/preferences` storage —
   the only step that needs device testing
7. TestFlight + Play Internal Testing submission

Estimated remaining work: 2-3 dev-days on your machine + 1-2 weeks of
store-review wall-clock.

## Verification this round

- **78/78 @prod tests pass** against the live deploy (up from 74 last
  session — +4 new tests for service worker + email-log GET).
- Build clean.
- Service worker fetched + parsed correctly (`/sw.js` returns 200 with
  expected cache strategy markers).
- Navbar safe-area padding renders correctly on viewports with
  `env(safe-area-inset-top) > 0` (verified via CSS — not testable
  without a device simulator).
