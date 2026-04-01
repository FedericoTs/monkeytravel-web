# Activation Fix — Implementation Plan

## Problem Statement

Users sign up but don't reach the "aha moment" (seeing a personalized AI itinerary).
Current flow requires 8+ steps before value delivery. Target: under 90 seconds.

## Current Flow (8+ steps)

```
Signup → Email confirm → /welcome → /onboarding (4 steps: vibes, dietary, accessibility, hours)
→ /trips (empty state) → /trips/new (4 steps: destination, dates, vibes, budget) → Generate → Save
```

## Target Flow

```
Landing CTA → /try (browse pre-built sample itineraries — instant aha!)
→ "Create Your Own" CTA → Signup → /trips/new (3-step wizard) → Generate → Save
```

**Key constraint:** Anonymous users NEVER trigger AI generation. The /try page shows
pre-built static sample itineraries to demonstrate value without API costs.

---

## Phase 1: Demo Mode — Pre-Built Samples (Sessions 1-2)

**Goal:** Show anonymous users what AI-generated itineraries look like via curated samples. No AI calls, no auth required.

### Session 1: /try Route + Sample Itinerary Data
**Features:** DEMO-01, DEMO-02, DEMO-05

**Implementation:**
1. Create sample itinerary data in `lib/demo/sample-itineraries.ts`:
   - 3-5 pre-built itineraries: Tokyo 5 days, Rome 3 days, Bali 7 days, Paris 3 days, Bangkok 5 days
   - Each includes: day-by-day breakdown, activities with times/descriptions/prices, images
   - Data is static TypeScript — no API calls, no database reads
   - Reuse existing `TripItinerary` type for compatibility
2. Create `app/[locale]/try/page.tsx` — public route (server component)
   - SEO metadata: "See What AI Trip Planning Looks Like | MonkeyTravel"
   - Hero section: "See what your trip could look like" + subtitle
   - Grid of 3-5 sample itinerary cards with destination image, title, duration
   - Clicking a card expands to full itinerary view
3. Create `components/demo/SampleItineraryCard.tsx` — card component
4. Create `components/demo/SampleItineraryView.tsx` — full itinerary display
   - Reuse existing itinerary display components where possible
   - Read-only, no edit/save/share buttons
   - "Sample Trip" badge clearly visible
5. Add `generateStaticParams` for locale variants
6. Add translations: `messages/{en,es,it}/demo.json`

**Key decisions:**
- All data is static — page can be fully SSG'd for performance
- No auth context loaded
- Navbar renders with "Sign Up" / "Log In" CTAs
- Images use existing destination images from `public/images/destinations/`

### Session 2: Signup Bridge + Landing Page CTA
**Features:** DEMO-03, DEMO-04

**Implementation:**
1. Add "Create Your Own Personalized Trip" CTA to sample itinerary view:
   - Appears at top and bottom of each itinerary
   - Stores selected destination in localStorage (`demoDestination`)
   - Navigates to `/auth/signup?from=demo&destination=tokyo` (or similar)
2. Modify post-signup redirect to check for `from=demo`:
   - If `from=demo`: redirect to `/trips/new` with destination pre-filled
   - Clear localStorage demo data
3. Update landing page hero CTA:
   - Primary CTA: "See It In Action" → links to `/try`
   - Secondary CTA: "Sign Up Free" → links to `/auth/signup`
4. Add PostHog events for demo funnel (ANALYTICS-01):
   - `demo_page_viewed`, `demo_itinerary_viewed`, `demo_signup_prompted`

---

## Phase 2: Streamlined Wizard (Sessions 3-4)

**Goal:** Reduce authenticated trip wizard from 4 steps to 3. Merge onboarding into first trip creation.

### Session 3: Combine Vibes + Budget Step
**Features:** WIZARD-01, WIZARD-02

**Implementation:**
1. Create `components/trips/wizard/VibesBudgetStep.tsx`:
   - Top section: vibe selection grid (reuse existing)
   - Bottom section: budget tier + pace selector (reuse existing)
   - Smart defaults from user preferences if available
2. Modify `app/[locale]/trips/new/page.tsx`:
   - Remove step 4 (Budget+Pace)
   - Replace step 3 (Vibes) with combined `VibesBudgetStep`
   - Update progress indicator to show 3 steps
3. Update step navigation logic
4. Test all existing trip creation flows still work

### Session 4: Remove Separate Onboarding
**Features:** WIZARD-03

**Implementation:**
1. Modify post-signup redirect:
   - Change `/welcome` → `/trips` redirect (skip onboarding)
   - Or simplify `/welcome` to a single-screen welcome with "Plan Your First Trip" CTA
2. Move dietary/accessibility preferences to trip wizard step 3:
   - Add expandable "Travel Preferences" section below vibes/budget
   - Only show on first trip creation (if `onboarding_completed === false`)
   - Save preferences to user profile after trip creation
3. Set `onboarding_completed = true` after first trip is saved
4. Keep `/onboarding` route functional but remove from default flow

---

## Phase 3: Rich Empty State (Session 5)

**Goal:** Replace blank dashboard with inspiring content that drives first trip creation.

### Session 5: Sample Itinerary + Destination Cards
**Features:** EMPTY-01, EMPTY-02, EMPTY-03

**Implementation:**
1. Create `components/trips/EmptyStateRich.tsx`:
   - Hero section: "Your adventure starts here"
   - Sample itinerary card: reuse data from `lib/demo/sample-itineraries.ts`
     - Show 3-4 sample activities with images
     - "This is what your trips will look like" label
     - "Create Your Own →" CTA
   - Destination inspiration grid: 4-5 cards from `lib/destinations/data.ts`
     - Each card: image, name, "Plan this trip →"
     - Clicking pre-fills destination in `/trips/new`
   - Social proof: "Join X travelers who planned trips this week"
2. Replace current empty state in `TripsPageClient.tsx`
3. Add translations for all new strings

---

## Phase 4: Email Sequence (Sessions 6-7)

**Goal:** Re-engage users who signed up but haven't created a trip.

### Session 6: Email Infrastructure + Welcome Email
**Features:** EMAIL-04, EMAIL-01

**Implementation:**
1. Choose email provider:
   - Option A: Supabase Edge Functions + Resend API
   - Option B: Next.js API route + Resend/SendGrid
   - Recommendation: Resend (simple API, good templates, free tier)
2. Create `lib/email/`:
   - `client.ts` — Resend client initialization
   - `templates/welcome.tsx` — React Email template for welcome
   - `send.ts` — Send functions with error handling
3. Create welcome email template:
   - Subject: "Welcome to MonkeyTravel — your first trip is waiting"
   - Body: app preview image, 3 bullet points of value, "Plan My Trip" CTA
   - Localized versions (EN, ES, IT)
4. Trigger welcome email in auth callback after signup
5. Add `RESEND_API_KEY` to environment variables

### Session 7: Day 2 + Day 5 Emails
**Features:** EMAIL-02, EMAIL-03

**Implementation:**
1. Create Supabase Edge Function or cron job for scheduled emails:
   - Query: users where `created_at < now() - 2 days` AND no trips AND welcome_email_sent AND NOT day2_email_sent
   - Send Day 2 email
   - Similar logic for Day 5
2. Create email templates:
   - Day 2: "Your free AI trip plan is waiting — takes 30 seconds"
   - Day 5: "X travelers used MonkeyTravel this week" + social proof
3. Add email tracking columns to users table:
   - `welcome_email_sent_at`, `day2_email_sent_at`, `day5_email_sent_at`
4. Add unsubscribe mechanism:
   - Unsubscribe link in all emails
   - Update `notification_settings.email_onboarding` to false

---

## Phase 5: Analytics & Nudges (Sessions 8-9)

### Session 8: PostHog Activation Funnel
**Features:** ANALYTICS-01, ANALYTICS-02, ANALYTICS-03

**Implementation:**
1. Add demo-mode events to `lib/posthog/events.ts`:
   - `demo_page_viewed`, `demo_itinerary_viewed`
   - `demo_signup_prompted`, `demo_signup_completed`
2. Ensure `time_to_value_minutes` is tracked on `first_trip_saved`
3. Create PostHog dashboard via API or manually:
   - Funnel: visit → demo_view → signup → first_generate → first_save → first_share

### Session 9: In-App Nudges
**Features:** NUDGE-01, NUDGE-02

**Implementation:**
1. Create `components/onboarding/TooltipWalkthrough.tsx`:
   - 3-step tooltip tour using Radix Popover or custom
   - Step 1: "Welcome! This is your trip dashboard"
   - Step 2: "Browse destination ideas for inspiration"
   - Step 3: "Ready? Create your first AI-powered trip →"
   - Persist completion state in localStorage
2. Add progress indicator to empty state:
   - "Your first trip: 0% planned"
   - Updates as user progresses through wizard

---

## Phase 6: i18n & Polish (Session 10)

### Session 10: Translations + Performance
**Features:** I18N-01, I18N-02, PERF-01

**Implementation:**
1. Audit all new components for hardcoded strings
2. Add missing translation keys to all 3 locale files
3. Verify email templates render in all languages
4. Run Lighthouse on /try page, optimize as needed
5. Final end-to-end testing of complete flow

---

## Session Protocol

Every session MUST follow this sequence:

```
1. Run `bash activation-fix/init.sh`
2. Read `activation-fix/claude-progress.txt`
3. Read `activation-fix/feature_list.json` — pick ONE unfinished feature
4. Implement the feature
5. Test end-to-end (browser verification, not just unit tests)
6. Update feature_list.json — set passes: true ONLY after testing
7. Commit with descriptive message
8. Update claude-progress.txt with session summary
```

## Architecture Constraints

- All new UI strings must use translation keys (never hardcode)
- All new routes must work with `[locale]` dynamic segment
- Server components by default; client components only when needed
- PostHog events for every user-facing action
- No breaking changes to existing authenticated flows
- **No anonymous AI generation** — /try uses static pre-built data only
- Sample itinerary data shared between /try page and /trips empty state
