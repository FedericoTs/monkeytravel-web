# Mobile App Conversion Plan — Roadmap to Booking/Airbnb-Class

**Date:** 2026-05-30
**Status:** planning doc
**Audience:** Federico (solo founder) + future contributors
**Predecessor docs:** `docs/MOBILE_HANDOFF.md` (submission checklist) and
`docs/MOBILE_REVIEW.md` (pre-TestFlight web-side audit). Read those first.

## Why this doc exists

The Capacitor wrap is built. The web side passes the pre-TestFlight audit.
The remaining "you submit it" steps live in `MOBILE_HANDOFF.md` and are
unblocked.

But "shipped to the store" ≠ "feels like Booking.com / Airbnb." Those apps
have years of native-feel polish: push notifications that earn opt-in,
biometric quick-login, tab-bar nav, native maps, pull-to-refresh, haptic
feedback on the right moments, deep-linked share URLs that open the right
trip when tapped, and a monetization layer that complies with App Store
Rule 3.1.1 (IAP for any digital content unlock).

This doc plans **what gets built between "first TestFlight" and "credibly
competing with the category leaders."** It's split into four phases by
priority, each with effort estimates so you can decide which to slot into
which week.

## Constraints (carried over from prior session rules)

- **No revenues yet → free tools first.** Avoid recurring SaaS fees where a
  self-built free-tier alternative works. The only unavoidable spends are
  $99/yr Apple Developer and $25 one-time Google Play Console.
- **Stateless Vercel functions** — anything mobile-related that needs
  server state (device tokens, IAP receipts, push history) goes in
  Supabase, not in-memory.
- **No account creation on user behalf.** OAuth flows must be initiated by
  the user.
- **Each push to master needs explicit authorization** — don't ship the
  plan's deliverables without a green light, even when the work itself is
  trivial.

## Current state (what already works)

Carried in from `MOBILE_REVIEW.md` + `MOBILE_HANDOFF.md`, condensed:

- ✅ Capacitor 8 wrap with `server.url = https://monkeytravel.app` (live-site shell, no bundled web)
- ✅ Plugins installed: `app`, `browser`, `preferences`, `share`, `splash-screen`, `status-bar`
- ✅ Service worker on `/trips/*` (stale-while-revalidate for offline trip viewing)
- ✅ Android hardware back-button handler with LIFO modal interception
- ✅ iOS safe-area handling on Navbar + sheets/modals
- ✅ Web-style flash + accidental selection killed (`-webkit-tap-highlight-color` + `user-select: none` on chrome)
- ✅ Native share sheet via `lib/native/share.ts`
- ✅ Universal Links manifest in `public/.well-known/apple-app-site-association` (TEAMID placeholder)
- ✅ Android App Links manifest in `public/.well-known/assetlinks.json` (SHA-256 placeholder)
- ✅ Middleware UA allowlist (`MonkeyTravelApp/` suffix)
- ✅ Supabase client wired to `@capacitor/preferences` for PKCE storage
- ✅ `openExternal()` helper; share + booking CTAs migrated off `target=_blank`

## What's missing (this doc's scope)

Everything beyond the basic wrap that the category leaders ship. Grouped
into 4 phases:

| Phase | Theme | Effort | Wall-clock |
|---|---|---|---|
| **A — Submit & Survive** | First store approval + don't get rejected on resubmission | 3 dev-days | 1-2 weeks (review wait) |
| **B — Feel Native** | Push, deep links, gestures, haptics — make it stop feeling like a webpage | 2 dev-weeks | 3-4 weeks (incl. push opt-in tuning) |
| **C — Compete with the Leaders** | Native maps, biometric, IAP (if Pro tier), in-app review prompts, Live Updates | 3-4 dev-weeks | 6-8 weeks |
| **D — Growth & Retention** | A/B testing infra, cohort analysis, push CTR optimization, ASO loop | ongoing | rolling |

> **STATUS as of 2026-05-30 (massive autonomous shipping run):**
> Phase A is **CODE-COMPLETE**. Phase B is **CODE-COMPLETE** — every
> item B1–B6 except B7 (icon polish, needs design assets) is shipped.
> All migrations applied to Trawell (Supabase project
> `sevfbahwmlbdlnbhqwyi`). The mobile app is genuinely shippable now —
> only blocker is the dashboard work (Apple Developer Services ID,
> Firebase project + service-account JSON, APNs .p8 key, Supabase
> Apple provider config, App Store + Play Console listing paste,
> screenshot generation). All of those are documented in
> `docs/legal/store-listings.md`, `docs/legal/app-privacy-label.md`,
> and `docs/MOBILE_HANDOFF.md`.
>
> Phase C remains **DEFERRED BY DESIGN** — only invest when data
> justifies, not on schedule (per the strategic discussion).

---

## Phase A — Submit & Survive (3 dev-days)

These items either block submission or are the most common rejection
reasons for travel apps in 2025-2026.

### A1. App Privacy Nutrition Label (Apple — REQUIRED)

App Store Connect → App Privacy → fill out the questionnaire. The form
asks per-data-category what you collect and whether it's linked to user
identity / used for tracking.

For MonkeyTravel today, the truthful answer:

| Data type | Collected? | Linked to user? | Used to track? |
|---|---|---|---|
| Email | yes (auth) | yes | no |
| Name | yes (profile) | yes | no |
| Photos (uploaded for Start Anywhere) | yes | no (transient, not stored) | no |
| Coarse location | no (Google Places returns places we asked for, never user GPS) | — | — |
| Crash data | yes (Sentry) | no | no |
| Performance data | yes (Sentry + PostHog) | yes (PostHog identify) | no |
| Product interaction | yes (PostHog) | yes | no |
| Device ID | no (PostHog uses anonymous ID; no IDFA) | — | — |
| User ID | yes (Supabase auth UUID) | yes | no |

**File this BEFORE first TestFlight upload.** Apple rejects builds with an
incomplete privacy label.

**Action item:** screenshot the filled form + store in
`docs/legal/app-privacy-label-2026-05.png` so it's reviewable later when
adding new data collection.

### A2. App Tracking Transparency (ATT) — defer the prompt

iOS 14.5+ requires `AppTrackingTransparency` prompt if you collect IDFA or
track users across apps. **MonkeyTravel doesn't today** (PostHog uses
anonymous ID; no advertising SDKs). Keep it that way for v1 and skip the
prompt entirely — opt-in rates are ~25% and the prompt is friction.

If you ever add Facebook Ads SDK, Branch with full attribution, or
AppsFlyer, the prompt becomes mandatory. Document the decision tree in
`docs/MOBILE_ATT_POLICY.md` (P3 task).

**Code check:** `posthog.init` config — confirm no `disable_session_recording: false` + no advertiser_id_collection. Add a
lint-style assertion in `lib/analytics/posthog.ts` so future contributors
can't accidentally enable IDFA.

### A3. Sign in with Apple — wire it up

**Rule 4.8.** Apple rejects apps offering Google sign-in (which we do)
without also offering Sign in with Apple. This is the single most common
rejection for OAuth-using apps in 2026.

Steps (full detail in `MOBILE_HANDOFF.md` Step 5):
1. Apple Developer → Identifiers → Services ID `app.monkeytravel.signin`
2. Private key (.p8) + Team ID + Key ID
3. Supabase Dashboard → Auth → Providers → Apple → enable + paste creds
4. Add `<SignInWithAppleButton>` next to Google in `components/auth/SocialButtons.tsx` (DOES NOT EXIST YET — create alongside)
5. Web fallback: Apple's web button is a JS SDK + popup; native uses `@capacitor-community/apple-sign-in` plugin
6. Both flows hit `supabase.auth.signInWithIdToken({ provider: "apple", token })`

**Files to touch:**
- `components/auth/SocialButtons.tsx` (new — extract Google + add Apple)
- `lib/native/apple-sign-in.ts` (new — Capacitor wrapper)
- `package.json` — add `@capacitor-community/apple-sign-in`
- `app/[locale]/auth/login/page.tsx` + `signup/page.tsx` — use new SocialButtons component
- `messages/{en,it,es}/auth.json` — "Continue with Apple" strings

**Test plan:**
1. Cold launch app → Apple → email reveal/hide both work → returns to /trips
2. Sign out → Apple again → no duplicate user created (idempotency check)
3. Web flow at `/auth/login` still works on desktop Safari + Chrome

**Estimated effort:** 1 dev-day.

### A4. App Store + Play Store metadata

**App Store Connect** (per locale — en, it, es):
- **Name:** MonkeyTravel
- **Subtitle (30 chars):** "AI Travel Planner & Itinerary"
- **Promotional text (170 chars):** "Plan your trip in 60 seconds with AI. Free, no signup. Customize, share with friends, take it with you anywhere."
- **Description (4000 chars):** marketing copy — pull from `app/[locale]/page.tsx` hero + features
- **Keywords (100 chars, comma-separated):** "travel,planner,itinerary,ai,trip,vacation,booking,maps,planning,backpacker,family,solo,group" (use Sensor Tower or AppFollow free tier to refine post-launch)
- **Screenshots:** 6.7" (iPhone 15 Pro Max), 5.5" (iPhone 8 Plus), 12.9" (iPad Pro 6th gen) — 3-5 each, generated from device or via `fastlane snapshot` (P2)
- **App Preview video (optional but high-converting):** 15-30s screen recording of generation flow

**Google Play Console**:
- **Short description (80 chars):** "AI trip planner. Free, no signup. Itineraries in 60s. Take them anywhere."
- **Full description (4000 chars):** same source as App Store
- **Feature graphic (1024×500):** brand visual
- **Screenshots:** phone + 7" tablet + 10" tablet
- **Categories:** Travel & Local

**Required URLs (both stores):**
- Privacy Policy: `https://monkeytravel.app/privacy` (✅ exists)
- Support: `https://monkeytravel.app/contact` (✅ exists)
- Marketing: `https://monkeytravel.app` (✅ exists)

**Action item:** create `docs/legal/store-listings/{en,it,es}.md` with the
copy so it's versioned and translatable.

**Estimated effort:** 0.5 dev-day (excluding screenshot creation — that's
1-2 more days if done manually, or 0.5 day with fastlane snapshot).

### A5. Build pipeline (decision)

Manual builds are fine for v1 (Xcode → Archive → Distribute is ~30 min per
release). For v1.5+, consider:

| Option | Cost | Pros | Cons |
|---|---|---|---|
| **Manual** | $0 | No setup; full control | Slow; tied to your laptop |
| **fastlane** | $0 | Open source; standard; works locally + in CI | Ruby; learning curve |
| **EAS Build** | $0 free tier (30 builds/mo) | Cloud; no Xcode needed | Vendor lock-in; pricing risk |
| **GitHub Actions + macos-latest runner** | $0 if open-source / $0.08/min private | Native CI | macOS minutes are 10× cost of Linux |
| **Self-hosted Mac mini** | ~$700 one-time | Unlimited builds | Maintenance |

**Recommendation for now:** manual. Revisit when you ship 2+ builds per
week consistently. Document Xcode Archive workflow in `docs/RELEASES.md`.

### Phase A summary

- A1: file App Privacy label (1 hr)
- A2: lock down ATT defer (1 hr — add lint guard)
- A3: Sign in with Apple (1 dev-day)
- A4: store metadata + screenshots (0.5-2 dev-days depending on screenshot path)
- A5: pick build pipeline (none — manual for v1)

**Total: 2-3 dev-days + store-review wait.**

---

## Phase B — Feel Native (2 dev-weeks)

The "this stops feeling like a wrapped webpage" phase. None of these are
submission blockers; all are user-perception blockers.

### B1. Push notifications — full architecture

Push is THE engagement lever for travel apps. Booking.com's app sends
6-12 pushes per trip (booking confirmation, day-before reminder, gate
change, price drop alerts, post-trip review prompt). MonkeyTravel today
has zero.

**Architecture:**

```
┌────────────────┐    ┌──────────────────┐    ┌────────────────┐
│  Native app    │──▶ │  /api/devices/   │──▶ │  device_tokens │
│  on launch     │    │  register        │    │  (Supabase)    │
│  permission +  │    │  (auth required) │    │                │
│  token fetch   │    └──────────────────┘    └────────────────┘
└────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────┐
│  Trigger sources:                                    │
│  • Daily cron (vercel.json) — "trip starts in 3d"    │
│  • lib/notifications/service.ts (existing) — fan out │
│    in-app notification + email + push                │
│  • Supabase webhook on trips updates (collab events) │
└──────────────────────────────────────────────────────┘
                              │
                              ▼
                ┌─────────────────────────────┐
                │  /lib/push/dispatch.ts      │
                │  • Resolve devices by user  │
                │  • APNs HTTP/2 (iOS) via    │
                │    web-push or self-built   │
                │  • FCM HTTP v1 (Android)    │
                │  • Suppress on bounce       │
                │  • Log to push_log table    │
                └─────────────────────────────┘
                              │
                              ▼
                ┌─────────────────────────────┐
                │  Device receives push       │
                │  Tap → deep link to         │
                │    /trips/{id} or           │
                │    /shared/{token}          │
                └─────────────────────────────┘
```

**Tech choices (free-tier first):**

- **APNs:** direct HTTP/2 with a `.p8` token key. No SDK needed. Apple
  charges nothing. Self-built — implement in `lib/push/apns.ts` ~80 lines.
- **FCM:** Firebase Cloud Messaging HTTP v1 API. Free for unlimited
  notifications. Need a Firebase project (free Spark plan). Self-built
  in `lib/push/fcm.ts` ~60 lines.
- **Alternative — RevenueCat-style abstraction:** OneSignal free tier is
  10k subscribers / unlimited push, but locks you into their dashboard
  and TOS. Skip for now.

**Schema additions:**

```sql
-- supabase/migrations/2026MMDD_device_tokens.sql
CREATE TABLE device_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  app_version TEXT,
  locale TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Set when APNs/FCM returns Unregistered. Stop sending; keep row for audit.
  suppressed_at TIMESTAMPTZ
);
CREATE INDEX device_tokens_user_id_idx ON device_tokens(user_id)
  WHERE suppressed_at IS NULL;

CREATE TABLE push_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  sent_count INTEGER NOT NULL DEFAULT 0,
  bounce_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX push_log_user_id_created_at_idx
  ON push_log(user_id, created_at DESC);

-- RLS
ALTER TABLE device_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users read own tokens" ON device_tokens FOR SELECT
  USING (auth.uid() = user_id);
CREATE POLICY "users insert own tokens" ON device_tokens FOR INSERT
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "users delete own tokens" ON device_tokens FOR DELETE
  USING (auth.uid() = user_id);
-- No UPDATE policy: tokens are immutable; "rotate" = delete + insert.

ALTER TABLE push_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users read own push log" ON push_log FOR SELECT
  USING (auth.uid() = user_id);
-- Server writes only — no INSERT policy for authenticated.
```

**API endpoints:**

- `POST /api/devices/register` — body: `{ token, platform, appVersion, locale }`. Auth required. Idempotent on `(user_id, token)`.
- `DELETE /api/devices/:token` — sign-out cleanup
- `POST /api/admin/push/test` — manual send for debugging (admin gate)

**Client integration:**

- `lib/native/push.ts` — wraps `@capacitor/push-notifications`. Handles permission request, token retrieval, and `pushNotificationActionPerformed` (tap routing).
- `components/NativeBoot.tsx` — extend to call `requestPushPermissionIfWanted()` post-auth (NOT on cold launch; opt-in moment is after first successful trip save)

**Opt-in strategy (critical):**

iOS push permission can only be requested ONCE. If denied, it's a Settings
trip to re-grant. Don't burn it on cold launch — ask after the user has
demonstrated investment (post-first-trip-save).

Booking.com pattern: show a custom soft-prompt sheet first ("Get reminders
for your trip and price alerts"). Only if user taps "Yes" do you trigger
the OS prompt. If they tap "Not now," try again after the 2nd trip.
Achieves ~70% opt-in vs ~40% for cold prompts.

**Notification types to ship first:**

1. **Trip starts in 3 days** — daily cron, sends `notification_type='trip_reminder_3d'`
2. **Collaborator added an activity** — webhook from `trip_activity_log` insert
3. **Vote needed on group trip** — when a poll is opened
4. **Post-trip review prompt** — 1 day after `end_date`

Skip for v1.1: price drop alerts (requires Amadeus subscription), gate
changes (requires flight tracking integration).

**Estimated effort:** 4-5 dev-days.

### B2. Deep linking — make tapped URLs open the right screen

Universal Links manifest exists. The routing logic doesn't.

Today: tap `https://monkeytravel.app/trips/abc123` from an iMessage → opens
the app cold → lands on `/trips/abc123` because that's the URL. Good
default. But:

- Push notification taps with `data: { url: "/trips/abc123" }` → need
  manual handling via `@capacitor/app`'s `appUrlOpen` event
- App is already open in background → tap link → need to route within the
  WebView without a cold load
- Tapped link to `/auth/callback?code=...` → need PKCE replay (already wired)

**Files to touch:**
- `lib/native/deep-links.ts` (NEW) — central `appUrlOpen` listener. Parses URL, validates origin, decides between in-WebView navigation (push state) vs cold load
- `components/NativeBoot.tsx` — register listener on mount
- Test matrix in `tests/e2e/deep-links.spec.ts` — simulated tap from each entry point

**Estimated effort:** 1-2 dev-days.

### B3. Tab-bar navigation (the single biggest "this isn't a webpage" win)

Booking, Airbnb, TripAdvisor, Kayak — every category leader has a 4-5 tab
bottom bar: Search, Trips, Saved, Inbox, Profile.

Today MonkeyTravel has a top Navbar with hamburger on mobile. That's
"webpage" UX.

**Proposal:** add a conditional bottom tab bar that renders only on
native (`Capacitor.isNativePlatform()`) and only on `/[locale]/(home|trips|saved|explore|profile)`. Web stays as-is.

```tsx
// components/native/BottomTabBar.tsx
// 5 tabs, ≥44px tap targets, safe-area-inset-bottom padding
// Active tab highlight, badge counts (e.g. unread inbox)
// Hide on /trips/[id], /trips/new (full-screen modes)
```

**Routing:** preserve existing URL structure. Tabs are visual nav, not
separate routing trees.

**Estimated effort:** 2-3 dev-days (incl. icon design and active-state tuning).

### B4. Pull-to-refresh on /trips and /saved

`@capacitor/swipe-back` doesn't exist; native iOS pull-to-refresh uses
`<UIRefreshControl>`. In a WebView it's CSS + JS:

```tsx
// lib/native/pull-to-refresh.ts
// touchstart at scrollTop=0 → track deltaY → if >80px on touchend, fire callback
// Show a custom spinner overlay during refresh
```

Wire to `revalidate()` calls in `TripsPageClient`.

**Estimated effort:** 1 dev-day.

### B5. Haptic feedback on key actions

`@capacitor/haptics` plugin. Add to:
- Save trip → light impact
- Vote on group decision → medium impact
- Trip generation complete → success notification
- Error toast → error notification

Subtle, but it's a strong "native app" signal.

**Files to touch:**
- `lib/native/haptics.ts` (wrapper, no-op on web)
- ~6-8 call sites across `components/`

**Estimated effort:** 0.5 dev-day.

### B6. Local notifications (no server roundtrip)

`@capacitor/local-notifications` schedules notifications client-side. Use
case: when a trip is saved with a `start_date`, schedule a "Trip starts
tomorrow!" local notification for the day before.

Advantage: works offline, zero server cost. Limitation: scheduled by the
device, so device-clock-dependent.

**Estimated effort:** 0.5 dev-day.

### B7. App icon polish + Dynamic Island integration (iOS 16+)

Live Activities + Dynamic Island for ongoing trips ("Day 3 of Tokyo • Next:
Senso-ji Temple in 45 min") is a high-prestige feature. Requires writing a
SwiftUI widget. Defer to Phase C.

For Phase B: just ensure the icon looks polished — adaptive icon for
Android (foreground + background layers), light/dark variants for iOS 18+.

**Estimated effort:** 1 dev-day (assumes designer time available).

### Phase B summary

| Item | Effort |
|---|---|
| B1: Push architecture | 4-5 dev-days |
| B2: Deep linking | 1-2 dev-days |
| B3: Tab bar | 2-3 dev-days |
| B4: Pull-to-refresh | 1 dev-day |
| B5: Haptics | 0.5 dev-day |
| B6: Local notifications | 0.5 dev-day |
| B7: Icon polish | 1 dev-day |

**Total: ~2 dev-weeks.** Ship B1 + B3 first — they're the biggest UX deltas.

---

## Phase C — Compete with the Leaders (3-4 dev-weeks)

### C1. Native maps (replacing Google Maps web embed)

The Google Maps JavaScript embed inside a WebView is ~2.5 MB on first
load and lags on mid-range Android. Native map SDKs are 10× faster, work
offline (cached tiles), and integrate with platform conventions (Apple
Maps on iOS gives free turn-by-turn).

**Options:**

| Option | Pros | Cons |
|---|---|---|
| `@capacitor/google-maps` plugin | Same provider as today; one API key | Still requires Google Maps Platform billing; iOS uses Google SDK (not Apple Maps) |
| `@capacitor-community/apple-maps` (iOS) + Google Maps native (Android) | Free Apple Maps on iOS (no API key cost); Google native on Android | Two integrations to maintain |
| Mapbox GL native | Beautiful; offline-first | Free tier 50k MAU; pricing risk |
| Leaflet + OpenStreetMap tiles | Free forever; no API key | Slower; community support; no POI database |

**Recommendation:** **`@capacitor/google-maps` on both platforms** for
consistency. Cost: Google Maps Platform gives $200/mo free credit which
covers ~28k dynamic map loads — way more than current scale. If volume
grows, switch to Mapbox at the inflection point.

**Migration path:**
- Keep `components/TripMap.tsx` as the web-only implementation
- New `components/native/TripMapNative.tsx` using `@capacitor/google-maps`
- Conditional render in `TripDetailClient.tsx`: native → Native variant; web → existing

**Estimated effort:** 5-7 dev-days (incl. parity testing — markers,
polylines, day filter, click handlers).

### C2. Biometric quick-login (Face ID / Touch ID / Android Biometric)

After first successful password/OAuth login, prompt: "Use Face ID to sign
in next time?" If yes, store the refresh token in Keychain (iOS) /
Keystore (Android) — never in `@capacitor/preferences` (those are
unencrypted on Android).

`@capacitor-community/biometric-auth` is the established plugin.

**Flow:**
1. User completes OAuth/password login
2. Show enrollment prompt (custom UI, not OS dialog) — once
3. If accepted, encrypt the Supabase refresh token with a biometric-gated
   Keychain entry
4. Next cold launch: app shows biometric prompt → on success, decrypts
   token → calls `supabase.auth.setSession()` → user is in

**Security note:** the refresh token is the keys to the kingdom. If a user
loses the phone, the biometric is bypassed only by full device factory
reset. Acceptable risk for a travel app; document in privacy policy.

**Estimated effort:** 2-3 dev-days.

### C3. In-App Purchase strategy (when/if we add a Pro tier)

**Today MonkeyTravel is free.** Banana referral tier system gives bonus
generations but no paid plan. If/when a Pro tier ships ("$4.99/mo for
unlimited generations + premium templates + priority AI"), Apple's
**Guideline 3.1.1** kicks in:

> "Apps offering 'loot boxes' or other mechanisms that provide randomized
> virtual items for purchase must disclose the odds. Apps offering
> subscriptions to digital content must use IAP — no external payment
> links allowed."

**Rules of the road:**

- Cannot use Stripe Checkout inside the app for digital content (would
  reject) — must use StoreKit / Play Billing
- Can use Stripe for **physical goods or services consumed outside the
  app** (e.g. hotel bookings — those route to Stripe Checkout in the
  external browser via `openExternal()`, which is already wired)
- "Subscription to AI generations" → IAP mandatory
- Apple/Google take 30% (15% Small Business Program first $1M)

**Implementation options:**

| Option | Cost | Effort |
|---|---|---|
| **RevenueCat** | Free under $2.5K MTR | 3 dev-days (their SDK handles both stores) |
| **DIY StoreKit + Play Billing + Supabase webhook receivers** | $0 | 8-10 dev-days; ongoing maintenance |

**Recommendation:** RevenueCat for v1 of Pro. Free tier covers the
expected first year; the 1% fee above $2.5K MTR is the "moving + later"
problem, not now. Saves 6+ dev-days that should go into core product.

**Schema additions (only when Pro ships):**

```sql
CREATE TABLE entitlements (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  plan TEXT NOT NULL CHECK (plan IN ('free', 'pro_monthly', 'pro_yearly')),
  granted_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ,
  source TEXT NOT NULL CHECK (source IN ('iap_ios', 'iap_android', 'stripe', 'manual')),
  original_transaction_id TEXT, -- for receipt validation
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Receipt validation:** server-side via App Store Server API + Play
Developer API. Never trust client. RevenueCat does this for you.

**Estimated effort (when needed):** 3 dev-days with RevenueCat / 8-10
dev-days DIY.

**Note:** if Pro never ships and monetization stays affiliate-only (which
is the current path — Hostelworld + iVisa + Booking.com affiliate links
opened in external browser), **IAP is not needed at all.** Document the
decision; revisit when revenue model crystallizes.

### C4. In-app review prompt (Apple SKStoreReview + Play In-App Review)

`@capacitor-community/in-app-review` triggers the OS native review prompt
without leaving the app. Show after positive moments:

- Trip saved + user returned to it twice = "How are we doing? Leave a
  review?"
- Successful collab vote
- After trip end_date passed (post-trip prompt)

Apple limits to 3 prompts per 365 days per device — use sparingly. Track
which moment converts best in PostHog.

**Estimated effort:** 0.5 dev-day.

### C5. Capacitor Live Updates (OTA web updates without store review)

Today: every web change ships instantly because `server.url` points at
prod. **Live Updates aren't needed.** The trade-off is offline behavior —
the SW caches recent assets but a fully offline user can't get new web
code.

If you ever switch to a bundled webDir (offline-first), Capacitor Live
Updates (`@capacitor/live-updates`) is the OTA layer. Costs money
(Ionic's hosted product). Self-built alternative: download a zip from your
own S3-equivalent + unpack — ~3 dev-days but free.

**Decision:** keep `server.url` model. Live Updates not needed. Document
the trade-off in `capacitor.config.ts` (already done).

### C6. Native crash reporting (Sentry React Native bridge vs WebView)

Today: `@sentry/nextjs` catches all WebView JS errors — that's 95% of
crashes. Native shell crashes (extremely rare in a thin wrapper) are
invisible.

**Two options:**

| Option | Pros | Cons |
|---|---|---|
| **Stick with @sentry/nextjs only** | Already wired; free; zero extra work | Misses native-side crashes (rare but real) |
| **Add @sentry/capacitor** | Catches native + JS | Adds ~200 KB to native binary; small dev complexity |

**Recommendation:** add `@sentry/capacitor` once you're shipping to >1k
users. Below that scale, JS-only Sentry is fine.

**Estimated effort:** 0.5 dev-day.

### C7. Onboarding screens (3-4 swipeable native-feel cards)

Today: cold launch → app loads → user sees /[locale]/ home. No
introduction. Category leaders ship 3-4 onboarding cards explaining the
value prop, often with a permission ask at the end (location for
weather-aware suggestions, push for trip reminders).

**Files to touch:**
- `components/native/OnboardingCards.tsx` (NEW — only renders on native + first launch)
- `lib/native/first-launch.ts` (tracks via @capacitor/preferences)
- Skip CTA → straight to home

**Estimated effort:** 1-2 dev-days.

### Phase C summary

| Item | Effort |
|---|---|
| C1: Native maps | 5-7 dev-days |
| C2: Biometric quick-login | 2-3 dev-days |
| C3: IAP via RevenueCat (only if Pro ships) | 3 dev-days |
| C4: In-app review prompt | 0.5 dev-day |
| C5: Live Updates | n/a (decision: no) |
| C6: @sentry/capacitor | 0.5 dev-day |
| C7: Onboarding cards | 1-2 dev-days |

**Total: 3-4 dev-weeks** (excluding C3 unless Pro ships).

---

## Phase D — Growth & Retention (ongoing)

### D1. App Store Optimization (ASO) loop

- Track keyword rankings weekly (AppFollow free tier: 1 app, 5 keywords)
- A/B test screenshots via App Store Connect's built-in tool (free)
- Reply to every store review within 48h
- Monitor competitor releases (Sensor Tower free tier)

### D2. Push notification CTR optimization

- Tag every push with `notification_type` for PostHog cohort analysis
- Track: sent → delivered → opened → trip-action-taken
- A/B test copy and timing (e.g. trip-reminder at 9am local vs 6pm local)
- Suppression list for users who haven't opened a push in 30 days

### D3. Cohort retention analysis

- PostHog cohorts: D1, D7, D30 retention by acquisition channel
- Identify which features (push opt-in, biometric setup, Pro upgrade)
  correlate with retention
- Build the funnel: install → first trip → second trip → push opt-in →
  collab share → retained at D30

### D4. App referral program

Banana referral system exists for web. Add native deep-link share that
opens the App Store / Play Store with attribution preserved:

- iOS: use `https://monkeytravel.app/r/{code}` as the share URL; Universal
  Link resolves to the app if installed, App Store if not (works via
  `apple-app-site-association`)
- Android: same pattern via App Links

Track install attribution via Branch.io (paid) or DIY with a server-side
referral cookie set on web → matched to user_id on first auth (free).

**Estimated effort:** 2-3 dev-days (DIY attribution).

### D5. Feature flag system

Today: no feature flag infra. For mobile, A/B testing is critical
(onboarding flows, push copy, paywall positioning). Options:

- **PostHog feature flags** (already in stack, free) — recommended
- **Vercel Edge Config** — works but no UI for non-tech users
- **GrowthBook** — open source, self-hosted on Supabase

**Recommendation:** PostHog feature flags. Already paying for it (free
tier). Add `<FeatureFlag name="...">` wrapper component.

**Estimated effort:** 1 dev-day to wire the wrapper + first flag.

---

## Decision points the human needs to make

Before executing this plan, decisions needed (in priority order):

1. **Do we ship Pro tier?** Drives whether Phase C3 (IAP) is in scope.
   Current path: affiliate-only revenue. Decision affects ~3 dev-days of work.

2. **Push opt-in moment.** Cold launch (low effort, low opt-in), post-first-save (recommended), post-second-trip (highest opt-in but delayed reach). Affects B1.

3. **Tab bar vs hamburger.** Tab bar is the single highest-leverage native-feel change but requires re-thinking nav IA. Possible to ship behind a feature flag and A/B test.

4. **Apple Maps vs Google Maps on iOS.** Free vs $200/mo credit. Affects C1 cost model.

5. **RevenueCat vs DIY IAP.** Only relevant if Pro ships. RevenueCat saves 6 dev-days; costs 1% over $2.5K MTR. Recommend RevenueCat for solo founder.

6. **Sign in with Apple alongside Google, or replace Google with Apple-only?** App Store mandates Apple alongside Google; technically allowed to drop Google. Most apps keep both. Affects Phase A3 scope.

7. **Live Updates / OTA.** Currently using `server.url` so unnecessary. If you ever switch to bundled webDir for offline-first, revisit.

---

## Anti-goals (things to NOT build)

- **Don't build a separate React Native codebase.** The web/native parity
  cost is enormous. The wrap is working; stay in it.
- **Don't fragment auth.** One Supabase auth source of truth; PKCE + Keychain
  on native; cookies + http-only on web. Don't add Auth0 or custom JWT.
- **Don't add analytics SDKs.** PostHog covers product; Sentry covers errors. No Mixpanel, Amplitude, Heap, etc. — they'd duplicate cost + add IDFA pressure.
- **Don't add ads.** Free travel app + ads = trash perception. Affiliate
  revenue + (eventually) Pro tier is the model.
- **Don't add an SDK for SDK's sake.** Every native dep is a binary-size
  hit + maintenance burden. Justify each one with a measured user benefit.

---

## Cost summary

| Item | One-time | Recurring |
|---|---|---|
| Apple Developer Program | — | $99/yr |
| Google Play Console | $25 | — |
| Firebase (FCM) | — | $0 (Spark plan) |
| APNs | — | $0 |
| Sentry | — | $0 (5K errors/mo free) |
| PostHog | — | $0 (1M events/mo free) |
| RevenueCat (if Pro ships) | — | $0 under $2.5K MTR, 1% above |
| Google Maps Platform | — | $0 with $200/mo credit |
| Domain (existing) | — | already paying |
| **Total Year 1 (no Pro)** | **$25** | **$99** |
| **Total Year 1 (with Pro, low revenue)** | **$25** | **$99 + ~1% of revenue (RevenueCat fee)** |

For a solo founder pre-revenue, the entire mobile play costs **$124 in
Year 1**. The bottleneck isn't money — it's developer time. This plan
estimates **~6-8 dev-weeks** to get from current state to credibly
competing with Booking.com / Airbnb mobile experience (excluding Phase D
ongoing growth work).

---

## Recommended sequencing

Given the constraint of one developer (you) and the need to keep the web
side healthy:

**Week 1:** Phase A (submit). Get to TestFlight + Play Internal Testing.
Even if Phase B isn't done, having the wrap live and review-cycle started
unblocks everything else.

**Week 2-3:** Phase B1 (push) + B3 (tab bar). The two highest-leverage
native-feel changes.

**Week 4:** Phase B2 (deep links) + B4-B7 (gestures, haptics, polish).

**Week 5-6:** Phase C1 (native maps). The single biggest performance win
on mid-range Android.

**Week 7:** Phase C2 (biometric) + C4 (review prompt) + C7 (onboarding).

**Week 8+:** Phase D (ongoing) + Phase C3 (IAP) if Pro tier ships.

**Throughout:** keep the web side as the primary product. The native app
is a distribution channel, not a parallel codebase.

---

## Status tracking

This doc is a snapshot, not a live spec. As items ship, update the
`MOBILE_REVIEW.md` "What's already done" section. When Phase A completes,
write `docs/MOBILE_LAUNCH_POSTMORTEM.md` to capture what surprised you.

Next concrete action when you're ready to start: **Phase A1** (App Privacy
nutrition label). Takes an hour, blocks the first TestFlight upload, can't
be skipped.
