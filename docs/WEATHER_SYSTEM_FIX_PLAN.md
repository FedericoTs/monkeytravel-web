# Weather System Fix Plan

## Executive Summary

The weather system in MonkeyTravel has **critical inconsistencies** that result in incorrect weather data being displayed to users. This document details the root causes and provides a comprehensive implementation plan to fix them.

---

## Current State Analysis

### Architecture Overview

The app currently has **two disconnected weather systems**:

#### System 1: Static Seasonal Library (`lib/seasonal/index.ts`)
**Used in:** Trip creation (Step 2 - `SeasonalContextCard.tsx`)

- `buildSeasonalContext(destination, startDate, latitude?)` generates weather data
- **Critical Bug:** Latitude parameter is NEVER passed from the UI
- Defaults to "northern" hemisphere for ALL destinations
- Returns hardcoded seasonal descriptions based on month only

#### System 2: AI-Generated Weather (`lib/gemini.ts`)
**Used in:** Trip detail page (via `weather_note` in itinerary)

- Gemini AI generates a `weather_note` string
- Receives potentially incorrect `seasonalContext` from System 1
- Can produce different weather than what was shown during creation

---

## Root Causes of Inconsistency

### 1. Hemisphere Bug (CRITICAL)

**Location:** `app/trips/new/page.tsx:101`
```typescript
const context = buildSeasonalContext(destination, startDate);
// ❌ No latitude passed! Defaults to "northern" hemisphere
```

**Impact:**
- Sydney in December shows "Winter" (0-10°C) instead of Summer (25-35°C)
- Buenos Aires, Cape Town, Auckland - all get inverted seasons
- Any Southern Hemisphere destination has completely wrong weather

### 2. No Geocoding Integration

**Current Flow:**
```
User selects destination → DestinationAutocomplete returns text only → No coordinates available
```

**Problem:**
- `DestinationAutocomplete` returns: `placeId`, `mainText`, `secondaryText`, `fullText`
- Does NOT fetch or return coordinates
- We have `/api/places` that CAN return `location: { latitude, longitude }` but it's not used

### 3. Two Different Data Sources

| Page | Data Source | Weather Info |
|------|-------------|--------------|
| Trip Creation (Step 2) | `lib/seasonal/index.ts` | Hardcoded seasonal estimates |
| Trip Detail | AI-generated `weather_note` | Gemini-generated text |

These two sources can produce **conflicting information**, confusing users.

### 4. No Real Weather API

All weather data is either:
- Hardcoded seasonal estimates (inaccurate for specific destinations)
- AI-generated (can hallucinate or be inconsistent)

No integration with actual weather services (OpenWeatherMap, WeatherAPI, etc.)

---

## Solution Implementation Plan

### Phase 1: Fix Hemisphere Bug (Quick Win)

**Goal:** Ensure Southern Hemisphere destinations show correct seasons.

#### Step 1.1: Enhance Autocomplete to Fetch Coordinates

**File:** `components/ui/DestinationAutocomplete.tsx`

Add a function to fetch place details including coordinates when user selects a destination:

```typescript
// After user selects a prediction
const handleSelect = useCallback(async (prediction: PlacePrediction) => {
  onChange(prediction.fullText);

  // Fetch coordinates using the placeId
  const details = await fetchPlaceDetails(prediction.placeId);
  onSelect?.({
    ...prediction,
    coordinates: details?.location
  });

  // ... rest of existing code
}, [onChange, onSelect]);
```

#### Step 1.2: Create Place Details API

**File:** `app/api/places/details/route.ts` (NEW)

```typescript
// Fetch place details including coordinates
export async function GET(request: NextRequest) {
  const placeId = searchParams.get("placeId");
  // Use Google Places Details API to get coordinates
  // Return { latitude, longitude }
}
```

#### Step 1.3: Update Trip Creation Page

**File:** `app/trips/new/page.tsx`

```typescript
const [destinationCoords, setDestinationCoords] = useState<{lat: number, lng: number} | null>(null);

// Update useEffect
useEffect(() => {
  if (destination && startDate) {
    const context = buildSeasonalContext(
      destination,
      startDate,
      destinationCoords?.lat  // ✅ Pass latitude!
    );
    setSeasonalContext(context);
  }
}, [destination, startDate, destinationCoords]);
```

### Phase 2: Integrate Real Weather API

**Goal:** Provide accurate, real weather forecasts instead of generic seasonal estimates.

#### Step 2.1: Choose Weather API

**Recommended:** WeatherAPI.com
- Free tier: 1M calls/month
- Supports historical data, forecasts, and climate averages
- Good coverage for travel destinations

**Alternative:** OpenWeatherMap
- Free tier: 1000 calls/day
- Climate API for future dates

#### Step 2.2: Create Weather API Endpoint

**File:** `app/api/weather/route.ts` (NEW)

```typescript
export async function GET(request: NextRequest) {
  const { lat, lng, date } = getParams(request);

  const daysUntilTrip = daysBetween(new Date(), new Date(date));

  if (daysUntilTrip <= 14) {
    // Use forecast API for near-term dates
    return await fetchForecast(lat, lng, date);
  } else {
    // Use historical/climate averages for far-future dates
    return await fetchClimateAverages(lat, lng, getMonthDay(date));
  }
}
```

#### Step 2.3: Update SeasonalContextCard

**File:** `components/trip/SeasonalContextCard.tsx`

```typescript
// Replace static buildSeasonalContext with real API call
useEffect(() => {
  const fetchWeather = async () => {
    if (!coordinates || !startDate) return;

    const response = await fetch(
      `/api/weather?lat=${coordinates.lat}&lng=${coordinates.lng}&date=${startDate}`
    );
    const weatherData = await response.json();

    // Merge real weather with seasonal context
    setSeasonalContext({
      ...buildSeasonalContext(destination, startDate, coordinates.lat),
      weather: weatherData.description,
      avgTemp: weatherData.temp,
    });
  };

  fetchWeather();
}, [coordinates, startDate, destination]);
```

### Phase 3: Unify Weather Display

**Goal:** Ensure consistent weather information across all pages.

#### Step 3.1: Pass Real Weather to AI Prompt

**File:** `lib/gemini.ts`

Enhance the prompt to include accurate weather data:

```typescript
const seasonalSection = params.seasonalContext
  ? `## Weather Context (VERIFIED DATA - USE THIS)
- Temperature: ${params.seasonalContext.avgTemp.min}°C to ${params.seasonalContext.avgTemp.max}°C
- Conditions: ${params.seasonalContext.weather}
- Season: ${params.seasonalContext.season}
- Hemisphere: ${params.seasonalContext.hemisphere}

IMPORTANT: Use this verified weather data in your weather_note. Do not invent different weather.`
  : "";
```

#### Step 3.2: Store Weather in Trip Meta

**File:** `app/trips/new/page.tsx`

When saving trip, include the verified weather data:

```typescript
const tripMeta = {
  weather_note: seasonalContext?.weather, // Use our verified data
  weather_source: "verified", // Mark as verified
  // ... other meta
};
```

#### Step 3.3: Update DestinationHero to Use Trip Meta

**File:** `components/DestinationHero.tsx`

Prefer stored weather data over AI-generated when available:

```typescript
// In parseWeatherNote, add verification source check
const weatherNote = trip.trip_meta?.weather_source === "verified"
  ? trip.trip_meta.weather_note
  : fallbackWeatherNote;
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `components/ui/DestinationAutocomplete.tsx` | Add coordinate fetching on selection |
| `app/api/places/details/route.ts` | NEW - Fetch place details with coords |
| `app/api/weather/route.ts` | NEW - Real weather API integration |
| `app/trips/new/page.tsx` | Store coords, pass to seasonal context |
| `components/trip/SeasonalContextCard.tsx` | Use real weather API |
| `lib/seasonal/index.ts` | Improve fallback logic |
| `lib/gemini.ts` | Use verified weather in prompt |
| `types/index.ts` | Add coordinates to autocomplete types |

---

## Environment Variables Needed

```bash
# Choose one:
WEATHER_API_KEY=your-weatherapi-com-key
# OR
OPENWEATHER_API_KEY=your-openweathermap-key
```

---

## Testing Checklist

### Hemisphere Test Cases
- [ ] Paris (48.8°N) in January → Should show Winter
- [ ] Sydney (-33.8°S) in January → Should show Summer
- [ ] Tokyo (35.6°N) in July → Should show Summer
- [ ] Buenos Aires (-34.6°S) in July → Should show Winter
- [ ] Singapore (1.3°N, tropical) → Should show appropriate tropical season

### Weather Consistency Tests
- [ ] Weather shown in Step 2 matches what appears in generated itinerary
- [ ] Weather on trip detail page matches creation weather
- [ ] Temperature ranges are realistic for the destination

### Edge Cases
- [ ] Trip dates > 14 days in future (should use climate averages)
- [ ] Destination not found (should fall back gracefully)
- [ ] API rate limits (should have fallback to static seasonal)

---

## Rollback Plan

If issues arise:
1. Revert to static seasonal data by removing weather API calls
2. Keep coordinate fetching for hemisphere accuracy
3. The `buildSeasonalContext` function still works as fallback

---

## Success Criteria

1. Southern Hemisphere destinations show correct seasons
2. Weather data is consistent across creation and detail pages
3. Temperature ranges are realistic for specific destinations
4. No hardcoded wrong-hemisphere defaults
5. Graceful fallback when weather API is unavailable
