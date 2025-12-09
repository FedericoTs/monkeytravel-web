# CRIT-002: User Settings Integration Plan

> **Created:** 2025-12-09
> **Status:** ✅ IMPLEMENTED (2025-12-09)

## Executive Summary

After deep analysis of the codebase, here's the reality of each setting:

| Category | Settings Count | Currently Used | Can Implement Now | Must Hide |
|----------|---------------|----------------|-------------------|-----------|
| **Travel Preferences** | 3 | 3 (100%) | - | - |
| **Notification Settings** | 8 | 0 (0%) | 2 (partial) | 6 |
| **Privacy Settings** | 6 | 0 (0%) | 0 | 6 |

---

## Analysis Results

### 1. TRAVEL PREFERENCES (Keep As-Is) ✅

These are **fully functional** and integrated into AI trip generation:

| Setting | Used In | How It Works |
|---------|---------|--------------|
| `dietaryPreferences` | `lib/gemini.ts:36-53` | Constrains restaurant suggestions |
| `accessibilityNeeds` | `lib/gemini.ts:56-69` | Filters inaccessible venues |
| `travelStyles` | `lib/gemini.ts:72-88` | Influences itinerary aesthetic |

**Action:** No changes needed. Keep this section.

---

### 2. NOTIFICATION SETTINGS (8 Fields)

#### Infrastructure Reality Check:
- ❌ **No email service** - No Resend, SendGrid, nodemailer installed
- ❌ **No push notifications** - No Firebase, OneSignal
- ❌ **No scheduled jobs** - No Vercel cron, no Supabase Edge Functions
- ❌ **No notification queue** - No backend to process notifications

#### Field-by-Field Analysis:

| Setting | What It Would Need | Complexity | Recommendation |
|---------|-------------------|------------|----------------|
| `emailNotifications` | Email service (Resend) + templates | HIGH | **Hide** |
| `pushNotifications` | Firebase/OneSignal + service worker | HIGH | **Hide** |
| `tripReminders` | Scheduler + email/push service | HIGH | **Hide** |
| `dealAlerts` | Deal detection system + notifications | HIGH | **Hide** |
| `socialNotifications` | Social features (don't exist) | VERY HIGH | **Hide** |
| `marketingNotifications` | Email service + campaigns | HIGH | **Hide** |
| `quietHoursStart` | Only useful if notifications exist | DEPENDS | **Repurpose** |
| `quietHoursEnd` | Only useful if notifications exist | DEPENDS | **Repurpose** |

#### Opportunity: Repurpose Quiet Hours for AI

**Instead of notification timing, use quiet hours for activity scheduling:**

```typescript
// In AI prompt generation:
"User prefers rest between ${quietHoursStart}:00 and ${quietHoursEnd}:00.
- Avoid scheduling activities that end after ${quietHoursStart}:00
- Don't schedule early morning activities before ${quietHoursEnd}:00
- For multi-day trips, ensure adequate rest time"
```

**Implementation:** ~30 minutes to add to `lib/gemini.ts`

---

### 3. PRIVACY SETTINGS (6 Fields)

#### Feature Reality Check:

| Setting | Required Feature | Feature Exists? | Recommendation |
|---------|-----------------|-----------------|----------------|
| `privateProfile` | Public profile pages | ❌ No `/user/[id]` route | **Hide** |
| `showRealName` | Profile visibility | ❌ User data not exposed on shared trips | **Hide** |
| `showTripHistory` | Trip history page | ❌ No such page exists | **Hide** |
| `showActivityStatus` | Online presence system | ❌ No WebSocket/presence | **Hide** |
| `allowLocationTracking` | Geolocation features | ❌ No location APIs used | **Hide** |
| `disableFriendRequests` | Friend/social system | ❌ No social features | **Hide** |

#### Key Finding: Shared Trips Are Already Private

From the analysis, shared trips **already protect user privacy**:
- ✅ `user_id` is NOT exposed to SharedTripView
- ✅ `display_name` is NOT passed to shared pages
- ✅ `email` is NOT visible anywhere
- ✅ No creator attribution shown

The privacy settings were designed for **future social features** that don't exist yet.

---

## Implementation Plan

### Phase 1: Quick Wins (Implement Now)

#### 1.1 Integrate Quiet Hours into AI Scheduling

**Files to modify:**
- `lib/gemini.ts` - Add quiet hours to prompt building
- `app/api/ai/generate/route.ts` - Fetch notification_settings

**Code Changes:**

```typescript
// In lib/gemini.ts - add new function
function buildSchedulingPreferences(
  quietHoursStart?: number,
  quietHoursEnd?: number
): string {
  if (!quietHoursStart || !quietHoursEnd) return "";

  return `
SCHEDULING PREFERENCES:
- User prefers to rest between ${quietHoursStart}:00 and ${quietHoursEnd}:00
- Avoid activities that would end after ${quietHoursStart}:00 (e.g., late dinners, night tours)
- Don't schedule early activities before ${quietHoursEnd}:00 (let them sleep in)
- Ensure activities have reasonable timing for the user's schedule
`;
}
```

**Effort:** 30 minutes

#### 1.2 Auto-fetch Default Preferences from Profile

**Current Issue:** `app/api/ai/generate/route.ts` only uses preferences from request body, ignoring user's saved defaults.

**Fix:** Fall back to profile preferences if not provided in request.

```typescript
// In app/api/ai/generate/route.ts
const budgetTier = body.budgetTier || profile?.preferences?.default_budget_tier || "balanced";
const pace = body.pace || profile?.preferences?.default_pace || "moderate";
```

**Effort:** 15 minutes

### Phase 2: Hide Non-Functional Settings

#### 2.1 Hide Notification Settings Section

**Approach:** Completely remove the section from UI (not "Coming Soon" - cleaner UX)

**File:** `app/profile/ProfileClient.tsx`

**Change:** Comment out or remove the Notifications ProfileSection (lines ~615-673)

**Effort:** 5 minutes

#### 2.2 Hide Privacy Settings Section

**Approach:** Completely remove the section from UI

**File:** `app/profile/ProfileClient.tsx`

**Change:** Comment out or remove the Privacy ProfileSection (lines ~676-726)

**Effort:** 5 minutes

### Phase 3: UI Updates

#### 3.1 Rename "Quiet Hours" to "Activity Scheduling"

Since we're repurposing quiet hours for AI, update the label:

**Current:**
```
Quiet Hours
Do not disturb between [Start] and [End]
```

**New:**
```
Activity Scheduling
Prefer activities between [Start] and [End]
I'm usually awake from [End]:00 to [Start]:00
```

**Location:** Move to Travel Preferences section

---

## Final UI Structure

### Before (Current):
```
Profile Page:
├── Personal Info ✓
├── Travel Preferences ✓
├── Notifications (8 settings - none work)
├── Privacy (6 settings - none work)
└── Account ✓
```

### After (Proposed):
```
Profile Page:
├── Personal Info ✓
├── Travel Preferences ✓
│   ├── Travel Styles (existing)
│   ├── Dietary Preferences (existing)
│   ├── Accessibility Needs (existing)
│   └── Activity Schedule (repurposed quiet hours) ← NEW
└── Account ✓
```

---

## Database Impact

**No schema changes needed.** We're:
1. Using existing `notification_settings.quietHoursStart/End` for AI scheduling
2. Simply hiding unused UI fields
3. Data continues to be stored (won't break existing profiles)

---

## Implementation Checklist

### Quick Wins (Done):
- [x] Add quiet hours to AI prompt generation (`lib/gemini.ts:103-131`)
- [x] Auto-fetch default preferences from profile (already working)
- [x] Move quiet hours UI to Travel Preferences (`app/profile/ProfileClient.tsx`)

### Hide Settings (Done):
- [x] Remove Notifications section from ProfileClient.tsx
- [x] Remove Privacy section from ProfileClient.tsx

### Future (When Ready):
- [ ] Add email service (Resend) for real notifications
- [ ] Build social features that use privacy settings
- [ ] Add public profile pages

---

## Effort Summary

| Task | Effort | Impact |
|------|--------|--------|
| Quiet hours → AI scheduling | 30 min | Activity times match user preference |
| Auto-fetch defaults | 15 min | Less friction in trip creation |
| Hide Notifications section | 5 min | Clean UI, no broken toggles |
| Hide Privacy section | 5 min | Clean UI, no broken toggles |
| Move quiet hours to Preferences | 15 min | Logical grouping |
| **Total** | **~70 min** | **Cleaner UX, working features only** |

---

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Users expect notification features | Settings never worked - no expectation set |
| Data loss from hidden fields | Data stays in DB, just hidden from UI |
| Future revert needed | Code is commented, not deleted |

---

*Plan created: 2025-12-09*
*Ready for implementation*
