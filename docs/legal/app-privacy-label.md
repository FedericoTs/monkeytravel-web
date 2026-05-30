# App Privacy Nutrition Label — Submission Checklist

**Date:** 2026-05-30
**Status:** ready to paste into App Store Connect → App Privacy
**Mobile Phase:** A1 (per `docs/MOBILE_CONVERSION_PLAN.md`)

Apple REJECTS builds without a completed App Privacy section. This is
the form you fill BEFORE uploading the first TestFlight binary, not
after. Google Play has its own Data Safety section with similar
questions — answers below cover both.

The answers are based on a 2026-05-30 audit of every external SDK +
data collection point in the codebase. Re-audit before each major
release where data collection changes.

---

## Apple — App Privacy section

App Store Connect → App Information → App Privacy → Get Started.
Apple walks you through 5 data-type categories. Click "Yes, we collect
data from this app" then answer per category below.

### 1. Contact Info

| Type | Collected? | Linked to identity | Used to track | Why |
|---|---|---|---|---|
| Name | **YES** | YES | NO | Profile display_name; user-provided at signup |
| Email | **YES** | YES | NO | Auth identifier; user-provided at signup |
| Phone | NO | — | — | Never collected |
| Physical address | NO | — | — | Never collected |
| Other contact info | NO | — | — | Never collected |

**Purposes** (check all that apply): App Functionality

### 2. Health & Fitness

NO data collected in this category.

### 3. Financial Info

| Type | Collected? | Linked | Tracked | Why |
|---|---|---|---|---|
| Payment info | NO | — | — | Stripe Checkout opens in `openExternal()` browser; we never see card data. Booking partners (iVisa, Hostelworld) handle their own payment forms outside the app. |
| Credit info | NO | — | — | — |
| Other financial info | NO | — | — | — |

### 4. Location

| Type | Collected? | Linked | Tracked | Why |
|---|---|---|---|---|
| Precise location | NO | — | — | App never requests GPS. Maps show destinations the user typed, not where they are. |
| Coarse location | NO | — | — | Same. |

**Important:** if you ever add a "Find hotels near me" feature, this
flips to YES + the app needs `NSLocationWhenInUseUsageDescription` in
Info.plist + a runtime prompt. Update this doc.

### 5. Sensitive Info

NO data collected in this category.

### 6. Contacts

NO data collected in this category.

### 7. User Content

| Type | Collected? | Linked | Tracked | Why |
|---|---|---|---|---|
| Photos or Videos | **YES** | NO | NO | Start Anywhere accepts photo uploads sent to Gemini Vision for trip extraction. Server processes + discards — never stored. Mark "Data Not Linked to You" because we don't persist + don't associate with user_id. |
| Audio data | NO | — | — | — |
| Customer support | **YES** | YES | NO | /contact form messages tied to email (linked) |
| Other user content | **YES** | YES | NO | Trip itineraries, packing lists, expenses, activities — all user-generated content owned by the user |

**Purposes**: App Functionality, Analytics

### 8. Browsing History

NO data collected in this category. (We don't track external browser activity.)

### 9. Search History

| Type | Collected? | Linked | Tracked | Why |
|---|---|---|---|---|
| Search History | **YES** | YES | NO | Wizard destination + activity searches stored in trip records |

### 10. Identifiers

| Type | Collected? | Linked | Tracked | Why |
|---|---|---|---|---|
| User ID | **YES** | YES | NO | Supabase auth UUID, only used by us |
| Device ID | NO | — | — | PostHog uses anonymous distinct_id; never reads IDFA. Confirm via grep before each release that `posthog.init` config does NOT enable `disable_session_recording: false` or any advertising_id setting. |

**Critical**: keeping Device ID = NO means we DON'T need to trigger the
App Tracking Transparency prompt on iOS 14.5+. ATT prompts have ~25%
opt-in rates and create user friction. Stay clean here.

### 11. Purchases

NO data collected in this category. (No IAP today; if Pro tier ships,
this flips to YES.)

### 12. Usage Data

| Type | Collected? | Linked | Tracked | Why |
|---|---|---|---|---|
| Product Interaction | **YES** | YES | NO | PostHog autocapture + custom events (page views, trip generation, save, share) |
| Advertising Data | NO | — | — | No ads |
| Other Usage Data | NO | — | — | — |

### 13. Diagnostics

| Type | Collected? | Linked | Tracked | Why |
|---|---|---|---|---|
| Crash Data | **YES** | NO | NO | Sentry. User ID attached only when set; default not. |
| Performance Data | **YES** | NO | NO | Sentry traces + PostHog perf metrics |
| Other Diagnostic Data | NO | — | — | — |

### 14. Surroundings

NO data collected. (No camera-based environment sensing.)

### 15. Body

NO data collected.

### 16. Other Data

NO data collected.

---

## Google Play — Data Safety form

Google Play Console → App content → Data safety. Different schema from
Apple but maps mostly the same data. Key differences below.

### Data collection summary

- **Data shared with third parties**: YES (Resend for email; PostHog +
  Sentry for analytics — both via processing agreements, not "selling")
- **Data collected**: YES (see types below)
- **Encrypted in transit**: YES (HTTPS everywhere, enforced by HSTS)
- **Users can request data deletion**: YES (`/profile/delete` endpoint —
  task #213 atomic cascade)

### Per-type entries

| Data type | Collected | Shared | Required | Purpose | Reason |
|---|---|---|---|---|---|
| Name | YES | NO | YES | Account management, Personalization | Signup display_name |
| Email | YES | YES (Resend) | YES | Account management, Communication | Auth + transactional email |
| User payment info | NO | — | — | — | Payments via Stripe Checkout in external browser |
| Photos | YES | NO | NO | App functionality | Start Anywhere photo extraction (transient) |
| User-generated content | YES | NO | NO | App functionality | Trips, itineraries, comments |
| Search history | YES | NO | NO | App functionality, Personalization | Destination + activity search context |
| App interactions | YES | YES (PostHog) | NO | Analytics, App functionality | Product analytics |
| Crash logs | YES | YES (Sentry) | NO | App functionality, Diagnostics | Error tracking |
| Performance | YES | YES (PostHog, Sentry) | NO | Analytics, Diagnostics | Web vitals |
| Device or other IDs | NO | — | — | — | Anonymous PostHog ID only; never IDFA / Android Advertising ID |

---

## Pre-submission verification

Before clicking "Submit for Review", verify each in code:

```bash
# 1. Confirm no IDFA / advertising-id collection anywhere
grep -r "IDFA\|advertising_id\|advertisingIdentifier\|IDFV" --include="*.ts" --include="*.tsx" .
# Expected: zero matches

# 2. Confirm PostHog init does not enable session recording with default false
grep -rn "posthog.init" --include="*.ts" --include="*.tsx" .
# Verify the config object does NOT contain `disable_session_recording: false`
# (default is true, which means recording is DISABLED — that's what we want)

# 3. Confirm Sentry beforeSend strips PII
grep -rn "beforeSend" --include="*.ts" instrumentation*.ts
# Should see the email scrubber from task #219

# 4. Confirm no analytics events capture sensitive fields
# Grep for events that include trip data with PII
grep -rn "captureEvent\|captureUserAction" --include="*.tsx" components/ app/
# Manually verify none send email/name in event properties beyond what's needed
```

If any of those fail, fix BEFORE pasting privacy answers — Apple
audits and finding mismatches post-submission can trigger an account
warning.

---

## What changes the answers

Update this doc + re-submit privacy answers BEFORE shipping a release
that:
- Adds location detection (`NSLocationWhenInUseUsageDescription`)
- Adds an advertising SDK (Facebook Ads, Branch with full attribution, AppsFlyer)
- Adds IAP (would add Purchases → User Payment Info)
- Adds health/biometric data collection
- Adds contact picker / camera with persistent storage
- Adds any new analytics provider beyond PostHog + Sentry

App Store and Play both let you update privacy answers anytime without
resubmitting binary — but in practice update them at the same time as
the matching binary release so users see consistent info.

---

## ATT (App Tracking Transparency) — keep deferred

iOS 14.5+ requires the ATT prompt for apps that "track users across
apps and websites owned by other companies." Since we collect ZERO
IDFA + ZERO cross-app identifiers, we do NOT trigger the requirement.

To keep it that way, **don't** add:
- Facebook SDK with attribution
- Google Ads SDK
- Branch.io with full identity stitching
- AppsFlyer or Adjust
- Any SDK that bridges to ASIdentifierManager.advertisingIdentifier

A first-touch UTM cookie (which we already have) is fine — that's
first-party data, doesn't count as tracking.

If we ever DO add cross-app tracking, the ATT prompt becomes mandatory.
Plan: write a custom "soft prompt" sheet first ("Allow MonkeyTravel to
deliver better travel recommendations? You'll see a system prompt
next."). Only show the OS prompt if user taps yes. Achieves ~70% opt-in
vs ~25% for cold prompts.

---

## Sanity-check before clicking Submit

- [ ] Every YES in section 1-16 above is justified by something the app
      actually does today (no aspirational "we might collect later")
- [ ] Every NO is verifiable by codebase grep (the commands above)
- [ ] Privacy Policy URL `https://monkeytravel.app/privacy` returns 200
      and matches what's documented here
- [ ] Sentry + PostHog DPA agreements are accepted in their respective
      dashboards (both standard free-tier flow)
- [ ] Resend account has GDPR DPA accepted (Settings → Legal)
- [ ] `/api/profile/delete` works end-to-end (manual test: create test
      account, click delete in profile, verify Supabase row is gone +
      auth user is removed)
- [ ] Email screenshot of completed privacy answers to yourself before
      submitting — Apple lets you change them later but having a record
      of what you submitted helps if there's ever a dispute
