# Travelpayouts Integration Plan

## Overview

Complete integration of Travelpayouts affiliate partners into MonkeyTravel. This plan covers:
1. Updated partner configuration with deep link format
2. Smart booking links with pre-filled parameters
3. AI-enhanced activity suggestions referencing real bookable experiences
4. Post-confirmation travel services (eSIM, flight compensation)
5. Seamless UX with proper tracking

---

## Partner Configuration

### Authorized Partners (Travelpayouts)

| Partner | Category | Commission | promo_id | Use Case |
|---------|----------|------------|----------|----------|
| **Booking.com** | Hotels | 4% | 3650 | Primary hotel bookings |
| **Trip.com** | Flights/Hotels | 3-5% | 3616 | Asian market flights |
| **Agoda** | Hotels | 6% | 2854 | Asian hotels |
| **Expedia** | All-in-one | 6% | 3709 | US market |
| **Klook** | Activities | 2-5% | 4110 | Activities (Asia focus) |
| **Tiqets** | Attractions | 8% | 2074 | Museum/attraction tickets |
| **Omio** | Trains/Buses | 6% | 2078 | European ground transport |
| **Yesim** | eSIM | 18% | 4526 | Travel data plans |
| **CheapOair** | Flights | Up to $25 | 3008 | US flight bookings |
| **AirHelp** | Compensation | 15%+ | 3195 | Flight delay claims |
| **VRBO** | Vacation Rentals | 4% | 3738 | Alternative to hotels |
| **Saily** | eSIM | 20% | 4812 | eSIM data (Nord Security) |

### Deep Link Format

All Travelpayouts partners use this format:
```
https://c{XX}.travelpayouts.com/click?shmarker={MARKER}.{SUBID}&promo_id={PROMO_ID}&source_type=customlink&type=click&custom_url={ENCODED_URL}
```

Where:
- `c{XX}` - Partner-specific subdomain (c84 for Booking, c137 for Klook, etc.)
- `shmarker` - Our affiliate marker ID (483997) + optional SubID
- `promo_id` - Partner program ID
- `custom_url` - URL-encoded destination page

---

## Implementation Architecture

### 1. Partner Configuration (`lib/affiliates/partners.ts`)

```typescript
export const TRAVELPAYOUTS_PARTNERS = {
  // Hotels
  booking: {
    name: "Booking.com",
    subdomain: "c84",
    promo_id: "3650",
    category: "hotels",
    baseUrl: "https://www.booking.com",
  },
  agoda: {
    name: "Agoda",
    subdomain: "c104",
    promo_id: "2854",
    category: "hotels",
    baseUrl: "https://www.agoda.com",
  },
  vrbo: {
    name: "VRBO",
    subdomain: "c102",
    promo_id: "3738",
    category: "vacation_rentals",
    baseUrl: "https://www.vrbo.com",
  },

  // Flights
  tripcom: {
    name: "Trip.com",
    subdomain: "c125",
    promo_id: "3616",
    category: "flights",
    baseUrl: "https://www.trip.com",
  },
  cheapoair: {
    name: "CheapOair",
    subdomain: "c108",
    promo_id: "3008",
    category: "flights",
    baseUrl: "https://www.cheapoair.com",
  },
  expedia: {
    name: "Expedia",
    subdomain: "c103",
    promo_id: "3709",
    category: "all",
    baseUrl: "https://www.expedia.com",
  },

  // Activities
  klook: {
    name: "Klook",
    subdomain: "c137",
    promo_id: "4110",
    category: "activities",
    baseUrl: "https://www.klook.com",
    regions: ["asia", "global"],
  },
  tiqets: {
    name: "Tiqets",
    subdomain: "c89",
    promo_id: "2074",
    category: "attractions",
    baseUrl: "https://www.tiqets.com",
    regions: ["europe", "global"],
  },

  // Transport
  omio: {
    name: "Omio",
    subdomain: "c91",
    promo_id: "2078",
    category: "trains",
    baseUrl: "https://www.omio.com",
    regions: ["europe"],
  },

  // Travel Services
  yesim: {
    name: "Yesim",
    subdomain: "c152",
    promo_id: "4526",
    category: "esim",
    baseUrl: "https://yesim.app",
  },
  saily: {
    name: "Saily",
    subdomain: "c167",
    promo_id: "4812",
    category: "esim",
    baseUrl: "https://saily.com",
  },
  airhelp: {
    name: "AirHelp",
    subdomain: "c95",
    promo_id: "3195",
    category: "compensation",
    baseUrl: "https://www.airhelp.com",
  },
} as const;
```

### 2. Deep Link Generator (`lib/affiliates/deeplinks.ts`)

```typescript
const MARKER = "483997";

export function createDeepLink(
  partner: keyof typeof TRAVELPAYOUTS_PARTNERS,
  targetUrl: string,
  subId?: string
): string {
  const config = TRAVELPAYOUTS_PARTNERS[partner];
  const shmarker = subId ? `${MARKER}.${subId}` : MARKER;

  return `https://${config.subdomain}.travelpayouts.com/click?` +
    `shmarker=${shmarker}&` +
    `promo_id=${config.promo_id}&` +
    `source_type=customlink&` +
    `type=click&` +
    `custom_url=${encodeURIComponent(targetUrl)}`;
}
```

### 3. Smart Booking Links

#### Hotels (Booking.com primary, Agoda/VRBO as alternatives)

```typescript
export function generateHotelLink(params: {
  destination: string;
  checkIn: string;    // YYYY-MM-DD
  checkOut: string;
  guests: number;
  partner?: "booking" | "agoda" | "vrbo";
}): string {
  const { destination, checkIn, checkOut, guests, partner = "booking" } = params;

  // Booking.com URL format
  if (partner === "booking") {
    const targetUrl = `https://www.booking.com/searchresults.html?` +
      `ss=${encodeURIComponent(destination)}&` +
      `checkin=${checkIn}&checkout=${checkOut}&` +
      `group_adults=${guests}&no_rooms=1`;
    return createDeepLink("booking", targetUrl, "hotels");
  }

  // Agoda
  if (partner === "agoda") {
    const targetUrl = `https://www.agoda.com/search?` +
      `city=${encodeURIComponent(destination)}&` +
      `checkIn=${checkIn}&checkOut=${checkOut}&` +
      `adults=${guests}&rooms=1`;
    return createDeepLink("agoda", targetUrl, "hotels");
  }

  // VRBO
  const targetUrl = `https://www.vrbo.com/search?` +
    `destination=${encodeURIComponent(destination)}&` +
    `startDate=${checkIn}&endDate=${checkOut}&` +
    `adults=${guests}`;
  return createDeepLink("vrbo", targetUrl, "hotels");
}
```

#### Flights (Trip.com, CheapOair, Expedia)

```typescript
export function generateFlightLink(params: {
  origin: string;
  destination: string;
  departDate: string;
  returnDate?: string;
  passengers: number;
  partner?: "tripcom" | "cheapoair" | "expedia";
}): string {
  const { partner = "tripcom" } = params;

  // Trip.com format
  if (partner === "tripcom") {
    const targetUrl = `https://www.trip.com/flights/${params.origin}-to-${params.destination}?` +
      `dcity=${params.origin}&acity=${params.destination}&` +
      `ddate=${params.departDate}&rdate=${params.returnDate || ""}&` +
      `passenger=${params.passengers}`;
    return createDeepLink("tripcom", targetUrl, "flights");
  }

  // CheapOair format
  if (partner === "cheapoair") {
    const targetUrl = `https://www.cheapoair.com/flights/${params.origin}/${params.destination}?` +
      `departure=${params.departDate}&return=${params.returnDate || ""}`;
    return createDeepLink("cheapoair", targetUrl, "flights");
  }

  // Expedia format
  const targetUrl = `https://www.expedia.com/Flights-Search?` +
    `leg1=from:${params.origin},to:${params.destination},departure:${params.departDate}` +
    (params.returnDate ? `&leg2=from:${params.destination},to:${params.origin},departure:${params.returnDate}` : "") +
    `&passengers=adults:${params.passengers}`;
  return createDeepLink("expedia", targetUrl, "flights");
}
```

#### Activities (Klook for Asia, Tiqets for Europe/Global)

```typescript
export function generateActivityLink(params: {
  destination: string;
  activityName?: string;
  region?: "asia" | "europe" | "americas" | "global";
}): { klook?: string; tiqets?: string } {
  const { destination, activityName, region } = params;
  const links: { klook?: string; tiqets?: string } = {};

  // Klook - great for Asia, also has global coverage
  const klookSearch = activityName
    ? `${activityName} ${destination}`
    : destination;
  const klookUrl = `https://www.klook.com/search/?query=${encodeURIComponent(klookSearch)}`;
  links.klook = createDeepLink("klook", klookUrl, "activities");

  // Tiqets - great for Europe attractions
  const tiqetsSearch = activityName || destination;
  const tiqetsUrl = `https://www.tiqets.com/search/?q=${encodeURIComponent(tiqetsSearch)}`;
  links.tiqets = createDeepLink("tiqets", tiqetsUrl, "activities");

  return links;
}
```

#### Transport (Omio for Europe)

```typescript
export function generateTrainLink(params: {
  origin: string;
  destination: string;
  date: string;
  passengers: number;
}): string {
  const targetUrl = `https://www.omio.com/search?` +
    `from=${encodeURIComponent(params.origin)}&` +
    `to=${encodeURIComponent(params.destination)}&` +
    `date=${params.date}&passengers=${params.passengers}`;
  return createDeepLink("omio", targetUrl, "trains");
}
```

### 4. Post-Confirmation Services

When trip status changes to "confirmed", show these suggestions:

#### eSIM Suggestions (Yesim / Saily)

```typescript
export function generateEsimLinks(destination: string): {
  yesim: string;
  saily: string;
} {
  // Yesim
  const yesimUrl = `https://yesim.app/destinations/${destination.toLowerCase().replace(/\s+/g, "-")}`;

  // Saily
  const sailyUrl = `https://saily.com/esim/${destination.toLowerCase().replace(/\s+/g, "-")}`;

  return {
    yesim: createDeepLink("yesim", yesimUrl, "esim"),
    saily: createDeepLink("saily", sailyUrl, "esim"),
  };
}
```

#### Flight Compensation (AirHelp)

Show when user has flight bookings (suggest claiming compensation for delays):

```typescript
export function generateAirHelpLink(): string {
  return createDeepLink("airhelp", "https://www.airhelp.com/en/claim/", "compensation");
}
```

---

## AI Integration Strategy

### Approach: Context-Aware Activity Generation

Since we don't have direct API access to Klook/Tiqets inventory, we'll enhance AI prompts to:
1. Generate activity names that match real bookable experiences
2. Include booking suggestions in the activity description
3. Add `booking_partner` field to guide link generation

### Updated Gemini Prompt Enhancement

Add to the system prompt in `lib/gemini.ts`:

```typescript
const BOOKING_AWARE_PROMPT = `
When generating activities, prefer well-known bookable experiences that travelers can reserve in advance:
- Museums: Include skip-the-line options (e.g., "Skip-the-Line Louvre Museum Tour")
- Attractions: Use official experience names (e.g., "Colosseum Underground & Arena Floor Access")
- Tours: Reference popular tour formats (e.g., "Small Group Walking Tour", "Hop-on Hop-off Bus")
- Food: Suggest food tours or cooking classes that are bookable (e.g., "Roman Street Food Tour")

For each activity that requires booking, set:
- booking_required: true
- booking_partner: "klook" | "tiqets" | "direct" (based on type and region)
- estimated_price: rough price range (e.g., "$25-45")

For Asian destinations (Japan, Korea, Singapore, Thailand, etc.), prefer Klook-style experiences.
For European museums and attractions, prefer Tiqets-style ticket experiences.
`;
```

### Activity Output Schema Enhancement

```typescript
interface EnhancedActivity {
  // ... existing fields
  booking_required: boolean;
  booking_partner?: "klook" | "tiqets" | "direct" | "free";
  estimated_price?: string;
  booking_tip?: string;  // e.g., "Book 2 weeks in advance"
}
```

---

## UI Components

### 1. Enhanced BookingPanel

Show multiple partner options organized by category:

```
┌──────────────────────────────────────────────────────────────┐
│  ✈️ Flights                                                   │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐                        │
│  │Trip.com │ │CheapOair│ │ Expedia │                        │
│  └─────────┘ └─────────┘ └─────────┘                        │
│                                                              │
│  🏨 Hotels                                                   │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐                        │
│  │Booking  │ │ Agoda   │ │  VRBO   │                        │
│  └─────────┘ └─────────┘ └─────────┘                        │
│                                                              │
│  🎫 Activities & Attractions                                 │
│  ┌─────────┐ ┌─────────┐                                    │
│  │  Klook  │ │ Tiqets  │                                    │
│  └─────────┘ └─────────┘                                    │
│                                                              │
│  🚆 Trains & Buses                                           │
│  ┌─────────┐                                                │
│  │  Omio   │                                                │
│  └─────────┘                                                │
└──────────────────────────────────────────────────────────────┘
```

### 2. Post-Confirmation Banner

When trip status = "confirmed":

```
┌──────────────────────────────────────────────────────────────┐
│  🎉 Your trip is confirmed! Don't forget these essentials:   │
│                                                              │
│  ┌───────────────────┐  ┌───────────────────┐               │
│  │ 📱 Get eSIM Data  │  │ ✈️ Flight Issues? │               │
│  │ Stay connected    │  │ Claim compensation│               │
│  │ [Yesim] [Saily]   │  │ [Check AirHelp]   │               │
│  └───────────────────┘  └───────────────────┘               │
└──────────────────────────────────────────────────────────────┘
```

### 3. Activity Booking CTA

For activities with `booking_required: true`:

```
┌───────────────────────────────────────────────────┐
│  🎟️ Skip-the-line Colosseum Tour         ~$45    │
│  📍 Colosseum, Rome                              │
│                                                   │
│  [Maps] [Search] [Book on Klook ↗] [Tiqets ↗]   │
└───────────────────────────────────────────────────┘
```

---

## PostHog Events

| Event | Properties | Trigger |
|-------|------------|---------|
| `booking_partner_click` | partner, type, destination, trip_id | CTA click |
| `booking_drawer_open` | type, trip_id | Drawer opens |
| `booking_drawer_complete` | type, origin, trip_id | Origin selected |
| `esim_cta_click` | partner, destination, trip_id | eSIM link click |
| `airhelp_cta_click` | trip_id | AirHelp click |
| `activity_booking_click` | partner, activity, trip_id | Activity booking |

---

## Implementation Order

1. **Phase 1**: Partner config + deep link generator
2. **Phase 2**: Update BookingPanel with new partners
3. **Phase 3**: Add activity-level booking CTAs
4. **Phase 4**: Post-confirmation suggestions
5. **Phase 5**: AI prompt enhancements
6. **Phase 6**: PostHog tracking + translations

---

## Files to Create/Modify

### New Files
- `lib/affiliates/partners.ts` - Partner configuration
- `lib/affiliates/deeplinks.ts` - Deep link generator
- `lib/affiliates/enrichment.ts` - City IATA mappings
- `components/booking/PostConfirmationBanner.tsx`
- `components/booking/PartnerButton.tsx`

### Modified Files
- `lib/affiliates/travelpayouts.ts` - Refactor to use new system
- `lib/affiliates/index.ts` - Export new functions
- `components/booking/BookingPanel.tsx` - Multi-partner layout
- `components/booking/BookingCTA.tsx` - Partner-aware CTAs
- `components/trip/EditableActivityCard.tsx` - Activity booking
- `lib/gemini.ts` - Booking-aware prompts
- `messages/*/common.json` - Translations
