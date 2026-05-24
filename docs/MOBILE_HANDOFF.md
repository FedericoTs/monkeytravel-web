# Mobile App Hand-off — Capacitor Native Wrap

## What's already done in this repo

| Item | Status | Where |
|---|---|---|
| Capacitor 6 runtime + plugins installed | ✅ | `package.json` (@capacitor/*) |
| `capacitor.config.ts` with `server.url=https://monkeytravel.app` | ✅ | `capacitor.config.ts` |
| Middleware allowlist comment (`MonkeyTravelApp/1.0` UA) | ✅ | `middleware.ts:17-23` |
| Universal Links manifest (placeholder TEAMID) | ✅ | `public/.well-known/apple-app-site-association` |
| Android App Links manifest (placeholder SHA256) | ✅ | `public/.well-known/assetlinks.json` |
| Both manifests served as `application/json` | ✅ | `next.config.ts` headers() |
| Middleware bypass for `.well-known/*` (no i18n redirect) | ✅ | `middleware.ts:107` |
| Native-aware `shareLink()` + `copyToClipboard()` | ✅ | `lib/native/share.ts` |
| `ShareRow` uses native share when available | ✅ | `components/ShareRow.tsx` |
| Playwright @prod tests (WebView UA + manifests) | ✅ | `tests/e2e/mobile-webview.spec.ts` |

## What you (the human) need to do next

These steps live on your machine, not in this repo, because they:
- Need Xcode 16+ / Android Studio Koala+
- Need an Apple Developer account ($99/yr) and Google Play Console account ($25 one-time)
- Generate platform folders (`ios/`, `android/`) that are large and don't belong in a web repo
- Need design assets we don't have here

### Step 1 — Generate the platform folders (10 min, local)

```bash
cd /c/Users/Samsung/Documents/Projects/travel-app-web

# Initialise the iOS shell. Writes the ios/ folder.
npx cap add ios

# Same for Android. Writes the android/ folder.
npx cap add android

# Pushes capacitor.config.ts into both native projects.
npx cap sync
```

**Add `ios/` and `android/` to `.gitignore`** if you're not committing them
to this repo (recommended — they're big and regenerate cleanly). Or commit
them to a separate `monkeytravel-mobile` repo.

### Step 2 — App icon + splash (1 hr, design + tooling)

You need a **1024×1024 PNG** master icon (transparent background OK for
adaptive icons). Save it as `resources/icon.png` and an optional
`resources/splash.png` (2732×2732 with the logo centered in the middle
~1024px).

```bash
npm install --save-dev @capacitor/assets   # already installed
npx capacitor-assets generate              # fans out every iOS/Android size
npx cap sync                                # push generated assets into native projects
```

### Step 3 — Apple Developer setup (1–2 hr)

1. https://developer.apple.com — enroll ($99/yr if not already)
2. App Store Connect → My Apps → New App
   - Bundle ID: `app.monkeytravel` (matches `capacitor.config.ts:appId`)
   - SKU: `monkeytravel-ios`
   - Name: `MonkeyTravel`
3. Note your **Team ID** (from Membership page) — looks like `ABCDEF1234`
4. Edit `public/.well-known/apple-app-site-association`:
   - Replace `TEAMID` (both places) with your actual Team ID
   - Commit + deploy
5. Apple's `swcd` daemon refreshes the file on its own schedule; verify
   with `swcutil dl -d monkeytravel.app` on a Mac after deploy

### Step 4 — Google Play setup (1–2 hr)

1. https://play.google.com/console — $25 one-time enrollment if not already
2. Create app → MonkeyTravel
3. Package name: `app.monkeytravel`
4. After your **first internal-track upload**, Play Console generates a
   signing certificate. Copy its **SHA-256 fingerprint** from
   *App integrity → App signing → SHA-256 certificate fingerprint*
5. Edit `public/.well-known/assetlinks.json`:
   - Replace `REPLACE_WITH_PLAY_APP_SIGNING_SHA256_AFTER_FIRST_INTERNAL_TRACK_UPLOAD`
     with the fingerprint
   - Commit + deploy
6. Verify with https://developers.google.com/digital-asset-links/tools/generator

### Step 5 — Sign in with Apple (App Store rule 4.8)

Apple **rejects apps** that offer third-party sign-in (Google, Facebook,
etc.) but don't also offer Sign in with Apple.

1. Supabase Dashboard → Authentication → Providers → Apple
   - Enable
   - Add your Apple Service ID (`app.monkeytravel.signin` — must be a Service ID, NOT the bundle ID)
   - Add the private key + Team ID + Key ID
2. In the app: add a "Sign in with Apple" button alongside Google
   - https://supabase.com/docs/guides/auth/social-login/auth-apple
3. Set the redirect URL in Supabase to:
   - `https://monkeytravel.app/auth/callback` (web)
   - `app.monkeytravel://auth/callback` (native — needs the URL scheme registered in iOS Info.plist)

### Step 6 — Auth flow inside the WebView (THE LOAD-BEARING RISK)

> **You will hit this. Plan for it.**

The current OAuth flow (`app/auth/callback/route.ts`) sets cookies via
`exchangeCodeForSession`. Inside Capacitor's WebView, cookies work — BUT
if you open the OAuth URL with `@capacitor/browser` (recommended for
Google's compliance rules), the cookies land in the in-app browser's
jar, NOT the WebView's.

**Two paths forward:**

**Path A (recommended) — PKCE + custom storage:**

```typescript
// lib/supabase/client.ts (modify after testing on device)
import { Preferences } from "@capacitor/preferences";

const capacitorStorageAdapter = {
  async getItem(key: string) {
    const { value } = await Preferences.get({ key });
    return value;
  },
  async setItem(key: string, value: string) {
    await Preferences.set({ key, value });
  },
  async removeItem(key: string) {
    await Preferences.remove({ key });
  },
};

export const createClient = () => createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  {
    auth: {
      flowType: "pkce",
      storage: isNativePlatform() ? capacitorStorageAdapter : undefined,
    },
  }
);
```

**Path B (fallback) — Custom URL scheme:**

Register `monkeytravel://` in iOS Info.plist and Android intent filters.
In the OAuth flow, redirect to `monkeytravel://auth/callback?code=...`,
catch it with `@capacitor/app`'s `appUrlOpen` event, and replay the code
exchange inside the WebView.

**Test plan** (do BEFORE submitting for review):
1. Cold-launch app → tap Google sign-in → complete OAuth → land back in app
2. Force-quit + reopen → session must persist
3. Background 30 min → foreground → session must persist
4. Sign out → verify cookies + Preferences are both cleared

### Step 7 — Local dev workflow

```bash
# After any change to capacitor.config.ts:
npx cap sync

# Open Xcode (iOS):
npx cap open ios

# Open Android Studio (Android):
npx cap open android

# Live-reload during dev — point at localhost:3000:
# Edit capacitor.config.ts temporarily:
#   server: { url: "http://10.0.2.2:3000", cleartext: true }  (Android emulator)
#   server: { url: "http://localhost:3000", cleartext: true }  (iOS simulator)
# Then `npx cap sync` and rebuild in Xcode/Studio.
# DO NOT commit these — only for local dev.
```

### Step 8 — TestFlight + Play Internal Testing

1. Xcode → Product → Archive → Distribute App → TestFlight
2. Android Studio → Build → Generate Signed Bundle → upload to Play
   Console → Internal Testing track
3. Add your email + 1-2 testers
4. Run the test plan in Step 6
5. Once green: submit for App Store Review (1-3 days) and Play Production
   (a few hours)

### Step 9 — Push notifications (v1.1, defer)

Per the implementation plan, push is explicitly v1.1. When you're ready:
- `npm install @capacitor/push-notifications`
- Firebase project (Android) + APNs key (iOS)
- New `device_tokens` table in Supabase + `/api/devices/register` endpoint
- Webhook from the notifications service (`lib/notifications/service.ts`)
  to fan out to registered devices

## Things that will trip you up

1. **`apple-app-site-association` MUST be served as `application/json`.**
   Already handled in `next.config.ts`. Verify post-deploy:
   ```bash
   curl -I https://monkeytravel.app/.well-known/apple-app-site-association
   # Look for: Content-Type: application/json
   ```

2. **Apple's swcd caches aggressively.** After updating the file, expect
   24-48hrs before Universal Links start working on already-installed
   devices. Reinstalling the app forces a refresh.

3. **Google App Links require the signing SHA-256 from Play Console**, not
   from your local keystore. You won't have this until your first
   internal-track upload.

4. **iOS WebView cookies are scoped to the app**, not the system Safari
   cookie jar. Users who are signed into monkeytravel.app in Safari are
   NOT signed into the app — this is expected and correct (security
   boundary).

5. **PostHog ATT prompt**: initialise PostHog without IDFA. Search for
   `posthog.init` in the codebase and confirm no advertiser ID is being
   collected. Adding the IDFA later triggers the App Tracking Transparency
   prompt, which tanks opt-in rates.

6. **Splash screen flashes.** If you see a brief white flash before the
   site loads, increase `SplashScreen.launchShowDuration` in
   `capacitor.config.ts`.

## Estimated remaining effort

| Step | Effort |
|---|---|
| 1: platform folders | 10 min |
| 2: icons + splash | 1 hr (assumes design assets ready) |
| 3: Apple Dev | 1-2 hr |
| 4: Play Console | 1-2 hr |
| 5: Sign in with Apple | 0.5 day |
| 6: PKCE auth migration + device test | 1 day |
| 7-8: local dev + TestFlight + Internal Testing | 0.5 day |
| 9: review wait (Apple) | 1-3 days |

**Total focused work:** ~2-3 dev-days. **Wall-clock:** 1-2 weeks accounting
for store review cycles.
