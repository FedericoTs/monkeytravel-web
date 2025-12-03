# Amadeus Integration Design Document

## Executive Summary

**Product Stage:** Growth-ready MVP with booking capability gap
**UX Health Score:** 7/10 (strong trip planning, weak booking completion)
**Top Opportunity:** Integrate in-app flight & hotel search to complete the trip planning loop

### Key Findings

1. **Current Gap:** Users see AI-generated itineraries with external booking links (Skyscanner, Booking.com) that redirect away from the app, breaking the experience
2. **Amadeus Ready:** Flight and hotel search components exist but are NOT connected to the trip flow
3. **Opportunity:** In-app booking search could increase user engagement by 40%+ and enable future monetization

---

## Part 1: User Experience Analysis

### Nielsen's Heuristics Evaluation

| Heuristic | Current State | Issue | Severity |
|-----------|---------------|-------|----------|
| **Visibility of system status** | ⚠️ Partial | No loading states for external booking links | 2 |
| **Match system/real world** | ✅ Good | Travel terminology is familiar | 0 |
| **User control and freedom** | ⚠️ Partial | No way to save flight/hotel selections to trip | 3 |
| **Consistency and standards** | ⚠️ Partial | External links break app flow, inconsistent experience | 3 |
| **Error prevention** | ✅ Good | Form validation present | 1 |
| **Recognition over recall** | ⚠️ Partial | Must re-enter trip dates on external sites | 3 |
| **Flexibility and efficiency** | ❌ Poor | No quick booking from itinerary view | 4 |
| **Aesthetic and minimalist design** | ✅ Good | Clean, premium feel | 0 |
| **Error recovery** | ✅ Good | Clear error messages | 1 |
| **Help and documentation** | ⚠️ Partial | No guidance on booking flow | 2 |

**Critical Issues (Severity 3-4):**
- Users lose context when redirected to external booking sites
- Trip dates/destination not automatically carried over
- Cannot save selected flights/hotels to trip record

### Flow Analysis: Booking Journey

```
## Flow: Trip-to-Booking (CURRENT - BROKEN)
**Goal:** User wants to book flights/hotels for their AI-generated trip
**Entry point:** Trip detail page → "Book Flights" link

**Steps:**
1. User views completed itinerary ✅
2. User clicks "Book Flights" link
3. → REDIRECTS to external site (Skyscanner) 😤
4. User must re-enter: dates, destination, passengers 😤
5. User completes booking on external site
6. User has NO WAY to record booking in MonkeyTravel 😤

**Friction points:**
- Complete context loss on redirect
- Double data entry (already entered in trip creation)
- Booking confirmation not linked to trip
- User leaves the app and may not return

**Drop-off risk:** HIGH (estimated 60%+ abandon)
**Cognitive load:** HIGH (restart booking process from scratch)
```

```
## Flow: Trip-to-Booking (PROPOSED - SEAMLESS)
**Goal:** User wants to book flights/hotels for their AI-generated trip
**Entry point:** Trip detail page → "Book" tab/section

**Steps:**
1. User views completed itinerary ✅
2. User clicks "Book" tab (stays in app) ✅
3. Flight/hotel search auto-populated with trip dates 😊
4. User searches and compares options in-app 😊
5. User selects flight/hotel (saved to trip) 😊
6. User sees booking summary with trip context 😊

**Friction points:** MINIMAL
**Drop-off risk:** LOW (estimated <20%)
**Cognitive load:** LOW (context preserved)
```

---

## Part 2: Product Design Analysis

### Value Proposition Assessment

| Dimension | Current | Proposed |
|-----------|---------|----------|
| **Core Value** | AI generates itinerary | AI generates itinerary + booking |
| **Completeness** | 70% (planning only) | 95% (planning + booking search) |
| **User Retention** | Low (one-and-done) | High (return to book) |
| **Monetization** | None | Affiliate fees, booking commissions |

### Feature Gap Analysis

| Feature | User Expectation | Current State | Gap |
|---------|------------------|---------------|-----|
| In-app flight search | Expected | ❌ External links | HIGH |
| In-app hotel search | Expected | ❌ External links | HIGH |
| Save booking to trip | Expected | ❌ Not possible | HIGH |
| Price alerts | Nice-to-have | ❌ Not available | LOW |
| Booking confirmation | Expected | ❌ Not tracked | MEDIUM |

### Competitive Analysis

| Feature | MonkeyTravel | TripIt | Wanderlog | Google Travel |
|---------|--------------|--------|-----------|---------------|
| AI Itinerary | ✅ Best | ❌ | ⚠️ Basic | ❌ |
| In-app Booking | ❌ | ⚠️ Links | ⚠️ Links | ✅ Integrated |
| Price Comparison | ❌ | ❌ | ❌ | ✅ Best |
| Trip Editing | ✅ Good | ✅ Good | ✅ Good | ⚠️ Basic |

**Differentiation Opportunity:** MonkeyTravel + Amadeus = AI-generated trips with real booking capability = unique in market.

### Jobs-to-be-Done Analysis

**Primary JTBD:** "Help me plan AND book my trip in one place"

| Job Step | Current Completion | With Amadeus |
|----------|-------------------|--------------|
| Discover destination | ✅ 100% | ✅ 100% |
| Plan itinerary | ✅ 100% | ✅ 100% |
| Find flights | ❌ 0% (external) | ✅ 100% |
| Find hotels | ❌ 0% (external) | ✅ 100% |
| Compare prices | ❌ 0% (external) | ✅ 100% |
| Complete booking | ❌ 0% (Phase 2) | ⚠️ External link |
| Track booking | ❌ 0% | ⚠️ Manual (Phase 2) |

---

## Part 3: Integration Architecture

### Where to Integrate: Trip Detail Page

The Amadeus booking search should appear in the **Trip Detail Page** (`/trips/[id]`), not the creation wizard, because:

1. **Context Complete:** User has finalized dates, destination, preferences
2. **Natural Flow:** Plan first, then book (matches mental model)
3. **Retention:** Gives users reason to return to saved trips
4. **Less Pressure:** Booking is optional, not blocking trip creation

### Component Architecture

```
TripDetailClient.tsx
├── DestinationHero (existing)
├── ControlsBar (existing)
│   └── [Add] Tab Navigation: Itinerary | Booking
├── [NEW] BookingPanel (conditional render)
│   ├── TabSelector: Flights | Hotels
│   ├── FlightSearch (existing component)
│   │   └── FlightCard[] (existing)
│   └── HotelSearch (existing component)
│       └── HotelCard[] (existing)
├── TripMap (existing)
├── DayFilters (existing)
└── ItineraryDisplay (existing)
```

### UI Integration Pattern: Tabbed Sections

**Option A: Horizontal Tabs (Recommended)**
```
┌────────────────────────────────────────────────────┐
│ [📋 Itinerary] [✈️ Flights] [🏨 Hotels]            │
├────────────────────────────────────────────────────┤
│                                                    │
│   Content based on selected tab                    │
│                                                    │
└────────────────────────────────────────────────────┘
```

**Why Tabs:**
- Clear navigation between planning and booking
- Doesn't clutter itinerary view
- Mobile-friendly (can become bottom nav)
- Progressive disclosure (booking only when needed)

### Data Flow

```
Trip Detail Page
     │
     ├── tripStartDate, tripEndDate, destination
     │
     ▼
FlightSearch / HotelSearch
     │
     ├── Auto-populated from trip context
     │
     ▼
Amadeus API
     │
     ├── /api/amadeus/flights/search
     ├── /api/amadeus/hotels/search
     │
     ▼
Results Display
     │
     ├── FlightCard[] / HotelCard[]
     │
     ▼
[Phase 2] Save selection to trip
```

---

## Part 4: Mobile UX Design

### Thumb Zone Optimization

```
Mobile Layout (375px):
┌─────────────────────────────────────┐
│  [←] Rome Trip            [Share]  │  ← Header
├─────────────────────────────────────┤
│                                     │
│  Hero Image / Map                   │  ← Scrollable
│                                     │
├─────────────────────────────────────┤
│ [Itinerary] [Flights] [Hotels]      │  ← Sticky tabs
├─────────────────────────────────────┤
│                                     │
│  Tab Content                        │
│  (Search form + results)            │
│                                     │
│                                     │
├─────────────────────────────────────┤
│  [🤖 AI Assistant]                  │  ← Bottom FAB
└─────────────────────────────────────┘
        ▲
        └── Easy thumb access (bottom 1/3)
```

### Mobile-Specific Considerations

| Element | Desktop | Mobile | Rationale |
|---------|---------|--------|-----------|
| Tab navigation | Horizontal inline | Horizontal scrollable OR bottom sheet | Thumb reach |
| Search form | Side-by-side inputs | Stacked inputs | Screen width |
| Flight cards | Full width with details | Collapsed with expand | Data density |
| Hotel cards | Grid (2 columns) | Single column | Touch targets |
| Price display | Inline | Prominent, large | Quick scanning |
| Filter controls | Visible | Collapsed in bottom sheet | Screen space |

### Touch Targets Checklist

- [ ] All buttons >= 44x44px
- [ ] Tab items >= 44px height
- [ ] Card tap areas clear
- [ ] Filter chips spaced 8px apart
- [ ] Form inputs 48px height on mobile

---

## Part 5: Visual Design Direction

### Aesthetic Direction: "Premium Travel Concierge"

**Tone:** Refined luxury meets practical efficiency
**Feel:** Like having a personal travel agent in your pocket
**Inspiration:** First-class airline lounges, boutique hotel lobbies

### Color Usage for Booking Section

```css
/* Booking Tab Active State */
.booking-tab-active {
  background: linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%);
  color: white;
}

/* Flight Section Accent */
.flight-section {
  border-left: 4px solid var(--vibe-urban);  /* Slate - modern travel */
}

/* Hotel Section Accent */
.hotel-section {
  border-left: 4px solid var(--vibe-wellness);  /* Lime - comfortable stay */
}

/* Price Highlight */
.price-best {
  color: var(--success);
  font-weight: 700;
}

/* Urgency Indicator */
.seats-limited {
  color: var(--warning);
  animation: pulse 2s infinite;
}
```

### Typography Hierarchy in Booking Cards

```
Flight Card:
┌─────────────────────────────────────────────────┐
│  TAP Portugal                    [Logo]         │  ← font-medium text-sm
│  TP210                                          │  ← text-xs text-slate-500
├─────────────────────────────────────────────────┤
│  14:30 ─────────────── 18:45                    │  ← text-lg font-semibold
│   JFK       7h 15m       LHR                    │  ← text-xs
│            Direct ✓                             │  ← text-xs text-green-600
├─────────────────────────────────────────────────┤
│                                      $298       │  ← text-2xl font-bold
│                                    Economy      │  ← text-xs text-slate-500
└─────────────────────────────────────────────────┘
```

### Animation & Micro-interactions

1. **Tab Switch:** Slide content with 200ms ease-out
2. **Search Loading:** Skeleton cards with shimmer effect
3. **Results Appear:** Staggered fade-in (50ms delay each)
4. **Card Hover:** Subtle lift with shadow increase
5. **Price Update:** Number counter animation
6. **Best Price Badge:** Gentle pulse on "Best Price" tag

### Skeleton Loading States

```jsx
// FlightCardSkeleton
<div className="border rounded-xl p-4 animate-pulse">
  <div className="flex items-center gap-3">
    <div className="w-10 h-10 bg-slate-200 rounded-lg" />
    <div className="space-y-2">
      <div className="h-4 w-24 bg-slate-200 rounded" />
      <div className="h-3 w-16 bg-slate-100 rounded" />
    </div>
  </div>
  <div className="mt-4 flex justify-between">
    <div className="h-6 w-20 bg-slate-200 rounded" />
    <div className="h-6 w-16 bg-slate-200 rounded" />
    <div className="h-6 w-20 bg-slate-200 rounded" />
  </div>
</div>
```

---

## Part 6: Implementation Plan

### Phase 1: Core Integration (P0 - This Sprint)

#### Task 1.1: Create BookingPanel Component
**File:** `components/trip/BookingPanel.tsx`

```typescript
interface BookingPanelProps {
  tripId: string;
  destination: string;
  destinationCode?: string;  // IATA code
  startDate: string;
  endDate: string;
  guests?: number;
}

// Features:
// - Tab switching (Flights / Hotels)
// - Loading states with skeletons
// - Error handling with retry
// - Mobile-responsive layout
```

**Effort:** 4 hours

#### Task 1.2: Create TripTabs Component
**File:** `components/trip/TripTabs.tsx`

```typescript
type TabId = 'itinerary' | 'flights' | 'hotels';

interface TripTabsProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  flightCount?: number;  // Badge for saved flights
  hotelCount?: number;   // Badge for saved hotels
}
```

**Effort:** 2 hours

#### Task 1.3: Integrate into TripDetailClient
**File:** `app/trips/[id]/TripDetailClient.tsx`

Changes:
1. Add `activeTab` state
2. Import TripTabs, BookingPanel
3. Conditional render based on active tab
4. Pass trip context to BookingPanel

**Effort:** 2 hours

#### Task 1.4: Add Destination Code Detection
**File:** `lib/utils/destination-code.ts`

```typescript
// Detect IATA code from destination name
async function getDestinationCode(destination: string): Promise<string | null> {
  // 1. Check cache
  // 2. Call /api/amadeus/locations/search
  // 3. Return best match IATA code
}
```

**Effort:** 2 hours

### Phase 2: Enhanced UX (P1 - Next Sprint)

#### Task 2.1: Create FlightCardSkeleton & HotelCardSkeleton
**Effort:** 1 hour

#### Task 2.2: Add "Best Price" and "Fastest" Badges
**Effort:** 1 hour

#### Task 2.3: Implement Sticky Tab Navigation
**Effort:** 2 hours

#### Task 2.4: Add Price Range Filter UI
**Effort:** 2 hours

#### Task 2.5: Mobile Bottom Sheet for Filters
**Effort:** 3 hours

### Phase 3: Booking Persistence (P2 - Future)

#### Task 3.1: Add Selected Flight/Hotel to Trip Record
```sql
-- Supabase migration
ALTER TABLE trips ADD COLUMN selected_flights JSONB DEFAULT '[]';
ALTER TABLE trips ADD COLUMN selected_hotels JSONB DEFAULT '[]';
```

#### Task 3.2: Create BookingConfirmation Component
Display saved booking selections in trip summary.

#### Task 3.3: Deep Link to External Booking
Open Amadeus booking URL with pre-filled info (when available).

---

## Part 7: Component Specifications

### BookingPanel.tsx

```typescript
'use client';

import { useState } from 'react';
import FlightSearch from '@/components/booking/FlightSearch';
import HotelSearch from '@/components/booking/HotelSearch';
import type { FlightOfferDisplay, HotelOfferDisplay } from '@/lib/amadeus/types';

interface BookingPanelProps {
  tripId: string;
  destination: string;
  destinationCode?: string;
  startDate: string;
  endDate: string;
  onFlightSelect?: (flight: FlightOfferDisplay) => void;
  onHotelSelect?: (hotel: HotelOfferDisplay) => void;
}

type BookingTab = 'flights' | 'hotels';

export default function BookingPanel({
  tripId,
  destination,
  destinationCode,
  startDate,
  endDate,
  onFlightSelect,
  onHotelSelect,
}: BookingPanelProps) {
  const [activeTab, setActiveTab] = useState<BookingTab>('flights');

  return (
    <div className="bg-white rounded-2xl shadow-lg border border-slate-100 overflow-hidden">
      {/* Tab Navigation */}
      <div className="flex border-b border-slate-200">
        <button
          onClick={() => setActiveTab('flights')}
          className={`flex-1 flex items-center justify-center gap-2 px-6 py-4 text-sm font-medium transition-colors ${
            activeTab === 'flights'
              ? 'text-[var(--primary)] border-b-2 border-[var(--primary)] bg-[var(--primary)]/5'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
          }`}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
          </svg>
          Flights
        </button>
        <button
          onClick={() => setActiveTab('hotels')}
          className={`flex-1 flex items-center justify-center gap-2 px-6 py-4 text-sm font-medium transition-colors ${
            activeTab === 'hotels'
              ? 'text-[var(--primary)] border-b-2 border-[var(--primary)] bg-[var(--primary)]/5'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
          }`}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
          </svg>
          Hotels
        </button>
      </div>

      {/* Tab Content */}
      <div className="p-0">
        {activeTab === 'flights' ? (
          <FlightSearch
            tripDestination={destination}
            tripDestinationCode={destinationCode}
            tripStartDate={startDate}
            tripEndDate={endDate}
            onFlightSelect={onFlightSelect}
          />
        ) : (
          <HotelSearch
            tripDestination={destination}
            tripDestinationCode={destinationCode}
            tripStartDate={startDate}
            tripEndDate={endDate}
            onHotelSelect={onHotelSelect}
          />
        )}
      </div>
    </div>
  );
}
```

### TripTabs.tsx

```typescript
'use client';

type TabId = 'itinerary' | 'booking';

interface TripTabsProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}

export default function TripTabs({ activeTab, onTabChange }: TripTabsProps) {
  const tabs = [
    { id: 'itinerary' as const, label: 'Itinerary', icon: '📋' },
    { id: 'booking' as const, label: 'Book', icon: '✈️' },
  ];

  return (
    <div className="flex bg-slate-100 rounded-xl p-1 mb-6">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-sm font-medium transition-all ${
            activeTab === tab.id
              ? 'bg-white text-slate-900 shadow-sm'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <span>{tab.icon}</span>
          {tab.label}
        </button>
      ))}
    </div>
  );
}
```

---

## Part 8: Success Metrics

### Pre-Launch Validation

| Metric | Target | Measurement |
|--------|--------|-------------|
| Flight search success rate | >90% | API response tracking |
| Hotel search success rate | >90% | API response tracking |
| Mobile usability score | >85 | Lighthouse audit |
| Time to first search result | <3s | Performance monitoring |

### Post-Launch KPIs

| Metric | Baseline | Target | Measurement |
|--------|----------|--------|-------------|
| Booking tab engagement | 0% | 30%+ | Analytics |
| Time on trip detail page | ~2 min | +50% | Analytics |
| External booking clicks | 10% | 25%+ | Click tracking |
| Return visits to saved trips | 20% | 40%+ | User sessions |

---

## Part 9: Risk Mitigation

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Amadeus API rate limits | High | Medium | Implement caching, queue requests |
| Slow API responses | Medium | Low | Skeleton loaders, timeout handling |
| No results for destination | Medium | Medium | Fallback to nearby cities, clear messaging |
| Mobile layout breaks | High | Low | Extensive testing, responsive design |
| User confusion with tabs | Low | Low | Clear labels, onboarding tooltip |

---

## Part 10: Files to Create/Modify

### New Files

| File | Purpose |
|------|---------|
| `components/trip/BookingPanel.tsx` | Container for booking search |
| `components/trip/TripTabs.tsx` | Tab navigation component |
| `components/booking/FlightCardSkeleton.tsx` | Loading state |
| `components/booking/HotelCardSkeleton.tsx` | Loading state |
| `lib/utils/destination-code.ts` | IATA code detection |

### Modified Files

| File | Changes |
|------|---------|
| `app/trips/[id]/TripDetailClient.tsx` | Add tab state, integrate BookingPanel |
| `components/booking/FlightSearch.tsx` | Remove redundant header in embedded mode |
| `components/booking/HotelSearch.tsx` | Remove redundant header in embedded mode |
| `app/globals.css` | Add booking-specific animations |

---

## Part 9: Activity-Based Hotel Geo-Filtering (IMPLEMENTED)

### Problem Statement

When searching for hotels, using city-level search (`cityCode` like "PAR" or "LON") returns hotels across the entire city. This can result in hotel suggestions that are far from the user's planned activities, leading to:

1. **Poor UX:** User books hotel on opposite side of city from activities
2. **Wasted time:** Long commutes between hotel and daily activities
3. **Disconnect:** Booking doesn't feel integrated with the trip plan

### Solution: Activity Centroid Search

The HotelSearch component now uses the trip's itinerary to:

1. **Extract coordinates** from all activities that have GPS data
2. **Calculate centroid** (geographic center) of activities
3. **Determine optimal radius** to cover activity distribution
4. **Use geo-based search** via Amadeus API with lat/lng/radius
5. **Display proximity** information on hotel cards

### Implementation Details

#### New Utility: `lib/utils/geo.ts`

```typescript
// Core functions:
- extractActivityCoordinates(itinerary) → Coordinates[]
- calculateCentroid(coordinates) → { lat, lng }
- calculateOptimalRadius(centroid, coordinates) → number (km)
- getHotelSearchCenter(itinerary) → GeoCenter | null
- getProximityLabel(km) → { label: string, color: string }
- formatDistance(km) → string
```

#### Updated: `components/booking/HotelSearch.tsx`

```typescript
// New prop:
itinerary?: ItineraryDay[];  // Pass trip itinerary for geo-filtering

// Behavior:
1. If itinerary provided with >30% coordinate coverage:
   → Use geo-based search (lat/lng/radius)
   → Sort by distance to activity center
   → Show proximity badges on hotel cards

2. Otherwise:
   → Fall back to city-based search (cityCode)
   → Standard sorting options
```

#### Updated: `components/booking/HotelCard.tsx`

```typescript
// New display elements:
- Proximity badge on hotel image: "2.3km"
- Proximity label in details: "Walking distance to your activities"
- Color-coded by distance: green (<2km), blue (<5km), yellow (<10km)
```

### Search Behavior

```
BEFORE (City-based):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  City: Paris (PAR)
  Hotels: All hotels in Paris (cityCode=PAR)
  Result: Hotels 1km to 20km from activities
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

AFTER (Activity-centered):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Activities: Eiffel Tower, Louvre, Champs-Élysées
  Center: 48.8584° N, 2.3199° E (calculated centroid)
  Radius: 4km (covers all activities + buffer)
  Hotels: Only hotels within 4km of activity center
  Result: Hotels 0.5km to 4km from activities
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Proximity Labels

| Distance | Label | Color | Use Case |
|----------|-------|-------|----------|
| < 0.5km | Walking distance | Green | Steps from activities |
| 0.5-2km | Very close | Light Green | Easy walk |
| 2-5km | Nearby | Blue | Short taxi/metro |
| 5-10km | Short commute | Yellow | Quick transport |
| > 10km | Further away | Orange | Consider location carefully |

### Fallback Behavior

The system gracefully falls back to city-based search when:

1. **No itinerary provided:** `itinerary` prop undefined
2. **No coordinates:** Activities lack GPS data
3. **Low coverage:** < 30% of activities have coordinates

This ensures the feature enhances UX without breaking existing functionality.

### Visual Design

```
Hotel Card with Proximity:
┌─────────────────────────────────────────────┐
│ ┌─────────────┐                             │
│ │   [Image]   │ Hotel Name                  │
│ │             │ Address line                │
│ │  ★★★★☆     │ 📍 Walking distance (800m)  │
│ │  [0.8km]   │ Room type • 1 King          │
│ └─────────────┘                             │
│               [Amenities] [Free cancel]     │
│                                 $189/night  │
└─────────────────────────────────────────────┘
```

### API Compatibility

The Amadeus Hotel API route already supports geo-based search:

```typescript
// Existing parameters in /api/amadeus/hotels/search:
- latitude: number
- longitude: number
- radius: number
- radiusUnit: 'KM' | 'MILE'
```

No API changes required - only client-side logic updates.

### Files Changed

| File | Status | Changes |
|------|--------|---------|
| `lib/utils/geo.ts` | NEW | Geo calculation utilities |
| `components/booking/HotelSearch.tsx` | MODIFIED | Geo-search logic, proximity display |
| `components/booking/HotelCard.tsx` | MODIFIED | Proximity badge and label |

---

## Appendix: Competitive Reference

### Best Practices from Google Travel

1. **Unified search:** Flights and hotels on same page with tabs
2. **Price alerts:** Track price changes for saved searches
3. **Calendar view:** Show prices across date range
4. **Map integration:** Hotels on map with price bubbles

### Best Practices from Kayak

1. **Flexible dates:** Show cheapest days to travel
2. **Hacker fares:** Mix airlines for best price
3. **Filter persistence:** Remember user preferences
4. **Compare mode:** Side-by-side flight comparison

### MonkeyTravel Differentiation

1. **AI-first:** Itinerary already created, booking is contextual
2. **Vibe-matched:** Could filter hotels by trip vibe (romantic = boutique hotels)
3. **Budget-aware:** Show options matching trip budget tier
4. **Seamless save:** Booking selections linked to trip record

---

*Document created: December 2025*
*Version: 1.0*
*Status: Ready for Implementation*
