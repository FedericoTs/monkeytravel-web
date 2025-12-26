# PostHog Integration - Comprehensive Implementation Plan

## Executive Summary

This document outlines the complete PostHog integration strategy for MonkeyTravel, including analytics, feature flags, A/B testing, and session replay capabilities.

**Stack Context:**
- Next.js 16.0.10 (App Router)
- React 19.2.0
- Supabase Auth (user identification)
- Existing: GA4, Vercel Analytics, Sentry

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           PostHog Cloud                                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │ Analytics   │  │ Feature     │  │ Experiments │  │ Session Replays     │ │
│  │ & Events    │  │ Flags       │  │ (A/B Tests) │  │ (Optional)          │ │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────────────┘ │
└───────────────────────────────────┬─────────────────────────────────────────┘
                                    │
┌───────────────────────────────────▼─────────────────────────────────────────┐
│                          Next.js Application                                 │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                     PostHogProvider (app/providers.tsx)               │   │
│  │  - Initializes posthog-js                                             │   │
│  │  - Handles pageviews (capture_pageview: 'history_change')             │   │
│  │  - Bootstraps feature flags from server                               │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                    │                                         │
│  ┌─────────────────────────────────┴───────────────────────────────────┐    │
│  │                                                                      │    │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────┐  │    │
│  │  │ usePostHog()    │  │ useFeatureFlag  │  │ PostHogFeature      │  │    │
│  │  │ - identify()    │  │ Enabled()       │  │ Component           │  │    │
│  │  │ - capture()     │  │ - A/B variants  │  │ - Declarative flags │  │    │
│  │  │ - reset()       │  │ - Experiments   │  │ - Fallback support  │  │    │
│  │  └─────────────────┘  └─────────────────┘  └─────────────────────┘  │    │
│  │                                                                      │    │
│  └──────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                     Server-Side (posthog-node)                        │   │
│  │  - Feature flag evaluation in middleware                              │   │
│  │  - Server component flag access                                       │   │
│  │  - Event capture from API routes                                      │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Integration Points

### 2.1 User Identification Flow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Anonymous  │ ──► │   Signup    │ ──► │  Identified │ ──► │   Logout    │
│   Session   │     │   (alias)   │     │    User     │     │   (reset)   │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
      │                   │                   │                   │
      ▼                   ▼                   ▼                   ▼
posthog with         posthog.alias(       posthog.identify(   posthog.reset()
distinct_id from     supabaseUserId,      supabaseUserId,     → new distinct_id
cookie               anonymousId)         userProperties)
```

**User Properties to Set:**
```typescript
{
  email: user.email,
  name: user.display_name,
  subscription_tier: 'free' | 'pro' | 'premium',
  referral_tier: 0 | 1 | 2 | 3,
  onboarding_completed: boolean,
  trips_created: number,
  account_age_days: number,
  has_beta_access: boolean,
  preferred_language: 'en' | 'es' | 'it'
}
```

### 2.2 Event Mapping (GA4 → PostHog)

| GA4 Event | PostHog Event | Properties |
|-----------|---------------|------------|
| `sign_up` | `user_signed_up` | method, referral_code |
| `login` | `user_logged_in` | method |
| `trip_created` | `trip_created` | destination, duration, budget_tier |
| `itinerary_generated` | `itinerary_generated` | destination, generation_time_ms |
| `share_prompt_shown` | `share_prompt_shown` | trip_id, location |
| `share_prompt_action` | `share_prompt_action` | action: invite/skip |
| `referral_conversion` | `referral_converted` | referral_code, reward_amount |
| `limit_reached` | `limit_reached` | limit_type, current_usage |
| `upgrade_prompt_shown` | `upgrade_prompt_shown` | trigger, location |

### 2.3 Feature Flags Configuration

| Flag Name | Type | Purpose | Variants |
|-----------|------|---------|----------|
| `pricing-tier-test` | Experiment | A/B test pricing | control, $39, $49 |
| `trial-duration` | Experiment | Test trial length | 7-days, 14-days |
| `share-modal-delay` | Experiment | Share modal timing | immediate, 2-seconds |
| `onboarding-steps` | Experiment | Onboarding length | 4-steps, 3-steps |
| `upgrade-prompt-style` | Experiment | Upgrade prompt UX | modal, banner, toast |
| `referral-messaging` | Experiment | Referral copy | earn-rewards, help-friends |
| `new-ai-features` | Boolean | AI feature rollout | true/false |
| `collaboration-v2` | Boolean | New collab features | true/false |

---

## 3. File Structure

```
lib/
├── posthog/
│   ├── client.ts           # Client-side PostHog instance
│   ├── server.ts           # Server-side PostHog instance
│   ├── hooks.ts            # Custom hooks (useExperiment, useTrack)
│   ├── events.ts           # Type-safe event definitions
│   └── flags.ts            # Feature flag keys and types

app/
├── providers.tsx           # PostHogProvider wrapper
└── layout.tsx              # Add PostHogProvider

components/
├── posthog/
│   └── PostHogPageView.tsx # Pageview tracking component
└── analytics/
    └── IdentifyUser.tsx    # User identification component

middleware.ts               # Bootstrap flags server-side
```

---

## 4. Implementation Phases

### Phase 1: Core Setup (This Session)

1. Install packages: `posthog-js`, `posthog-node`
2. Create PostHog provider and client configuration
3. Add to root layout with existing providers
4. Set up user identification with Supabase auth
5. Configure pageview tracking (history_change mode)
6. Create type-safe event tracking wrapper

### Phase 2: Event Migration

1. Create event mapping layer (lib/posthog/events.ts)
2. Update existing trackEvent calls to use PostHog
3. Keep GA4 running in parallel (dual tracking)
4. Verify event parity in PostHog dashboard

### Phase 3: Feature Flags

1. Create initial feature flags in PostHog dashboard
2. Add useFeatureFlag hooks to key components
3. Implement server-side flag evaluation in middleware
4. Add flag tracking for experiment exposure

### Phase 4: Experiments

1. Set up first A/B test (pricing tier)
2. Configure conversion goals
3. Add experiment tracking to analytics
4. Create experiment documentation

---

## 5. Environment Variables

```env
# PostHog Configuration
NEXT_PUBLIC_POSTHOG_KEY=phc_xxxxxxxxxxxxx
NEXT_PUBLIC_POSTHOG_HOST=https://app.posthog.com

# For reverse proxy (optional, recommended for production)
NEXT_PUBLIC_POSTHOG_UI_HOST=https://app.posthog.com
```

---

## 6. Key Code Components

### 6.1 PostHog Client Configuration

```typescript
// lib/posthog/client.ts
import posthog from 'posthog-js'

export function initPostHog() {
  if (typeof window === 'undefined') return

  posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY!, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://app.posthog.com',

    // Use 2025 defaults for best pageview handling
    defaults: '2025-11-30',

    // Capture pageviews on history changes (SPA navigation)
    capture_pageview: 'history_change',

    // Enable session recording (optional)
    disable_session_recording: false,

    // Feature flag settings
    bootstrap: {
      // Will be populated from server
    },

    // Privacy settings
    persistence: 'localStorage+cookie',
    person_profiles: 'identified_only',

    // Performance
    autocapture: true,
    capture_heatmaps: true,
  })
}

export { posthog }
```

### 6.2 PostHog Provider

```typescript
// app/providers.tsx
'use client'

import { useEffect } from 'react'
import posthog from 'posthog-js'
import { PostHogProvider as PHProvider } from 'posthog-js/react'
import { initPostHog } from '@/lib/posthog/client'

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    initPostHog()
  }, [])

  return <PHProvider client={posthog}>{children}</PHProvider>
}
```

### 6.3 User Identification

```typescript
// lib/posthog/identify.ts
import posthog from 'posthog-js'
import type { User } from '@supabase/supabase-js'

interface UserProperties {
  email?: string
  name?: string
  subscription_tier?: string
  referral_tier?: number
  onboarding_completed?: boolean
  trips_created?: number
  account_age_days?: number
  has_beta_access?: boolean
  preferred_language?: string
}

export function identifyUser(user: User, properties: UserProperties) {
  posthog.identify(user.id, {
    email: user.email,
    ...properties,
    $set_once: {
      first_seen_at: new Date().toISOString(),
    },
  })
}

export function resetUser() {
  posthog.reset()
}
```

### 6.4 Type-Safe Events

```typescript
// lib/posthog/events.ts
import posthog from 'posthog-js'

// Event type definitions
export type PostHogEvent =
  | { name: 'trip_created'; properties: { destination: string; duration: number; budget_tier: string } }
  | { name: 'share_prompt_shown'; properties: { trip_id: string; location: string } }
  | { name: 'share_prompt_action'; properties: { trip_id: string; action: 'invite' | 'skip' } }
  | { name: 'limit_reached'; properties: { limit_type: string; current_usage: number; limit: number } }
  | { name: 'upgrade_prompt_shown'; properties: { trigger: string; location: string } }
  | { name: 'referral_converted'; properties: { referral_code: string; reward_amount: number } }

export function capture<T extends PostHogEvent>(event: T) {
  posthog.capture(event.name, event.properties)
}
```

### 6.5 Feature Flag Hook

```typescript
// lib/posthog/hooks.ts
import { useFeatureFlagEnabled, useFeatureFlagVariantKey, usePostHog } from 'posthog-js/react'

export function useExperiment(flagKey: string) {
  const variant = useFeatureFlagVariantKey(flagKey)
  const posthog = usePostHog()

  // Track exposure on first render
  useEffect(() => {
    if (variant) {
      posthog.capture('$feature_flag_called', {
        $feature_flag: flagKey,
        $feature_flag_response: variant,
      })
    }
  }, [variant, flagKey, posthog])

  return variant
}

export function useFlag(flagKey: string) {
  return useFeatureFlagEnabled(flagKey)
}
```

---

## 7. Integration with Existing Analytics

### Dual Tracking Strategy

During the transition period, we'll track events to both GA4 and PostHog:

```typescript
// lib/analytics/unified.ts
import * as ga4 from '@/lib/analytics'
import * as posthog from '@/lib/posthog/events'

export function trackTripCreated(params: TripCreatedParams) {
  // Track in GA4 (existing)
  ga4.trackTripCreated(params)

  // Track in PostHog (new)
  posthog.capture({
    name: 'trip_created',
    properties: {
      destination: params.destination,
      duration: params.duration,
      budget_tier: params.budgetTier,
    },
  })
}
```

### SessionTracker Integration

Update `SessionTracker.tsx` to also identify users in PostHog:

```typescript
// After existing setUserId call
import { identifyUser } from '@/lib/posthog/identify'

// In trackSession function:
identifyUser(user, {
  email: user.email,
  subscription_tier: userData?.subscription_tier || 'free',
  referral_tier: userData?.referral_tier || 0,
  onboarding_completed: userData?.onboarding_completed ?? false,
  trips_created: trips,
  account_age_days: daysSinceSignup,
  has_beta_access: !!betaAccess,
})
```

---

## 8. Priority A/B Tests to Configure

### Test 1: Pricing Tier (High Impact)

**Flag:** `pricing-tier-test`
**Variants:**
- control: $39/year ($4.99/mo)
- variant-a: $49/year ($4.99/mo)
- variant-b: $29/year ($3.99/mo)

**Goal:** Free-to-paid conversion rate

### Test 2: Share Modal Timing (Growth)

**Flag:** `share-modal-delay`
**Variants:**
- immediate: Show modal right after save
- delayed: Show 2 seconds after save
- scroll: Show when user scrolls

**Goal:** Share rate per trip

### Test 3: Trial Duration (Revenue)

**Flag:** `trial-duration`
**Variants:**
- 7-days: Current default
- 14-days: Extended trial
- 3-days: Urgency trial

**Goal:** Trial-to-paid conversion

---

## 9. Success Metrics

| Metric | Current (GA4) | Target (PostHog) |
|--------|---------------|------------------|
| Event capture rate | ~95% | 100% |
| User identification | Post-signup | Immediate |
| Feature flag latency | N/A | <50ms |
| Experiment setup time | N/A | <1 hour |
| Cross-session tracking | Limited | Complete |

---

## 10. Rollback Plan

If issues arise:
1. PostHog provider can be disabled via env var
2. GA4 remains as backup analytics
3. Feature flags default to control variant
4. Session recording can be disabled independently

---

## Next Steps

1. ✅ Complete research and planning
2. 🔄 Install packages and create core files
3. ⏳ Add PostHogProvider to layout
4. ⏳ Implement user identification
5. ⏳ Create first feature flag
6. ⏳ Set up first A/B test
7. ⏳ Deploy and verify

