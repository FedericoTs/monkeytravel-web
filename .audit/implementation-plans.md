# Implementation Plans — Five Sequential Bets

**Date:** 2026-05-23 · **Author:** Codebase audit
**Companion docs:** `.audit/conversion-diagnosis.md`, `.audit/competitor-benchmark.md`, `.audit/blog-quality-audit.md`
**Premise:** Anonymous generation, per-day regen, foregrounded AI assistant, anonymous voting on `/shared`, and the `TOUR_ENABLED` flip have already shipped (commits 7c48769..fb4cdc4). These five plans cover what's next.

**Recommended sequencing:** 5 → 2 → 4 → 1 → 3.
ES/IT pillar translations (#5) is the lowest-risk SEO compounding win — ship while everything else is in dev. Start Anywhere (#2) is the highest-delight conversion lever. Streaming (#4) is purely an upgrade to a shipped path. Mobile wrap (#1) is the distribution multiplier. Email/notifications (#3) is the heaviest cross-cutting change and benefits from everything else stabilizing first.

---

## 1. Mobile native app (Capacitor wrap of the Next.js PWA)

A Capacitor shell around the production website. No second codebase, no React Native rewrite. The web app stays the source of truth; the native binary is a WebView pointed at `monkeytravel.com` plus a thin native bridge for share/push/auth.

### Pre-flight findings (read from code)

- **PWA manifest exists** (`public/manifest.json`) — `display: standalone`, theme color `#FF6B6B`, all icon sizes 16/32/180/192/512 maskable, screenshots wired. Good baseline.
- **No service worker** ships today (no `public/sw.js`, no `next-pwa` in `package.json`). Capacitor doesn't need one, but if a true offline PWA is also desired this is a separate slice.
- **Auth is Supabase cookie-based** (`@supabase/ssr` 0.8.0, see `lib/supabase/server.ts` + `app/auth/callback/route.ts`). OAuth callback URL is currently `${origin}/auth/callback?code=...`. **This is the single biggest gotcha** — see Risk R1.
- **Middleware bot-blocking** (`middleware.ts:17-43`) screens 22 UA patterns. Capacitor's default WebView UA is `MonkeyTravel/1.0 (iOS; ...) CapacitorWebView` (configurable) — none of the blocked patterns will false-positive. [ASSUMPTION: assuming default Capacitor UA template; verify with `Capacitor.getPlatform()` shim once installed.]
- **No deep-link configuration** yet (no `apple-app-site-association`, no `assetlinks.json` in `public/`).

### Impact matrix

| Layer | Change |
|---|---|
| **Database** | None. Auth model unchanged. |
| **Manifest** | Flip `prefer_related_applications: true` (currently `false`, `manifest.json:57`) after store IDs exist. |
| **Service worker** | None. Out of scope for v1. |
| **Icons/splash** | Generate 1024×1024 master → fan out via `@capacitor/assets`. Existing `og-image.png` is 1200×630 — wrong aspect. |
| **Deep links** | iOS Universal Links (`/.well-known/apple-app-site-association`) + Android App Links (`/.well-known/assetlinks.json`). Both must be served unauthenticated with `Content-Type: application/json`. |
| **Auth callback** | Add `monkeytravel://auth/callback` to Supabase redirect URLs + handle in `app/auth/callback/route.ts`. See risk section. |
| **Middleware** | Verify Capacitor WebView UA passes `BLOCKED_BOT_PATTERNS` in `middleware.ts:17-43`. Likely fine; one-line allowlist if needed. |
| **Native plugins** | See "Tooling" below. |
| **Web components** | Wrap `navigator.share` with `Capacitor.isNativePlatform() ? Share.share(...) : navigator.share(...)`. Audit `components/trip/ShareButton.tsx`, `components/ShareRow.tsx`. |
| **Push** | New `device_tokens` table + `/api/devices/register`. Defer to v1.1. |
| **Cookies** | Supabase sessions are `httpOnly; secure; sameSite=lax` (`lib/anonymous/rate-limit.ts:114-116`). Works in WebView; OAuth jar-mismatch is the real concern (see R1). |

### Auth callback — the load-bearing risk

Current OAuth (`app/auth/callback/route.ts:92-188`): `code` → `exchangeCodeForSession` → cookie → redirect. In Capacitor, the Google redirect lands in `ASWebAuthenticationSession`/Custom Tabs, **not** the app's WebView — the cookie ends up in the wrong jar.

**Recommended fix:** switch `supabase-js` to `flowType: 'pkce'` with a custom storage adapter backed by `@capacitor/preferences`. Bypasses the cookie-jar mismatch entirely. Fallback path: register `monkeytravel://` custom scheme + Universal Links, detect native context in `/auth/callback`, 302 to scheme, replay code exchange inside WebView via `@capacitor/app`'s `appUrlOpen`.

### Tooling

- **Capacitor 6** (current stable). `npx @capacitor/cli init`.
- **Plugins:** `@capacitor/core`, `@capacitor/ios`, `@capacitor/android`, `@capacitor/app`, `@capacitor/browser`, `@capacitor/share`, `@capacitor/preferences`, `@capacitor/status-bar`, `@capacitor/splash-screen`, `@capacitor/assets` (dev).
- **Push (v1.1):** `@capacitor/push-notifications` + Firebase (Android) + APNs cert (iOS).
- **`capacitor.config.ts`:** `server.url = 'https://monkeytravel.com'` — loads the live site, no bundled build.
- **Build:** Xcode 16+, Android Studio Koala+. Local or Codemagic/Bitrise/GitHub macOS runners.

### App Store / Play Store requirements

- **Apple privacy labels:** Email (linked), Usage Data (linked), Coarse Location (Not Linked — Vercel geo, not device GPS per `lib/supabase/middleware.ts:21-22`).
- **Age rating:** 4+. No UGC feed; affiliate booking links are standard for travel category.
- **iOS screenshots:** 6.7" + 6.5" + 5.5" iPhone, 12.9" iPad — 5 per size. Existing `screenshots/` folder is empty for App Store sizes.
- **Android:** phone + 7" + 10" tablet screenshots + 1024×500 feature graphic.
- **Privacy policy URL:** `app/[locale]/privacy/page.tsx` already exists.
- **Sign in with Apple is mandatory** if Google OAuth is offered (App Store rule 4.8). Add before submission or expect rejection.
- **PostHog ATT:** init without IDFA to avoid the App Tracking Transparency prompt.

### Step-by-step plan (effort estimates per step)

| # | Step | Effort |
|---:|---|---|
| 1 | Generate 1024×1024 app icon master + splash. Run `@capacitor/assets` to fan out sizes. | 0.5d |
| 2 | `npx @capacitor/cli init`, add iOS + Android platforms, configure `capacitor.config.ts` with `server.url`. Local build runs. | 0.5d |
| 3 | Switch Supabase client to PKCE flow + `@capacitor/preferences` storage adapter. Verify session survives app restart. | 1d |
| 4 | Configure Universal Links / App Links: serve `apple-app-site-association` and `assetlinks.json` from `public/.well-known/`. Register custom scheme `monkeytravel://`. | 1d |
| 5 | Wire `/auth/callback` to detect native context and redirect to scheme; handle `appUrlOpen` in Capacitor bridge. | 1d |
| 6 | Wrap `navigator.share` in a `Capacitor.isNativePlatform()` adapter (3-4 components). | 0.5d |
| 7 | Audit middleware bot-blocking against Capacitor UA; allowlist if needed. | 0.25d |
| 8 | Capture 5 screenshots per required device size (iOS + Android). Set up App Store Connect + Play Console listings. | 1d |
| 9 | Add Sign in with Apple to Supabase + signup/login UIs. | 0.5d |
| 10 | TestFlight + Internal Testing track submissions. Fix any review feedback. | 2-5d (mostly waiting) |
| 11 | **v1.1:** push notifications, deep-link share targets, offline cache. | 1-2w later |

**Total:** ~6.5 dev-days + 1-2 weeks of review/iteration. Matches the "1-2 week" estimate in `competitor-benchmark.md` item #6.

### Risks (ranked by likelihood × impact)

| # | Risk | Likelihood | Impact | Mitigation |
|---:|---|---|---|---|
| R1 | OAuth callback breaks in WebView; users can't sign in | High | Critical | PKCE + Preferences storage adapter, tested on both platforms before submission |
| R2 | Apple rejects for missing Sign in with Apple | Medium | High | Add SIWA in step 9 |
| R3 | Middleware false-positives on WebView UA | Low | High | One-line UA allowlist; smoke-test via TestFlight |
| R4 | Push notification scope creep delays launch | Medium | Medium | Explicitly defer to v1.1 |
| R5 | Cookie jar mismatch between SFSafariViewController and WebView | Medium | High | Same mitigation as R1 |
| R6 | App Store review flags affiliate booking deeplinks | Low | Medium | Standard travel app category; competitors (Layla, Mindtrip) ship same model |
| R7 | PostHog ATT prompt requirement | Low | Low | Initialize PostHog without IDFA; document in submission |

### Test plan (E2E)

- Cold launch app → splash → home page loads from `server.url`
- Tap "Sign in with Google" → system browser → OAuth → returns to app → session persists across app restart
- Tap "Sign in with Apple" → same flow
- Generate a trip as anonymous → save → auth prompt → trip persists post-auth
- Share a trip → native share sheet appears (iOS/Android), URL is `https://monkeytravel.com/shared/...`
- Receive a `monkeytravel://` deep link (e.g. invite link) from another app → app opens to the right route
- Background the app for 30 min → foreground → session still valid (no surprise re-auth)
- Anonymous rate limit cookie persists across cold launches
- Middleware: verify WebView UA doesn't return 403
- Offline (airplane mode) → friendly error, no white screen of death

---

## 2. "Start Anywhere" (photo / URL / screenshot → trip via Gemini Vision)

Highest-delight item in `competitor-benchmark.md` (#4, "single most copy-worthy idea in the field"). Mindtrip's flagship input model. A weekend of work if scoped right.

### Pre-flight findings

- **Gemini Vision is already in the dep tree** (`@google/generative-ai` 0.24.1) — the same package powers `lib/gemini.ts`. No new SDK.
- **`generateContent` already supports `inlineData` parts** for images. URL fetching is a server-side `fetch + base64`.
- **No Supabase Storage in use** — `lib/supabase/` has no storage helpers. [ASSUMPTION based on the lib folder listing.] Image processing can happen entirely in-memory.
- **Wizard entry point:** `app/[locale]/trips/new/page.tsx`. Existing `trip_wizard_step_viewed` PostHog events at the wizard step level.
- **`/api/ai/generate` already accepts anonymous requests** (confirmed in `app/api/ai/generate/route.ts:215-241`) — extracted context becomes input to the existing endpoint, no second generation pathway needed.
- **Anonymous rate limit** (`lib/anonymous/rate-limit.ts`) is keyed to `mt_anon` cookie, gates `/api/ai/generate`. The new extraction endpoint needs its own gate or it's an abuse vector (extract 1000 times, generate nothing).

### Impact matrix

| Layer | Change |
|---|---|
| **Database** | **None.** Do NOT add `trip_input_attachments` — photos/URLs are 1-shot prefill inputs. A table adds RLS surface, storage cost, GDPR delete obligation, CDN concerns for zero user value. |
| **Trip metadata** | Optional: add `trip_meta.input_source: 'image' \| 'url' \| 'manual'` to existing JSONB (telemetry only, no migration). |
| **API** | New `POST /api/ai/extract-trip-context` returning `{destination, vibes, suggestedDates, durationDays, notes}`. Stateless, never writes to DB. |
| **Storage** | In-memory only. Reject >4 MB. Vision API accepts inline base64 up to ~20 MB. |
| **Wizard** | Two surfaces: homepage hero (3-modality input) + small "upload" button on wizard step 1. |
| **Telemetry** | New PostHog: `start_anywhere_extraction_{started,succeeded,failed}`, `start_anywhere_prefill_accepted`. |
| **Anon rate limit** | Separate `mt_anon_extract` cookie at 5/day. Don't let extraction failures burn generation quota. |
| **Cost** | Vision call ~$0.0015/image (Gemini 2.5 Flash). Add to `lib/api-gateway/config.ts` cost table. |
| **Safety** | Gemini's NSFW filter handles this; pass through as friendly error. |
| **URL fetch** | Server-side fetch with 5 MB cap, 5s timeout, 3-redirect limit. **SSRF defense:** deny private IP ranges, `localhost`, non-http(s) schemes. |

### UX flow

**Homepage hero (primary surface):**
```
"Where to next?"
  [ Destination input ────────── ] [Generate]
   or  📸 Drop a screenshot   🔗 Paste a URL   📋 Try an example
```

The three secondary CTAs feel like equal modalities, not a hidden "advanced" panel. This is how Mindtrip presents it.

**Wizard step 1 (secondary surface):**
A small inline `[📸 Upload from photo/URL]` button next to the destination field. Existing flow stays intact for typed input.

**Extraction loading state:**
Reuses `GenerationProgress.tsx` pattern (already exists for the main generation). Subtitle: "Reading your screenshot…" / "Checking the article…"

**Post-extraction:**
Wizard auto-fills destination + vibes + suggested dates → user lands on step 2 with everything pre-populated. A small banner: "From your screenshot · [Edit]" so the user can correct mistakes (critical: don't auto-submit, always show confirmation).

### Step-by-step plan

| # | Step | Effort |
|---:|---|---|
| 1 | Build `POST /api/ai/extract-trip-context`. Accepts `{ type: 'image' \| 'url', payload: base64 \| string }`. Returns extracted params. | 1d |
| 2 | Write the Vision prompt + structured-output schema. Test against 20 sample inputs (Instagram screenshots, TripAdvisor URLs, Pinterest, blog posts). | 0.5d |
| 3 | Add separate anonymous rate limit (`mt_anon_extract`, 5/day). Reuse the pattern in `lib/anonymous/rate-limit.ts`. | 0.25d |
| 4 | URL fetcher with SSRF protection + size/timeout caps. | 0.5d |
| 5 | Homepage hero: 3-modality input. Wire to extraction → wizard prefill. | 1d |
| 6 | Wizard step 1: small upload button. Same flow. | 0.25d |
| 7 | PostHog events + cost-table entry in `lib/api-gateway/config.ts`. | 0.25d |
| 8 | Loading/error/banner UI states. | 0.5d |
| 9 | QA pass against the 20-sample test set. | 0.5d |

**Total:** ~4.75 dev-days. Matches "~3 days" estimate in benchmark.

### Risks

| # | Risk | Likelihood | Impact | Mitigation |
|---:|---|---|---|---|
| R1 | Hallucinated destination from low-quality / off-topic image | High | Medium | Always show editable confirmation banner; never auto-submit |
| R2 | NSFW / PII in uploaded photo (passports, faces) | Medium | High | Gemini's safety filter handles NSFW; document in privacy policy that uploads are processed in-memory and discarded; never log image bytes |
| R3 | Copyrighted Instagram/Pinterest images | Low | Low | Same legal posture as any user-uploaded screenshot; transformative use for personal trip planning |
| R4 | SSRF via URL input | Medium | Critical | Strict scheme + IP allowlist, 5s timeout, 5 MB cap, no redirects to private ranges |
| R5 | URL extractor breaks on JS-rendered sites (TikTok, IG) | High | Medium | Document scope: works on blog posts + static articles; for IG/TikTok, recommend screenshot |
| R6 | Quota burn from bots scraping the extract endpoint | Medium | Medium | Anonymous cookie limit + Vercel rate-limit middleware in front |
| R7 | Vision call latency (3-5s) makes the homepage feel slow | Medium | Low | Show skeleton + cancel button; users tolerate this if they understand what's happening |

### Test plan (E2E)

- Upload valid travel screenshot (Bali beach) → extraction succeeds → wizard prefills destination=Bali, suggested vibes include "beach,relaxation"
- Upload non-travel photo (cat) → extraction returns `{ destination: null }` → friendly error, wizard stays on default
- Upload >4 MB image → 413 response, friendly error
- Paste valid blog URL → extraction succeeds with destination + dates
- Paste `localhost:8080` URL → 400 response, "Invalid URL"
- Paste URL that 302s to `127.0.0.1` → 400 (SSRF blocked)
- Hit extraction endpoint 6 times as anon → 6th returns 429
- Successful extraction → confirmation banner shown → user clicks "Edit" → wizard becomes editable
- Successful extraction → user proceeds → `trip_meta.input_source = 'image'` recorded on the eventual trip
- Anonymous rate limit on extraction does NOT consume generation quota (verify both cookies independent)
- PostHog events fire in correct order

---

## 3. Email service + invites + notifications

Largest cross-cutting change of the five. Touches DB, backend, frontend, deliverability, GDPR, i18n. Recommend shipping last so other features stabilize their event surfaces first.

### Pre-flight findings

- **No email SDK in `package.json`.** Only `email-templates/confirm-signup.html` (served by Supabase Auth, not a transactional system).
- **`trip_invites`** (`20251220_create_trip_collaboration.sql:8-19`) has `token, role, max_uses, expires_at, is_active`. **No `recipient_email`.** Default `max_uses=1`.
- **`is_referral_eligible`** column referenced in `app/api/invites/[token]/route.ts:265` — added by a later migration not in the original.
- **Invite acceptance** requires `getAuthenticatedUser` (`app/api/invites/[token]/route.ts:170-171`). Anonymous voters on `/shared/[token]` exist (new `anonymous_activity_votes` table) but can't accept invite-tier collaboration.
- **ShareAndInviteModal** (`components/trip/ShareAndInviteModal.tsx`) already has tab infra (`share` / `invite`). Email is straightforward to add.
- **Cookie consent banner** exists (`lib/consent/`, migration `20260125_add_cookie_consent.sql`).
- **Event hooks:** `useProposals.ts` is client-side. Server-side enqueue must live in the API route handlers (`/api/proposals/*`, `/api/trips/[id]/activities/[aid]/vote`), not in the React hook.

### Impact matrix

| Layer | Change | Notes |
|---|---|---|
| **DB — `notifications`** | New table: `id, user_id, type, payload jsonb, read_at, created_at, deleted_at` | RLS: user reads own only. Service-role INSERT only. |
| **DB — `email_log`** | New: `id, recipient_email, template_id, message_id, status, sent_at, opened_at, bounced_at, complained_at, idempotency_key` | Deliverability tracking + bounce suppression + cron idempotency. |
| **DB — `trip_invites`** | ALTER ADD `recipient_email TEXT, recipient_locale TEXT, message TEXT` | Email invites are single-recipient; existing shareable-link semantics preserved when `recipient_email IS NULL`. |
| **Preferences** | Reuse existing `users.notification_settings` JSONB (`app/auth/callback/route.ts:144-151`) — add keys: `collabVotes, collabComments, weeklyDigest`. `transactional` is non-disableable. | No new table needed. |
| **Service** | **Resend** (over Postmark). React Email is its sibling project — JSX templates, better Next.js docs. Both have equivalent deliverability. |  |
| **Env vars** | `RESEND_API_KEY, EMAIL_FROM, EMAIL_REPLY_TO, EMAIL_UNSUBSCRIBE_SECRET` (HMAC signing for unsubscribe tokens) |  |
| **DNS (owner action)** | SPF, DKIM (Resend gives 3 CNAMEs), DMARC. Resend refuses sends from unverified domains. | Block deploy until verified. |
| **Templates** | React Email: `Invite, VoteCast, CommentAdded, WeeklyDigest`. Store in `lib/email/templates/`. |  |
| **API** | `POST /api/trips/[id]/invites` accepts `{recipient_email, message}` → dispatch email. Backward compatible: omit `recipient_email` for shareable-link behaviour. |  |
| **Event hooks** | On successful vote/comment/proposal: `enqueueNotification(trip.owner_id, type, payload)` in the **API route** (not `useProposals.ts`). |  |
| **Bell UI** | Navbar bell + unread count + dropdown (last 10) + `/profile/notifications` full list. Realtime via Supabase Realtime (pattern from `20260219_enable_realtime_proposals.sql`). |  |
| **Cron** | `/api/cron/send-notification-emails` every 5 min — batches per user, respects `notification_settings`, idempotent via `email_log.idempotency_key`. |  |
| **i18n** | New `messages/{en,es,it}/email.json`. Recipient locale from `users.preferred_language` (fallback: inviter locale → EN). |  |
| **GDPR** | Weekly digest: explicit opt-in (default `weeklyDigest=false`). Invites/votes/comments on your trip: transactional, no opt-in needed. `notification_settings.marketingNotifications` default `false` already (`auth/callback/route.ts:151`). |  |
| **Unsubscribe** | RFC 8058 one-click in every marketing email. Preference center at `/profile/notifications`. Transactional emails include "manage preferences" footer (Gmail reputation signal). |  |

### Step-by-step plan

| # | Step | Effort |
|---:|---|---|
| 1 | Pick + sign up for Resend; verify sending domain; add DNS records to `monkeytravel.com` | 0.5d (mostly waiting on DNS propagation) |
| 2 | Install `resend` + `@react-email/components` + `@react-email/render`. Create `lib/email/` with client + send helper. | 0.5d |
| 3 | Migrations: `notifications`, `email_log`, ALTER `trip_invites` to add 3 cols. | 0.5d |
| 4 | React Email templates: Invite, VoteCast, CommentAdded, WeeklyDigest. EN versions first. | 1.5d |
| 5 | `POST /api/trips/[id]/invites` accepts `recipient_email`. Send email on insert. Log to `email_log`. | 0.5d |
| 6 | `ShareAndInviteModal`: add email tab. | 0.75d |
| 7 | `enqueueNotification` helper + DB writes. Update vote-cast + proposal-created + comment-added API routes to enqueue. | 1d |
| 8 | Vercel cron job at `/api/cron/send-notification-emails` — batches per user, respects `notification_settings`, writes to `email_log`. | 0.75d |
| 9 | Bell UI in Navbar + Realtime subscription + dropdown. | 1.5d |
| 10 | Preference center at `/profile/notifications`. | 0.5d |
| 11 | One-click unsubscribe endpoint with HMAC token verification. | 0.5d |
| 12 | i18n: translate 4 email templates to ES + IT. | 1d (LLM-assisted) |
| 13 | Resend webhook handler for bounces/complaints → suppress in `email_log` + auto-disable in `notification_settings`. | 0.5d |
| 14 | QA: send invites to a test mailbox, verify deliverability via mail-tester.com (target score >9/10) | 0.5d |

**Total:** ~10 dev-days. Two-week sprint with buffer.

### Risks

| # | Risk | Likelihood | Impact | Mitigation |
|---:|---|---|---|---|
| R1 | DNS records not added by owner → emails fail silently | High | Critical | Block deploy until SPF/DKIM/DMARC verified in Resend dashboard |
| R2 | Notifications table explodes on a viral trip (10k votes = 10k rows for owner) | Medium | Medium | Coalesce: instead of N rows per vote, upsert one "X new votes" row per (trip, day) and bump a counter |
| R3 | Bounce rate >2% → Resend throttles sender | Medium | High | Webhook handler suppresses bounced addresses; never re-send |
| R4 | Spam complaint rate >0.1% → Resend suspends sender | Low | Critical | Strict opt-in for digests; clear unsubscribe; never send marketing to unverified addresses |
| R5 | Email templates rendered with stale data after enqueue but before send | Medium | Low | Re-fetch payload at send time, not enqueue time |
| R6 | i18n: email sent in wrong language | Medium | Medium | Always use recipient's `preferred_language`, fall back to inviter's locale, fall back to EN |
| R7 | Cron job double-sends after Vercel retry | Low | High | `email_log.idempotency_key = hash(notification_id)`; upsert on conflict |
| R8 | GDPR complaint for unsolicited weekly digest | Low | High | Default OFF; opt-in only |

### Test plan (E2E)

- Owner invites by email → recipient receives email in their locale (test ES, IT) → recipient clicks link → lands on `/invite/[token]` → can join (existing flow)
- Recipient address with invalid format → API returns 400 before send
- Recipient on suppression list (previously bounced) → API returns 200 but no email sent, log entry shows `status=suppressed`
- Vote cast on shared trip → notification row inserted for owner → bell UI shows unread count via Realtime
- Cron job runs → notification dispatched to owner's email (if `collabVotes=true`) → `email_log` records `sent_at` + provider message_id
- Cron job runs with `collabVotes=false` → notification stays in DB, never emailed
- Open notification dropdown → entries marked `read_at` → unread count zeroes
- Click unsubscribe link in marketing email → preference flipped → confirmation page in user's locale
- Tampered unsubscribe HMAC token → 403
- Bounce webhook from Resend → `email_log.bounced_at` set, future sends to that address blocked
- Same notification enqueued twice (Vercel cron retry) → only one email sent (idempotency_key dedupe)
- Invite with `recipient_email` set → single-use even if `max_uses > 1`
- Anonymous voter on `/shared/[token]` triggers owner notification (verify the new `anonymous_activity_votes` insert wires to `enqueueNotification`)

---

## 4. Streaming generation (Phase 2F)

The remaining Phase 2 item from `conversion-diagnosis.md`. Purely an upgrade to an already-shipped path. No DB changes. Risk is concentrated in middleware/CDN buffering.

### Pre-flight findings

- **`/api/ai/generate`** returns single JSON (`route.ts:510-530`), 30-40s blocking.
- **`@google/generative-ai` 0.24.1** supports `generateContentStream()` — async iterator of partial responses.
- **`lib/gemini.ts:18-21`** notes incremental generation was abandoned because "frontend never implemented the handler." Streaming v2 must ship frontend in lockstep.
- **`GenerationProgress.tsx`** already exists with fake-progress UI — swap to real day count.
- **`apiGateway.fetch` is NOT stream-aware** (`lib/api-gateway/client.ts:64` calls `response.clone().json()`). Bypass it for this route; don't rebuild.
- **`waitUntil`** already used in this route (`:422-435`) — good pattern for finalizing cache after stream closes.
- **Cache hits** should still return single JSON. Streaming applies only to cache-miss path.

### Impact matrix

| Layer | Change |
|---|---|
| **Database** | None. Usage increments per-request at stream completion (in `finally` — tab close still counts; AI work was done). |
| **`/api/ai/generate`** | Opt-in via `?stream=1` query param. Old callers keep JSON (backward compatible). |
| **Stream format** | SSE (`Content-Type: text/event-stream`). Events: `{type:'metadata'}`, `{type:'day',day:N,content:{...}}`, `{type:'complete',meta:{...}}`, `{type:'error',...}`. Better browser support than JSON-lines. |
| **Gemini call** | Swap `generateContent` → `generateContentStream`. Accumulate partial JSON, parse complete day objects, emit one SSE message per day. Need a streaming JSON parser (`partial-json` or custom day-boundary detector). |
| **Frontend** | `fetch + getReader()` (not `EventSource` — lacks POST). `GenerationProgress.tsx` shows real `Day X of Y`. |
| **`apiGateway.fetch`** | Bypass for this route — call `fetch()` directly from wizard. |
| **Sentry** | Wrap `for await` in try/catch → explicit `Sentry.captureException` (async iteration drops rejections). |
| **Cache writes** | Only on stream `complete`. Skip cache if stream errored. `waitUntil` keeps function alive for write. |
| **Vercel** | Set `Cache-Control: no-cache, no-transform` + `X-Accel-Buffering: no` to defeat edge buffering. Verify `maxDuration` ≥ 300s in `vercel.json` (current function timeout is 120s per `lib/gemini.ts:25`). |
| **Middleware** | Already excludes `/api/` from i18n + page-view tracking (`middleware.ts:103`). No change. |

### Step-by-step plan

| # | Step | Effort |
|---:|---|---|
| 1 | Spike: confirm `generateContentStream` returns parseable partial JSON for the existing prompt schema. | 0.5d |
| 2 | Streaming JSON parser that emits complete `Day` objects as they arrive (handles incomplete trailing day) | 1d |
| 3 | SSE response writer with `metadata` / `day` / `complete` / `error` event types | 0.5d |
| 4 | Add `?stream=1` branch to `/api/ai/generate`. Cache-miss path only. | 0.5d |
| 5 | Wizard: `fetch + getReader()` stream consumer; append days to state as they arrive | 1d |
| 6 | `GenerationProgress.tsx`: real progress (Day X of Y) | 0.25d |
| 7 | Cost tracking on completion (not start). Idempotent for early-disconnect. | 0.25d |
| 8 | Sentry stream-error wrapping. | 0.25d |
| 9 | Test against Vercel preview: verify no buffering, first byte <5s. | 0.5d |
| 10 | A/B: 50/50 split between stream and JSON for 1 week, watch `trip_created` and abandonment events. | 1w of observation |

**Total:** ~4.75 dev-days + 1 week observation.

### Risks

| # | Risk | Likelihood | Impact | Mitigation |
|---:|---|---|---|---|
| R1 | Vercel edge / CDN buffers SSE → all days arrive at once | Medium | Critical | Set `Cache-Control: no-cache, no-transform` + `X-Accel-Buffering: no`; test in production preview |
| R2 | Streaming JSON parser breaks on Gemini output drift | Medium | High | Defensive: if parse fails midway, fall back to "wait for complete response, parse, emit all at once" — degrades to current behaviour, doesn't break |
| R3 | User closes tab mid-stream → orphaned Gemini call + ambiguous billing | Medium | Low | `waitUntil` finishes the call + caches result anyway (next user gets cache hit); usage counter still increments |
| R4 | Some browsers / corporate proxies strip SSE | Low | Medium | Fall back to JSON if `EventSource` not supported; document min browser versions |
| R5 | Per-chunk async iteration drops rejections, Sentry never sees errors | Medium | Medium | Explicit try/catch around `for await` block + `Sentry.captureException` |
| R6 | Cache write happens before stream completes → poisoned cache | Low | High | Only cache in the `complete` event handler |
| R7 | A/B test shows no lift (users don't notice) | Low | Low | Even no-lift is a quality-of-life win — keep it |

### Test plan (E2E)

- Anonymous user starts generation with `?stream=1` → first day visible in <5s → all days within 30s
- Cache hit → returns single JSON (no stream) even if `stream=1` requested
- Network throttled to 3G → days still appear progressively, no full-stop
- User closes tab during stream → server completes generation, caches result; new identical request returns cache hit
- Gemini API errors mid-stream → SSE `error` event sent; client shows friendly error; usage NOT incremented
- Authenticated user with quota = 0 → 429 before stream starts
- Anonymous user at rate-limit → 429 before stream starts
- Stream events arrive out of order (unlikely but test) → client handles by `day_number` key, not arrival order
- Sentry receives the stream-error if Gemini fails mid-way
- Usage counter increments exactly once per successful generation (not per chunk, not zero)
- Tab refreshed mid-stream → fresh request (no resume semantics — document this)
- JSON consumers (mobile cache warmer, future server-side preview) still work without `?stream=1`

---

## 5. Pillar translations to ES + IT

Lowest-risk, highest-compounding SEO move. Three high-effort English pillars are currently 1 of 1 across languages — they emit `canonical=EN` and skip `hreflang` for ES/IT per `hasLocaleTranslation()` (see `lib/blog/api.ts:174-191`). Translating them flips the metadata to self-canonical and unlocks 6 indexed URLs from 3.

### Pre-flight findings

- **Three pillar slugs** are EN-only today: `2026-travel-calendar`, `spring-summer-travel-guide`, `honeymoon-planning-guide`. Verified via `glob` against `content/blog/{es,it}/`.
- **Word counts** (verified with `wc -w`):
  - `2026-travel-calendar.md`: 8,751 words
  - `spring-summer-travel-guide.md`: 4,581 words
  - `honeymoon-planning-guide.md`: 6,811 words
  - **Total EN:** 20,143 words → **~40,300 words** of translation across ES + IT
- **`hasLocaleTranslation`** (`lib/blog/api.ts:186-191`) already does the right thing — once the files exist, sitemap + canonical flip automatically. **Zero code changes required.**
- **`messages/es/blog.json:117`** has a `posts` map keyed by slug. Verified the three pillars are NOT in there today. Same likely for IT.
- **Existing translation quality:** `messages/es/blog.json` is fluent Castilian (e.g. "Sin relleno"), not raw machine translation. Sets a quality bar — pure DeepL with no human pass would feel a step down.
- **Existing IT pillars by Emanuela/Francesca:** the EN bylines (`author: "Emanuela P."` per `content/blog/2026-travel-calendar.md:5`) should be preserved — Emanuela writes in Italian natively (per the project's profile), Francesca's Italian fluency [ASSUMPTION] suggests these can be presented as same-author works, not "translated by" works. **This is important for E-E-A-T** — Google's helpful-content classifier treats translation-by-author differently from machine-translation-with-byline-laundering.

### Impact matrix

| Layer | Change | Notes |
|---|---|---|
| **Database** | None | i18n is file-based. |
| **Files** | Create 6 files: `content/blog/es/{2026-travel-calendar,spring-summer-travel-guide,honeymoon-planning-guide}.md` and same 3 under `content/blog/it/` | Frontmatter `slug` stays English (URL stays English) per existing convention; `title`/`description`/body translate. |
| **Sitemap** | Auto-emits the 6 new URLs once files exist (no code change) | `hasLocaleTranslation` gates it. |
| **Canonical** | Auto-flips from `canonical=/blog/{slug}` to `canonical=/{locale}/blog/{slug}` for the locale page | Same gate. |
| **Hreflang** | Auto-emits `<link rel="alternate" hreflang="es" ...>` and `hreflang="it"` once locale files exist | Same gate. |
| **i18n keys** | Add 3 entries to `messages/es/blog.json` and `messages/it/blog.json` under `posts.{slug}.title` and `posts.{slug}.description` | Currently fall back to frontmatter EN — replacing with translated copy. |
| **Author bylines** | Keep `author: "Emanuela P."` etc. — translation flows from same-author voice, not third-party translator | E-E-A-T point above. |
| **Cross-linking** | The English pillars link to other EN posts. Translated pillars should link to ES/IT counterparts where they exist, fall back to EN otherwise. | Manual pass during translation. |

### Decision: who translates?

| Option | Cost | Quality | Speed | Recommendation |
|---|---|---|---|---|
| **Pure LLM (Claude/GPT-4) with no human pass** | ~$5 | "Reads OK" — recreates the thin/duplicate locale content problem the blog audit just fixed | 1 day | **Reject** — the audit explicitly warned against this |
| **LLM-assisted draft + native-speaker editor (Emanuela for IT, hired for ES)** | ~$300-500 (editor time at $40-80/hr × 6-10hr per language) | High — voice preserved, cultural adaptation | 3-5 days per language | **Recommend** |
| **Pure human translator (agency)** | ~$3-5k (40k words at $0.08-0.12/word) | Highest | 2-3 weeks | Defer unless paid traffic targets justify |

**Recommended path:** LLM-assisted draft + native-speaker pass. Project profile suggests Emanuela can handle IT review in-house. ES needs a hired native editor (one round, ~$300). This matches the quality bar of `messages/es/blog.json`.

### Step-by-step plan

| # | Step | Effort |
|---:|---|---|
| 1 | Pick translation prompt + glossary (preserve brand voice, conditions-not-hype tone) | 0.25d |
| 2 | Run LLM translation of 3 pillars × 2 languages = 6 drafts | 0.5d |
| 3 | IT review pass by Emanuela (her existing voice) | 1d |
| 4 | ES review pass by hired native editor — cultural adaptation, especially destination naming and idioms | 2d wallclock (likely 4-8hr of editor time) |
| 5 | Add `posts.{slug}` entries to `messages/{es,it}/blog.json` | 0.25d |
| 6 | Verify in dev: `/es/blog/2026-travel-calendar` renders translated content, sitemap includes new URLs, hreflang tags present | 0.25d |
| 7 | Deploy. Submit updated sitemap to GSC. Watch indexing dashboard over 2-4 weeks. | 0.25d (+ ongoing) |
| 8 | Spot-check 4 weeks post-launch: are the locale pages indexed? Any "Duplicate, Google chose different canonical" warnings? | 1hr at +4w |

**Total dev/edit effort:** ~4.5 days wallclock, ~2 days of focused work.

### Risks

| # | Risk | Likelihood | Impact | Mitigation |
|---:|---|---|---|---|
| R1 | Low-effort MT recreates the thin-content problem | High if step 3-4 skipped | Critical to SEO | Mandatory native-speaker editor pass |
| R2 | Translated pillars cannibalize EN pillars on `.com/blog/2026-travel-calendar` for Spanish/Italian-speaking US searchers | Low | Low | hreflang resolves this for Google; not a real risk |
| R3 | Frontmatter mistranslation breaks sitemap (e.g. malformed YAML in IT due to unescaped quotes) | Medium | Medium | Lint-check YAML frontmatter before commit; CI script |
| R4 | Author byline appears inconsistent (EN author writing in IT) — feels off to readers | Low | Low | Add small footer note: "Versione italiana a cura di Emanuela" |
| R5 | Cross-links from translated pillar point to non-existent locale articles | High if not audited | Low | Step 4 reviewer fixes; fall back to EN link if no locale version |
| R6 | Honeymoon pillar (`6,811 words`) includes culturally-anchored examples (Italian beaches, Mediterranean honeymoons) that don't map to LATAM Spanish audience | Medium | Medium | ES editor adds 1-2 LATAM-relevant examples (Cartagena, Tulum) and notes regional preference; otherwise the article reads like Spain-only content |
| R7 | Indexing dashboard shows no improvement in 4 weeks | Low | Low | Google's helpful-content rollouts are slow; give it 8-12 weeks before second-guessing |

### Test plan (E2E)

- `content/blog/es/2026-travel-calendar.md` exists → `/es/blog/2026-travel-calendar` renders the Spanish content (not EN fallback)
- Same for IT and for the other 2 pillars (6 page-render checks)
- `/sitemap.xml` includes all 6 new locale URLs
- HTML `<head>` of `/es/blog/2026-travel-calendar` has `<link rel="canonical" href="https://monkeytravel.com/es/blog/2026-travel-calendar">` (NOT pointing at EN)
- Same page has `<link rel="alternate" hreflang="en" ...>`, `hreflang="it"`, `hreflang="es"`, `hreflang="x-default"`
- `messages/es/blog.json` has `posts.2026-travel-calendar.title` populated → blog index page shows translated title in ES locale
- Frontmatter YAML valid (no unescaped quotes, dates correctly formatted)
- Cross-links from translated pillar all resolve (no 404s, no fallback-to-EN that should have been translated)
- LLM-only sections flagged by the editor are visibly different from the LLM draft (verify human pass actually happened)
- 4 weeks post-deploy: GSC indexing report shows the 6 new URLs in "Indexed" state, not "Discovered – not indexed"
- 4 weeks post-deploy: no "Duplicate, Google chose different canonical" warnings for the locale URLs

---

## Summary table — sequence at a glance

| # | Feature | Dev effort | Risk profile | Conversion impact | Best position in queue |
|---:|---|---|---|---|---|
| 5 | Pillar translations (ES + IT) | ~4.5d wallclock | Low (manual + editorial work) | Indirect — SEO compounding over months | **First** — runs in parallel with everything else |
| 2 | Start Anywhere (Vision input) | ~4.75d | Medium — SSRF + hallucination risks | High (matches Mindtrip's most copied feature) | **Second** — highest user-facing delight |
| 4 | Streaming generation | ~4.75d + 1w observation | Medium — buffering + parser risks | Medium (perceived latency win) | **Third** — pure upgrade of shipped path |
| 1 | Mobile native (Capacitor) | ~6.5d + 2w review | Medium-High — OAuth callback is load-bearing | High (distribution channel competitors own) | **Fourth** — wait for streaming so the mobile UX feels current |
| 3 | Email + notifications | ~10d | High — DNS, deliverability, GDPR, cron idempotency | Medium (unblocks collaboration story) | **Last** — most cross-cutting; let other features stabilize their event hooks first |

All five together: ~30 dev-days. A focused 6-week sprint with one engineer, or 3 weeks with two working in parallel (translations + streaming + Start Anywhere are independent; mobile and email come after).
