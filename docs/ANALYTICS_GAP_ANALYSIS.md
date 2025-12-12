# Google Analytics Gap Analysis - Sean Ellis Growth Framework

## Executive Summary

**UPDATED Dec 2024**: ✅ **ALL GAPS FIXED** - Analytics code is now fully wired up!

~~**Current State**: MonkeyTravel has a solid analytics foundation (`lib/analytics.ts`) with 25+ event functions defined, but **only 40% are actually implemented** in the codebase.~~

**NEW State**: All 35+ event functions are now wired up across the codebase. See `/docs/GA4_SETUP_GUIDE.md` for implementation status.

**Fixed Gaps**:
1. ✅ **Retention tracking** - `SessionTracker` component tracks D1/D7/D30 returns
2. ✅ **Revenue intent events** - `limit_reached`, `upgrade_prompt_shown` ready for Stripe
3. ✅ **All dead code wired** - Every function now has call sites
4. ✅ **Referral funnel tracked** - `ShareModal` tracks all share actions

**What's Left**: Configure GA4 Admin (custom dimensions, audiences, explorations) - see guide

---

## AARRR Funnel Audit

### A - ACQUISITION (60% Tracked)

| Event | Status | Implementation |
|-------|--------|----------------|
| `sign_up` | ✅ Tracked | `AuthEventTracker.tsx`, `signup/page.tsx` |
| `login` | ✅ Tracked | `AuthEventTracker.tsx`, `login/page.tsx` |
| Landing page views | ✅ Auto | GA4 pageview |
| UTM parameters | ⚠️ Partial | Not persisted to user profile |
| Referral link clicks | ❌ **MISSING** | `/api/referral/click` has no GA |
| Email subscribe | ❌ **MISSING** | `EmailSubscribe.tsx` has no tracking |

**Missing Events to Add**:
```typescript
// Acquisition
trackEmailSubscribe(source: string)
trackReferralLinkClicked(code: string, referrerId: string)
trackLandingPageCTA(ctaName: string, position: string)
```

---

### A - ACTIVATION (70% Tracked)

| Event | Status | Implementation |
|-------|--------|----------------|
| `onboarding_step_viewed` | ✅ Tracked | `onboarding/page.tsx` |
| `onboarding_step_completed` | ✅ Tracked | `onboarding/page.tsx` |
| `onboarding_completed` | ✅ Tracked | `onboarding/page.tsx` |
| `onboarding_skipped` | ✅ Tracked | `onboarding/page.tsx` |
| `trip_created` | ✅ Tracked | `SaveTripModal.tsx` |
| `itinerary_generated` | ❌ **DEFINED BUT NOT CALLED** | Never used |
| `early_access_redeemed` | ❌ **DEFINED BUT NOT CALLED** | Never used |
| `trial_started` | ❌ **DEFINED BUT NOT CALLED** | Never used |
| Welcome page viewed | ❌ **MISSING** | No tracking |
| Beta code entry attempt | ❌ **MISSING** | No tracking |

**The "Aha Moment" Problem**:
- We track trip creation but NOT itinerary generation
- Users see value when AI generates itinerary, NOT when trip is saved
- **Critical gap**: Time-to-value (TTV) cannot be measured

**Missing Events to Add**:
```typescript
// Activation
trackWelcomePageViewed()
trackBetaCodeAttempt(code: string, success: boolean)
trackFirstTripStarted()  // When user clicks "Plan New Trip"
trackDestinationSelected(destination: string)
trackItineraryViewed(tripId: string, viewDuration: number)
```

---

### R - RETENTION (10% Tracked) ⚠️ CRITICAL GAP

| Event | Status | Implementation |
|-------|--------|----------------|
| User return visit | ❌ **MISSING** | No session tracking |
| Trip revisit | ❌ **MISSING** | No view tracking |
| Activity completion | ❌ **DEFINED BUT NOT CALLED** | `trackActivityCompleted` unused |
| Day-of-trip engagement | ❌ **MISSING** | No tracking |
| Streak/progress | ❌ **MISSING** | XP system has no GA events |
| `last_sign_in_at` | ⚠️ DB only | Supabase updates, but not in GA |

**Why This Matters**:
> "Retention is the foundation of growth. A 10% improvement in retention compounds; a 10% improvement in acquisition does not." - Sean Ellis

**We cannot currently answer**:
- What % of users return after Day 1? Day 7? Day 30?
- Do users who complete onboarding retain better?
- What actions correlate with long-term retention?

**Missing Events to Add**:
```typescript
// Retention
trackUserReturn(daysSinceLastVisit: number, totalSessions: number)
trackTripViewed(tripId: string, isOwnTrip: boolean, daysSinceCreation: number)
trackActivityChecked(tripId: string, activityId: string, dayNumber: number)
trackStreakMaintained(streakDays: number, xpEarned: number)
trackAchievementUnlocked(achievementId: string, achievementName: string)
trackAppReopen(source: 'direct' | 'notification' | 'email' | 'share')
```

---

### R - REFERRAL (30% Tracked)

| Event | Status | Implementation |
|-------|--------|----------------|
| `share` (trip shared) | ✅ Tracked | `ShareButton.tsx` |
| `share_link_clicked` | ✅ Tracked | `SharedTripView.tsx` |
| Referral code generated | ❌ **MISSING** | No tracking |
| Referral link clicked | ❌ **MISSING** | `/api/referral/click` not tracked |
| Referral signup | ❌ **MISSING** | No attribution |
| Referral conversion | ❌ **MISSING** | `/api/referral/complete` not tracked |

**Referral Funnel Blind Spots**:
```
Share Trip → View Shared Trip → ??? → Signup → ??? → Create Trip → Referral Complete
            ✅                   ❌        ❌        ❌            ❌
```

**Missing Events to Add**:
```typescript
// Referral
trackReferralCodeGenerated(code: string)
trackReferralLinkClicked(code: string, medium: string)
trackReferralSignup(referralCode: string, referrerId: string)
trackReferralConversion(referralCode: string, rewardAmount: number)
trackShareModalOpened(tripId: string)
trackShareMethodSelected(method: 'copy' | 'whatsapp' | 'twitter' | 'facebook' | 'email')
```

---

### R - REVENUE (0% Tracked) ⚠️ CRITICAL GAP

| Event | Status | Implementation |
|-------|--------|----------------|
| Pricing page viewed | ❌ **MISSING** | No pricing page exists |
| Upgrade prompt shown | ❌ **MISSING** | Limit modals not tracked |
| Upgrade clicked | ❌ **MISSING** | No Stripe yet |
| Payment started | ❌ **MISSING** | No Stripe yet |
| Payment completed | ❌ **MISSING** | No Stripe yet |
| Subscription cancelled | ❌ **MISSING** | No Stripe yet |

**Pre-Stripe Events to Add Now**:
Even without Stripe, we should track monetization intent:

```typescript
// Revenue Intent (pre-Stripe)
trackUpgradePromptShown(trigger: string, limitType: string)
trackUpgradePromptClicked(trigger: string)
trackUpgradePromptDismissed(trigger: string)
trackPricingViewed(source: string)
trackFreeTripUsed(tripsRemaining: number)
trackLimitReached(limitType: 'generation' | 'regeneration' | 'assistant')
```

---

## Defined But Never Called (Dead Code)

These functions exist in `lib/analytics.ts` but are **never imported anywhere**:

| Function | Lines | Should Be Called In |
|----------|-------|---------------------|
| `trackItineraryGenerated` | 106-118 | `/api/ai/generate/route.ts` |
| `trackActivityCompleted` | 271-283 | `EditableActivityCard.tsx` (checkbox) |
| `trackHotelSearch` | 314-322 | Hotel search components |
| `trackFlightSearch` | 327-337 | Flight search components |
| `trackEarlyAccessRedeemed` | 245-251 | `BetaCodeInput.tsx` |
| `trackTrialStarted` | 256-262 | Trial activation flow |
| `trackError` | 346-368 | Error boundaries, API errors |
| `trackTiming` | 446-458 | Performance-critical operations |
| `setUserProperties` | 433-441 | After login, profile updates |

---

## ICE-Scored Implementation Priority

| Priority | Event Category | ICE Score | Effort | Impact |
|----------|---------------|-----------|--------|--------|
| 1 | **Retention tracking** | 9.0 | Medium | Critical for growth decisions |
| 2 | **Wire up dead code** | 8.7 | Low | Quick wins, already written |
| 3 | **Referral funnel** | 8.3 | Medium | Viral coefficient measurement |
| 4 | **Revenue intent** | 8.0 | Low | Pre-Stripe prep, user intent |
| 5 | **User properties** | 7.7 | Low | Segmentation in GA4 |
| 6 | **Acquisition gaps** | 7.3 | Low | Email subscribe, UTM |

---

## Implementation Plan

### Phase 1: Wire Up Dead Code (Day 1) - ICE: 8.7

**Files to modify**:

1. **`/api/ai/generate/route.ts`** - Add `trackItineraryGenerated`:
```typescript
import { trackItineraryGenerated } from "@/lib/analytics";

// After successful generation:
trackItineraryGenerated({
  destination: params.destination,
  duration: params.duration,
  budgetTier: params.budgetTier,
  generationTimeMs: Date.now() - startTime,
});
```

2. **`components/beta/BetaCodeInput.tsx`** - Add `trackEarlyAccessRedeemed`:
```typescript
import { trackEarlyAccessRedeemed } from "@/lib/analytics";

// On successful redemption:
trackEarlyAccessRedeemed({ codeId: code });
```

3. **`components/trip/EditableActivityCard.tsx`** - Add `trackActivityCompleted`:
```typescript
import { trackActivityCompleted } from "@/lib/analytics";

// On checkbox toggle:
trackActivityCompleted({
  tripId,
  activityId: activity.id,
  dayNumber,
  xpEarned: activity.xp || 0,
});
```

4. **`lib/early-access/index.ts`** or welcome flow - Add `trackTrialStarted`

5. **Error boundaries** - Add `trackError` calls

---

### Phase 2: Retention Tracking (Days 2-3) - ICE: 9.0

**New events to add to `lib/analytics.ts`**:

```typescript
// ============================================================================
// RETENTION EVENTS - Critical for growth measurement
// ============================================================================

/**
 * Track user returning to the app
 * Call on app load after checking last visit
 */
export function trackUserReturn(params: {
  daysSinceLastVisit: number;
  totalSessions: number;
  returnSource?: 'direct' | 'notification' | 'email' | 'share';
}): void {
  trackEvent("user_return", {
    days_since_last_visit: params.daysSinceLastVisit,
    total_sessions: params.totalSessions,
    return_source: params.returnSource || "direct",
    // Bucket for easier analysis
    return_bucket: params.daysSinceLastVisit === 0 ? "same_day"
      : params.daysSinceLastVisit === 1 ? "d1"
      : params.daysSinceLastVisit <= 7 ? "d2_7"
      : params.daysSinceLastVisit <= 30 ? "d8_30"
      : "d30_plus",
  });
}

/**
 * Track when user views their trip (engagement signal)
 */
export function trackTripViewed(params: {
  tripId: string;
  isOwnTrip: boolean;
  tripStatus: string;
  daysSinceCreation: number;
  activitiesCount: number;
}): void {
  trackEvent("trip_viewed", {
    trip_id: params.tripId,
    is_own_trip: params.isOwnTrip,
    trip_status: params.tripStatus,
    days_since_creation: params.daysSinceCreation,
    activities_count: params.activitiesCount,
  });
}

/**
 * Track session start with context
 */
export function trackSessionStart(params: {
  userId?: string;
  isNewUser: boolean;
  hasActiveTrip: boolean;
  tripsCount: number;
  daysSinceSignup: number;
}): void {
  trackEvent("session_start", {
    is_new_user: params.isNewUser,
    has_active_trip: params.hasActiveTrip,
    trips_count: params.tripsCount,
    days_since_signup: params.daysSinceSignup,
    // Lifecycle stage
    user_stage: params.tripsCount === 0 ? "new"
      : params.tripsCount === 1 ? "activated"
      : params.tripsCount < 5 ? "engaged"
      : "power_user",
  });
}

/**
 * Track achievement unlock (gamification retention)
 */
export function trackAchievementUnlocked(params: {
  achievementId: string;
  achievementName: string;
  xpEarned: number;
  totalXp: number;
}): void {
  trackEvent("achievement_unlocked", {
    achievement_id: params.achievementId,
    achievement_name: params.achievementName,
    xp_earned: params.xpEarned,
    total_xp: params.totalXp,
  });
}
```

**Implementation locations**:

1. **`app/layout.tsx`** or **`components/SessionTracker.tsx`** (new):
   - Check `localStorage` for last visit timestamp
   - Calculate days since last visit
   - Call `trackUserReturn()` and `trackSessionStart()`
   - Update last visit timestamp

2. **`app/trips/[id]/TripDetailClient.tsx`**:
   - Call `trackTripViewed()` on component mount

3. **`lib/hooks/useGamification.ts`**:
   - Call `trackAchievementUnlocked()` when achievement triggers

---

### Phase 3: Referral Funnel (Days 4-5) - ICE: 8.3

**New events**:

```typescript
// ============================================================================
// REFERRAL FUNNEL EVENTS - Viral coefficient tracking
// ============================================================================

export function trackReferralCodeGenerated(params: {
  code: string;
  userId: string;
}): void {
  trackEvent("referral_code_generated", {
    referral_code: params.code,
    user_id: params.userId,
  });
}

export function trackReferralLinkClicked(params: {
  code: string;
  medium: 'copy' | 'whatsapp' | 'twitter' | 'facebook' | 'email' | 'qr';
}): void {
  trackEvent("referral_link_clicked", {
    referral_code: params.code,
    share_medium: params.medium,
  });
}

export function trackReferralSignup(params: {
  referralCode: string;
  referrerId: string;
}): void {
  trackEvent("referral_signup", {
    referral_code: params.referralCode,
    referrer_id: params.referrerId,
  });
}

export function trackReferralConversion(params: {
  referralCode: string;
  rewardAmount: number;
  referrerId: string;
  refereeId: string;
}): void {
  trackEvent("referral_conversion", {
    referral_code: params.referralCode,
    reward_amount: params.rewardAmount,
    referrer_id: params.referrerId,
    referee_id: params.refereeId,
  });
}

export function trackShareModalOpened(params: {
  tripId: string;
  tripDestination: string;
}): void {
  trackEvent("share_modal_opened", {
    trip_id: params.tripId,
    trip_destination: params.tripDestination,
  });
}
```

**Implementation locations**:

1. **`/api/referral/click/route.ts`** - Add `trackReferralLinkClicked`
2. **`/api/referral/complete/route.ts`** - Add `trackReferralConversion`
3. **`app/auth/signup/page.tsx`** - Add `trackReferralSignup` if `referred_by` exists
4. **`components/referral/ReferralModal.tsx`** - Add `trackReferralCodeGenerated`
5. **`components/trip/ShareModal.tsx`** - Add `trackShareModalOpened`

---

### Phase 4: Revenue Intent (Day 6) - ICE: 8.0

**New events for pre-Stripe tracking**:

```typescript
// ============================================================================
// REVENUE INTENT EVENTS - Pre-monetization tracking
// ============================================================================

export function trackUpgradePromptShown(params: {
  trigger: 'limit_reached' | 'feature_gate' | 'trial_ending' | 'upsell';
  limitType?: string;
  location: string;
}): void {
  trackEvent("upgrade_prompt_shown", {
    trigger: params.trigger,
    limit_type: params.limitType,
    location: params.location,
  });
}

export function trackUpgradePromptAction(params: {
  trigger: string;
  action: 'clicked' | 'dismissed' | 'later';
}): void {
  trackEvent("upgrade_prompt_action", {
    trigger: params.trigger,
    action: params.action,
  });
}

export function trackLimitReached(params: {
  limitType: 'generation' | 'regeneration' | 'assistant';
  currentUsage: number;
  limit: number;
}): void {
  trackEvent("limit_reached", {
    limit_type: params.limitType,
    current_usage: params.currentUsage,
    limit: params.limit,
    utilization_percent: Math.round((params.currentUsage / params.limit) * 100),
  });
}

export function trackFreeTripUsed(params: {
  tripsRemaining: number;
  tripId: string;
}): void {
  trackEvent("free_trip_used", {
    trips_remaining: params.tripsRemaining,
    trip_id: params.tripId,
    is_last_free: params.tripsRemaining === 0,
  });
}
```

**Implementation locations**:

1. **`components/ui/EarlyAccessModal.tsx`** - Track prompt shown/actions
2. **`lib/early-access/index.ts`** - Track limit reached in `checkEarlyAccess()`
3. **`/api/ai/generate/route.ts`** - Track free trip usage

---

### Phase 5: User Properties & Segmentation (Day 7) - ICE: 7.7

**Wire up `setUserProperties` after login**:

```typescript
// In AuthEventTracker.tsx or a new SessionTracker component:
import { setUserProperties, setUserId } from "@/lib/analytics";

// After getting user profile:
setUserId(user.id);
setUserProperties({
  subscriptionTier: profile.subscription_tier || "free",
  tripsCreated: profile.trips_count || 0,
  accountAgeDays: Math.floor((Date.now() - new Date(profile.created_at).getTime()) / 86400000),
  hasCompletedOnboarding: profile.onboarding_completed,
  hasBetaAccess: !!betaAccess,
  referralSource: profile.referred_by_code ? "referral" : "organic",
});
```

---

## GA4 Custom Dimensions Setup

Add these custom dimensions in GA4 Admin > Custom definitions:

| Dimension Name | Scope | Parameter |
|---------------|-------|-----------|
| User Stage | User | user_stage |
| Subscription Tier | User | subscriptionTier |
| Has Beta Access | User | hasBetaAccess |
| Referral Source | User | referralSource |
| Trip Status | Event | trip_status |
| Share Medium | Event | share_medium |
| Return Bucket | Event | return_bucket |
| Limit Type | Event | limit_type |

---

## Success Metrics After Implementation

| Metric | Current | Target | How to Measure |
|--------|---------|--------|----------------|
| Funnel visibility | 40% | 95% | Events firing / Events defined |
| D1 Retention | Unknown | 40%+ | `user_return` where `return_bucket = 'd1'` |
| D7 Retention | Unknown | 25%+ | `user_return` where `return_bucket = 'd2_7'` |
| D30 Retention | Unknown | 15%+ | `user_return` where `return_bucket = 'd8_30'` |
| Referral conversion | Unknown | 20%+ | `referral_conversion` / `referral_link_clicked` |
| Activation rate | Unknown | 60%+ | `trip_created` / `sign_up` |

---

## Quick Reference: Events by File

| File | Events to Add |
|------|---------------|
| `lib/analytics.ts` | ~15 new event functions |
| `app/layout.tsx` | Session tracking component |
| `/api/ai/generate/route.ts` | `trackItineraryGenerated`, `trackFreeTripUsed` |
| `/api/referral/click/route.ts` | `trackReferralLinkClicked` |
| `/api/referral/complete/route.ts` | `trackReferralConversion` |
| `components/beta/BetaCodeInput.tsx` | `trackEarlyAccessRedeemed`, `trackBetaCodeAttempt` |
| `components/trip/EditableActivityCard.tsx` | `trackActivityCompleted` |
| `components/trip/ShareModal.tsx` | `trackShareModalOpened` |
| `components/referral/ReferralModal.tsx` | `trackReferralCodeGenerated` |
| `components/ui/EarlyAccessModal.tsx` | `trackUpgradePromptShown/Action` |
| `app/trips/[id]/TripDetailClient.tsx` | `trackTripViewed` |
| `app/auth/signup/page.tsx` | `trackReferralSignup` |

---

## Estimated Timeline

| Phase | Duration | Events Added |
|-------|----------|--------------|
| Phase 1: Wire dead code | 1 day | 6 events |
| Phase 2: Retention | 2 days | 4 events |
| Phase 3: Referral | 2 days | 5 events |
| Phase 4: Revenue intent | 1 day | 4 events |
| Phase 5: User properties | 1 day | Setup only |
| **Total** | **7 days** | **19+ events** |

---

## Appendix: Current Event Inventory

### Events Currently Tracked (10)
- `sign_up` ✅
- `login` ✅
- `trip_created` ✅
- `share` ✅
- `share_link_clicked` ✅
- `view_item` (template) ✅
- `template_copied` ✅
- `onboarding_step_viewed` ✅
- `onboarding_step_completed` ✅
- `onboarding_completed` ✅
- `onboarding_skipped` ✅
- `activity_regenerated` ✅
- `ai_assistant_used` ✅

### Events Defined But Not Called (8)
- `itinerary_generated` ❌
- `activity_completed` ❌
- `hotel_search` ❌
- `flight_search` ❌
- `early_access_redeemed` ❌
- `trial_started` ❌
- `error` ❌
- `timing_complete` ❌

### Events Missing Entirely (19+)
- Retention: `user_return`, `session_start`, `trip_viewed`, `achievement_unlocked`
- Referral: `referral_code_generated`, `referral_link_clicked`, `referral_signup`, `referral_conversion`, `share_modal_opened`
- Revenue: `upgrade_prompt_shown`, `upgrade_prompt_action`, `limit_reached`, `free_trip_used`
- Acquisition: `email_subscribe`, `landing_page_cta`
- Activation: `welcome_page_viewed`, `beta_code_attempt`, `first_trip_started`, `destination_selected`
