# MonkeyTravel Growth Audit Report

**Prepared by:** Claude Code (Sean Ellis Growth Methodology)
**Date:** December 7, 2025
**Version:** 1.0

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Current State Analysis](#current-state-analysis)
3. [Feature Inventory](#feature-inventory)
4. [Differentiating Features](#differentiating-features)
5. [Broken & Incomplete Features](#broken--incomplete-features)
6. [Critical Missing Features](#critical-missing-features)
7. [AARRR Funnel Analysis](#aarrr-funnel-analysis)
8. [Growth Opportunities (ICE Scored)](#growth-opportunities-ice-scored)
9. [Technical Implementation Plan](#technical-implementation-plan)
10. [Success Metrics & KPIs](#success-metrics--kpis)
11. [Appendix: Database Schema](#appendix-database-schema)

---

## Executive Summary

### The Verdict

MonkeyTravel has **exceptional product foundations** with 80+ features, sophisticated AI integration, and a genuinely differentiated approach to travel planning. However, **the app is currently operating as a leaky bucket**:

| Aspect | Status | Notes |
|--------|--------|-------|
| Product Quality | Excellent | 30-second AI generation, vibe-based planning |
| Activation Path | Strong | 2-3 minute time-to-value |
| Monetization | **0% Ready** | No pricing page, no payment processing |
| Retention | **Not Implemented** | DB schemas exist, no active features |
| Referral/Viral | **Partial** | Share exists, no attribution tracking |

### Critical Finding

**Users hit usage limits but have nowhere to upgrade.** The `/pricing` page doesn't exist. This is the single highest-impact issue.

### Key Metrics (Current vs Target)

| Metric | Current | Target | Gap |
|--------|---------|--------|-----|
| Signup → First Trip | ~50% (est.) | 70% | -20% |
| D7 Retention | Unknown | 40% | No tracking |
| D30 Retention | Unknown | 25% | No tracking |
| Free → Paid Conversion | 0% | 5% | No payment system |
| Referral Rate | 0% | 15% | No tracking |
| Revenue | $0 | - | No monetization |

---

## Current State Analysis

### Tech Stack
- **Framework:** Next.js 16 with App Router
- **Language:** TypeScript
- **Database:** Supabase (PostgreSQL)
- **Hosting:** Vercel
- **AI:** Google Gemini (trip generation, assistant)
- **APIs:** Google Places, Google Distance Matrix, Amadeus (flights), Open-Meteo (weather)

### Database Overview
- **30+ tables** in schema
- **25 users** registered
- **38 trips** created
- **7,100+ page views** tracked

### Usage Limits (Currently Implemented)

```typescript
// lib/usage-limits/config.ts
free: {
  aiGenerations: 3,        // trips per month
  aiRegenerations: 10,     // activity regenerations per month
  aiAssistantMessages: 20, // AI assistant messages per day
  placesAutocomplete: 100, // per day
  placesSearch: 50,        // per day
  placesDetails: 30,       // per day
}

premium: {
  // All values: -1 (unlimited)
}
```

### Pages Inventory (12 total)

| Route | Purpose | Auth Required |
|-------|---------|---------------|
| `/` | Landing page | No |
| `/auth/login` | Login | No |
| `/auth/signup` | Registration | No |
| `/trips` | Dashboard | Yes |
| `/trips/new` | Trip creation wizard | Yes |
| `/trips/[id]` | Trip detail view | Yes |
| `/trips/[id]/timeline` | Live trip timeline | Yes |
| `/shared/[token]` | Public trip sharing | No |
| `/admin` | Admin dashboard | Admin only |
| `/privacy` | Privacy policy | No |
| `/terms` | Terms of service | No |
| `/pricing` | **DOES NOT EXIST** | - |

### API Routes (41 total)

**AI Routes (8):**
- `/api/ai/generate` - Trip generation
- `/api/ai/regenerate` - Activity regeneration
- `/api/ai/assistant` - Chat assistant
- `/api/ai/smart-adjust` - Intelligent adjustments
- `/api/ai/streaming/*` - Streaming responses

**Places Routes (5):**
- `/api/places/autocomplete`
- `/api/places/details`
- `/api/places/search`
- `/api/places/photo`
- `/api/places/nearby`

**Travel Routes (4):**
- `/api/travel/flights`
- `/api/travel/hotels`
- `/api/travel/distance`
- `/api/travel/weather`

**Trip Management (6):**
- `/api/trips` - CRUD operations
- `/api/trips/[id]/activities`
- `/api/trips/[id]/share`
- `/api/trips/duplicate`
- `/api/trips/packing-list`
- `/api/trips/export`

**Admin Routes (8):**
- `/api/admin/metrics`
- `/api/admin/api-config`
- `/api/admin/costs`
- `/api/admin/prompts`
- `/api/admin/users`

---

## Feature Inventory

### Core Trip Planning (20 features)

| Feature | Status | Quality |
|---------|--------|---------|
| 4-step trip creation wizard | Working | Excellent |
| AI trip generation (Gemini) | Working | Excellent |
| 3 budget tiers (Budget/Balanced/Premium) | Working | Excellent |
| Vibe-based customization (12 vibes) | Working | Excellent |
| Day-by-day itinerary view | Working | Excellent |
| Activity cards with details | Working | Excellent |
| Drag-and-drop reordering | Working | Good |
| Activity regeneration | Working | Good |
| Smart activity adjustment | Working | Good |
| Trip duplication | Working | Good |
| Trip templates (curated escapes) | Working | Good |
| Multi-day support | Working | Good |
| Seasonal context awareness | Working | Good |
| Travel time between activities | Working | Good |
| Opening hours integration | Working | Good |
| Price level indicators | Working | Good |
| Activity ratings display | Working | Good |
| Photo galleries per activity | Working | Good |
| Map integration | Working | Good |
| Day summary cards | Working | Good |

### AI Features (8 features)

| Feature | Status | Quality |
|---------|--------|---------|
| 30-second trip generation | Working | Excellent |
| AI chat assistant | Working | Excellent |
| Streaming responses | Working | Excellent |
| Contextual suggestions | Working | Good |
| Smart adjustments | Working | Good |
| Token usage tracking | Working | Good |
| Cost monitoring | Working | Good |
| Prompt customization (admin) | Working | Good |

### Booking Integration (6 features)

| Feature | Status | Quality |
|---------|--------|---------|
| Flight search (Amadeus) | Working | Good |
| Hotel search (Amadeus) | Working | Good |
| Affiliate booking links | Working | Good |
| Price comparisons | Working | Good |
| Weather forecasts | Working | Good |
| Packing list generation | Working | Good |

### Sharing & Export (5 features)

| Feature | Status | Quality |
|---------|--------|---------|
| Share modal (Twitter, WhatsApp, Email) | Working | Good |
| Public share links | Working | Good |
| SEO-optimized shared pages | Working | Good |
| Calendar export (ICS) | Working | Good |
| PDF export | Working | Basic |

### Live Trip Features (8 features)

| Feature | Status | Quality |
|---------|--------|---------|
| Trip countdown | Working | Good |
| Pre-trip checklist | Working | Good |
| Live journey header | Working | Good |
| Activity status tracking | Working | Good |
| Activity rating modal | Working | Good |
| Slide-to-complete | Working | Good |
| Day progress indicator | Working | Good |
| Current activity highlight | Working | Good |

### User Dashboard (6 features)

| Feature | Status | Quality |
|---------|--------|---------|
| Trip listing with filters | Working | Good |
| Trip statistics | Working | Good |
| Empty state onboarding | Working | Good |
| Curated escapes section | Working | Good |
| Search/filter trips | Working | Good |
| Mobile-responsive design | Working | Good |

### Admin Features (10 features)

| Feature | Status | Quality |
|---------|--------|---------|
| Cost command center | Working | Excellent |
| API control panel | Working | Excellent |
| Prompt editor | Working | Excellent |
| User growth charts | Working | Good |
| Google metrics dashboard | Working | Good |
| API toggle controls | Working | Good |
| Rate limit visualization | Working | Good |
| Cost projections | Working | Good |
| Security advisors | Working | Good |
| Performance advisors | Working | Good |

### Authentication (5 features)

| Feature | Status | Quality |
|---------|--------|---------|
| Email/password signup | Working | Good |
| Google OAuth | Working | Good |
| Session management | Working | Good |
| Protected routes | Working | Good |
| Admin access control | Working | Good |

---

## Differentiating Features

These are MonkeyTravel's **competitive moats** - features that set it apart:

### 1. 30-Second AI Trip Generation
**What:** Complete multi-day itinerary generated in ~30 seconds
**Why it matters:** Competitors take 2-5 minutes or require manual input
**Evidence:** Generation progress component shows real-time streaming

### 2. Vibe-Based Planning (12 Vibes)
**What:** Users select travel "vibes" instead of rigid categories
**Vibes:** Adventure, Cultural, Foodie, Wellness, Romantic, Urban, Nature, Offbeat, Wonderland, Movie Magic, Fairytale, Retro
**Why it matters:** Emotionally resonant, differentiating UX
**Evidence:** `components/trip/VibeSelector.tsx` with custom styling per vibe

### 3. Three-Tier Budget Options
**What:** Every trip generates Budget, Balanced, and Premium versions
**Why it matters:** Serves all user segments simultaneously
**Evidence:** Trip creation wizard offers tier selection

### 4. Live Trip Timeline
**What:** Real-time trip execution mode with countdown, progress tracking
**Why it matters:** Extends value beyond planning into travel experience
**Evidence:** `/trips/[id]/timeline` route with `LiveJourneyHeader`, `LiveActivityCard`

### 5. Intelligent Activity Context
**What:** Opening hours, seasonal tips, travel times, weather integration
**Why it matters:** Practical, not just inspirational
**Evidence:** `SeasonalContextCard`, `TravelConnector` components

### 6. Template Marketplace ("Curated Escapes")
**What:** Pre-built trip templates users can duplicate
**Why it matters:** Reduces activation friction, showcases AI quality
**Evidence:** `CuratedEscapes.tsx` component on dashboard

### 7. Streaming AI Responses
**What:** Real-time generation with visible progress
**Why it matters:** Reduces perceived wait time, builds anticipation
**Evidence:** `/api/ai/streaming/*` routes, `GenerationProgress` component

### 8. Smart Destination Autocomplete
**What:** AI-enhanced location search with context
**Why it matters:** Reduces friction in trip creation
**Evidence:** `DestinationAutocomplete.tsx` with Google Places integration

---

## Broken & Incomplete Features

### Critical Breaks

#### 1. Price Verification Disabled
**Location:** `lib/places/price-verification.ts`
**Issue:** `ENABLE_PRICE_VERIFICATION = false` - hardcoded off
**Impact:** Price estimates may be inaccurate
**Fix Effort:** Low (enable + test)

#### 2. Photo Capture Unimplemented
**Location:** `components/timeline/LiveActivityCard.tsx:140`
**Issue:** Camera button shows `alert("Photo capture coming soon!")`
**Impact:** Users can't document their trips
**Fix Effort:** Medium (needs camera API + storage)

#### 3. Fire-and-Forget Database Updates
**Location:** Multiple files
**Issue:** Activity updates, usage tracking don't await responses
**Impact:** Silent failures, data inconsistency
**Fix Effort:** Medium (add error handling throughout)

#### 4. Limited Hotel Results
**Location:** `components/trip/HotelRecommendations.tsx:29`
**Issue:** Only shows first hotel result
**Impact:** Poor hotel discovery experience
**Fix Effort:** Low (UI change)

### Incomplete Features

#### 1. Notification System
**Status:** Database schema exists (`notifications` table), no implementation
**Missing:** Push notifications, email triggers, in-app notifications

#### 2. User Preferences
**Status:** Fields in `users` table, minimal UI
**Missing:** Preference editor, personalization based on preferences

#### 3. Social Features
**Status:** Share modal exists, no social graph
**Missing:** Following users, collaborative planning, activity feed

#### 4. Reviews/Ratings
**Status:** Rating modal exists for own activities, no community reviews
**Missing:** User-generated reviews, rating aggregation

---

## Critical Missing Features

### 1. Pricing Page (CRITICAL)

**Impact:** Users hit limits with nowhere to upgrade
**Current State:** `/pricing` returns 404
**Database Ready:** `subscription_tier` field exists in `users` table

**Requirements:**
- Tier comparison table (Free vs Premium)
- Feature breakdown
- Clear pricing ($X/month or $Y/year)
- CTA buttons linking to payment
- FAQ section

### 2. Payment Processing (CRITICAL)

**Impact:** Zero revenue capability
**Current State:** Stripe fields exist in DB, no integration
**Database Fields:** `stripe_customer_id`, `stripe_subscription_id` in `users`

**Requirements:**
- Stripe Checkout integration
- Subscription management
- Billing portal access
- Webhook handling for payment events
- Grace period handling (already configured: 3 days)

### 3. Referral Program

**Impact:** Zero viral growth
**Current State:** Share modal exists, no attribution
**Database:** No referral tracking tables

**Requirements:**
- Referral code generation per user
- Referral tracking table
- Reward system (both sides)
- Referral dashboard
- Attribution on signup

### 4. Retention Mechanics

**Impact:** No re-engagement
**Current State:** DB schemas exist, no implementation

**Requirements:**
- Email service integration (Resend, SendGrid, etc.)
- Transactional emails (welcome, trip reminders)
- Re-engagement sequences (D3, D7, D14 inactive)
- Push notification infrastructure
- In-app notification center

### 5. Analytics Dashboard (User-Facing)

**Impact:** Users don't see their value
**Current State:** Admin dashboard only

**Requirements:**
- Personal trip statistics
- "Time saved" calculations
- Travel history visualization
- Achievement/badge system

---

## AARRR Funnel Analysis

### Acquisition (Grade: B)

**Strengths:**
- Landing page with clear value proposition
- Email waitlist collection
- SEO metadata configured
- Social sharing meta tags

**Weaknesses:**
- No content marketing
- No referral attribution
- Limited organic channels

**Metrics to Track:**
- Visitors → Signup rate
- Traffic by source
- Cost per acquisition

### Activation (Grade: A-)

**Strengths:**
- 4-step wizard is streamlined
- 2-3 minute time-to-value
- Google OAuth reduces friction
- Empty state guides to first trip
- Template library for quick start

**Weaknesses:**
- No onboarding checklist
- No progress tracking
- First trip completion rate unknown

**Metrics to Track:**
- Signup → First trip rate
- Time to first trip
- Wizard drop-off by step

### Retention (Grade: F)

**Strengths:**
- Live trip timeline adds value during travel
- Trip duplication encourages reuse

**Weaknesses:**
- No email re-engagement
- No push notifications
- No streaks or habits
- No activity feed
- No reason to return daily

**Metrics to Track:**
- D1, D7, D30 retention
- Monthly active users
- Session frequency

### Referral (Grade: D)

**Strengths:**
- Share modal with multiple channels
- Public share pages exist
- SEO on shared trips

**Weaknesses:**
- No referral tracking
- No incentives
- No viral loops
- No attribution

**Metrics to Track:**
- Share rate
- K-factor
- Signups from shares

### Revenue (Grade: F)

**Strengths:**
- Usage limits are implemented
- Tier system defined
- Stripe fields in database

**Weaknesses:**
- No pricing page
- No payment processing
- No upgrade flow
- Zero revenue

**Metrics to Track:**
- Free → Paid conversion
- ARPU
- LTV
- Churn rate

---

## Growth Opportunities (ICE Scored)

### Tier 1: Quick Wins (ICE > 8.0)

| # | Opportunity | Impact | Confidence | Ease | ICE | Description |
|---|-------------|--------|------------|------|-----|-------------|
| 1 | **Create /pricing page** | 10 | 9 | 10 | **9.7** | Users hit limits with nowhere to go. High-converting, no backend needed initially. |
| 2 | **Add upgrade CTA on limit hit** | 9 | 9 | 9 | **9.0** | Currently shows error toast. Should show upgrade modal with benefits. |
| 3 | **Add Stripe Checkout** | 10 | 9 | 8 | **9.0** | Enable actual payments. Stripe makes this straightforward. |
| 4 | **Add share prompt post-save** | 8 | 8 | 9 | **8.3** | After saving first trip, prompt to share. High-leverage moment. |
| 5 | **Add referral tracking to shares** | 8 | 8 | 8 | **8.0** | Append `?ref=USER_ID` to share links. Enable attribution. |

### Tier 2: High Impact (ICE 6.0 - 8.0)

| # | Opportunity | Impact | Confidence | Ease | ICE | Description |
|---|-------------|--------|------------|------|-----|-------------|
| 6 | **Onboarding checklist** | 7 | 8 | 8 | **7.7** | Visual progress: Create trip → Add dates → Get recommendations → Save → Share |
| 7 | **Welcome email sequence** | 8 | 8 | 7 | **7.7** | D0: Welcome, D1: Tips, D3: First trip reminder, D7: Feature highlight |
| 8 | **Enable price verification** | 6 | 9 | 8 | **7.7** | Already built, just disabled. Improves data accuracy. |
| 9 | **Personal analytics dashboard** | 7 | 7 | 7 | **7.0** | Show users their stats: trips planned, time saved, countries explored |
| 10 | **Referral rewards program** | 9 | 6 | 6 | **7.0** | Both-sided: Referrer gets 1mo free, referee gets extended trial |

### Tier 3: Strategic Initiatives (ICE 4.0 - 6.0)

| # | Opportunity | Impact | Confidence | Ease | ICE | Description |
|---|-------------|--------|------------|------|-----|-------------|
| 11 | **Push notifications** | 7 | 6 | 5 | **6.0** | Trip reminders, travel tips, re-engagement |
| 12 | **Achievement system** | 6 | 6 | 6 | **6.0** | Badges for trips completed, countries visited, streaks |
| 13 | **Photo capture feature** | 6 | 7 | 5 | **6.0** | Complete the "coming soon" feature |
| 14 | **Collaborative planning** | 8 | 5 | 4 | **5.7** | Multiple users editing same trip |
| 15 | **Content marketing** | 7 | 5 | 4 | **5.3** | Blog, destination guides, SEO content |

---

## Technical Implementation Plan

### Phase 1: Fix the Leaky Bucket (Week 1-2)

#### 1.1 Create Pricing Page

**File:** `app/pricing/page.tsx`

```
/pricing
├── Hero with value proposition
├── Tier comparison table
│   ├── Free tier (current limits)
│   ├── Premium tier ($9.99/mo or $99/yr)
│   └── Feature comparison matrix
├── FAQ section
├── Social proof (testimonials, user count)
└── CTA buttons
```

**Key Features to Highlight:**

| Free | Premium |
|------|---------|
| 3 trips/month | Unlimited trips |
| 10 regenerations/month | Unlimited regenerations |
| 20 AI messages/day | Unlimited AI messages |
| Basic destinations | All destinations |
| Standard support | Priority support |

#### 1.2 Add Upgrade CTA on Limit Hit

**Files to Modify:**
- `lib/usage-limits/check-limit.ts`
- `components/ui/Toast.tsx` (or create `UpgradeModal.tsx`)

**Current Behavior:**
```typescript
// Returns error toast: "You've reached your daily limit for X"
```

**New Behavior:**
```typescript
// Show upgrade modal with:
// - Limit reached message
// - Benefits of upgrading
// - CTA to /pricing
// - "Maybe later" dismiss option
```

#### 1.3 Integrate Stripe Checkout

**New Files:**
- `app/api/stripe/create-checkout/route.ts`
- `app/api/stripe/webhook/route.ts`
- `app/api/stripe/portal/route.ts`

**Database Updates:**
```sql
-- Already exists:
-- users.stripe_customer_id
-- users.stripe_subscription_id
-- users.subscription_tier

-- Add:
ALTER TABLE users ADD COLUMN subscription_status text;
ALTER TABLE users ADD COLUMN subscription_period_end timestamptz;
```

**Environment Variables:**
```bash
STRIPE_SECRET_KEY=sk_...
STRIPE_WEBHOOK_SECRET=whsec_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_...
```

### Phase 2: Enable Growth Loops (Week 3-4)

#### 2.1 Referral Tracking

**New Table:**
```sql
CREATE TABLE referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id uuid REFERENCES users(id),
  referee_id uuid REFERENCES users(id),
  referral_code text UNIQUE NOT NULL,
  status text DEFAULT 'pending', -- pending, converted, rewarded
  created_at timestamptz DEFAULT now(),
  converted_at timestamptz,
  rewarded_at timestamptz
);

-- Add referral code to users
ALTER TABLE users ADD COLUMN referral_code text UNIQUE;
```

**Share Link Format:**
```
https://monkeytravel.app/shared/{token}?ref={referral_code}
```

#### 2.2 Post-Save Share Prompt

**File:** `app/trips/new/page.tsx` (after save)

**Trigger:** First trip saved successfully

**UI:**
```
┌─────────────────────────────────────────────┐
│  🎉 Trip Saved!                              │
│                                              │
│  Share your {destination} adventure with    │
│  friends and earn rewards!                  │
│                                              │
│  [Share on Twitter] [Copy Link] [Skip]      │
└─────────────────────────────────────────────┘
```

#### 2.3 Email Service Integration

**Recommended:** Resend (simple API, React emails)

**New Files:**
- `lib/email/client.ts`
- `lib/email/templates/welcome.tsx`
- `lib/email/templates/trip-reminder.tsx`
- `lib/email/templates/reengagement.tsx`

**Triggers:**
| Event | Email | Delay |
|-------|-------|-------|
| Signup | Welcome | Immediate |
| First trip created | Congratulations | Immediate |
| Trip date approaching | Reminder | 7 days before |
| Inactive 3 days | Re-engagement | D3 |
| Inactive 7 days | Feature highlight | D7 |

### Phase 3: Retention Mechanics (Week 5-6)

#### 3.1 Onboarding Checklist

**Component:** `components/onboarding/Checklist.tsx`

**Items:**
```typescript
const checklistItems = [
  { id: 'first_trip', label: 'Create your first trip', icon: '✈️' },
  { id: 'add_dates', label: 'Set your travel dates', icon: '📅' },
  { id: 'get_recommendations', label: 'Get AI recommendations', icon: '🤖' },
  { id: 'save_trip', label: 'Save your trip', icon: '💾' },
  { id: 'share_trip', label: 'Share with friends', icon: '📤' },
];
```

#### 3.2 Personal Analytics

**Component:** `components/dashboard/UserStats.tsx`

**Metrics to Show:**
- Total trips planned
- Countries/cities explored
- Hours of planning saved (estimate: 3hrs/trip)
- Favorite travel vibe
- Next upcoming trip countdown

#### 3.3 Achievement System

**New Table:**
```sql
CREATE TABLE achievements (
  id text PRIMARY KEY,
  name text NOT NULL,
  description text,
  icon text,
  points integer DEFAULT 0
);

CREATE TABLE user_achievements (
  user_id uuid REFERENCES users(id),
  achievement_id text REFERENCES achievements(id),
  unlocked_at timestamptz DEFAULT now(),
  PRIMARY KEY (user_id, achievement_id)
);
```

**Initial Achievements:**
| ID | Name | Condition |
|----|------|-----------|
| first_trip | Explorer | Create first trip |
| three_trips | Wanderer | Create 3 trips |
| ten_trips | Globe Trotter | Create 10 trips |
| first_share | Social Butterfly | Share first trip |
| first_referral | Ambassador | First successful referral |
| all_vibes | Vibe Master | Use all 12 vibes |

---

## Success Metrics & KPIs

### Primary Metrics (North Star Candidates)

| Metric | Current | 30-Day Target | 90-Day Target |
|--------|---------|---------------|---------------|
| **Trips Completed** | 38 | 100 | 500 |
| Weekly Active Users | Unknown | 50 | 200 |
| Monthly Revenue | $0 | $500 | $3,000 |

### Acquisition Metrics

| Metric | Current | Target | How to Track |
|--------|---------|--------|--------------|
| Signups/week | ~3 | 20 | Supabase + Vercel Analytics |
| Signup conversion rate | Unknown | 5% | Landing page analytics |
| CAC | $0 (organic) | <$10 | Ad spend / signups |

### Activation Metrics

| Metric | Current | Target | How to Track |
|--------|---------|--------|--------------|
| Signup → First trip (D0) | ~50% est. | 70% | Database query |
| Onboarding completion | N/A | 80% | Checklist tracking |
| Time to first trip | ~3 min | <5 min | Event timestamps |

### Retention Metrics

| Metric | Current | Target | How to Track |
|--------|---------|--------|--------------|
| D1 retention | Unknown | 40% | Cohort analysis |
| D7 retention | Unknown | 25% | Cohort analysis |
| D30 retention | Unknown | 15% | Cohort analysis |
| Weekly active / Monthly active | Unknown | 40% | DAU/MAU ratio |

### Referral Metrics

| Metric | Current | Target | How to Track |
|--------|---------|--------|--------------|
| Share rate | Unknown | 20% | Shares / Users |
| K-factor | 0 | 0.3 | Invites × Conversion |
| Referral signups | 0 | 15% of signups | Referral tracking |

### Revenue Metrics

| Metric | Current | Target | How to Track |
|--------|---------|--------|--------------|
| Free → Paid conversion | 0% | 5% | Stripe dashboard |
| ARPU | $0 | $5 | Revenue / Active users |
| MRR | $0 | $3,000 | Stripe dashboard |
| Churn rate | N/A | <5% | Subscription cancellations |

---

## Appendix: Database Schema

### Core Tables

```sql
-- Users (25 rows)
users (
  id uuid PRIMARY KEY,
  email text UNIQUE,
  full_name text,
  avatar_url text,
  subscription_tier text DEFAULT 'free', -- free, premium, enterprise
  stripe_customer_id text,
  stripe_subscription_id text,
  created_at timestamptz,
  last_active_at timestamptz,
  -- ... other fields
)

-- Trips (38 rows)
trips (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES users(id),
  destination text,
  start_date date,
  end_date date,
  vibes text[],
  budget_tier text, -- budget, balanced, premium
  share_token text UNIQUE,
  is_template boolean DEFAULT false,
  created_at timestamptz,
  updated_at timestamptz
)

-- Activities
activities (
  id uuid PRIMARY KEY,
  trip_id uuid REFERENCES trips(id),
  day_number integer,
  order_index integer,
  name text,
  description text,
  place_id text, -- Google Places ID
  coordinates jsonb,
  duration_minutes integer,
  price_level integer,
  rating numeric,
  -- ... other fields
)
```

### Usage Tracking Tables

```sql
-- User Usage (limits tracking)
user_usage (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES users(id),
  limit_type text, -- aiGenerations, aiRegenerations, etc.
  count integer DEFAULT 0,
  period_start timestamptz,
  period_end timestamptz
)

-- AI Usage (cost tracking)
ai_usage (
  id uuid PRIMARY KEY,
  user_id uuid,
  model text,
  input_tokens integer,
  output_tokens integer,
  estimated_cost numeric,
  created_at timestamptz
)

-- Page Views (7100+ rows)
page_views (
  id uuid PRIMARY KEY,
  path text,
  user_id uuid,
  session_id text,
  referrer text,
  user_agent text,
  created_at timestamptz
)
```

### Tables Ready but Unused

```sql
-- Notifications (schema exists, no implementation)
notifications (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES users(id),
  type text,
  title text,
  message text,
  read boolean DEFAULT false,
  created_at timestamptz
)

-- Email Subscribers (waitlist)
email_subscribers (
  id uuid PRIMARY KEY,
  email text UNIQUE,
  source text,
  subscribed_at timestamptz,
  metadata jsonb
)
```

---

## Conclusion

MonkeyTravel has built an impressive product with genuine differentiation in the travel planning space. The 30-second AI generation, vibe-based planning, and three-tier budget system are real competitive advantages.

However, **the business infrastructure is missing**. The immediate priorities are:

1. **Create /pricing page** - Users have nowhere to upgrade
2. **Add Stripe Checkout** - Enable actual revenue
3. **Add upgrade CTAs** - Convert limit hits to upgrades
4. **Enable referral tracking** - Measure and incentivize sharing
5. **Set up email automation** - Re-engage inactive users

Until these are in place, every dollar spent on acquisition is wasted in a leaky bucket.

---

**Document Prepared Using:**
- Sean Ellis Growth Methodology
- AARRR (Pirate Metrics) Framework
- ICE Scoring Prioritization
- Codebase analysis (80+ components, 41 API routes, 30+ DB tables)

**Next Steps:**
1. Review and approve priorities with team
2. Assign owners to each phase
3. Set up tracking for success metrics
4. Begin Phase 1 implementation
