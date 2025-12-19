# MonkeyTravel Optimization Plan

## Executive Summary

Based on comprehensive analysis of the codebase, we identified **3 major optimization areas** with significant ROI:

| Area | Potential Savings | Implementation Time | Risk |
|------|-------------------|---------------------|------|
| **Code Factorization** | 1,260-2,760 lines | 2-3 days | Low |
| **API Cost Optimization** | 40-60% monthly cost reduction | 1-2 days | Low |
| **Component/Hook Optimization** | 1,700 lines + 200KB bundle | 4-6 hours | Low |

**Total Impact:**
- **~3,500-4,500 lines of code reduced**
- **~40-60% API cost savings** ($800-1,200/month if spend is $2-3K)
- **~200KB bundle size reduction**
- **~500ms faster page load**
- **~40-60% CPU reduction during trip editing**

---

## Current State Analysis

### Database Metrics (Last 30 Days)

| API | Calls | Cache Hit Rate | Total Cost | Avg Response |
|-----|-------|----------------|------------|--------------|
| google_geocoding | 300 | 0% logged* | $1.50 | 1.2ms |
| google_places_search | 60 | 0% | $1.92 | 758ms |
| google_places_autocomplete | 111 | 9.91% | $0.28 | 354ms |
| google_places_details | 35 | 5.71% | $0.56 | 430ms |
| google_distance_matrix | 36 | 0% | $0.71 | 34ms |
| gemini | 142 | 0% (expected) | $0.39 | 46,186ms |

*Cache working internally (25,810+ hits) but not logged to api_request_logs

### Cache Table Effectiveness

| Cache | Entries | Total Hits | Avg Hits/Entry |
|-------|---------|------------|----------------|
| geocode_cache | 288 | 25,810 | 89.62 |
| distance_cache | 137 | 13,569 | 99.04 |
| google_places_cache | 10 | 4 | 0.40 |
| destination_activity_cache | 0 | 0 | N/A |
| destination_activity_bank | 0 | 0 | N/A |

**Key Finding:** Geocode and distance caches are highly effective but Places cache and Activity caches are underutilized.

### AI Usage Patterns

| Action | Calls | Avg Input Tokens | Avg Output Tokens | Cost |
|--------|-------|------------------|-------------------|------|
| answer_question | 51 | 854 | 291 | $0.043 |
| add_activity | 19 | 908 | 434 | $0.019 |
| replace_activity | 9 | 960 | 500 | $0.009 |
| regenerate_activity | 3 | 1,102 | 155 | $0.003 |

---

## Phase 1: Quick Wins (1 Day)

### 1.1 Increase Activity Bank Size
**File:** `/lib/activity-bank/index.ts`
**Change:** `ACTIVITIES_PER_TYPE = 5` → `ACTIVITIES_PER_TYPE = 10`
**Impact:** +30-40% cache hits, same API cost per destination
**Risk:** None - generates more data in same Gemini call
**LOC:** 1 line change

```typescript
// Line 43
const ACTIVITIES_PER_TYPE = 10; // Was 5
```

### 1.2 Increase Geocoding Batch Size
**File:** `/app/api/travel/geocode/route.ts`
**Change:** `BATCH_SIZE = 10` → `BATCH_SIZE = 25`
**Impact:** 60% fewer API calls for large batches
**Risk:** Low - Google supports up to 25 elements
**LOC:** 1 line change

```typescript
// Line 168
const BATCH_SIZE = 25; // Was 10
```

### 1.3 Extend Distance Matrix Cache TTL
**File:** `/app/api/travel/distance/route.ts`
**Change:** 30 days → 60 days
**Impact:** 10-15% fewer cache misses
**Risk:** None - travel times between fixed locations are stable
**LOC:** 1 line change

```typescript
// Line 424: expiresAt calculation
const expiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000); // 60 days
```

### 1.4 Reduce Coordinate Rounding Precision
**File:** `/app/api/travel/distance/route.ts`
**Change:** 5 decimals (~1.1m) → 4 decimals (~11m)
**Impact:** +15-20% cache hits for nearby locations
**Risk:** Minimal - 11m precision still accurate for travel
**LOC:** 2 line changes

```typescript
// Lines 50-52
function roundCoord(n: number): number {
  return Math.round(n * 10000) / 10000; // Was 100000
}
```

### 1.5 Extend Image Cache TTLs
**Files:**
- `/app/api/images/activity/route.ts` line 26
- `/app/api/images/destination/route.ts` line 22
**Change:** 48h → 7 days
**Impact:** Fewer Places API hits for image URLs
**Risk:** None - images rarely change
**LOC:** 2 line changes

---

## Phase 2: Code Factorization (1-2 Days)

### 2.1 Create API Response Wrapper
**New File:** `/lib/api/response-wrapper.ts`
**Impact:** -200-300 lines across 57 API routes
**Complexity:** Low

```typescript
import { NextResponse } from "next/server";

interface ApiResponseOptions {
  errorMessage?: string;
  includeTimestamp?: boolean;
}

export async function wrapApiResponse<T>(
  handler: () => Promise<T>,
  options: ApiResponseOptions = {}
): Promise<NextResponse> {
  const startTime = Date.now();

  try {
    const result = await handler();
    return NextResponse.json({
      data: result,
      meta: {
        responseTime: Date.now() - startTime,
        timestamp: options.includeTimestamp ? new Date().toISOString() : undefined,
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    let statusCode = 500;

    if (errorMessage.includes("rate limit")) statusCode = 429;
    if (errorMessage.includes("authentication")) statusCode = 401;
    if (errorMessage.includes("not found")) statusCode = 404;
    if (errorMessage.includes("invalid") || errorMessage.includes("required")) statusCode = 400;

    console.error(`[API Error] ${options.errorMessage || "Request failed"}:`, errorMessage);

    return NextResponse.json(
      { error: options.errorMessage || "Request failed", details: errorMessage },
      { status: statusCode }
    );
  }
}
```

### 2.2 Create Unified Cache Manager
**New File:** `/lib/cache/index.ts`
**Impact:** -150-200 lines of duplicate cache logic
**Complexity:** Low-Medium

```typescript
import { createClient } from "@/lib/supabase/server";
import crypto from "crypto";

export function generateCacheKey(
  input: string | Record<string, unknown>,
  options?: { type?: string; normalize?: boolean }
): string {
  const normalized = typeof input === "string"
    ? input.toLowerCase().trim().replace(/\s+/g, " ")
    : JSON.stringify(input);

  const prefix = options?.type ? `${options.type}:` : "";
  return crypto.createHash("md5").update(prefix + normalized).digest("hex");
}

export async function getCachedResult<T>(
  table: string,
  keyColumn: string,
  keyValue: string,
  additionalFilters?: Record<string, unknown>
): Promise<T | null> {
  const supabase = await createClient();

  let query = supabase
    .from(table)
    .select("*")
    .eq(keyColumn, keyValue)
    .gt("expires_at", new Date().toISOString());

  if (additionalFilters) {
    Object.entries(additionalFilters).forEach(([key, value]) => {
      query = query.eq(key, value);
    });
  }

  const { data, error } = await query.single();

  if (error || !data) return null;

  // Update hit count asynchronously
  supabase
    .from(table)
    .update({
      hit_count: (data.hit_count || 0) + 1,
      last_accessed_at: new Date().toISOString(),
    })
    .eq("id", data.id)
    .then(() => {});

  return data.data || data;
}

export async function saveCacheResult<T>(
  table: string,
  keyColumn: string,
  keyValue: string,
  data: T,
  durationDays: number,
  additionalFields?: Record<string, unknown>
): Promise<void> {
  const supabase = await createClient();
  const expiresAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000);

  await supabase.from(table).upsert({
    [keyColumn]: keyValue,
    data,
    expires_at: expiresAt.toISOString(),
    hit_count: 0,
    last_accessed_at: new Date().toISOString(),
    ...additionalFields,
  });
}
```

### 2.3 Create API Logging Factory
**New File:** `/lib/api/logging.ts`
**Impact:** -200-560 lines of duplicate logging code
**Complexity:** Low

```typescript
import { logApiCall } from "@/lib/api-gateway";

interface ApiCostConfig {
  baseCost: number;
  cacheHitCost?: number;
  errorCost?: number;
}

const API_COSTS: Record<string, ApiCostConfig> = {
  google_places_search: { baseCost: 0.032 },
  google_places_autocomplete: { baseCost: 0.00283 },
  google_places_details: { baseCost: 0.017 },
  google_geocoding: { baseCost: 0.005 },
  google_distance_matrix: { baseCost: 0.005 },
};

export function createApiLogger(apiName: string, endpoint: string) {
  const config = API_COSTS[apiName] || { baseCost: 0 };

  return async (options: {
    cacheHit?: boolean;
    status?: number;
    error?: string;
    responseTimeMs?: number;
    userId?: string;
  }) => {
    const { cacheHit = false, status = 200, error, responseTimeMs = 0, userId } = options;
    const costUsd = cacheHit || status >= 400 ? 0 : config.baseCost;

    await logApiCall({
      apiName,
      endpoint,
      status,
      responseTimeMs,
      cacheHit,
      costUsd,
      error,
      userId,
    });
  };
}
```

### 2.4 Extract Pricing Logic
**New File:** `/lib/utils/pricing.ts`
**Impact:** -140 lines from ActivityCard + EditableActivityCard
**Complexity:** Low

```typescript
export const PRICE_RANGES: Record<string, Record<number, { min: number; max: number }>> = {
  food: {
    0: { min: 0, max: 0 },
    1: { min: 5, max: 15 },
    2: { min: 15, max: 35 },
    3: { min: 35, max: 75 },
    4: { min: 75, max: 150 },
  },
  attraction: {
    0: { min: 0, max: 0 },
    1: { min: 0, max: 15 },
    2: { min: 15, max: 30 },
    3: { min: 30, max: 60 },
    4: { min: 60, max: 120 },
  },
  // ... other categories
};

export function convertPriceLevel(
  priceLevel: number | string | undefined,
  category: string,
  currency: string
): string {
  // Centralized conversion logic
}

export function formatCurrency(amount: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(amount);
}
```

---

## Phase 3: Component Optimization (4-6 Hours)

### 3.1 Create BaseModal Component
**New File:** `/components/ui/BaseModal.tsx`
**Impact:** -800 lines across 12 modal components, -35KB bundle
**Complexity:** Low

```typescript
"use client";

import { useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

interface BaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  title?: string;
  maxWidth?: "sm" | "md" | "lg" | "xl";
  showCloseButton?: boolean;
}

export default function BaseModal({
  isOpen,
  onClose,
  children,
  title,
  maxWidth = "md",
  showCloseButton = true,
}: BaseModalProps) {
  // Escape key handler
  const handleEscape = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") onClose();
  }, [onClose]);

  useEffect(() => {
    if (isOpen) {
      document.addEventListener("keydown", handleEscape);
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "";
    };
  }, [isOpen, handleEscape]);

  if (!isOpen) return null;

  const maxWidthClasses = {
    sm: "max-w-sm",
    md: "max-w-md",
    lg: "max-w-lg",
    xl: "max-w-xl",
  };

  const modalContent = (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />
      <div className="relative min-h-screen flex items-center justify-center p-4">
        <div
          className={`relative bg-white rounded-2xl shadow-xl ${maxWidthClasses[maxWidth]} w-full animate-scale-up`}
          onClick={(e) => e.stopPropagation()}
        >
          {showCloseButton && (
            <button
              onClick={onClose}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          )}
          {title && (
            <div className="px-6 pt-6 pb-2">
              <h2 className="text-xl font-semibold text-slate-900">{title}</h2>
            </div>
          )}
          <div className="p-6">{children}</div>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
```

### 3.2 Add React.memo to Activity Cards
**Files:**
- `/components/ActivityCard.tsx`
- `/components/trip/EditableActivityCard.tsx`
- `/components/trip/SortableActivityCard.tsx`

**Impact:** 40-60% CPU reduction during editing
**Complexity:** Low

```typescript
// Wrap exports with React.memo
export default React.memo(ActivityCard);
export default React.memo(EditableActivityCard);
export default React.memo(SortableActivityCard);
```

### 3.3 Create useFetch Hook
**New File:** `/lib/hooks/useFetch.ts`
**Impact:** -300 lines of duplicate fetch logic
**Complexity:** Low

```typescript
import { useState, useCallback } from "react";

interface UseFetchResult<T> {
  data: T | null;
  error: string | null;
  isLoading: boolean;
  fetch: () => Promise<void>;
  reset: () => void;
}

export function useFetch<T>(
  url: string,
  options?: RequestInit
): UseFetchResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(url, options);
      const json = await response.json();

      if (!response.ok) {
        throw new Error(json.error || `HTTP ${response.status}`);
      }

      setData(json.data || json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setIsLoading(false);
    }
  }, [url, options]);

  const reset = useCallback(() => {
    setData(null);
    setError(null);
    setIsLoading(false);
  }, []);

  return { data, error, isLoading, fetch: fetchData, reset };
}
```

### 3.4 Lazy Load Heavy Components
**Files:**
- `/components/trip/ExportMenu.tsx`
- `/components/trip/TripMap.tsx`

**Impact:** -200KB initial bundle, -300ms load time
**Complexity:** Medium

```typescript
// In TripDetailClient.tsx
const ExportMenu = dynamic(() => import("@/components/trip/ExportMenu"), {
  loading: () => <div className="animate-pulse bg-slate-200 h-10 w-24 rounded" />,
});

const TripMap = dynamic(() => import("@/components/trip/TripMap"), {
  loading: () => <div className="animate-pulse bg-slate-200 h-64 rounded-xl" />,
});
```

---

## Phase 4: Advanced Optimizations (Optional, 3-5 Days)

### 4.1 Create TripContext
**Impact:** Eliminate 50+ prop drilling locations
**Complexity:** Medium-High
**Files:** TripDetailClient.tsx + 8-10 child components

### 4.2 Implement Partial Itinerary Caching
**Impact:** Additional AI cost savings
**Complexity:** Medium
**Logic:** Reuse 7-day cache for 5-day requests

### 4.3 Response Streaming for Itinerary Generation
**Impact:** Faster perceived response
**Complexity:** Medium
**Technology:** `streamGenerateContent` API

### 4.4 Cache Hit Rate Monitoring Dashboard
**Impact:** Enable data-driven optimization
**Complexity:** Medium
**Location:** Admin dashboard new tab

---

## Implementation Checklist

### Phase 1 - Quick Wins (Day 1)
- [ ] Update ACTIVITIES_PER_TYPE: 5 → 10
- [ ] Update BATCH_SIZE: 10 → 25
- [ ] Update distance cache TTL: 30 → 60 days
- [ ] Update coordinate rounding: 5 → 4 decimals
- [ ] Update image cache TTL: 48h → 7 days
- [ ] Test all changes locally
- [ ] Deploy to production

### Phase 2 - Code Factorization (Days 2-3)
- [ ] Create `/lib/api/response-wrapper.ts`
- [ ] Create `/lib/cache/index.ts`
- [ ] Create `/lib/api/logging.ts`
- [ ] Create `/lib/utils/pricing.ts`
- [ ] Refactor 5 highest-impact API routes
- [ ] Test refactored routes
- [ ] Deploy to production

### Phase 3 - Component Optimization (Day 4)
- [ ] Create `/components/ui/BaseModal.tsx`
- [ ] Add CSS animation to globals.css
- [ ] Refactor ShareModal to use BaseModal
- [ ] Refactor ReferralModal to use BaseModal
- [ ] Add React.memo to activity cards
- [ ] Create `/lib/hooks/useFetch.ts`
- [ ] Add dynamic imports for ExportMenu/TripMap
- [ ] Test all modal functionality
- [ ] Deploy to production

---

## Dependency Map

```
Phase 1 (No Dependencies)
├── Activity Bank size ─────────► Can deploy immediately
├── Geocoding batch size ───────► Can deploy immediately
├── Distance cache TTL ─────────► Can deploy immediately
├── Coordinate rounding ────────► Can deploy immediately
└── Image cache TTL ────────────► Can deploy immediately

Phase 2 (Sequential)
├── response-wrapper.ts ────────► Required before refactoring routes
├── cache/index.ts ─────────────► Required before cache consolidation
├── logging.ts ─────────────────► Required before logging refactor
└── pricing.ts ─────────────────► Required before card refactor

Phase 3 (Sequential)
├── BaseModal.tsx ──────────────► Required before modal refactors
├── globals.css animations ─────► Required for BaseModal
├── React.memo ─────────────────► Independent, can do anytime
├── useFetch.ts ────────────────► Independent, can do anytime
└── Dynamic imports ────────────► Independent, can do anytime
```

---

## Risk Assessment

| Change | Risk Level | Rollback Plan |
|--------|------------|---------------|
| Activity Bank size | None | Revert constant |
| Batch sizes | Low | Revert constant |
| Cache TTLs | None | Revert constant |
| Response wrapper | Low | Keep both patterns temporarily |
| BaseModal | Low | Keep old modals as fallback |
| React.memo | None | Remove memo wrapper |
| Dynamic imports | Low | Revert to static imports |

---

## Success Metrics

### Before Optimization
- API cost: ~$X/month
- Bundle size: ~YKB
- Page load: ~Zms
- CPU during edit: ~W%

### After Optimization (Target)
- API cost: -40-60% reduction
- Bundle size: -200KB
- Page load: -500ms
- CPU during edit: -40-60%

### Monitoring
1. Track `api_request_logs` cost trends
2. Track cache hit rates via existing hit_count columns
3. Monitor Vercel Analytics for bundle size
4. Use React DevTools Profiler for render counts

---

## Notes

- All changes are backwards compatible
- No database migrations required
- No breaking changes to API contracts
- All optimizations can be deployed incrementally
- Each phase can be tested independently

---

*Generated: December 19, 2025*
*Last Updated: December 19, 2025*
