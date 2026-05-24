# Live E2E UX Audit — 2026-05-24

**Method:** drove a real Chrome browser through monkeytravel.app at 1440×900
desktop viewport. Captured screenshots, console messages, and network
behavior on each surface. Mobile viewport attempted but the resize tool
only changed the outer window, not the rendered viewport — those findings
need a real device.

**Verdict:** the app is genuinely good, with two surprises:
1. There are *more* P0 bugs than the COLLAB_AUDIT caught — the brand-
   duplication fix only addressed one page; the same bug exists across
   the blog and probably others.
2. The wizard has a real interactive-lag problem on step 2 that froze
   the renderer twice during testing. Not visible in our @prod test
   suite because the suite only hits the API, never clicks the UI.

---

## Findings — by severity

### 🔴 P0 — Real bugs visible to every user

| # | Finding | Evidence | Fix |
|---|---|---|---|
| **L-B1** | **Brand duplication in `<title>` is widespread, not just `/invite/`.** Live blog page title is `"Travel Planning Blog \| MonkeyTravel \| MonkeyTravel"`. B2 only patched the invite metadata; the blog (and probably destinations, trip detail, etc.) all set `title: "X \| MonkeyTravel"` and then the root layout's `template: "%s \| MonkeyTravel"` doubles it. | Screenshot of `/blog` tab title. | Audit every `generateMetadata` in the app for `title: "... | MonkeyTravel"` strings — strip the suffix. **2 hr** for a full sweep, ~5 min per page. |
| **L-B2** | **Blog listing card BODY shows the metadata title with brand suffix as content.** Featured article on `/blog` reads `"2026 Travel Calendar: Where to Go Every Month \| MonkeyTravel"` — visible to the user as if "| MonkeyTravel" is part of the article title. Looks broken. | Same screenshot — see the H2 in the EDITOR'S PICK card. | The blog listing component is rendering `frontmatter.seo.title` instead of `frontmatter.title`. Use the human title field, not the SEO meta one. **30 min.** |
| **L-B3** | **Hero phone mockup fails to render on first paint** (black rectangle). Reproduced on every fresh navigation to monkeytravel.app and to the wizard. After dismissing the cookie banner OR after some delay, the image loads. So the bug is real but the user only sees it for ~3-8 seconds; still — that's the first impression. | Two screenshots: black-phone on first nav, populated phone after dismissing cookie banner. | Most likely a render-blocking initial-paint priority issue. Add `priority` on the Next/Image, or `fetchpriority="high"`, or move the cookie banner mount out of the LCP path. **1 hr investigation + 30 min fix.** |
| **L-B4** | **Cookie consent banner blocks the entire hero CTA on first paint.** Banner appears at bottom-center, ~600px wide, BLOCKING the "Plan a Trip Together" / "Sign In" buttons + the phone mockup. Every first-time visitor sees this stacked over the primary conversion CTA. | Screenshot. | Move the banner to a slim bottom strip (cookie-bar style, not modal-card), OR delay-mount it 1-2s after LCP so the hero gets first impression. **2 hr.** |
| **L-B5** | **Wizard step 2 renderer freezes on vibe-card clicks.** Reproduced twice in this audit. Clicking 1-2 vibe cards in quick succession → renderer becomes unresponsive (screenshot tool times out at 30s waiting for `Page.captureScreenshot`). No console errors. Probably a heavy re-render chain (state updates → multiple analytics events → blocking effect). | Two consecutive `browser_batch` calls hung the screenshot tool. Console had zero error messages. Recovered only by hard nav away. | Profile with Chrome DevTools Performance tab while clicking vibes. Likely candidates: analytics fire-and-forget should `await idle`, or a heavy unmount of `StartAnywhereSection` / `SeasonalContextCard`. **1 day investigation.** |

### 🟠 P1 — Significant friction

| # | Finding | Evidence | Fix |
|---|---|---|---|
| **L-F1** | **Nav auth-state placeholder pills are visible too long on first paint.** "Sign In" + "Get Started" CTAs are two empty pill shapes for ~500ms-1s while `getUser()` resolves. They look like broken/disabled buttons. | First screenshot of homepage. | Render the logged-out CTAs by default (no auth resolution needed for first-paint state) and swap to the logged-in state after auth resolves. Inverts the current "loading placeholder → real" model into "default → swap." **1 hr.** |
| **L-F2** | **Wizard "Adventure" vibe is suggested on step 1 (seasonal context) but NOT pre-applied on step 2.** User sees "SUGGESTED VIBES FOR THIS SEASON: Adventure" on step 1, expects it to be auto-checked on step 2, has to manually pick it. | Screenshot of step 1 seasonal card showing Adventure suggestion, screenshot of step 2 with `0 / 3 selected`. | Pre-select suggested vibes on step 2 (with a "we picked these for the season — change if you want" hint). Keeps user in flow if they agree, lets them override if not. **1 hr.** |
| **L-F3** | **Seasonal-context card shows DIFFERENT dates than what the user picked.** User picks Jun 15–20; the season card shows "Jun 14, 2026 - Jun 19, 2026" (off by 1 day). Confusing — looks like a calculation bug. | Screenshot showing date mismatch. | Investigate `lib/seasonal/index.ts` — the date range it derives for the seasonal lookup might be using `< endDate` instead of `<= endDate`, or generating its own week-aligned range. **1 hr.** |
| **L-F4** | **"With friends" toggle selected-state contrast is too subtle.** Selected button has thin pink border + 5% pink fill (`bg-[var(--primary)]/5`) — easy to miss "which one did I pick?" at a glance. The unselected button is full-bleed white. | Screenshot showing both states side by side. | Bump to 10-15% fill on selected, or use a stronger ring. **15 min.** |
| **L-F5** | **Person/group icons in the "Who's coming?" toggle are dark navy, not brand-pink.** Inconsistent with the brand language elsewhere (primary-color icons in most components). | Screenshot. | Use `text-[var(--primary)]` on the icons. **5 min.** |
| **L-F6** | **Wizard step 1 has visual overlap risk between the open date picker and Continue button.** When the date picker expands below the dates row, the Continue button is right next to where the calendar floats. On smaller heights it could overlap. | Screenshot showing calendar overlay + Continue at same Y. | Either render date picker as a popover (positioned above, not below), OR push Continue down when picker is open. **1 hr.** |
| **L-F7** | **Page renderer hangs on deep homepage scroll.** Reproducible: scrolling 60+ ticks down the homepage → renderer becomes unresponsive (screenshot times out). Likely the Travelpayouts affiliate script or another heavy embed in the footer area is hitting the main thread hard during scroll. | Renderer timeout on `Page.captureScreenshot` after the "What you won't find here" section. | Profile + identify the culprit script. Likely `lazyOnload` strategy isn't enough — needs `afterInteractive` with intersection-observer mounting. **3 hr.** |

### 🟡 P2 — Smaller polish issues

| # | Finding | Fix |
|---|---|---|
| **L-P1** | "With friends" hint says "Group-first planning is coming soon" — implies the feature is broken today. But the user CAN already invite friends post-generation. Either remove the "coming soon" framing (since the existing invite flow already works), or follow through with the Phase 2 restructure. | **15 min copy fix.** |
| **L-P2** | The invalid-shared and invalid-invite icons aren't pixel-identical (invite has `!` inside the triangle; shared doesn't). Same conceptual error, slightly different icon. | Standardize on one icon. **5 min.** |
| **L-P3** | "62 articles" badge on `/blog` is shown but no way to filter/sort visible from this viewport. Maybe further down — not verified. | **Nil if filter exists below the fold; otherwise wishlist.** |
| **L-P4** | Hero badge `"Free for You and Your Crew"` repeats `"100% Free / Up to 8 Friends / 30 Seconds"` checklist immediately below — could feel repetitive. Two near-identical claims of free-ness within 5 lines of each other. | A/B test removing the badge. **No-op until we have data.** |
| **L-P5** | Console pollution: 345+ Chrome-extension warnings on every page load (a TensorFlow-based extension installed in the test browser). Not our problem, but suggests we should add a Sentry breadcrumb filter to keep extension noise out of our own error reports. | **30 min filter setup.** |

---

## Things that are notably GOOD (worth keeping)

| Surface | Why it works |
|---|---|
| **Hero copy** | "Plan Trips With Friends in 30 Seconds" + "everyone can vote on, edit, and make their own" sets the differentiator immediately. |
| **Problem-statement section** ("Group trips fall apart before they start") | Excellent emotional framing — names the pain users actually feel before pitching the solution. |
| **"Built Different" feature section** with the "Unique" badge on "Built for Groups" | Clear positioning vs other AI trip planners. The "No fake places — Verified Places" card directly addresses the AI-hallucination concern. |
| **"What you won't find here"** transparency section | Bold copy choice. "No paywall / No app download / No fake places / No solo-only planning / No generic lists" reads as opinionated and confident. |
| **Auto-flip from check-in → check-out picker** | Beautiful UX. Picker auto-advances; check-out gets ringed focus; check-in shows filled icon. |
| **Live weather forecast on date selection** | Genuinely premium — "23°C – 33°C, occasional rain possible, ~2 rainy days expected." Real differentiator vs Mindtrip/Layla. |
| **Holidays & Events card** ("Summer Solstice" for June trip) | Cultural-context layer that competitors don't have. |
| **Seasonal vibe suggestion** ("Suggested vibes for this season: Adventure") | Reduces decision cost, even if it's not yet pre-applied on step 2 (see L-F2). |
| **/shared/{invalid}** error page (after this session's fix) | Friendly card, clear copy, single CTA. Matches the invite-error layout. |

---

## Sequencing recommendation

Highest leverage first:

1. **L-B1 + L-B2** — fix the brand duplication everywhere + the visible "| MonkeyTravel" in article cards. Both make the app look unpolished to every visitor. **2.5 hr total.**
2. **L-B3 + L-B4** — fix the cookie banner blocking the hero + the broken phone-mockup-on-first-paint. These ARE the first-impression issues. **3 hr.**
3. **L-B5** — investigate the wizard step-2 renderer freeze. May be 30 min, may be 1 day. We don't know until we profile. **0.5-1 day.**
4. **L-F1 + L-F2 + L-F4 + L-F5** — wizard polish: nav loading state, pre-apply suggested vibes, toggle contrast, icon colors. **~2 hr bundled.**
5. **L-F3** — seasonal date-mismatch investigation. **1 hr.**
6. **L-F6 + L-F7** — date picker layout + scroll-hang script. **4 hr combined.**

**Total: ~2 dev-days** for everything in P0 + P1.

---

## What I didn't get to (worth doing next)

- **Full mobile viewport pass.** The Chrome MCP resize only changed the outer window, not the rendered viewport. Need a real iPhone/Android device or Chrome DevTools device emulation via a different tool.
- **Generation end-to-end** — never reached the result page because step 2 froze. Result page UX, share modal trigger, save → auth flow all unverified live this round.
- **Save → auth modal flow** — same reason.
- **Blog detail page** rendering — only saw the listing.
- **Destination detail pages** — not visited.
- **Tag pages** (`/blog/tag/...`) — not visited.
- **Authentication-required surfaces** (`/profile`, `/trips`, bell dropdown, preference center) — would need a seeded test user.
- **The new email-invite UI in ShareAndInviteModal** — only viewable on an authenticated trip-detail page.
