# From Zero to TestFlight + Team Testing — Step-by-Step

**Date:** 2026-05-30
**Audience:** Federico
**Predecessor docs:** `MOBILE_HANDOFF.md` (what's already in repo), `MOBILE_CONVERSION_PLAN.md` (the full roadmap), `legal/app-privacy-label.md` + `legal/store-listings.md` (paste-ready copy).

**What this doc covers:** Every external action you need to take to go from "code is shipped" (where we are now) to "the team has the app installed on their phones via TestFlight (iOS) and Play Internal Testing (Android)."

**Total estimated time on your machine:** ~1 dev-day spread across the steps. Most of that is Apple review wall-clock waiting.

---

## Quick reference — what state is everything in

| Layer | State | Action needed |
|---|---|---|
| Web codebase | ✅ All Phase A + B shipped to prod | None |
| Supabase schema | ✅ `device_tokens` + `push_log` applied | None |
| Capacitor wrap config | ✅ `capacitor.config.ts` ready | None |
| Universal Links / App Links manifests | ✅ Files in `public/.well-known/` with placeholders | Fill `TEAMID` + Play signing SHA-256 (Step 1 + 4) |
| iOS native shell | ❌ Not generated | `npx cap add ios` (Step 5) |
| Android native shell | ❌ Not generated | `npx cap add android` (Step 5) |
| Apple Developer account | ❌ Not enrolled | $99/yr enrollment (Step 1) |
| Google Play Console | ❌ Not enrolled | $25 one-time (Step 1) |
| Firebase project | ❌ Not created | Free (Step 2) |
| Push env vars in Vercel | ❌ Not set | Step 3 |
| Supabase Apple provider | ❌ Not enabled | Step 3 |
| App Store Connect privacy answers | ❌ Not filed | Step 6 |
| Screenshots | ❌ Not generated | Step 7 |

---

## Step 0 — Decision point before you start

Before spending $124 + a dev-day, confirm:

- **Are you OK shipping the app even before push notifications work?** Push needs APNs key (free) + Firebase project (free) + env vars set. The app works fine in TestFlight without push — testers just won't get notifications. **Recommended path: ship iOS to TestFlight first, configure push after.**
- **iOS-first or both stores at once?** Easier to do iOS first since you'll learn the flow before tackling Android's Play Console which has different UX. Recommended: iOS first this week, Android next week.
- **Who's on the test team?** Decide now. TestFlight invites accept up to 10,000 testers but you'll start with a handful. List the emails.

This guide assumes: **iOS-first, push deferred to "after first TestFlight is happy."**

---

## Step 1 — Apple Developer Program enrollment

**Time:** 1-2 hr first time + 24-48 hr Apple approval wait.
**Cost:** $99/year.

1. Go to https://developer.apple.com/programs/enroll/
2. Sign in with your Apple ID (use a personal one tied to your real name; don't make a new one)
3. Choose **Individual** enrollment (faster than Organization — no D-U-N-S number required). You can convert later if MonkeyTravel becomes a company.
4. Pay the $99
5. Wait for Apple's email confirming enrollment is active (usually 24-48 hr; can be same-day if you're lucky)

**Why now:** every other step in this guide needs an active Apple Developer account. Start this first so the wait runs in parallel with the rest of the work.

Once active, get your **Team ID** from https://developer.apple.com/account → Membership → Team ID. It looks like `ABCDEF1234`. Save it — you'll paste it in multiple places.

---

## Step 2 — Google Play Console enrollment (parallel, for Android later)

**Time:** 30 min + 1-2 day Google approval.
**Cost:** $25 one-time.

1. https://play.google.com/console/signup
2. Pay $25
3. Wait for Google's email approving the account

You won't need this immediately if you're iOS-first. Start it now so it's ready when you're done with iOS.

---

## Step 3 — Auth + push env config (do while Apple approves)

These can all run in parallel with Apple's approval wait. Each is 10-20 min.

### 3a — Sign in with Apple Service ID

You need this to make the **"Continue with Apple"** button work on web AND in the iOS app.

1. https://developer.apple.com/account → **Certificates, Identifiers & Profiles** → **Identifiers** → click **(+)**
2. Choose **Services IDs** → Continue
3. Description: `MonkeyTravel Sign In`
4. Identifier: `app.monkeytravel.signin` (must be DIFFERENT from your app's bundle ID — Apple's quirk)
5. Continue → Register
6. Click the new Service ID → check **Sign in with Apple** → Configure
7. Primary App ID: `app.monkeytravel` (your bundle ID — even though you haven't created the iOS app yet, you can reserve it now)
8. Domains and Subdomains: `monkeytravel.app`
9. Return URLs: `https://monkeytravel.app/auth/callback`
10. Save

### 3b — Apple .p8 push key (for push notifications)

ONE key per Apple Developer team, downloaded ONCE. Don't lose it — Apple won't show it again.

1. Same dashboard → **Keys** → click **(+)**
2. Key Name: `MonkeyTravel Push + Sign In`
3. Check **Apple Push Notifications service (APNs)**
4. Check **Sign in with Apple** → Configure → Primary App ID: `app.monkeytravel`
5. Continue → Register → **Download** the `.p8` file
6. Note the **Key ID** (10 chars shown on the next page) — you'll need it for env vars

Save the `.p8` file somewhere safe (1Password, encrypted drive — NOT in git).

### 3c — Supabase Apple provider

1. https://supabase.com/dashboard/project/sevfbahwmlbdlnbhqwyi/auth/providers
2. Find **Apple** → toggle **Enabled**
3. **Services ID**: `app.monkeytravel.signin` (the one from 3a)
4. **Secret Key (For OAuth)**: This is a JWT generated from your .p8. Use https://supabase.com/docs/guides/auth/social-login/auth-apple#provider-configuration to compute it OR run:

```bash
# In any Node project:
npm install jose
node -e '
const { SignJWT, importPKCS8 } = require("jose");
const fs = require("fs");
const TEAM_ID = "YOUR_TEAM_ID";       // from Step 1
const KEY_ID = "YOUR_KEY_ID";         // from 3b
const SERVICES_ID = "app.monkeytravel.signin";
const P8 = fs.readFileSync("./AuthKey_KEYID.p8", "utf8");
(async () => {
  const key = await importPKCS8(P8, "ES256");
  const now = Math.floor(Date.now() / 1000);
  const jwt = await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: KEY_ID })
    .setIssuer(TEAM_ID)
    .setAudience("https://appleid.apple.com")
    .setSubject(SERVICES_ID)
    .setIssuedAt(now)
    .setExpirationTime(now + 180 * 24 * 60 * 60) // 6 months — Apple's max
    .sign(key);
  console.log(jwt);
})();'
```

Paste the output JWT as the Secret Key in Supabase.

**Note:** This JWT expires every 6 months. Set a calendar reminder to regenerate (or automate it later).

5. **Save**
6. Test: open `https://monkeytravel.app/auth/login` in incognito → click **Continue with Apple** → should bounce through appleid.apple.com and back to your trips page

### 3d — Firebase project (for FCM push, can defer)

If you want push working before first TestFlight, do this now. Otherwise skip until later.

1. https://console.firebase.google.com → **Add project**
2. Project name: `MonkeyTravel` → Continue → Disable Analytics (we use PostHog) → Create
3. Once created → **⚙ Project Settings** → **Service Accounts** → **Generate new private key** → downloads a JSON file
4. Note your **Project ID** (shown at the top of Project Settings)
5. Save the JSON file safely (1Password etc.)

### 3e — Vercel env vars

Whatever you set up in 3a-3d, the env vars need to land in Vercel.

```bash
cd /path/to/travel-app-web
# Apple sign-in (already works via Supabase; no env needed unless you also do native iOS)
# Push (skip if not doing 3d yet)
vercel env add APNS_TEAM_ID production    # paste Team ID
vercel env add APNS_KEY_ID production     # paste Key ID from 3b
vercel env add APNS_KEY_P8 production     # paste FULL contents of .p8 file, including BEGIN/END lines
vercel env add APNS_BUNDLE_ID production  # paste: app.monkeytravel
vercel env add APNS_PRODUCTION production # paste: false (start with sandbox; flip to true after TestFlight)
vercel env add FCM_PROJECT_ID production  # paste: monkeytravel-xxxxx (from 3d)
vercel env add FCM_SERVICE_ACCOUNT_JSON production  # paste ENTIRE contents of the JSON file as one line
```

Trigger a redeploy after env changes:
```bash
vercel --prod
```

---

## Step 4 — Fill the Universal Links + App Links manifests

These tell iOS/Android "links to monkeytravel.app should open in the app if installed."

### 4a — Apple App Site Association

Edit `public/.well-known/apple-app-site-association`. Replace both occurrences of `TEAMID` with your Team ID from Step 1:

```json
{
  "applinks": {
    "apps": [],
    "details": [
      {
        "appID": "ABCDEF1234.app.monkeytravel",
        "paths": ["*"]
      }
    ]
  }
}
```

Commit + push. Vercel deploys. Verify with:
```bash
curl -I https://monkeytravel.app/.well-known/apple-app-site-association
# Look for: Content-Type: application/json
```

### 4b — Android App Links (do AFTER first Play Internal upload — see Step 9)

`public/.well-known/assetlinks.json` needs the **app signing SHA-256** from Google Play Console. Skip until Step 9.

---

## Step 5 — Generate the iOS native shell

**Time:** 15 min. Requires macOS + Xcode 16+.

```bash
cd /path/to/travel-app-web

# Generate the platform folders. NOT committed to this repo (they're big + regenerate).
npx cap add ios

# Push capacitor.config.ts + manifests into the iOS project
npx cap sync ios

# Open in Xcode
npx cap open ios
```

Xcode opens with a generated `App.xcworkspace`.

### One-time Xcode config

1. Select **App** in the file tree → **Signing & Capabilities**
2. Sign in with your Apple Developer account (Xcode → Settings → Accounts → +)
3. **Team:** select your team
4. **Bundle Identifier:** `app.monkeytravel`
5. Click **+ Capability** and add:
   - **Sign in with Apple**
   - **Push Notifications**
   - **Background Modes** → check `Remote notifications`
6. **Info.plist** → add:
   - `NSUserActivityTypes` array with `NSUserActivityTypeBrowsingWeb` (for Universal Links)

### App icon + splash

Recommended: download `@capacitor/assets` and auto-generate.

1. Save your 1024×1024 PNG master icon as `resources/icon.png`
2. Optional splash: 2732×2732 PNG with logo centered (~1024px) as `resources/splash.png`
3. Run:
```bash
npx capacitor-assets generate --ios
npx cap sync ios
```

This produces all the iOS-specific sizes Xcode needs.

---

## Step 6 — Fill App Privacy Nutrition Label in App Store Connect

Apple **rejects builds** if this isn't filed BEFORE the first upload. Takes ~30 min.

1. https://appstoreconnect.apple.com → **My Apps** → **(+)** New App
2. Platform: iOS
3. Name: `MonkeyTravel`
4. Primary Language: English (US)
5. Bundle ID: `app.monkeytravel` (should appear in the dropdown after Xcode registers it)
6. SKU: `monkeytravel-ios`
7. User Access: Full Access
8. Create

Now the app shell exists. Go to **App Information** → **App Privacy** → **Get Started**.

**Use `docs/legal/app-privacy-label.md` to answer every section.** That doc was written exactly for this — every section there maps to Apple's questionnaire 1:1.

The TL;DR:
- Contact Info → Email + Name → YES, linked, NOT tracking
- Health/Financial/Location/Sensitive/Contacts → all NO
- User Content → Photos (transient for Start Anywhere) + User-generated trips
- Identifiers → User ID (Supabase UUID) YES; Device ID **NO** (critical for ATT)
- Usage Data → Product Interaction YES
- Diagnostics → Crash + Performance YES, NOT linked

Save and File.

---

## Step 7 — Generate screenshots

**Required:** 6.7" iPhone (1290×2796), 6.5" iPhone (1242×2688). Optional but recommended: 12.9" iPad Pro (2048×2732).

**Path A — Manual (1-2 hr, no setup):**

1. Open Chrome DevTools → Device toolbar → set custom dimension to 1290×2796 (iPhone 15 Pro Max)
2. Navigate to your live site (`https://monkeytravel.app`) and screenshot each story step:
   - Hero/wizard step 1 with destination filled
   - Result page Day 2 of a Tokyo trip
   - TripMap with markers + polylines
   - Visa checker tool result
   - /shared/{token} with vote bottom sheet open
3. Save each as PNG at the exact pixel dimensions
4. Repeat for 1242×2688 (iPhone 8 Plus)
5. Repeat for 2048×2732 (iPad Pro)

**Path B — fastlane snapshot (0.5 day setup, then 5 min per release):**

```bash
gem install fastlane
cd ios/App
fastlane init
fastlane snapshot init
# Edit Snapfile + write a UI test that walks each screen
fastlane snapshot
```

For first ship, just do Path A manually. Switch to fastlane after you've shipped 2-3 releases.

Upload screenshots in App Store Connect → **Version** → **Screenshots**.

---

## Step 8 — Paste store listing copy

In App Store Connect → **Version** sections, paste from `docs/legal/store-listings.md`:

- **Name** (per locale): MonkeyTravel
- **Subtitle** (30 chars): paste per locale
- **Promotional Text** (170 chars): paste per locale
- **Description** (4000 chars): paste per locale
- **Keywords** (100 chars, comma-separated): paste per locale
- **What's New**: paste per locale
- **Support URL**: `https://monkeytravel.app/contact`
- **Marketing URL**: `https://monkeytravel.app`
- **Privacy Policy URL**: `https://monkeytravel.app/privacy`
- **Category**: Travel (primary), Lifestyle (secondary)
- **Age Rating**: complete the questionnaire — likely 4+ (no objectionable content)

For en/it/es locales: each has a "Localization" tab; paste the matching language copy.

---

## Step 9 — First TestFlight upload

**Time:** 30 min for the upload + 5-30 min for Apple's automated review.

### 9a — Archive in Xcode

1. In Xcode, top bar device selector → **Any iOS Device (arm64)**
2. Menu: **Product → Archive**
3. Wait 2-5 min for the archive to build
4. Organizer window opens → select your archive → **Distribute App**
5. Choose **App Store Connect** → Next
6. **Upload** → Next → defaults are fine
7. **Automatically manage signing** → Next
8. Wait 3-10 min for upload + Apple's automated checks

### 9b — TestFlight processing

Back in App Store Connect → **TestFlight** tab:

1. Your build will appear in **Builds** → status: "Processing" for 5-30 min
2. Once Processed, status becomes "Ready to Submit" — but you DON'T need to submit for App Store review yet; internal testing works immediately

### 9c — Internal Testing (your team only — no review)

1. App Store Connect → **TestFlight** → **Internal Testing** → **(+)**
2. Group name: `Core Team`
3. Add testers by email (must be App Store Connect users — invite them first under **Users and Access**)
4. Save
5. Add your build to this group → click the build → **Add Build to Test**

Internal testers get the build instantly. No Apple review needed for internal.

### 9d — External Testing (broader beta — needs Apple review)

If you want to ship to non-team testers:

1. TestFlight → **External Testing** → **(+)** → Group name: `Beta Users`
2. Submit a **Beta App Review** form (Apple reviews — typically 1-3 days)
3. Once approved, you can add up to 10,000 testers via email or public link
4. They install via the TestFlight iOS app on their phone

---

## Step 10 — Inviting + onboarding the team

### What testers do

1. They get an email: "Federico invited you to test MonkeyTravel on TestFlight"
2. They install Apple's free **TestFlight** app from the App Store
3. They open the email on their iPhone → tap **View in TestFlight**
4. TestFlight installs your build
5. They open the app

### What you tell them

Send this verbatim to each tester:

> **MonkeyTravel TestFlight — what we need from you**
>
> Thanks for testing! Three flows we care about most:
>
> 1. **Plan a trip from scratch** — tap Plan New Trip, fill destination + dates, see the AI generate it. Tell us anything that felt slow, broken, or surprising.
> 2. **Sign in** — try Google AND Apple sign-in. Confirm they both land you back in the app.
> 3. **Daily use** — keep the app for a week. Open it casually. Note when something feels off vs. what you'd expect from Booking/Airbnb.
>
> **How to report:** screenshot anything weird, send to [your email or a Slack channel]. Crashes are auto-reported via Sentry, so you don't need to file those.
>
> **What's expected to be rough:**
> - Push notifications might be off — that's fine
> - Apple sign-in works in TestFlight; Google sign-in works once we've set up the OAuth domains
> - First load is slow because the app fetches a fresh build each launch (this is intentional for now)

### Tester comms channel

Pick one and stick to it:
- **Email**: simplest. They reply to your invite email. Works for <10 testers.
- **Slack channel**: better for >5 testers. Free Slack workspace, one #monkeytravel-beta channel.
- **TestFlight Feedback**: built-in. Testers tap **Send Beta Feedback** in TestFlight → shows up in App Store Connect → TestFlight → Feedback. Best for screenshots + automatic crash logs.

Recommended: **TestFlight Feedback for bug reports + Slack for general discussion**.

---

## Step 11 — Iterating without re-review

This is the magic of your `server.url` Capacitor model:

- **Web/feature changes**: deploy via Vercel as always. Every TestFlight installer sees them on next app launch. **Zero App Store review.**
- **Bug fixes**: same. Push the fix to the website, testers get it instantly.
- **Push notification changes**: same — server-side dispatcher updates without re-upload.

**You need a new TestFlight upload ONLY for:**
- Native plugin changes (new Capacitor plugin added → re-archive in Xcode → re-upload)
- `capacitor.config.ts` changes (`server.allowNavigation`, splash, status bar, etc.)
- App icon or version number bumps

For everything else: ship to the web, the app gets it on next launch.

### Bump version number for each TestFlight upload

In Xcode, the project's **General** tab:

- **Version** (e.g. 1.0.0) — what users see; bump on user-facing releases
- **Build** (e.g. 1, 2, 3) — must increment for each TestFlight upload. Apple rejects re-uploads of the same Build number.

---

## Step 12 — Android Play Internal Testing (parallel track)

Once iOS is happy on TestFlight, repeat for Android:

```bash
npx cap add android
npx cap sync android
npx cap open android  # opens Android Studio
```

In Android Studio:
1. **Build → Generate Signed Bundle / APK** → **Android App Bundle**
2. Create a new keystore (save the JKS file + password — losing them means you can't update the app)
3. Build the .aab file
4. Google Play Console → **Internal Testing** → **Create new release** → upload the .aab
5. Add testers by email or opt-in link
6. They install via Play Store

**After first Android upload:** Play Console → **App integrity** → **App signing** → copy the **SHA-256 certificate fingerprint** → paste it into `public/.well-known/assetlinks.json` replacing the placeholder.

---

## Common gotchas + how to fix

| Problem | Fix |
|---|---|
| Apple rejects on first submit: "Missing Sign in with Apple" | You added Google but not Apple. Use the Apple button shipped in commit `3fbfe3f` + complete Step 3a |
| App opens then immediately exits | iOS WebView blocked an OAuth redirect domain. Check `capacitor.config.ts` `server.allowNavigation` includes the OAuth callback host |
| OAuth flow loops back to login page | Cookie domain mismatch. Verify the `monkeytravel.app` host in Apple Service ID return URLs (Step 3a) matches exactly |
| Push permission prompt never shows | Check `lib/native/push.ts` — soft-prompt only fires after first trip saved. Save a trip then re-open. |
| `apple-app-site-association` returns 404 | `next.config.ts` headers() should serve it as `application/json`. Verify with `curl -I`. Apple's `swcd` daemon caches for 24-48hrs; reinstalling the app forces a refresh. |
| TestFlight build "Invalid binary" | Usually a missing Provisioning Profile or Bundle ID mismatch. Re-do Step 5 Xcode signing config. |
| Screenshots rejected | Apple sometimes rejects screenshots that look "too marketing-y" or include status bar elements that aren't iOS-native. Use clean device-frame screenshots without ALL_CAPS text overlays. |
| Beta App Review rejected | Most common reason: privacy policy URL returns 404, or features in screenshots aren't accessible in the build. Verify both before re-submitting. |

---

## Time budget summary

| Step | Time |
|---|---|
| 1 — Apple Developer enrollment | 1 hr work + 24-48hr wait |
| 2 — Play Console enrollment | 30 min + 1-2 day wait |
| 3 — Auth + push config | 1-2 hr |
| 4 — Manifest fill | 5 min (TEAMID); SHA-256 deferred |
| 5 — Generate iOS shell + Xcode config | 1 hr |
| 6 — App Privacy label | 30 min |
| 7 — Screenshots (manual) | 1-2 hr |
| 8 — Store listings paste | 30 min |
| 9 — First TestFlight upload | 30 min + Apple processing |
| 10 — Invite team | 10 min |
| 11 — Iterate | ongoing, 0 review time |
| 12 — Android track | mirror of 5-10 for Android |

**Realistic wall clock**: 2-3 evenings of work + Apple's wait times. **TestFlight live with team installs**: end of week 1.

---

## What success looks like at end of Step 10

- You have an app icon on your phone home screen labeled MonkeyTravel
- Tap it → app loads → you're signed in (your Supabase session)
- You can plan a trip, save it, share it
- Your team has the same on their phones
- TestFlight Feedback shows their bug reports + crash logs
- You push a web change → next time anyone opens the app, they see it

That's the bar. Get there, then we'll do Phase B7 (icon polish), C1 (native maps), and the rest based on what real testers complain about.
