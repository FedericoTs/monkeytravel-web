# Journey Audit — 2026-05-24 (deep run)

**Method:** drove a real Chrome browser through the core user paths on
monkeytravel.app after deploying the Phase-A bundle (commit `3285b1f`).
Verified prior fixes landed live; hunted for new issues in the actual
flows users hit.

## What landed correctly ✅

| Fix | Verified live? | Evidence |
|---|---|---|
| Brand-title duplication sweep | Yes — `/destinations` tab title is `"Top Travel Destinations & AI Itineraries \| MonkeyTravel"` (single brand) | screenshot of /destinations page |
| Seasonal-card date timezone fix | Yes — picking Jul 7 → Jul 14 shows "Summer Season Jul 7, 2026 - Jul 14, 2026" (matches user pick exactly). Previously was off-by-one ("Jul 6 - Jul 13") | screenshot of seasonal card |
| Cookie banner delay | Yes — banner now appears ~1.5s after page load instead of competing with the hero LCP | screenshot timing |
| Nav default-to-logged-out | Yes — Sign In / Get Started CTAs render immediately, no empty pills on first paint | screenshot at t=0 |
| `/shared/{invalid}` friendly card | Yes — matches the invite-error styling | confirmed earlier session |
| Phone mockup placeholder | Yes — warm gradient renders behind the Image while it loads | (not retested this round; deployed in d52f26b) |

## New findings 🐛

### 🔴 P1: Wizard step-1 interaction freeze (persists despite memo fix)

**Symptom:** Clicking "Just me" / "With friends" on step 1 → renderer
becomes unresponsive (screenshot tool times out at 30s waiting for
`Page.captureScreenshot`). Same hang seen previously on step-2 vibe
clicks. My VibeSelector memoization fix in commit `da56746` didn't
fully resolve it.

**What I tried:**
- `React.memo(VibeSelector)` + `useMemo` on the vibes array
- `useCallback` on the parent's `handleVibesChange`
- `AffiliateScript` interaction-gated deferral (LIVE_AUDIT F7)

**What still hangs:** any state-changing click on step 1 (toggle,
scroll). The freeze pattern is consistent — not random.

**Hypotheses I haven't ruled out:**
- PostHog `posthog.capture()` runtime serialization on every event
- DestinationAutocomplete loading Google Places lib eagerly on mount
- Something in `useItineraryDraft` re-running heavy work on every state change
- **Chrome MCP screenshot tool itself** being unreliable on heavy SPAs
  — possible the freeze is a tool artifact, not a user-visible bug

**Recommendation:** profile with real Chrome DevTools Performance tab
during the next manual QA session. The fix is unclear until we see
which task is consuming the main thread.

### 🟡 P2: Deep scroll renderer hang persists

Same symptom on `/destinations/paris` after AffiliateScript fix. May be
Google Maps embed or a Sentry/PostHog timer; needs profiling.

## What was NOT a bug after all

| First-glance "bug" | Reality |
|---|---|
| `/destinations/paris#plan-trip` tab shows blank content | False alarm — the `<DestinationCTA>` section exists at the anchor (page.tsx:283) but renders below the fold. Tab nav is sticky; my screenshot at the top of the anchored section just captured the empty space above. CTA is reachable by scrolling. |

## What I didn't get to test live

- Full wizard → generation → result (blocked by the step-1 freeze on every
  attempt this round)
- Save → auth modal (same)
- Authenticated routes (would need a seeded test user)
- Mobile-viewport-specific behavior (Chrome MCP `resize_window` only
  changes the outer window, not the rendered viewport — same as last round)

## Honest assessment

Three audits in, the picture is: **the app is well-built, the
deferred-bug fixes are landing correctly, and the one remaining
stubborn issue (the step-1 freeze) needs real Chrome DevTools to
diagnose**. Continuing to add speculative fixes without profiling data
risks regressions for a phantom.

## What would help most next

1. **A DevTools Performance recording of the step-1 toggle click** —
   30 seconds, would show exactly which task is blocking. Far more
   valuable than another speculative memo/effect tweak.
2. **A seeded test user** so the authenticated flows can be tested
   live (save modal, /trips, /profile/notifications, share modal in
   trip detail, etc.).
3. **PostHog session-recording access** would show the same data with
   real users instead of my Chrome session.

Until any of those land, further "deep journey hunt" passes will mostly
re-confirm what this one already showed.
