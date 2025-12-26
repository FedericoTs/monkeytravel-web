# Deferred Profile Completion - Implementation Plan

## Problem Statement

From PostHog session replays, users experience friction in the onboarding flow:

1. **Current Flow**: Tour → Signup → Trip Planning Setup → Personal Settings
2. **Issue**: Personal Settings feels redundant after already completing onboarding
3. **Root Cause**: Two different data collection points feel like "more forms"

### What Each Step Currently Collects:

| Step | Data Collected | Purpose |
|------|---------------|---------|
| **Onboarding Modal** (pre-signup) | Travel styles, dietary, accessibility, active hours | AI trip personalization |
| **Profile Page** (post-signup) | Display name, bio, country, city, languages, DOB | User identity & social |

**Key Insight**: These are actually DIFFERENT data sets, but showing them back-to-back creates perception of redundancy.

---

## Solution: Deferred Profile Completion

Move personal info collection to a **friendly modal on second login**, when users have already experienced value.

### UX Principles Applied:
1. **Progressive Disclosure** - Don't ask for everything upfront
2. **Value Before Ask** - Let users experience the product first
3. **Reduced Friction** - Fewer steps in initial onboarding
4. **Non-Blocking** - Modal is skippable, not mandatory

---

## Implementation Plan

### Phase 1: Database Schema Changes

```sql
-- Migration: add_login_tracking_fields
ALTER TABLE users
ADD COLUMN IF NOT EXISTS login_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS profile_completed BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS profile_completed_at TIMESTAMPTZ;

-- Index for efficient querying
CREATE INDEX IF NOT EXISTS idx_users_login_count ON users(login_count);
CREATE INDEX IF NOT EXISTS idx_users_profile_completed ON users(profile_completed) WHERE profile_completed = false;
```

### Phase 2: Login Tracking

**Files to modify:**
- `app/auth/callback/route.ts` - OAuth logins
- `app/[locale]/auth/login/page.tsx` - Email/password logins

**Logic:**
```typescript
// On successful login (not signup)
if (!isNewUser) {
  await supabase
    .from("users")
    .update({
      login_count: supabase.sql`login_count + 1`,
      last_sign_in_at: new Date().toISOString()
    })
    .eq("id", user.id);
}
```

### Phase 3: ProfileCompletionModal Component

**Location:** `components/profile/ProfileCompletionModal.tsx`

**Design Principles:**
- Friendly, welcoming tone ("Help us personalize your experience!")
- Pre-filled display_name from OAuth if available
- Clear value proposition for each field
- Easy skip option ("I'll do this later")
- Progress indicator (3-4 simple fields)

**Fields to collect:**
1. **Display Name** (pre-filled if from OAuth)
2. **Home Country** (dropdown with popular countries first)
3. **Home City** (text input)
4. **Languages** (multi-select chips, max 5)
5. **Bio** (optional, textarea, 200 chars max)

**UI Flow:**
```
┌─────────────────────────────────────────┐
│  🌍 Complete Your Travel Profile        │
│                                         │
│  Help us personalize your trips!        │
│                                         │
│  ┌─────────────────────────────────┐   │
│  │ Display Name: [Federico       ] │   │
│  └─────────────────────────────────┘   │
│                                         │
│  Where are you based?                   │
│  ┌──────────────┐ ┌──────────────┐     │
│  │ Country  ▼   │ │ City         │     │
│  └──────────────┘ └──────────────┘     │
│                                         │
│  Languages you speak:                   │
│  [English ✓] [Spanish] [Italian ✓]     │
│                                         │
│  ┌─────────────────────────────────────┐│
│  │        Complete Profile             ││
│  └─────────────────────────────────────┘│
│                                         │
│         Skip for now                    │
└─────────────────────────────────────────┘
```

### Phase 4: Integration Points

**Show modal when:**
```typescript
const shouldShowProfileModal =
  user.login_count >= 2 &&
  !user.profile_completed &&
  !hasShownProfileModalThisSession;
```

**Integration in layout:**
- Add check in `app/[locale]/layout.tsx` or create a `ProfileCompletionProvider`
- Use a session flag to prevent showing multiple times per session
- Store "shown this session" in sessionStorage

### Phase 5: Profile Page Updates

After implementing the modal:
1. Personal Info section should show completion status
2. If `profile_completed`, show "Profile complete" badge
3. Travel Preferences section stays as-is (editable)

---

## File Changes Summary

| File | Change |
|------|--------|
| `supabase/migrations/xxx_add_login_tracking.sql` | New migration |
| `types/index.ts` | Add new User fields |
| `app/auth/callback/route.ts` | Increment login_count |
| `app/[locale]/auth/login/page.tsx` | Increment login_count |
| `components/profile/ProfileCompletionModal.tsx` | New component |
| `app/providers.tsx` | Add ProfileCompletionProvider |
| `messages/en/common.json` | Add translations |
| `messages/es/common.json` | Add translations |
| `messages/it/common.json` | Add translations |

---

## Success Metrics

Track in PostHog:

| Event | When |
|-------|------|
| `profile_modal_shown` | Modal displayed on 2nd login |
| `profile_modal_completed` | User fills all fields and submits |
| `profile_modal_partial` | User fills some fields |
| `profile_modal_skipped` | User clicks "Skip for now" |
| `profile_modal_dismissed` | User closes without action |

**Target:**
- 60%+ completion rate on 2nd login
- <10% skip rate
- Improved retention D7 for users who complete profile

---

## Rollout Plan

1. **Phase A**: Deploy database changes (no user impact)
2. **Phase B**: Deploy login tracking (silent, collects data)
3. **Phase C**: Deploy modal (feature flagged)
4. **Phase D**: Gradual rollout (10% → 50% → 100%)

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Modal annoys returning users | Easy skip, only shows once, friendly tone |
| Login count not accurate | Also track `last_sign_in_at` comparison |
| Users miss value prop | Clear copy explaining benefits |
| Modal blocks critical action | Non-blocking, can dismiss easily |

---

## Alternative Approaches Considered

1. **Email follow-up after 2nd visit** - Lower completion rate, adds friction
2. **In-profile nudge banner** - Less visible, easy to ignore
3. **Required step after onboarding** - Current problem, creates friction
4. **Gamification (rewards for completing)** - Complex, save for later

**Chosen approach**: Modal on 2nd login balances visibility with non-intrusiveness.
