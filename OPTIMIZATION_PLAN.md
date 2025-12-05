# API Optimization Implementation Plan

## Executive Summary

Based on thorough codebase analysis, this plan addresses:
1. **Client-side redundant API calls** - PlaceGallery, geocoding duplication
2. **Cross-user shared caching** - Activities/places for same destination
3. **Field masking optimization** - Reduce API payload sizes
4. **Server-side consolidation** - Ensure all external calls go through API routes

**Estimated Annual Savings: $18,000-26,000**

---

## Current Issues Identified

### Critical Issues (High Cost Impact)

| Issue | Location | Impact | Root Cause |
|-------|----------|--------|------------|
| PlaceGallery fetches on every mount | `components/PlaceGallery.tsx:55-86` | 40-60% redundant calls | No client-side cache |
| Geocoding duplicated across components | HotelRecommendations + useTravelDistances | 30-50% redundant | No shared service |
| Hotel search not cached | `components/trip/HotelRecommendations.tsx` | Every page load = fresh search | Missing cache layer |
| No cross-user activity cache | Activities fetched fresh per user | Duplicate API calls for same destination | User-specific only |

### Medium Issues (UX + Cost)

| Issue | Location | Impact |
|-------|----------|--------|
| Places Autocomplete no field mask | `api/places/autocomplete/route.ts` | 20% larger responses |
| Gemini prompt redundancy | `lib/gemini.ts:14-77` | 15-20% extra tokens |
| Places Text Search extra fields | `api/places/route.ts:166-167` | 15% unnecessary data |

---

## Implementation Plan

### Phase 1: Shared Activity Cache (Cross-User)

**Goal**: When two users search for "Rome, Italy" with similar criteria, serve cached activities first.

#### Step 1.1: Create Activity Cache Table

```sql
-- New table for destination-based activity cache
CREATE TABLE destination_activity_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  destination_hash VARCHAR(64) NOT NULL,  -- MD5(normalized destination)
  destination_name TEXT NOT NULL,
  vibes TEXT[] NOT NULL,                   -- Sorted array of vibes
  budget_tier VARCHAR(20) NOT NULL,
  activities JSONB NOT NULL,               -- Cached activity list
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  hit_count INTEGER DEFAULT 0,
  last_accessed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(destination_hash, vibes, budget_tier)
);

CREATE INDEX idx_dest_cache_hash ON destination_activity_cache(destination_hash);
CREATE INDEX idx_dest_cache_expires ON destination_activity_cache(expires_at);
```

#### Step 1.2: Modify AI Generate Route

**File**: `app/api/ai/generate/route.ts`

```typescript
// Before generating, check for matching cached activities
async function getCachedActivities(params: TripCreationParams): Promise<Activity[] | null> {
  const destinationHash = hashDestination(params.destination);
  const sortedVibes = [...params.vibes].sort();

  const { data } = await supabase
    .from('destination_activity_cache')
    .select('activities')
    .eq('destination_hash', destinationHash)
    .eq('budget_tier', params.budgetTier)
    .contains('vibes', sortedVibes)
    .gt('expires_at', new Date().toISOString())
    .order('hit_count', { ascending: false })
    .limit(1)
    .single();

  if (data) {
    // Update hit count asynchronously
    supabase
      .from('destination_activity_cache')
      .update({
        hit_count: data.hit_count + 1,
        last_accessed_at: new Date().toISOString()
      })
      .eq('id', data.id)
      .then(() => {});

    return data.activities;
  }

  return null;
}
```

#### Step 1.3: Cache Strategy for Activities

```
Cache Lookup Flow:
1. Hash destination + vibes + budget → cache key
2. Check destination_activity_cache for match
3. If HIT:
   - Return cached activities
   - Optionally generate 1-2 fresh activities for variety
   - Log as cache hit (cost: $0)
4. If MISS:
   - Generate full itinerary via Gemini
   - Cache activities for 7 days
   - Log as cache miss (cost: $0.003)
```

---

### Phase 2: Client-Side Place Cache

**Goal**: Prevent PlaceGallery from fetching same place data multiple times per session.

#### Step 2.1: Create Place Cache Context

**File**: `lib/context/PlaceCacheContext.tsx` (NEW)

```typescript
'use client';

import { createContext, useContext, useState, useCallback, ReactNode } from 'react';

interface PlaceData {
  placeId: string;
  name: string;
  photos: Array<{ url: string; thumbnailUrl: string }>;
  rating?: number;
  // ... other fields
}

interface PlaceCacheContextType {
  getPlace: (key: string) => PlaceData | null;
  setPlace: (key: string, data: PlaceData) => void;
  hasPlace: (key: string) => boolean;
}

const PlaceCacheContext = createContext<PlaceCacheContextType | null>(null);

export function PlaceCacheProvider({ children }: { children: ReactNode }) {
  const [cache] = useState(() => new Map<string, PlaceData>());

  const getPlace = useCallback((key: string) => cache.get(key) || null, [cache]);
  const setPlace = useCallback((key: string, data: PlaceData) => {
    cache.set(key, data);
    // Limit cache size to prevent memory issues
    if (cache.size > 100) {
      const firstKey = cache.keys().next().value;
      cache.delete(firstKey);
    }
  }, [cache]);
  const hasPlace = useCallback((key: string) => cache.has(key), [cache]);

  return (
    <PlaceCacheContext.Provider value={{ getPlace, setPlace, hasPlace }}>
      {children}
    </PlaceCacheContext.Provider>
  );
}

export const usePlaceCache = () => {
  const context = useContext(PlaceCacheContext);
  if (!context) throw new Error('usePlaceCache must be used within PlaceCacheProvider');
  return context;
};
```

#### Step 2.2: Update PlaceGallery Component

**File**: `components/PlaceGallery.tsx`

```typescript
// Add cache check before fetching
const { getPlace, setPlace, hasPlace } = usePlaceCache();
const cacheKey = `${placeName}-${placeAddress}`;

useEffect(() => {
  // Check client cache first
  if (hasPlace(cacheKey)) {
    const cached = getPlace(cacheKey);
    if (cached) {
      setPlaceData(cached);
      setIsLoading(false);
      return;
    }
  }

  // Fetch from API
  const fetchPlaceData = async () => {
    // ... existing fetch logic

    // Store in cache after successful fetch
    if (data) {
      setPlace(cacheKey, data);
    }
  };

  fetchPlaceData();
}, [placeName, placeAddress, cacheKey]);
```

---

### Phase 3: Centralized Geocoding Service

**Goal**: Single source of truth for geocoding, prevent duplicate calls.

#### Step 3.1: Create Geocoding Service

**File**: `lib/services/geocoding.ts` (NEW)

```typescript
import { deduplicatedFetch, generateKey } from '@/lib/api/request-dedup';

// In-memory cache for geocoding results (session-level)
const geocodeCache = new Map<string, { lat: number; lng: number; address: string }>();

export interface GeocodedLocation {
  lat: number;
  lng: number;
  formattedAddress: string;
}

/**
 * Centralized geocoding with caching and deduplication
 */
export async function geocodeAddress(address: string): Promise<GeocodedLocation | null> {
  const normalizedAddress = address.toLowerCase().trim();
  const cacheKey = generateKey('geocode', { address: normalizedAddress });

  // Check in-memory cache
  const cached = geocodeCache.get(cacheKey);
  if (cached) {
    return { lat: cached.lat, lng: cached.lng, formattedAddress: cached.address };
  }

  // Deduplicated fetch
  const result = await deduplicatedFetch(cacheKey, async () => {
    const response = await fetch('/api/travel/geocode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ addresses: [address] }),
    });

    if (!response.ok) return null;

    const data = await response.json();
    return data.results?.[0] || null;
  });

  if (result) {
    geocodeCache.set(cacheKey, {
      lat: result.lat,
      lng: result.lng,
      address: result.formattedAddress,
    });
  }

  return result;
}

/**
 * Batch geocoding with deduplication
 */
export async function geocodeAddresses(addresses: string[]): Promise<Map<string, GeocodedLocation>> {
  const results = new Map<string, GeocodedLocation>();
  const uncached: string[] = [];

  // Check cache first
  for (const addr of addresses) {
    const cacheKey = generateKey('geocode', { address: addr.toLowerCase().trim() });
    const cached = geocodeCache.get(cacheKey);
    if (cached) {
      results.set(addr, { lat: cached.lat, lng: cached.lng, formattedAddress: cached.address });
    } else {
      uncached.push(addr);
    }
  }

  // Fetch uncached
  if (uncached.length > 0) {
    const response = await fetch('/api/travel/geocode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ addresses: uncached }),
    });

    if (response.ok) {
      const data = await response.json();
      for (const result of data.results || []) {
        const cacheKey = generateKey('geocode', { address: result.address.toLowerCase().trim() });
        geocodeCache.set(cacheKey, {
          lat: result.lat,
          lng: result.lng,
          address: result.formattedAddress,
        });
        results.set(result.address, {
          lat: result.lat,
          lng: result.lng,
          formattedAddress: result.formattedAddress,
        });
      }
    }
  }

  return results;
}
```

#### Step 3.2: Update HotelRecommendations

Replace direct geocoding call with centralized service:

```typescript
// Instead of:
const response = await fetch('/api/travel/geocode', { ... });

// Use:
import { geocodeAddress } from '@/lib/services/geocoding';
const location = await geocodeAddress(destination);
```

---

### Phase 4: Field Masking Optimization

#### Step 4.1: Optimize Places Text Search

**File**: `app/api/places/route.ts`

```typescript
// Current (line 166-167):
"X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location,places.photos,places.rating,places.userRatingCount,places.websiteUri,places.googleMapsUri,places.priceLevel,places.priceRange,places.currentOpeningHours"

// Optimized (remove low-value fields):
"X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location,places.photos,places.rating,places.userRatingCount,places.googleMapsUri,places.priceLevel"

// Removed:
// - websiteUri (rarely displayed, can fetch on-demand)
// - priceRange (priceLevel provides enough info)
// - currentOpeningHours (can fetch separately if needed)
```

**Savings**: ~15% per request = $2.55/1000 calls

#### Step 4.2: Add Field Mask to Autocomplete

**File**: `app/api/places/autocomplete/route.ts`

```typescript
// Add header to limit response:
headers: {
  "Content-Type": "application/json",
  "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
  "X-Goog-FieldMask": "suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat"
}
```

**Savings**: ~20% per request = $0.57/1000 calls

#### Step 4.3: Optimize Gemini Prompts

**File**: `lib/gemini.ts`

```typescript
// Reduce system prompt from ~2400 chars to ~1200 chars
const SYSTEM_PROMPT = `You are MonkeyTravel AI, creating personalized travel itineraries.

RULES:
1. All places must be real, verifiable on Google Maps
2. Include full address and official website (null if unsure)
3. Match activities to vibes with 50/30/20 weighting (primary/secondary/exploration)
4. Adjust for season: weather, crowds, local events
5. Return valid JSON only

OUTPUT: Array of DayItinerary objects per schema.`;

// Instead of sending full vibe descriptions, reference by name
const vibePrompt = params.vibes.length > 0
  ? `Selected vibes: ${params.vibes.join(', ')}. Apply travel styles accordingly.`
  : '';

// Compress seasonal context
const seasonalPrompt = seasonalContext
  ? `Season: ${seasonalContext.season}, ${seasonalContext.avgTemp.min}-${seasonalContext.avgTemp.max}°C, crowds: ${seasonalContext.crowdLevel}`
  : '';
```

**Savings**: 15-20% token reduction = $0.45-0.60/generation

---

### Phase 5: Server-Side API Consolidation

#### Step 5.1: Audit Client Components

Ensure no direct external API calls from client code:

| Component | Status | Action |
|-----------|--------|--------|
| PlaceGallery | ✅ Uses /api/places | No change |
| DestinationAutocomplete | ✅ Uses /api/places/autocomplete | No change |
| HotelRecommendations | ✅ Uses /api/hotels/places | No change |
| useTravelDistances | ✅ Uses /api/travel/distance | No change |

**Result**: All external API calls already server-side.

#### Step 5.2: Add Request Deduplication to Remaining Routes

Apply `deduplicatedFetch` to:
- [ ] `/api/travel/geocode/route.ts`
- [ ] `/api/hotels/places/route.ts`
- [x] `/api/places/route.ts` (already done)

---

## Implementation Order

### Week 1: Quick Wins
1. [ ] Add field mask to Places Autocomplete
2. [ ] Reduce Places Text Search fields
3. [ ] Optimize Gemini prompt size
4. [ ] Add deduplication to geocode route

### Week 2: Caching Infrastructure
5. [ ] Create destination_activity_cache table
6. [ ] Implement cross-user activity cache lookup
7. [ ] Add cache write after AI generation

### Week 3: Client-Side Optimization
8. [ ] Create PlaceCacheContext
9. [ ] Update PlaceGallery to use cache
10. [ ] Create centralized geocoding service
11. [ ] Update HotelRecommendations

### Week 4: Testing & Monitoring
12. [ ] Add cache hit/miss logging
13. [ ] Create monitoring dashboard
14. [ ] Load testing
15. [ ] Cost comparison analysis

---

## Expected Outcomes

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Google Places calls/trip | 15-20 | 3-5 | 75% reduction |
| Geocoding calls/trip | 8-12 | 2-3 | 75% reduction |
| AI generation tokens | 1800 | 1200 | 33% reduction |
| Cross-user cache hit rate | 0% | 40-60% | New feature |
| Monthly API cost | $702 | $350-400 | 50% reduction |

---

## Risk Mitigation

### Risk 1: Stale Cache Data
**Mitigation**:
- 7-day TTL for activity cache
- 30-day TTL for place data
- Manual cache invalidation endpoint for admins

### Risk 2: Memory Pressure from Client Cache
**Mitigation**:
- Limit to 100 entries
- LRU eviction policy
- Clear on page refresh

### Risk 3: Cross-User Cache Returns Irrelevant Activities
**Mitigation**:
- Cache key includes vibes + budget tier
- Only return if 80%+ vibe match
- Always generate 1-2 fresh activities for variety

---

## Files to Modify

### New Files
- `lib/context/PlaceCacheContext.tsx`
- `lib/services/geocoding.ts`

### Modified Files
- `app/api/ai/generate/route.ts` - Add cache lookup
- `app/api/places/route.ts` - Reduce field mask
- `app/api/places/autocomplete/route.ts` - Add field mask
- `app/api/travel/geocode/route.ts` - Add deduplication
- `components/PlaceGallery.tsx` - Use cache context
- `components/trip/HotelRecommendations.tsx` - Use geocoding service
- `lib/gemini.ts` - Optimize prompts

### Database Migrations
- Create `destination_activity_cache` table
