# MonkeyTravel Onboarding Implementation Plan

**Created:** 2025-12-09
**Status:** Planning Complete, Ready for Implementation
**Research Skill:** `/home/fede/.claude/skills/onboarding-conversion-optimizer/`

---

## Executive Summary

Based on comprehensive research (28% retention improvement with gradual engagement, 82% improvement with personalized onboarding), we're implementing a 5-phase onboarding optimization:

1. **Gradual Engagement** - Let users experience value before requiring signup
2. **Streamlined Signup** - SSO-first, minimal friction
3. **Onboarding Survey** - 3-screen preference collection post-signup
4. **Reverse Trial Infrastructure** - Prepare for future paywall
5. **Metrics Tracking** - GA4 funnel tracking

---

## Current State Analysis

### Existing Flow (Before)
```
Landing Page → "Get Started" → Signup Required → Trip Creation
                                    ↑
                            Value not yet experienced
```

### Target Flow (After)
```
Landing Page → "Plan Your Trip" → Trip Preview (no signup) → "Save Trip" → Signup Modal
                                        ↑                           ↑
                                  Value experienced           Signup with context
                                        ↓
                              Onboarding Survey (3 screens) → Personalized Dashboard
```

---

## Phase 1: Gradual Engagement

### Goal
Allow users to experience core value (trip creation/preview) before requiring signup.

### Implementation Steps

- [ ] **1.1** Modify `/app/trips/new/page.tsx` to allow unauthenticated access
- [ ] **1.2** Create "preview mode" for trip generation (limited but functional)
- [ ] **1.3** Store preview trip in localStorage until signup
- [ ] **1.4** Trigger signup modal at value actions:
  - Save trip
  - Access AI assistant
  - Share trip
  - Add more than X activities
- [ ] **1.5** After signup, migrate localStorage trip to user's account
- [ ] **1.6** Update landing page CTA from "Get Started" to "Plan Your Trip"

### Files to Modify
- `app/trips/new/page.tsx` - Remove auth requirement
- `app/page.tsx` - Update CTA text
- `components/ui/SaveTripModal.tsx` - Handle preview-to-saved migration
- `lib/hooks/usePreviewTrip.ts` - NEW: localStorage management

### Signup Triggers
| Action | Trigger Type |
|--------|--------------|
| Save trip | Hard (must signup) |
| AI Assistant | Hard |
| Share trip | Hard |
| View 3+ templates | Soft (dismissible prompt) |
| 2nd visit | Soft |

---

## Phase 2: Streamlined Signup

### Goal
Minimize signup friction with SSO-first approach.

### Implementation Steps

- [ ] **2.1** Add Google OAuth provider to Supabase
- [ ] **2.2** Add Apple OAuth provider to Supabase
- [ ] **2.3** Redesign signup modal with SSO prominence
- [ ] **2.4** Move email signup below SSO options
- [ ] **2.5** Remove email verification blocking (verify later)
- [ ] **2.6** Add trust badges ("Free forever", "No credit card")
- [ ] **2.7** Add context to modal ("Sign up to save your Barcelona trip")

### UI Design
```
┌─────────────────────────────────────┐
│  Sign up to save your               │
│  Barcelona Trip                     │
│                                     │
│  ┌─────────────────────────────┐    │
│  │ 🔵 Continue with Google     │    │  ← Primary
│  └─────────────────────────────┘    │
│  ┌─────────────────────────────┐    │
│  │  Continue with Apple       │    │  ← Primary
│  └─────────────────────────────┘    │
│                                     │
│  ─────────── or ───────────         │
│                                     │
│  Email: [________________]          │  ← Secondary
│  Password: [________________]       │
│                                     │
│  [     Create Account      ]        │
│                                     │
│  🔒 Free forever • No credit card   │
└─────────────────────────────────────┘
```

### Files to Modify
- `app/auth/login/page.tsx` - Add SSO buttons
- `app/auth/signup/page.tsx` - Add SSO buttons
- `components/ui/SaveTripModal.tsx` - Add SSO + redesign
- `lib/supabase/client.ts` - Configure OAuth providers

---

## Phase 3: Onboarding Survey

### Goal
Collect user preferences post-signup to personalize AI trip generation.

### CRITICAL: Preferences Structure Alignment

The `users.preferences` JSONB column already stores preferences used by AI generation.
Onboarding MUST populate the same fields used in `UserProfilePreferences` (types/index.ts:197):

```typescript
interface UserProfilePreferences {
  dietaryPreferences?: string[];  // vegetarian, vegan, halal, kosher, gluten-free
  travelStyles?: string[];        // adventure, relaxation, cultural, foodie, romantic, etc.
  accessibilityNeeds?: string[];  // wheelchair, limited-mobility, visual, hearing, sensory
}
```

**These preferences are used in `lib/gemini.ts:30` to customize AI trip generation.**

### Survey Design (4 Screens - Still Quick)

**Screen 1: Travel Style** (multi-select, max 3)
```
What's your travel style?

[🏔️ Adventure]  [🧘 Relaxation]  [🏛️ Cultural]
[🍕 Foodie]     [💑 Romantic]    [💎 Luxury]
[💰 Budget]     [👤 Solo]        [👨‍👩‍👧‍👦 Family]

Select up to 3                   [Skip →]
```
→ Maps to: `preferences.travelStyles[]`

**Screen 2: Dietary Preferences** (multi-select)
```
Any dietary preferences?
We'll find the best restaurants for you

[🥗 Vegetarian]  [🌱 Vegan]     [🥩 Halal]
[✡️ Kosher]      [🌾 Gluten-Free]

Select all that apply             [None / Skip →]
```
→ Maps to: `preferences.dietaryPreferences[]`

**Screen 3: Accessibility** (multi-select, optional)
```
Any accessibility needs?
We'll ensure your activities are accessible

[♿ Wheelchair]      [🚶 Limited Mobility]
[👁️ Visual Support]  [👂 Hearing Support]
[🧠 Sensory-Friendly]

                                  [None / Skip →]
```
→ Maps to: `preferences.accessibilityNeeds[]`

**Screen 4: Timeline** (single-select, activation trigger)
```
When's your next trip?

[📅 This month]     [🗓️ 1-3 months]
[💭 Just exploring]

                                  [Skip →]
```
→ Maps to: `preferences.travelTimeline` (new field for activation tracking)

### Implementation Steps

- [ ] **3.1** Update existing `users.preferences` JSONB (no new table needed!)
- [ ] **3.2** Create `OnboardingSurvey` component
- [ ] **3.3** Create individual survey screen components
- [ ] **3.4** Add progress indicator (dots or bar)
- [ ] **3.5** Implement skip functionality for each screen
- [ ] **3.6** Store preferences in `users.preferences` JSONB column
- [ ] **3.7** Add `onboarding_completed_at` field to users table
- [ ] **3.8** Redirect to trip/dashboard with personalized content

### Database Schema Update
```sql
-- Add onboarding tracking to existing users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ;

-- No new table needed! Use existing users.preferences JSONB column
-- The onboarding will populate:
-- preferences.travelStyles = ['adventure', 'cultural', 'foodie']
-- preferences.dietaryPreferences = ['vegetarian', 'halal']
-- preferences.accessibilityNeeds = ['wheelchair']
-- preferences.travelTimeline = 'this_month' (new field)
-- preferences.travelCompanions = 'couple' (new field)
```

### Preference Field Mapping

| Onboarding Question | `users.preferences` Field | Used In |
|---------------------|---------------------------|---------|
| Travel Style | `travelStyles[]` | `lib/gemini.ts:72` - AI prompt |
| Dietary | `dietaryPreferences[]` | `lib/gemini.ts:36` - Restaurant filtering |
| Accessibility | `accessibilityNeeds[]` | `lib/gemini.ts:56` - Venue selection |
| Timeline | `travelTimeline` | Activation triggers |
| Companions | `travelCompanions` | Future personalization |

### Files to Create
- `components/onboarding/OnboardingSurvey.tsx` - Main wrapper
- `components/onboarding/TravelStyleScreen.tsx` - Multi-select styles
- `components/onboarding/DietaryScreen.tsx` - Multi-select dietary
- `components/onboarding/AccessibilityScreen.tsx` - Multi-select accessibility
- `components/onboarding/TimelineScreen.tsx` - Single-select timeline
- `app/onboarding/page.tsx` - Onboarding route

### UX Notes
- 4 screens is acceptable (research shows up to 5 is fine with skip options)
- Dietary + Accessibility are often skipped → fast flow for most users
- Each screen has clear value proposition ("We'll find the best restaurants")
- Progress bar shows 1/4, 2/4, etc.

---

## Phase 4: Reverse Trial Infrastructure

### Goal
Prepare infrastructure for future paywall using reverse trial model.

### Implementation Steps

- [ ] **4.1** Add `trial_ends_at` field to users/profiles table
- [ ] **4.2** Set trial end date on signup (14 days from now)
- [ ] **4.3** Create `useTrialStatus` hook
- [ ] **4.4** Add subtle "Pro" badges to premium features
- [ ] **4.5** Create trial status banner component
- [ ] **4.6** Implement trial expiry detection
- [ ] **4.7** Create upgrade prompt modal (for later activation)

### Premium Features (To Badge)
| Feature | Badge Location |
|---------|---------------|
| AI Assistant | Chat header |
| Unlimited regenerations | Regenerate button |
| Premium templates | Template card |
| PDF Export | Export menu |
| Priority generation | Generation screen |

### Database Schema Addition
```sql
ALTER TABLE profiles ADD COLUMN trial_ends_at TIMESTAMPTZ;
ALTER TABLE profiles ADD COLUMN subscription_tier TEXT DEFAULT 'free';
-- Values: 'free', 'trial', 'pro', 'premium'
```

### Files to Create/Modify
- `lib/hooks/useTrialStatus.ts` - NEW
- `components/ui/ProBadge.tsx` - NEW
- `components/ui/TrialBanner.tsx` - NEW
- `components/ui/UpgradeModal.tsx` - NEW (dormant until paywall)

---

## Phase 5: Metrics Tracking

### Goal
Track onboarding funnel in GA4 for optimization.

### Events to Track

| Event | Trigger | Properties |
|-------|---------|------------|
| `trip_preview_started` | User starts trip creation (no account) | destination |
| `signup_modal_shown` | Signup modal appears | trigger_action |
| `signup_completed` | User completes signup | method (google/apple/email) |
| `onboarding_screen_viewed` | Each survey screen | screen_number, screen_name |
| `onboarding_screen_skipped` | User skips a screen | screen_number |
| `onboarding_completed` | Survey finished | screens_completed, time_spent |
| `trial_started` | User enters trial period | trial_duration |

### Implementation Steps

- [ ] **5.1** Add `trackTripPreviewStarted` to analytics.ts
- [ ] **5.2** Add `trackSignupModalShown` to analytics.ts
- [ ] **5.3** Add `trackOnboardingScreen` to analytics.ts
- [ ] **5.4** Add `trackOnboardingCompleted` to analytics.ts
- [ ] **5.5** Instrument all new components with tracking
- [ ] **5.6** Create GA4 funnel report

### Funnel Definition
```
Landing Page Views
    ↓
Trip Preview Started (target: 40% of visitors)
    ↓
Signup Modal Shown (target: 60% of previewers)
    ↓
Signup Completed (target: 50% of modal views)
    ↓
Onboarding Completed (target: 70% of signups)
    ↓
First Trip Saved (target: 80% of onboarded)
```

---

## Implementation Order

### Week 1: Foundation
1. Phase 1.1-1.3: Preview mode infrastructure
2. Phase 2.1-2.2: SSO provider setup

### Week 2: Core Flow
3. Phase 1.4-1.6: Signup triggers + migration
4. Phase 2.3-2.7: Signup modal redesign

### Week 3: Personalization
5. Phase 3.1-3.8: Full onboarding survey

### Week 4: Future-Proofing
6. Phase 4.1-4.7: Trial infrastructure
7. Phase 5.1-5.6: Metrics instrumentation

---

## Success Metrics

| Metric | Current | Target | Measurement |
|--------|---------|--------|-------------|
| Signup rate | Unknown | >40% of previewers | GA4 funnel |
| Onboarding completion | N/A | >70% | GA4 event |
| D7 retention | Unknown | >30% | GA4 cohort |
| Activation (first trip saved) | Unknown | >50% | Database query |

---

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2025-12-09 | Gradual engagement before signup | 28% higher retention (Localytics) |
| 2025-12-09 | Preferences collected post-signup | 82% retention improvement (Brandon Hall) |
| 2025-12-09 | Reverse trial model | 10-40% conversion lift (Elena Verna) |
| 2025-12-09 | 3-screen survey max | Balance personalization vs friction |
| 2025-12-09 | SSO-first signup | Lower friction than email |

---

## Progress Tracking

### Phase 1: Gradual Engagement
- [ ] Step 1.1 - Allow unauth access to /trips/new
- [ ] Step 1.2 - Create preview mode
- [ ] Step 1.3 - localStorage trip storage
- [ ] Step 1.4 - Signup triggers
- [ ] Step 1.5 - Trip migration on signup
- [ ] Step 1.6 - Update landing CTA

### Phase 2: Streamlined Signup
- [ ] Step 2.1 - Google OAuth
- [ ] Step 2.2 - Apple OAuth
- [ ] Step 2.3 - Redesign signup modal
- [ ] Step 2.4 - Email below SSO
- [ ] Step 2.5 - Remove email verification blocking
- [ ] Step 2.6 - Trust badges
- [ ] Step 2.7 - Context in modal

### Phase 3: Onboarding Survey (Collects UserProfilePreferences)
- [ ] Step 3.1 - Add `onboarding_completed_at` to users table
- [ ] Step 3.2 - OnboardingSurvey component wrapper
- [ ] Step 3.3a - TravelStyleScreen (→ preferences.travelStyles[])
- [ ] Step 3.3b - DietaryScreen (→ preferences.dietaryPreferences[])
- [ ] Step 3.3c - AccessibilityScreen (→ preferences.accessibilityNeeds[])
- [ ] Step 3.3d - TimelineScreen (→ preferences.travelTimeline)
- [ ] Step 3.4 - Progress indicator (1/4, 2/4, etc.)
- [ ] Step 3.5 - Skip functionality for each screen
- [ ] Step 3.6 - Store in users.preferences JSONB
- [ ] Step 3.7 - Set onboarding_completed_at timestamp
- [ ] Step 3.8 - Redirect with personalized content

### Phase 4: Reverse Trial
- [ ] Step 4.1 - trial_ends_at field
- [ ] Step 4.2 - Set trial on signup
- [ ] Step 4.3 - useTrialStatus hook
- [ ] Step 4.4 - Pro badges
- [ ] Step 4.5 - Trial banner
- [ ] Step 4.6 - Expiry detection
- [ ] Step 4.7 - Upgrade modal

### Phase 5: Metrics
- [ ] Step 5.1-5.4 - Analytics functions
- [ ] Step 5.5 - Component instrumentation
- [ ] Step 5.6 - GA4 funnel report
