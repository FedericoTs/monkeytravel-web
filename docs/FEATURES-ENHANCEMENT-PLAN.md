# MonkeyTravel - Features Enhancement Plan

> **Created:** 2025-12-09
> **Last Updated:** 2025-12-09
> **Status:** Active Development

This document tracks all identified broken, incomplete, and unused features in the MonkeyTravel application, prioritized for systematic resolution.

---

## Executive Summary

| Priority | Count | Status |
|----------|-------|--------|
| Critical | 2 | 2 completed |
| High | 4 | 1 completed |
| Medium | 6 | 0 completed |
| Low | 5 | 2 resolved (hidden) |
| **Total** | **17** | **5 resolved** |

---

## Critical Priority (Must Fix Before Launch)

### CRIT-001: Delete Account Button Non-Functional
- **Status:** `[x] Completed (2025-12-09)`
- **Location:** `app/profile/ProfileClient.tsx:758-768`
- **Issue:** Button renders with full styling but has NO onClick handler. Users click and nothing happens.
- **Impact:** Privacy Policy (line 110) promises account deletion capability. Legal/trust issue.
- **Fix Required:**
  - Add confirmation modal with password verification
  - Implement `/api/profile/delete` endpoint
  - Handle cascade deletion (trips, conversations, usage data)
  - Clear session and redirect to landing page
- **Estimate:** Medium complexity
- **Dependencies:** None

### CRIT-002: User Profile Settings 82% Unused
- **Status:** `[x] Completed (2025-12-09)`
- **Location:** `app/profile/ProfileClient.tsx:615-726`
- **Issue:** 14 of 17 user settings are stored but never affect app behavior
- **Resolution:**
  - Notifications section: **Hidden** (requires email service, push notifications - infrastructure doesn't exist)
  - Privacy section: **Hidden** (requires social features, public profiles - don't exist)
  - Quiet Hours: **Repurposed** as "Activity Schedule" in Travel Preferences - now affects AI trip generation
  - Travel preferences (travelStyles, dietaryPreferences, accessibilityNeeds): Already working
- **See:** `docs/CRIT-002-SETTINGS-INTEGRATION-PLAN.md` for detailed analysis

#### Resolution Summary
| Category | Settings | Action Taken |
|----------|----------|--------------|
| Notification Settings | 6 toggles | Hidden (no backend infrastructure) |
| Quiet Hours | 2 fields | Repurposed for AI activity scheduling |
| Privacy Settings | 5 toggles | Hidden (no social features) |
| Travel Preferences | 3 fields | Already working, auto-fetched |

#### Now Working (5 fields)
| Setting | Used In | Status |
|---------|---------|--------|
| travelStyles | AI generation (`lib/gemini.ts:72-88`) | Working |
| dietaryPreferences | AI generation (`lib/gemini.ts:36-52`) | Working |
| accessibilityNeeds | AI generation (`lib/gemini.ts:56-68`) | Working |
| quietHoursStart → activeHoursEnd | AI scheduling (`lib/gemini.ts:103-131`) | **NEW** |
| quietHoursEnd → activeHoursStart | AI scheduling (`lib/gemini.ts:103-131`) | **NEW** |

---

## High Priority (Should Fix)

### HIGH-001: Weather Data Isolated - Not Used for Recommendations
- **Status:** `[ ] Not Started`
- **Location:** `components/trip/SeasonalContextCard.tsx`
- **Issue:** Weather API works perfectly but data only appears in sidebar card. Not used for:
  - Activity recommendations
  - Packing list suggestions
  - Weather warnings
  - AI trip generation context
- **Fix Required:**
  - Pass weather data to AI generation prompts
  - Add weather-based packing suggestions
  - Show weather warnings for extreme conditions
- **Estimate:** Medium complexity
- **Dependencies:** None

### HIGH-002: AI Assistant Response Time Bug
- **Status:** `[x] Completed (2025-12-09)`
- **Location:** `app/api/ai/assistant/route.ts:418`
- **Issue:**
  ```typescript
  responseTimeMs: Date.now() - Date.now(),  // ALWAYS RETURNS 0
  ```
  Should be `Date.now() - startTime` (startTime declared at line 383)
- **Impact:** All AI performance metrics incorrectly show 0ms
- **Fix:** Added `const requestStartTime = Date.now();` at line 384, updated to `responseTimeMs: Date.now() - requestStartTime`
- **Estimate:** Trivial
- **Dependencies:** None

### HIGH-003: Itinerary Structure Inconsistency
- **Status:** `[ ] Not Started`
- **Location:** `app/api/ai/generate-more-days/route.ts:154-162`
- **Issue:**
  - This endpoint treats itinerary as `{ days: ItineraryDay[] }`
  - Other endpoints treat itinerary as `ItineraryDay[]` directly
  - Can cause data corruption on trips with 5+ days after incremental generation
- **Fix Required:** Standardize itinerary structure across all endpoints
- **Estimate:** Medium complexity
- **Dependencies:** Requires testing all trip endpoints

### HIGH-004: Missing RLS Policies on ai_prompts Table
- **Status:** `[ ] Not Started`
- **Location:** `supabase/migrations/20241206_create_ai_prompts.sql`
- **Issue:**
  - Table has RLS enabled but only SELECT policy exists
  - No UPDATE/DELETE restrictions at database level
  - Admin changes protected at app level only
- **Fix Required:** Add RLS policies restricting UPDATE/DELETE to admin emails
- **Estimate:** Low complexity
- **Dependencies:** None

---

## Medium Priority (Improve UX)

### MED-001: Google Places Price Verification Disabled
- **Status:** `[ ] Not Started`
- **Location:** `components/ActivityCard.tsx:174-221`
- **Issue:** Price verification disabled due to cost ($0.48 per page view)
- **Comment in code:** "TODO: Re-enable with proper caching (localStorage + server cache) or lazy-load on 'More' click"
- **Fix Required:** Implement lazy-load on user interaction OR server-side batch caching
- **Estimate:** Medium complexity
- **Dependencies:** None

### MED-002: Checklist Item PATCH Endpoint Verification
- **Status:** `[ ] Not Started`
- **Location:** `app/api/trips/[id]/checklist/[itemId]/route.ts`
- **Issue:** Need to verify individual checklist item updates work correctly
- **Fix Required:** Test and fix PATCH endpoint if broken
- **Estimate:** Low complexity
- **Dependencies:** None

### MED-003: In-Memory Cache on Serverless
- **Status:** `[ ] Not Started`
- **Location:** `app/api/places/autocomplete/route.ts:52-60`
- **Issue:**
  - Each serverless instance maintains its own cache
  - No centralized cleanup
  - Memory leak risk on long-running instances
- **Fix Required:** Migrate to Supabase table or Redis
- **Estimate:** Medium complexity
- **Dependencies:** None

### MED-004: Page Views Table Growing Indefinitely
- **Status:** `[ ] Not Started`
- **Location:** Supabase `page_views` table
- **Issue:**
  - 9,185 rows with no cleanup policy
  - Unused columns: `referrer`, `user_agent`, `latitude`, `longitude`
- **Fix Required:**
  - Add 90-day retention policy (Supabase function or cron)
  - Consider removing unused columns
- **Estimate:** Low complexity
- **Dependencies:** None

### MED-005: Unused Database Columns
- **Status:** `[ ] Not Started`
- **Locations:**
  | Table | Column | Issue |
  |-------|--------|-------|
  | email_subscribers | verified_at | Never set (email verification not implemented) |
  | email_subscribers | created_at | Never read |
  | ai_conversations | context | Always empty `{}` |
- **Fix Required:** Either implement features or remove columns
- **Estimate:** Low complexity
- **Dependencies:** Decision on email verification feature

### MED-006: Email Field Shows Edit Affordance
- **Status:** `[ ] Not Started`
- **Location:** `app/profile/ProfileClient.tsx:476-482`
- **Issue:** Email field uses EditableField component with empty `onChange={() => {}}` stub
- **Fix Required:** Use read-only display or clearly indicate non-editable
- **Estimate:** Trivial
- **Dependencies:** None

---

## Low Priority (Polish)

### LOW-001: Activity Status Toggle No Implementation
- **Status:** `[x] Resolved (2025-12-09)`
- **Location:** `app/profile/ProfileClient.tsx` (Privacy section)
- **Issue:** Toggle saves "Show when you're online" but no online status tracking exists
- **Resolution:** Hidden as part of CRIT-002 (entire Privacy section removed from UI)
- **Dependencies:** Social features roadmap

### LOW-002: Location Tracking Toggle No Implementation
- **Status:** `[x] Resolved (2025-12-09)`
- **Location:** `app/profile/ProfileClient.tsx` (Privacy section)
- **Issue:** Toggle saves but no geolocation features exist in app
- **Resolution:** Hidden as part of CRIT-002 (entire Privacy section removed from UI)
- **Dependencies:** Location features roadmap

### LOW-003: Template Copy - trip_meta Not Regenerated
- **Status:** `[ ] Not Started`
- **Location:** `app/api/templates/[id]/copy/route.ts`
- **Issue:** When copying templates, weather/distances may be stale (copied from template creation time)
- **Fix Required:** Clear trip_meta on copy and regenerate on first view
- **Estimate:** Low complexity
- **Dependencies:** None

### LOW-004: Shared Trip Analytics Missing
- **Status:** `[ ] Not Started`
- **Location:** `app/shared/[token]/page.tsx`
- **Issue:** No tracking of shared trip views or engagement
- **Fix Required:** Add page view tracking for shared trips
- **Estimate:** Low complexity
- **Dependencies:** None

### LOW-005: AI Conversations Null trip_id Entries
- **Status:** `[ ] Not Started`
- **Location:** `ai_conversations` table
- **Issue:** Some conversations exist without associated trips
- **Fix Required:** Investigate if intentional, clean up orphaned records if not
- **Estimate:** Trivial
- **Dependencies:** None

---

## Excluded Items (Intentionally Deferred)

### EXCLUDED-001: Amadeus Flights Search
- **Location:** `components/booking/FlightSearch.tsx`
- **Reason:** Feature intentionally disabled, commented out in TripDetailClient.tsx
- **Decision:** Keep for future use, do not remove

### EXCLUDED-002: Amadeus Hotels Search
- **Location:** `components/booking/HotelSearch.tsx`
- **Reason:** Feature intentionally disabled, commented out in TripDetailClient.tsx
- **Decision:** Keep for future use, do not remove

---

## Progress Log

| Date | Item | Action | Notes |
|------|------|--------|-------|
| 2025-12-09 | Plan Created | Initial audit | 17 items identified |
| 2025-12-09 | CRIT-001 | Completed | Delete account fully implemented with modal, API, cascade deletion |
| 2025-12-09 | HIGH-002 | Completed | Fixed AI assistant timing bug (Date.now() - requestStartTime) |
| 2025-12-09 | CRIT-002 | Completed | Hidden Notifications/Privacy sections, repurposed quiet hours for AI scheduling |
| 2025-12-09 | LOW-001 | Resolved | Hidden as part of CRIT-002 Privacy section removal |
| 2025-12-09 | LOW-002 | Resolved | Hidden as part of CRIT-002 Privacy section removal |

---

## How to Update This Document

When completing a task:
1. Change status from `[ ] Not Started` to `[x] Completed`
2. Add completion date and notes to Progress Log
3. Update Executive Summary counts
4. If new issues discovered during fix, add them to appropriate priority section

---

*Document maintained by development team. Last comprehensive audit: 2025-12-09*
