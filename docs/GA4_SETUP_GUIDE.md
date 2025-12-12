# Google Analytics 4 Setup Guide for Growth
## Finding Your "Aha Moment" with Sean Ellis Methodology

---

## Implementation Status (Updated Dec 2024)

### Code Implementation: ✅ COMPLETE

All analytics events are now wired up in the codebase. Here's what's tracking:

| Event | Status | Location |
|-------|--------|----------|
| `itinerary_generated` | ✅ Wired | `app/trips/new/page.tsx` |
| `trip_created` | ✅ Wired | `app/trips/new/page.tsx` |
| `destination_selected` | ✅ Wired | `app/trips/new/page.tsx` |
| `activity_completed` | ✅ Wired | `lib/hooks/useGamification.ts` |
| `achievement_unlocked` | ✅ Wired | `lib/hooks/useGamification.ts` |
| `early_access_redeemed` | ✅ Wired | `components/beta/BetaCodeInput.tsx` |
| `beta_code_attempt` | ✅ Wired | `components/beta/BetaCodeInput.tsx` |
| `session_start` | ✅ Wired | `components/analytics/SessionTracker.tsx` |
| `user_return` | ✅ Wired | `components/analytics/SessionTracker.tsx` |
| `trip_viewed` | ✅ Wired | `app/trips/[id]/TripDetailClient.tsx` |
| `share_modal_opened` | ✅ Wired | `components/trip/ShareModal.tsx` |
| `trip_shared` | ✅ Wired | `components/trip/ShareModal.tsx` |
| `referral_link_clicked` | ✅ Wired | `components/trip/ShareModal.tsx` |
| `limit_reached` | ✅ Wired | `app/trips/new/page.tsx` |
| `upgrade_prompt_shown` | ✅ Wired | `app/trips/new/page.tsx` |

### GA4 Admin Setup: 🔧 YOU MUST DO THIS

Follow the guide below to configure GA4 custom dimensions, audiences, and explorations.
Without this setup, the events above will fire but won't be segmentable for aha moment analysis.

**Time required**: ~1-2 hours

---

## What is the "Aha Moment"?

The "aha moment" is when a user first experiences the core value of your product. It's the action that, once completed, dramatically increases the likelihood of retention.

**Famous Examples**:
- **Facebook**: Add 7 friends in 10 days
- **Dropbox**: Upload first file
- **Slack**: Send 2,000 messages as a team
- **Twitter**: Follow 30 people
- **Airbnb**: Complete first booking

**For MonkeyTravel**, potential aha moments to test:
- Generate first AI itinerary
- View complete itinerary (scroll to bottom)
- Check off first activity
- Share trip with someone
- Return to view trip within 3 days

---

## Step 1: GA4 Property Configuration

### 1.1 Access GA4 Admin

1. Go to [analytics.google.com](https://analytics.google.com)
2. Select your MonkeyTravel property
3. Click **Admin** (gear icon, bottom left)

### 1.2 Enable Enhanced Measurement

1. Admin > Data Streams > Select your web stream
2. Enable **Enhanced measurement**:
   - ✅ Page views
   - ✅ Scrolls
   - ✅ Outbound clicks
   - ✅ Site search
   - ✅ Video engagement
   - ✅ File downloads

### 1.3 Extend Data Retention

1. Admin > Data Settings > Data Retention
2. Change from "2 months" to **"14 months"**
3. Toggle ON "Reset user data on new activity"

> **Why**: Default 2-month retention is useless for cohort analysis. You need 14 months to see seasonal patterns and long-term retention.

### 1.4 Enable Google Signals

1. Admin > Data Settings > Data Collection
2. Enable **Google signals data collection**
3. Accept the policy

> **Why**: Enables cross-device tracking and demographic data.

---

## Step 2: Custom Dimensions Setup

Custom dimensions let you slice data by your specific business attributes.

### 2.1 Create User-Scoped Dimensions

Go to: Admin > Custom definitions > Create custom dimension

| Name | Scope | Event Parameter | Description |
|------|-------|-----------------|-------------|
| User Stage | User | `user_stage` | new/activated/engaged/power_user |
| Subscription Tier | User | `subscription_tier` | free/premium/enterprise |
| Has Beta Access | User | `has_beta_access` | true/false |
| Onboarding Status | User | `onboarding_completed` | true/false |
| Referral Source | User | `referral_source` | organic/referral/paid |
| Days Since Signup | User | `days_since_signup` | Number |
| Total Trips | User | `trips_count` | Number |

### 2.2 Create Event-Scoped Dimensions

| Name | Scope | Event Parameter | Description |
|------|-------|-----------------|-------------|
| Trip ID | Event | `trip_id` | For trip-level analysis |
| Destination | Event | `destination` | Popular destinations |
| Budget Tier | Event | `budget_tier` | budget/balanced/premium |
| Share Medium | Event | `share_medium` | copy/whatsapp/twitter/email |
| Return Bucket | Event | `return_bucket` | same_day/d1/d2_7/d8_30/d30_plus |
| Limit Type | Event | `limit_type` | generation/regeneration/assistant |
| Onboarding Step | Event | `step_name` | For funnel analysis |

### 2.3 Create Custom Metrics

Go to: Admin > Custom definitions > Custom metrics

| Name | Scope | Event Parameter | Unit |
|------|-------|-----------------|------|
| XP Earned | Event | `xp_earned` | Standard |
| Generation Time | Event | `generation_time_ms` | Milliseconds |
| Activities Count | Event | `activities_count` | Standard |
| Days Since Creation | Event | `days_since_creation` | Standard |

---

## Step 3: Key Events (Conversions) Setup

Mark these events as "Key Events" (formerly Conversions):

Go to: Admin > Events > Mark as key event

| Event Name | Why It Matters |
|------------|----------------|
| `sign_up` | Acquisition conversion |
| `trip_created` | Activation - core action |
| `itinerary_generated` | Aha moment candidate |
| `activity_completed` | Engagement signal |
| `share` | Viral coefficient |
| `referral_conversion` | Growth loop completion |
| `upgrade_prompt_clicked` | Revenue intent |

---

## Step 4: Audiences for Aha Moment Discovery

Audiences let you compare behavior between retained vs churned users.

### 4.1 Create Retained Users Audience

Go to: Admin > Audiences > New audience > Create custom audience

**Audience: "Retained Users (D7+)"**
```
Include users when:
  - session_start (event)
  - AND days_since_signup > 7 (user property)
  - AND session_number >= 3 (in the last 30 days)
```

**Settings**:
- Membership duration: 30 days
- Trigger event: None needed

### 4.2 Create Churned Users Audience

**Audience: "Churned Users"**
```
Include users when:
  - sign_up (event occurred more than 7 days ago)
  - AND session_start (NOT in the last 7 days)
```

### 4.3 Create Aha Moment Test Audiences

Create multiple audiences to test which action correlates with retention:

**Audience A: "Generated Itinerary in First Session"**
```
Include users when:
  - itinerary_generated (event)
  - AND session_number = 1
```

**Audience B: "Completed Activity in First Week"**
```
Include users when:
  - activity_completed (event)
  - Within first 7 days of first_visit
```

**Audience C: "Shared Trip in First Week"**
```
Include users when:
  - share (event)
  - Within first 7 days of first_visit
```

**Audience D: "Viewed Trip 3+ Times"**
```
Include users when:
  - trip_viewed (event count >= 3)
  - Within first 14 days of first_visit
```

---

## Step 5: Build Exploration Reports

Explorations are where you discover your aha moment through data analysis.

### 5.1 Funnel Exploration: Activation Funnel

Go to: Explore > Create new exploration > Funnel exploration

**Steps**:
1. `sign_up` - User registered
2. `onboarding_completed` - Completed preferences
3. `trip_created` OR `itinerary_generated` - Created first trip
4. `trip_viewed` (session_number > 1) - Returned to view trip
5. `activity_completed` - Engaged with trip

**Breakdown by**: `referral_source`, `onboarding_completed`

**What to look for**:
- Where is the biggest drop-off?
- Do referred users convert better?
- Do onboarding completers activate more?

### 5.2 Cohort Exploration: Retention by Action

Go to: Explore > Create new exploration > Cohort exploration

**Configuration**:
- Cohort inclusion: `sign_up`
- Return criteria: `session_start`
- Cohort granularity: Weekly
- Values: Active users (%)

**Then create comparison cohorts**:

| Cohort Name | Inclusion Criteria |
|-------------|-------------------|
| All Users | `sign_up` |
| Generated Itinerary | `sign_up` AND `itinerary_generated` in same week |
| Completed Activity | `sign_up` AND `activity_completed` in first week |
| Shared Trip | `sign_up` AND `share` in first week |

**What to look for**:
The cohort with significantly higher Week 2, Week 4, Week 8 retention is your aha moment.

### 5.3 Free-Form Exploration: Action Correlation

**Comparing Retained vs Churned User Behaviors**

**Tab Setup**:
- Technique: Free-form
- Rows: Event name
- Values: Event count, Total users
- Segments: "Retained Users (D7+)" vs "Churned Users"

**Analysis**:
Look for events that retained users do significantly more than churned users.

Example findings:
| Event | Retained Users | Churned Users | Lift |
|-------|---------------|---------------|------|
| `activity_completed` | 78% | 12% | **6.5x** |
| `trip_viewed` (2+) | 89% | 23% | **3.9x** |
| `share` | 34% | 3% | **11.3x** |

The highest "lift" events are aha moment candidates.

---

## Step 6: Build Key Dashboards

### 6.1 North Star Metric Dashboard

Create a Looker Studio dashboard (or GA4 custom report) with:

**Primary Metric**: Weekly Active Trip Planners
```
Users who triggered trip_viewed OR activity_completed in the last 7 days
```

**Supporting Metrics**:
1. New signups this week
2. Activation rate (trip_created / sign_up)
3. D7 retention rate
4. Viral coefficient (referral_conversion / active_users)

### 6.2 AARRR Funnel Dashboard

| Stage | Metric | How to Calculate |
|-------|--------|------------------|
| Acquisition | Signups | `sign_up` event count |
| Activation | Itineraries Generated | `itinerary_generated` / `sign_up` |
| Retention | D7 Return Rate | Users with `session_start` on day 7+ / total users |
| Referral | Shares per User | `share` / active users |
| Revenue | Upgrade Intent | `upgrade_prompt_clicked` / limit_reached |

---

## Step 7: Finding Your Aha Moment (The Process)

### 7.1 Hypothesis Generation

Based on MonkeyTravel's value proposition, hypothesize:

| Hypothesis | Aha Moment Candidate | Why |
|------------|---------------------|-----|
| H1 | Generate first itinerary | User sees AI value |
| H2 | View complete itinerary | User sees full trip plan |
| H3 | Check off first activity | User engages with planning |
| H4 | Share trip with friend | Social commitment |
| H5 | Return within 3 days | Trip is on their mind |
| H6 | Add custom activity | User personalizes |

### 7.2 Data Collection (2-4 weeks)

Implement all tracking from the Analytics Gap Analysis, then wait for sufficient data:
- Minimum 500 signups for statistical significance
- At least 2 weeks for D7 retention data
- 4 weeks for D30 retention data

### 7.3 Correlation Analysis

For each hypothesis, calculate:

```
Retention Lift = (Retention of users who did action) / (Retention of users who didn't)
```

**Example Analysis**:

| Action | Did Action | Didn't Do | D7 Retention (Did) | D7 Retention (Didn't) | Lift |
|--------|-----------|-----------|-------------------|----------------------|------|
| Generated itinerary | 400 | 100 | 45% | 8% | **5.6x** |
| Completed activity | 200 | 300 | 62% | 18% | **3.4x** |
| Shared trip | 80 | 420 | 71% | 22% | **3.2x** |
| Returned in 3 days | 180 | 320 | 68% | 12% | **5.7x** |

### 7.4 Validate Causation

High correlation doesn't mean causation. Validate by:

1. **Time sequence**: Did the action happen BEFORE retention, or because of it?
2. **A/B test**: Force 50% of users to the action, measure retention difference
3. **Qualitative**: Survey retained users - what made them stay?

### 7.5 Define Your Aha Moment

Based on data, your aha moment might be:

> **"Users who generate an AI itinerary AND return within 3 days have 5x higher D30 retention"**

This becomes your North Star for activation optimization.

---

## Step 8: Optimize Towards Aha Moment

Once identified, optimize the path to aha moment:

### 8.1 Reduce Time to Aha

Current flow:
```
Landing → Signup → Welcome → Onboarding (4 steps) → Create Trip → Generate
         ↓         ↓          ↓ (many drop here)    ↓
       [3 min]   [1 min]      [5 min]              [2 min] = 11 minutes
```

Optimized flow:
```
Landing → Signup → Quick Onboarding (2 steps) → Generate → Personalize later
         ↓         ↓                            ↓
       [3 min]   [2 min]                       [2 min] = 7 minutes (-36%)
```

### 8.2 Guide Users to Aha

Add nudges and prompts:

1. **Welcome email** (Day 0): "Create your first trip in 2 minutes"
2. **In-app prompt** (if no trip after 10 min): "Ready to plan? Let's go!"
3. **Push notification** (Day 1 if no trip): "Your dream trip is waiting"
4. **Return prompt** (Day 2-3): "Your [Destination] trip misses you"

### 8.3 Track Aha Moment Explicitly

Add a new event when user completes the aha moment:

```typescript
export function trackAhaMomentReached(params: {
  userId: string;
  trigger: 'itinerary_generated' | 'activity_completed' | 'trip_returned';
  timeToAhaMinutes: number;
  sessionNumber: number;
}): void {
  trackEvent("aha_moment_reached", {
    user_id: params.userId,
    trigger: params.trigger,
    time_to_aha_minutes: params.timeToAhaMinutes,
    session_number: params.sessionNumber,
  });
}
```

---

## Step 9: GA4 Implementation Checklist

### Pre-Launch Checklist

- [ ] GA4 property created and connected
- [ ] Data retention set to 14 months
- [ ] Google Signals enabled
- [ ] Enhanced measurement enabled
- [ ] All custom dimensions created (14 total)
- [ ] All custom metrics created (4 total)
- [ ] Key events marked (7 events)
- [ ] Test/comparison audiences created (6+ audiences)

### Event Implementation Checklist

**Phase 1 - Core Events** (Week 1):
- [ ] `sign_up` with method ✅ (already working)
- [ ] `login` with method ✅ (already working)
- [ ] `onboarding_completed` ✅ (already working)
- [ ] `trip_created` ✅ (already working)
- [ ] Wire `itinerary_generated` (currently dead)
- [ ] Wire `activity_completed` (currently dead)
- [ ] Wire `early_access_redeemed` (currently dead)

**Phase 2 - Retention Events** (Week 2):
- [ ] `session_start` with user context
- [ ] `user_return` with days since last visit
- [ ] `trip_viewed` with engagement data
- [ ] `achievement_unlocked` for gamification

**Phase 3 - Funnel Events** (Week 3):
- [ ] `referral_code_generated`
- [ ] `referral_link_clicked`
- [ ] `referral_signup`
- [ ] `referral_conversion`
- [ ] `share_modal_opened`

**Phase 4 - Revenue Events** (Week 4):
- [ ] `upgrade_prompt_shown`
- [ ] `upgrade_prompt_action`
- [ ] `limit_reached`
- [ ] `free_trip_used`

### Exploration Reports Checklist

- [ ] Activation funnel exploration
- [ ] Weekly cohort retention exploration
- [ ] Retained vs churned comparison
- [ ] Aha moment correlation analysis
- [ ] AARRR dashboard in Looker Studio

---

## Step 10: Ongoing Growth Operations

### Weekly Growth Review (30 min)

Every Monday, review:

1. **Acquisition**: How many signups? What sources?
2. **Activation**: What % reached aha moment?
3. **Retention**: D7 retention this cohort vs last?
4. **Referral**: Shares per user trending?
5. **Revenue**: Upgrade intent signals?

### Monthly Deep Dive (2 hours)

1. Re-run cohort analysis with new data
2. Check if aha moment hypothesis still holds
3. Identify new friction points in funnel
4. Plan next month's experiments

### Quarterly Aha Moment Review

1. Has the aha moment changed?
2. Are we getting users there faster?
3. What's the next aha moment after the first?

---

## Quick Start: Do This Today

### In GA4 Admin (20 minutes):

1. Set data retention to 14 months
2. Enable Google Signals
3. Create these 5 custom dimensions:
   - `user_stage` (User scope)
   - `trips_count` (User scope)
   - `destination` (Event scope)
   - `return_bucket` (Event scope)
   - `onboarding_completed` (User scope)

4. Mark these events as Key Events:
   - `sign_up`
   - `trip_created`
   - `share`

### In Code (1 hour):

1. Wire `trackItineraryGenerated` in `/api/ai/generate/route.ts`
2. Wire `trackActivityCompleted` in `EditableActivityCard.tsx`
3. Add `trackTripViewed` in `TripDetailClient.tsx`

### In GA4 Explore (30 minutes):

1. Create "Activation Funnel" exploration
2. Create weekly cohort retention report
3. Note your baseline metrics

---

## Summary: The Growth Analytics Formula

```
DISCOVER → DEFINE → DRIVE → MEASURE → ITERATE

1. DISCOVER: Which actions correlate with retention?
   → Build cohort explorations, compare retained vs churned

2. DEFINE: What is your aha moment?
   → "Users who [ACTION] within [TIMEFRAME] retain X% better"

3. DRIVE: Optimize path to aha moment
   → Reduce friction, add nudges, improve UX

4. MEASURE: Track aha moment rate
   → % of new users reaching aha in first week

5. ITERATE: Continuously refine
   → Test new aha moment hypotheses quarterly
```

---

## Resources

- [GA4 Documentation](https://developers.google.com/analytics/devguides/collection/ga4)
- [Sean Ellis - Hacking Growth](https://www.amazon.com/Hacking-Growth-Fastest-Growing-Companies-Breakout/dp/045149721X)
- [Amplitude's Guide to Finding Your Aha Moment](https://amplitude.com/blog/finding-your-aha-moment)
- [Reforge - Retention Fundamentals](https://www.reforge.com/blog/retention-engagement-growth-silent-killer)
