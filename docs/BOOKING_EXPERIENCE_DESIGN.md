# Booking Experience Design Plan

## Executive Summary

This document outlines the comprehensive design for MonkeyTravel's affiliate booking experience. The goal is to create booking CTAs that feel **native, helpful, and premium** while maximizing affiliate conversions through smart pre-filling and contextual placement.

**Key Principles:**
1. **Pre-fill everything possible** - Reduce friction by 80%+ with smart defaults
2. **Collect missing data gracefully** - Use a bottom drawer, not intrusive modals
3. **Contextual placement** - Right content, right place, right time
4. **Transparent handoffs** - Clear expectations when leaving app
5. **Mobile-first** - Primary actions in thumb zone

---

## Part 1: Data Analysis

### Available Data Sources

| Source | Data | Use Case |
|--------|------|----------|
| **Trip** | destination, startDate, endDate, itinerary | All booking links |
| **Trip** | collaboratorCount + 1 | Travelers count |
| **User Profile** | home_city, home_country | Flight origin (needs fetch) |
| **Activity** | name, location, address, booking_required | Activity-specific bookings |
| **Cache** | City → IATA code mapping | Flight pre-fill |
| **Cache** | City → Hotellook locationId | Hotel pre-fill |

### Data Gaps & Solutions

| Gap | Impact | Solution |
|-----|--------|----------|
| No airport IATA codes | Flights won't pre-fill | Use city codes (NYC, LON) - Aviasales supports this |
| User's home city not fetched | Origin unknown | Fetch from profile OR ask in drawer |
| Exact traveler count unknown | Defaults to 2 | Use collaboratorCount + 1 |
| No activity dates pre-filled | Generic activity search | Pass trip start date as minimum |

---

## Part 2: Affiliate Partner Link Optimization

### Aviasales (Flights)
**Current:** ❌ No links shown (no airport codes)
**Solution:** Use CITY IATA codes which search ALL airports in metro area

```typescript
// City codes (not airport codes) - search all airports
const CITY_IATA_CODES: Record<string, string> = {
  "Rome": "ROM", "Paris": "PAR", "London": "LON",
  "New York": "NYC", "Los Angeles": "LAX", "Tokyo": "TYO",
  // ... expand with common destinations
};

// Fallback: Link to homepage with destination pre-selected
```

**URL Structure:**
```
https://www.aviasales.com/search/{origin}{DDMM}{destination}{DDMM}{passengers}?marker=483997
```

### Hotellook (Hotels)
**Current:** ✅ Works with city name
**Enhancement:** Cache locationId for faster, more accurate results

```typescript
// Lookup API to get locationId
const locationId = await lookupHotellookLocation(destination);

// Pre-fill with all data
https://search.hotellook.com/?locationId=15542&checkin=2025-03-15&checkout=2025-03-20&adults=2&marker=483997
```

### GetYourGuide (Activities)
**Current:** ⚠️ Only destination, no dates
**Reality:** GetYourGuide doesn't support date pre-fill in URLs
**Solution:** Use destination page + tracking

```typescript
// Best we can do - destination page
https://www.getyourguide.com/s/?q=Paris&partner_id=483997

// For specific activities, search by activity name
https://www.getyourguide.com/s/?q=Louvre+Museum+Skip+Line&partner_id=483997
```

### RentalCars (Car Rental)
**Current:** ⚠️ Uses city name, no dates
**Solution:** Use city-based URL path

```typescript
// City-based URL (works without airport code)
https://www.rentalcars.com/en/city/it/rome?affiliateCode=483997

// With dates (if we can construct proper params)
```

---

## Part 3: UX Design Specifications

### 3.1 Trip-Level Booking Panel (Enhanced)

**Location:** After hero, before itinerary (current position - good)

**Layout Redesign:**
```
┌──────────────────────────────────────────────────────────────┐
│  📍 Ready to book your Rome trip?                           │
│  Mar 15 - Mar 22, 2025 · 2 travelers                        │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────────────┐  ┌─────────────────────┐           │
│  │ ✈️ FLIGHTS          │  │ 🏨 HOTELS           │           │
│  │ Find the best       │  │ Compare 2M+         │           │
│  │ deals to Rome       │  │ properties          │           │
│  │ [Search Flights →]  │  │ [Search Hotels →]   │           │
│  └─────────────────────┘  └─────────────────────┘           │
│                                                              │
│  ┌─────────────────────┐  ┌─────────────────────┐           │
│  │ 🚗 CAR RENTAL       │  │ 🎫 ACTIVITIES       │           │
│  │ Explore freely      │  │ Book tours & more   │           │
│  │ [Rent a Car →]      │  │ [Browse →]          │           │
│  └─────────────────────┘  └─────────────────────┘           │
│                                                              │
│  ───────────────────────────────────────────────────────    │
│  💡 We earn a small commission at no extra cost to you      │
└──────────────────────────────────────────────────────────────┘
```

**Visual Specs:**
- 2x2 grid on desktop, 2x2 on tablet, 1-column on mobile
- Card-style buttons with icon, title, subtitle
- Primary color for Flights/Hotels, secondary for others
- Subtle shadow on hover (elevation change)

### 3.2 Flight Booking Drawer (New Component)

**Trigger:** User clicks "Search Flights" without origin set

**Design:**
```
┌────────────────────────────────────────────┐
│ ┌──────────────────────────────────────┐   │ ← Drag handle
│ │                                      │   │
│ │  Where are you flying from?          │   │
│ │                                      │   │
│ │  ┌──────────────────────────────┐   │   │
│ │  │ 🔍 Enter city or airport     │   │   │
│ │  └──────────────────────────────┘   │   │
│ │                                      │   │
│ │  Recent:                             │   │
│ │  • New York (NYC)                    │   │
│ │  • Los Angeles (LAX)                 │   │
│ │                                      │   │
│ │  ────────────────────────────────   │   │
│ │                                      │   │
│ │  ┌────────────────────────────────┐ │   │
│ │  │  ✈️ Search Flights to Rome     │ │   │
│ │  │     Mar 15 - 22 · 2 travelers  │ │   │
│ │  └────────────────────────────────┘ │   │
│ │                                      │   │
│ └──────────────────────────────────────┘   │
└────────────────────────────────────────────┘
```

**Behavior:**
1. Slides up from bottom (mobile-friendly)
2. City autocomplete with IATA codes
3. Saves selection to localStorage for next time
4. After selection → opens Aviasales in new tab
5. Tracks: drawer_opened, city_selected, search_clicked

**Why Drawer (not Modal):**
- Mobile thumb-zone accessible
- Less intrusive than full-screen modal
- Partial visibility maintains context
- Modern pattern (Uber, Airbnb)

### 3.3 Activity-Level Booking CTAs

**Current State:** Activities have a "Booking Required" badge but no action

**New Design - Two Levels:**

#### Level 1: Quick Badge (Always Visible)
For activities with `booking_required: true`:

```
┌───────────────────────────────────────────────────┐
│  🎟️ Skip-the-line Colosseum Tour         $45    │
│  📍 Colosseum, Rome                              │
│                                                   │
│  [Maps] [Search] [Book Now ↗]  ← NEW CTA        │
│                                                   │
└───────────────────────────────────────────────────┘
```

**"Book Now" Button Specs:**
- Position: In quick actions row (flex-end)
- Style: `bg-[var(--accent)] text-slate-900` (gold/yellow - stands out)
- Size: Same as other quick action buttons
- Opens GetYourGuide search for activity name

#### Level 2: Expanded Booking Section
When user expands the activity card:

```
┌───────────────────────────────────────────────────┐
│  [Expanded content: tips, photos, etc.]          │
│                                                   │
│  ── Book This Activity ──────────────────────    │
│                                                   │
│  ┌───────────────────────────────────────────┐   │
│  │ 🎫 GetYourGuide                           │   │
│  │    Skip-the-line tickets from $45         │   │
│  │    [Search Tickets →]                     │   │
│  └───────────────────────────────────────────┘   │
│                                                   │
│  ┌───────────────────────────────────────────┐   │
│  │ 🌐 Official Website                       │   │
│  │    www.colosseum-rome.com                 │   │
│  │    [Visit Website →]                      │   │
│  └───────────────────────────────────────────┘   │
│                                                   │
│  💡 Compare prices across platforms              │
│                                                   │
└───────────────────────────────────────────────────┘
```

### 3.4 Mobile Bottom Bar (Enhancement)

**Concept:** Floating bottom bar on mobile with booking CTA

```
┌─────────────────────────────────────────┐
│  ← Rome Trip                        ⋯   │
│  ─────────────────────────────────────  │
│                                         │
│  [Scrollable itinerary content...]      │
│                                         │
│                                         │
├─────────────────────────────────────────┤
│  ┌──────────┐ ┌──────────┐ ┌─────────┐ │
│  │ ✈️ Flights│ │ 🏨 Hotels│ │ 🎫 Book │ │
│  └──────────┘ └──────────┘ └─────────┘ │
└─────────────────────────────────────────┘
```

**Behavior:**
- Shows after scrolling past the BookingPanel
- Compact 3-button layout
- Thumb-zone accessible (bottom of screen)
- Dismissible (X or swipe down)

---

## Part 4: Technical Implementation

### 4.1 Data Enrichment Layer

Create `lib/affiliates/enrichment.ts`:

```typescript
/**
 * City to IATA code mapping for flight searches
 * Uses city codes (not airport codes) for maximum coverage
 */
const CITY_IATA: Record<string, string> = {
  // Europe
  "Rome": "ROM", "Paris": "PAR", "London": "LON",
  "Barcelona": "BCN", "Madrid": "MAD", "Amsterdam": "AMS",
  "Berlin": "BER", "Munich": "MUC", "Vienna": "VIE",
  "Prague": "PRG", "Lisbon": "LIS", "Dublin": "DUB",
  // Americas
  "New York": "NYC", "Los Angeles": "LAX", "Miami": "MIA",
  "Chicago": "CHI", "San Francisco": "SFO", "Las Vegas": "LAS",
  // Asia
  "Tokyo": "TYO", "Singapore": "SIN", "Hong Kong": "HKG",
  "Bangkok": "BKK", "Seoul": "SEL", "Dubai": "DXB",
  // Add more as needed...
};

export function getCityIATA(cityName: string): string | null {
  // Direct lookup
  if (CITY_IATA[cityName]) return CITY_IATA[cityName];

  // Fuzzy match (Rome, Italy → Rome)
  const baseCity = cityName.split(",")[0].trim();
  if (CITY_IATA[baseCity]) return CITY_IATA[baseCity];

  return null;
}

export function getTravelerCount(
  collaboratorCount: number | undefined
): number {
  // collaboratorCount already includes owner (totalVoters = collaborators + 1)
  return collaboratorCount || 2;
}
```

### 4.2 Enhanced Booking Link Generator

Update `lib/affiliates/travelpayouts.ts`:

```typescript
interface SmartFlightParams {
  destination: string;
  originCity?: string;        // User's home city (from profile or drawer)
  departDate: string;
  returnDate?: string;
  travelers: number;
  locale?: 'en' | 'es' | 'it';
}

export function generateSmartFlightLink(params: SmartFlightParams): {
  url: string | null;
  needsOrigin: boolean;
  destinationCode: string | null;
} {
  const destCode = getCityIATA(params.destination);

  if (!destCode) {
    // Fallback: Generic Aviasales with destination hint
    return {
      url: `https://www.aviasales.com/?marker=${MARKER}`,
      needsOrigin: true,
      destinationCode: null,
    };
  }

  if (!params.originCity) {
    return {
      url: null,  // Will trigger drawer
      needsOrigin: true,
      destinationCode: destCode,
    };
  }

  const originCode = getCityIATA(params.originCity);
  if (!originCode) {
    return {
      url: null,
      needsOrigin: true,
      destinationCode: destCode,
    };
  }

  // Full pre-filled URL
  const dept = formatDateDDMM(params.departDate);
  const ret = params.returnDate ? formatDateDDMM(params.returnDate) : "";
  const searchPath = `${originCode}${dept}${destCode}${ret}${params.travelers}`;

  return {
    url: `https://www.aviasales.com/search/${searchPath}?marker=${MARKER}`,
    needsOrigin: false,
    destinationCode: destCode,
  };
}

// Enhanced activity link with date
export function generateActivityLink(params: {
  destination: string;
  activityName?: string;
  date?: string;
}): string {
  const query = params.activityName
    ? `${params.activityName} ${params.destination}`
    : params.destination;

  const url = new URL(`${PARTNERS.getyourguide}/s/`);
  url.searchParams.set("q", query);
  url.searchParams.set("partner_id", MARKER);

  if (params.date) {
    url.searchParams.set("date_from", params.date);
  }

  return url.toString();
}
```

### 4.3 BookingDrawer Component

Create `components/booking/BookingDrawer.tsx`:

```typescript
"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { motion, AnimatePresence } from "framer-motion";
import { capture } from "@/lib/posthog";
import { getCityIATA } from "@/lib/affiliates/enrichment";

interface BookingDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  bookingType: "flight" | "hotel" | "car";
  destination: string;
  destinationCode: string | null;
  startDate: string;
  endDate: string;
  travelers: number;
  tripId: string;
  onSearch: (originCity: string) => void;
}

const RECENT_ORIGINS_KEY = "monkeytravel_recent_origins";

export default function BookingDrawer({...}: BookingDrawerProps) {
  const [originCity, setOriginCity] = useState("");
  const [recentOrigins, setRecentOrigins] = useState<string[]>([]);
  const t = useTranslations("common.booking");

  useEffect(() => {
    const recent = localStorage.getItem(RECENT_ORIGINS_KEY);
    if (recent) setRecentOrigins(JSON.parse(recent));
  }, []);

  const handleSearch = () => {
    // Save to recent
    const updated = [originCity, ...recentOrigins.filter(o => o !== originCity)].slice(0, 3);
    localStorage.setItem(RECENT_ORIGINS_KEY, JSON.stringify(updated));

    // Track
    capture("booking_origin_selected", {
      origin_city: originCity,
      origin_code: getCityIATA(originCity),
      destination,
      trip_id: tripId,
    });

    onSearch(originCity);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.5 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black z-40"
            onClick={onClose}
          />

          {/* Drawer */}
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 25 }}
            className="fixed bottom-0 left-0 right-0 bg-white rounded-t-2xl z-50 p-6 max-h-[70vh]"
          >
            {/* Drag handle */}
            <div className="w-12 h-1 bg-slate-200 rounded-full mx-auto mb-6" />

            <h3 className="text-lg font-semibold mb-4">
              {t("whereFlying")}
            </h3>

            <input
              type="text"
              value={originCity}
              onChange={(e) => setOriginCity(e.target.value)}
              placeholder={t("enterCityOrAirport")}
              className="w-full px-4 py-3 border rounded-lg mb-4"
              autoFocus
            />

            {recentOrigins.length > 0 && (
              <div className="mb-6">
                <p className="text-sm text-slate-500 mb-2">{t("recent")}</p>
                <div className="flex flex-wrap gap-2">
                  {recentOrigins.map(city => (
                    <button
                      key={city}
                      onClick={() => setOriginCity(city)}
                      className="px-3 py-1.5 bg-slate-100 rounded-full text-sm"
                    >
                      {city}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <button
              onClick={handleSearch}
              disabled={!originCity}
              className="w-full py-4 bg-[var(--primary)] text-white rounded-xl font-medium disabled:opacity-50"
            >
              {t("searchFlightsTo", { destination })}
            </button>

            <p className="text-center text-xs text-slate-400 mt-4">
              {t("externalSiteNote")}
            </p>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
```

### 4.4 Enhanced Activity Card Booking CTA

Update `EditableActivityCard.tsx` quick actions:

```typescript
// In the quick actions row, add booking CTA for bookable activities
{activity.booking_required && (
  <a
    href={generateActivityLink({
      destination,
      activityName: activity.name,
      date: dayDate,  // The specific day's date
    })}
    target="_blank"
    rel="noopener noreferrer sponsored"
    onClick={() => capture("activity_booking_click", {
      activity_id: activity.id,
      activity_name: activity.name,
      trip_id: tripId,
    })}
    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg
               bg-[var(--accent)] text-slate-900 text-sm font-medium
               hover:bg-[var(--accent)]/90 transition-colors"
  >
    <TicketIcon className="w-4 h-4" />
    {t("bookNow")}
    <ExternalLinkIcon className="w-3 h-3" />
  </a>
)}
```

---

## Part 5: Analytics & Tracking

### PostHog Events

| Event | Properties | Purpose |
|-------|------------|---------|
| `booking_panel_view` | trip_id, destination, section | Track panel impressions |
| `booking_cta_click` | type, destination, trip_id, has_prefill | Track clicks |
| `booking_drawer_opened` | type, trip_id | Track drawer opens |
| `booking_origin_selected` | origin_city, origin_code, destination | Flight origin tracking |
| `activity_booking_click` | activity_id, activity_name, trip_id | Activity-level clicks |
| `booking_external_redirect` | partner, destination, prefill_quality | Track handoffs |

### Conversion Funnel

```
Trip Created
    ↓
Booking Panel View (track impression)
    ↓
CTA Click (track by type: flight/hotel/activity)
    ↓
[If flight + no origin] Drawer Opened
    ↓
Origin Selected
    ↓
External Redirect (final click)
```

---

## Part 6: Implementation Phases

### Phase 1: Foundation (Day 1)
- [ ] Create `lib/affiliates/enrichment.ts` with city IATA mapping
- [ ] Update `generateFlightLink` to use smart fallbacks
- [ ] Add `generateActivityLink` date support
- [ ] Fetch user's home_city in TripDetailClient server component

### Phase 2: Drawer & Smart Pre-fill (Day 2)
- [ ] Create `BookingDrawer` component
- [ ] Integrate drawer with BookingPanel flights CTA
- [ ] Add localStorage for recent origins
- [ ] Add PostHog tracking events

### Phase 3: Activity Booking CTAs (Day 3)
- [ ] Add "Book Now" button to EditableActivityCard
- [ ] Pass day date to activity booking links
- [ ] Add activity-specific PostHog events
- [ ] Add translations for new UI strings

### Phase 4: Polish & Mobile (Day 4)
- [ ] Refine BookingPanel 2x2 grid layout
- [ ] Add mobile bottom bar (optional)
- [ ] Add external link indicators
- [ ] Test on mobile devices

### Phase 5: Deploy & Monitor (Day 5)
- [ ] Deploy to production
- [ ] Set up PostHog dashboard for booking funnel
- [ ] Monitor click-through rates
- [ ] A/B test CTA copy/colors

---

## Part 7: Translations Required

Add to `messages/{en,es,it}/common.json`:

```json
{
  "booking": {
    "bookYourTrip": "Ready to book your trip?",
    "findFlights": "Find the best flight deals",
    "compareHotels": "Compare 2M+ hotels",
    "rentCar": "Explore freely with a rental",
    "browseActivities": "Book tours and experiences",
    "searchFlights": "Search Flights",
    "searchHotels": "Search Hotels",
    "rentACar": "Rent a Car",
    "browseAll": "Browse Activities",
    "whereFlying": "Where are you flying from?",
    "enterCityOrAirport": "Enter city or airport",
    "recent": "Recent:",
    "searchFlightsTo": "Search Flights to {destination}",
    "externalSiteNote": "You'll be redirected to our partner site to complete your search",
    "bookNow": "Book Now",
    "bookThisActivity": "Book This Activity",
    "ticketsFrom": "Tickets from {price}",
    "compareprices": "Compare prices across platforms",
    "poweredByTravelpayouts": "Powered by Travelpayouts partners"
  }
}
```

---

## Success Metrics

| Metric | Current | Target | Measurement |
|--------|---------|--------|-------------|
| Booking CTA Click Rate | ? | 15%+ | Clicks / Panel Views |
| Flight CTA Engagement | 0% | 10%+ | (No links shown currently) |
| Activity Booking Clicks | 0% | 5%+ | Activity clicks / Activity views |
| Origin Drawer Completion | N/A | 70%+ | Searches / Drawer opens |
| External Redirect Rate | ? | 90%+ | Redirects / CTA clicks |

---

## Appendix: City IATA Code Reference

Priority cities to support (expandable):

**Tier 1 (Most Popular Destinations):**
Paris, London, Rome, Barcelona, Amsterdam, New York, Tokyo, Dubai, Bangkok, Singapore

**Tier 2 (Common Origins):**
Los Angeles, Chicago, San Francisco, Miami, Toronto, Sydney, Hong Kong, Berlin, Munich, Madrid

**Tier 3 (Regional Hubs):**
Lisbon, Prague, Vienna, Dublin, Copenhagen, Seoul, Taipei, Melbourne, Vancouver, Seattle
