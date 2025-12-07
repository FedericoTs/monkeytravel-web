# Usage Limits Implementation Plan

## Executive Summary

This document outlines the comprehensive implementation plan for adding usage limits to:
1. **AI Generation** (Gemini API) - Trip generation, activity regeneration, AI assistant
2. **Google Places API** - Autocomplete, search, details, nearby search

## Current State Analysis

### AI Generation (Gemini)

**Entry Points:**
| Endpoint | File | Current Limit | Cost |
|----------|------|---------------|------|
| `POST /api/ai/generate` | `app/api/ai/generate/route.ts` | 10/day (via api_request_logs query) | $0.003 |
| `POST /api/ai/regenerate-activity` | `app/api/ai/regenerate-activity/route.ts` | 10/hour per trip | $0.001 |
| `POST /api/ai/generate-more-days` | `app/api/ai/generate-more-days/route.ts` | 20/day | $0.002 |
| `POST /api/ai/assistant` | `app/api/ai/assistant/route.ts` | 5/min, 30/hr, 50k tokens/day | Variable |

**Current Rate Limiting Method:**
- Queries `api_request_logs` table at runtime (slow, expensive)
- Admin bypass via `isAdmin()` check
- No user-facing quota display
- No subscription tier support

### Google Places API

**Entry Points:**
| Endpoint | File | Current Limit | Cost |
|----------|------|---------------|------|
| `POST /api/places/autocomplete` | `app/api/places/autocomplete/route.ts` | None | $0.00283 |
| `POST /api/places` (search) | `app/api/places/route.ts` | None | $0.032 |
| `GET /api/places` (destination) | `app/api/places/route.ts` | None | $0.032 |
| `GET /api/places/details` | `app/api/places/details/route.ts` | None | $0.017 |
| `GET /api/hotels/places` | `app/api/hotels/places/route.ts` | None | $0.032 |

**Current State:**
- No per-user limits
- API access controlled via `checkApiAccess()` (on/off only)
- Caching reduces costs but doesn't limit abuse

---

## Proposed Architecture

### Tier System

```
FREE TIER (Default)
├── AI Generation: 3 trips/month
├── Activity Regeneration: 10/trip
├── AI Assistant: 20 messages/day
├── Places Autocomplete: 100/day
├── Places Search: 50/day
└── Places Details: 30/day

PREMIUM TIER ($79/year)
├── AI Generation: Unlimited
├── Activity Regeneration: Unlimited
├── AI Assistant: Unlimited
├── Places Autocomplete: Unlimited
├── Places Search: Unlimited
└── Places Details: Unlimited

ADMIN (Hardcoded emails)
└── All: Unlimited (bypass all limits)
```

### Database Schema

#### New Table: `user_usage`

```sql
CREATE TABLE user_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Period tracking (YYYY-MM format for monthly, YYYY-MM-DD for daily)
  period_type TEXT NOT NULL CHECK (period_type IN ('monthly', 'daily')),
  period_key TEXT NOT NULL,  -- e.g., '2025-01' or '2025-01-06'

  -- AI Usage Counters
  ai_generations_used INTEGER DEFAULT 0,
  ai_regenerations_used INTEGER DEFAULT 0,
  ai_assistant_messages_used INTEGER DEFAULT 0,
  ai_tokens_used INTEGER DEFAULT 0,

  -- Places API Counters
  places_autocomplete_used INTEGER DEFAULT 0,
  places_search_used INTEGER DEFAULT 0,
  places_details_used INTEGER DEFAULT 0,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Unique constraint: one row per user per period
  UNIQUE (user_id, period_type, period_key)
);

-- Indexes for fast lookups
CREATE INDEX idx_user_usage_user_period ON user_usage(user_id, period_type, period_key);
CREATE INDEX idx_user_usage_period ON user_usage(period_type, period_key);

-- RLS
ALTER TABLE user_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own usage"
ON user_usage FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "System can manage usage"
ON user_usage FOR ALL
USING (true)
WITH CHECK (true);
```

#### Modify `users` Table

```sql
-- Add subscription fields to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_tier TEXT DEFAULT 'free'
  CHECK (subscription_tier IN ('free', 'premium', 'enterprise'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_expires_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;
```

---

## Implementation Plan

### Phase 1: Core Infrastructure

#### 1.1 Create Usage Limits Library

**New File: `lib/usage-limits/index.ts`**

```typescript
export interface UsageLimits {
  aiGenerations: number;      // per month
  aiRegenerations: number;    // per trip
  aiAssistantMessages: number; // per day
  placesAutocomplete: number; // per day
  placesSearch: number;       // per day
  placesDetails: number;      // per day
}

export const TIER_LIMITS: Record<string, UsageLimits> = {
  free: {
    aiGenerations: 3,
    aiRegenerations: 10,
    aiAssistantMessages: 20,
    placesAutocomplete: 100,
    placesSearch: 50,
    placesDetails: 30,
  },
  premium: {
    aiGenerations: -1, // unlimited
    aiRegenerations: -1,
    aiAssistantMessages: -1,
    placesAutocomplete: -1,
    placesSearch: -1,
    placesDetails: -1,
  },
};
```

**New File: `lib/usage-limits/check.ts`**

```typescript
export interface UsageCheckResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  used: number;
  resetAt: string;
  tier: string;
  message?: string;
}

export async function checkUsageLimit(
  userId: string,
  limitType: keyof UsageLimits,
  periodType: 'monthly' | 'daily' = 'monthly'
): Promise<UsageCheckResult>

export async function incrementUsage(
  userId: string,
  limitType: keyof UsageLimits,
  amount: number = 1
): Promise<void>

export async function getUserTier(userId: string): Promise<string>

export async function getUserUsageStats(userId: string): Promise<UsageStats>
```

#### 1.2 Database Migration

**New File: `supabase/migrations/YYYYMMDD_create_user_usage.sql`**

Contains the SQL from the schema section above.

### Phase 2: AI Generation Limits

#### 2.1 Modify `/api/ai/generate/route.ts`

**Changes:**
1. Replace `api_request_logs` query with `checkUsageLimit()` call
2. Add `incrementUsage()` after successful generation
3. Return usage info in response for UI display

**Before (lines 225-243):**
```typescript
if (!userIsAdmin) {
  const today = new Date().toISOString().split("T")[0];
  const { count } = await supabase
    .from("api_request_logs")
    .select("*", { count: "exact", head: true })
    .eq("api_name", "gemini")
    .gte("timestamp", `${today}T00:00:00Z`)
    .eq("request_params->>user_id", user.id);

  if ((count || 0) >= 10) {
    return NextResponse.json(
      { error: "Daily generation limit reached..." },
      { status: 429 }
    );
  }
}
```

**After:**
```typescript
import { checkUsageLimit, incrementUsage } from "@/lib/usage-limits";

// Check usage limit (admins bypass)
if (!userIsAdmin) {
  const usageCheck = await checkUsageLimit(user.id, "aiGenerations", "monthly");

  if (!usageCheck.allowed) {
    return NextResponse.json({
      error: "Monthly trip generation limit reached",
      usage: usageCheck,
      upgradeUrl: "/pricing",
    }, { status: 429 });
  }
}

// ... after successful generation ...

// Increment usage counter (not for cache hits)
if (!cacheHit && !userIsAdmin) {
  await incrementUsage(user.id, "aiGenerations", 1);
}
```

#### 2.2 Modify `/api/ai/regenerate-activity/route.ts`

**Changes:**
- Replace trip-based hourly limit with per-trip lifetime limit
- Use `checkUsageLimit()` with trip context

#### 2.3 Modify `/api/ai/assistant/route.ts`

**Changes:**
- Replace `checkRateLimit()` with `checkUsageLimit()`
- Daily limit for messages (not tokens - simpler UX)

### Phase 3: Places API Limits

#### 3.1 Create Places Usage Middleware

**New File: `lib/usage-limits/places-middleware.ts`**

```typescript
export async function withPlacesLimit(
  userId: string | null,
  limitType: 'placesAutocomplete' | 'placesSearch' | 'placesDetails',
  fn: () => Promise<Response>
): Promise<Response> {
  // Anonymous users get a small limit tracked by IP
  // Authenticated users use their account limits

  if (!userId) {
    // IP-based limiting for anonymous (strict)
    return handleAnonymousLimit(limitType, fn);
  }

  const check = await checkUsageLimit(userId, limitType, 'daily');
  if (!check.allowed) {
    return NextResponse.json({
      error: "Daily API limit reached",
      usage: check,
      upgradeUrl: "/pricing",
    }, { status: 429 });
  }

  const response = await fn();

  // Only increment on success (not cache hits)
  if (response.ok) {
    await incrementUsage(userId, limitType, 1);
  }

  return response;
}
```

#### 3.2 Modify Places Routes

**Files to modify:**
- `app/api/places/autocomplete/route.ts`
- `app/api/places/route.ts` (POST and GET)
- `app/api/places/details/route.ts`
- `app/api/hotels/places/route.ts`

**Pattern:**
```typescript
// Before
export async function POST(request: NextRequest) {
  // ... existing code
}

// After
import { withPlacesLimit } from "@/lib/usage-limits/places-middleware";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  return withPlacesLimit(user?.id || null, 'placesSearch', async () => {
    // ... existing code, but return Response
  });
}
```

### Phase 4: User-Facing Components

#### 4.1 Usage Dashboard Component

**New File: `components/usage/UsageDashboard.tsx`**

Displays:
- Current tier (Free/Premium)
- Usage bars for each limit type
- Reset countdown (daily/monthly)
- Upgrade CTA for free users

#### 4.2 Upgrade Modal

**New File: `components/premium/UpgradeModal.tsx`**

Triggered when:
- User hits a limit
- User clicks "Upgrade" button
- After 2nd free trip generation

#### 4.3 API Response Enhancement

All limited endpoints return usage metadata:
```typescript
{
  success: true,
  data: { ... },
  usage: {
    type: "aiGenerations",
    used: 2,
    limit: 3,
    remaining: 1,
    resetAt: "2025-02-01T00:00:00Z",
    tier: "free"
  }
}
```

### Phase 5: Admin Dashboard Enhancement

#### 5.1 Add Usage Stats to Admin

**Modify: `app/api/admin/stats/route.ts`**

Add:
- Total usage across all users
- Users approaching limits
- Premium vs free tier breakdown
- Usage trends

---

## Edge Cases & Considerations

### 1. Race Conditions

**Problem:** Concurrent requests could exceed limits
**Solution:** Use Supabase atomic increment:
```sql
UPDATE user_usage
SET ai_generations_used = ai_generations_used + 1
WHERE user_id = $1 AND period_type = 'monthly' AND period_key = $2
RETURNING ai_generations_used;
```

### 2. Period Rollover

**Problem:** Usage should reset at period boundaries
**Solution:** Use period_key (YYYY-MM or YYYY-MM-DD) - new period = new row

### 3. Cache Hits

**Problem:** Should cache hits count against limits?
**Decision:** NO - cache hits don't cost money, shouldn't count
**Implementation:** Check `cacheHit` flag before incrementing

### 4. Failed Requests

**Problem:** Should failed requests count?
**Decision:** NO - only successful API calls consume quota
**Implementation:** Increment after successful response

### 5. Anonymous Users (Places API)

**Problem:** Autocomplete is used before login
**Solution:**
- Rate limit by IP for anonymous users (10 autocomplete/day)
- Associate with account after login
- Use localStorage to track client-side

### 6. Subscription Expiry

**Problem:** Premium expires mid-month
**Solution:**
- Check `subscription_expires_at` in `getUserTier()`
- Grace period of 3 days (still show premium limits)
- After grace: revert to free tier

### 7. Admin Bypass

**Problem:** Admins shouldn't be limited
**Solution:** Early return in all limit checks:
```typescript
if (isAdmin(user.email)) {
  return { allowed: true, remaining: -1, ... };
}
```

### 8. Offline/Network Errors

**Problem:** Can't check limits if DB is down
**Solution:** Fail-open for short periods (allow request, log for later reconciliation)

---

## File Change Summary

### New Files

| File | Purpose |
|------|---------|
| `lib/usage-limits/index.ts` | Constants and types |
| `lib/usage-limits/check.ts` | Core limit checking/incrementing |
| `lib/usage-limits/places-middleware.ts` | Places API wrapper |
| `components/usage/UsageDashboard.tsx` | Usage display UI |
| `components/premium/UpgradeModal.tsx` | Upgrade prompt |
| `supabase/migrations/YYYYMMDD_create_user_usage.sql` | DB schema |
| `supabase/migrations/YYYYMMDD_add_subscription_fields.sql` | User table changes |
| `app/api/usage/route.ts` | GET endpoint for client usage |

### Modified Files

| File | Changes |
|------|---------|
| `app/api/ai/generate/route.ts` | Replace log-based limits with usage-limits |
| `app/api/ai/regenerate-activity/route.ts` | Add per-trip regeneration limits |
| `app/api/ai/assistant/route.ts` | Replace token limits with message limits |
| `app/api/places/autocomplete/route.ts` | Add daily limits |
| `app/api/places/route.ts` | Add daily limits (POST and GET) |
| `app/api/places/details/route.ts` | Add daily limits |
| `app/api/hotels/places/route.ts` | Add daily limits |
| `app/api/admin/stats/route.ts` | Add usage analytics |
| `types/index.ts` | Add usage-related types |

---

## Implementation Order

1. **Database Migration** - Create tables first
2. **Usage Limits Library** - Core functions
3. **AI Generation Limits** - Highest cost impact
4. **Places API Limits** - Secondary cost control
5. **User-Facing Components** - Usage display, upgrade modal
6. **Admin Dashboard** - Monitoring and analytics
7. **Testing** - Unit tests, integration tests
8. **Documentation** - Update CLAUDE.md

---

## Testing Plan

### Unit Tests

- `checkUsageLimit()` returns correct results for all tiers
- `incrementUsage()` atomically increments counters
- Period key generation is correct
- Admin bypass works correctly

### Integration Tests

- Full trip generation flow respects limits
- Places API calls respect limits
- Cache hits don't count against limits
- Failed requests don't count
- Period rollover works correctly

### Manual Testing

- Create free account, hit limits, verify UI
- Upgrade to premium, verify unlimited
- Check admin bypass
- Test anonymous Places API limits

---

## Rollback Plan

If issues occur:
1. Set all limits to -1 (unlimited) in TIER_LIMITS
2. Deploy immediately
3. Debug and fix
4. Gradual re-enable with monitoring

---

## Success Metrics

- API costs reduced by 40%+ within 30 days
- No increase in user complaints
- Premium conversion rate tracked
- System stability maintained (no 5xx from limit checks)
