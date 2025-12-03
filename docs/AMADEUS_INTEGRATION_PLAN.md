# Amadeus API Integration Plan for MonkeyTravel

## Executive Summary

This document outlines the comprehensive plan to integrate Amadeus Self-Service APIs into MonkeyTravel for real flight and hotel search/booking capabilities.

### Goals
1. **Flight Search**: Real-time flight offers from 500+ airlines
2. **Hotel Search**: Real-time hotel availability and pricing
3. **Price Confirmation**: Verify prices before user commitment
4. **Booking Flow**: Enable in-app booking (Phase 2)
5. **Cost Optimization**: Stay within free tier (2,000 calls/month) initially

---

## 1. Architecture Overview

### Current State
```
User Request → Gemini AI → Static booking_links URLs
                              ↓
                         Redirect to Skyscanner/Booking.com
```

### Target State
```
User Request → Gemini AI → Amadeus API → Real-time Results
                              ↓
                         In-app Search → Price Confirm → Book (Phase 2)
```

### Integration Points

| Component | Current | After Integration |
|-----------|---------|-------------------|
| Trip Generation | Static affiliate links | Real flight/hotel options |
| AI Assistant | Suggest activities | Search flights/hotels on demand |
| Trip Details | Display links | Interactive search + pricing |
| Booking Flow | Redirect | In-app confirmation (Phase 2) |

---

## 2. Amadeus API Overview

### Authentication
- **Method**: OAuth2 Client Credentials
- **Endpoint**: `POST /v1/security/oauth2/token`
- **Token Lifetime**: 1799 seconds (~30 minutes)
- **Auto-refresh**: Handled by SDK

### Rate Limits

| Environment | Limit | Constraint |
|-------------|-------|------------|
| Test | 10 TPS | 1 request per 100ms |
| Production | 20 TPS | 1 request per 50ms |

### Free Tier Limits
- **2,000 free calls/month** (applies across all apps)
- Overage: Pay-as-you-go pricing
- Different quotas per API endpoint

### APIs to Integrate

#### Flight APIs
| API | Purpose | Free Calls/Month |
|-----|---------|------------------|
| Flight Offers Search | Find flights | 2,000 |
| Flight Offers Price | Confirm price | 2,000 |
| Flight Create Orders | Book flight | 500 |
| Airport & City Search | Autocomplete | 10,000 |

#### Hotel APIs
| API | Purpose | Free Calls/Month |
|-----|---------|------------------|
| Hotel List | Find hotels by city | 2,000 |
| Hotel Search | Get offers/prices | 2,000 |
| Hotel Booking | Book hotel | 500 |

---

## 3. File Structure

### New Files to Create

```
lib/
├── amadeus/
│   ├── client.ts              # Amadeus SDK wrapper + auth
│   ├── flights.ts             # Flight search & booking logic
│   ├── hotels.ts              # Hotel search & booking logic
│   ├── types.ts               # Amadeus-specific TypeScript types
│   ├── cache.ts               # Response caching (reduce API calls)
│   ├── rate-limiter.ts        # Rate limiting queue
│   └── utils.ts               # IATA codes, date formatting, etc.

app/api/
├── amadeus/
│   ├── flights/
│   │   ├── search/route.ts    # GET /api/amadeus/flights/search
│   │   ├── price/route.ts     # POST /api/amadeus/flights/price
│   │   └── book/route.ts      # POST /api/amadeus/flights/book (Phase 2)
│   ├── hotels/
│   │   ├── search/route.ts    # GET /api/amadeus/hotels/search
│   │   ├── offers/route.ts    # GET /api/amadeus/hotels/offers
│   │   └── book/route.ts      # POST /api/amadeus/hotels/book (Phase 2)
│   └── locations/
│       └── search/route.ts    # GET /api/amadeus/locations/search

components/
├── booking/
│   ├── FlightSearch.tsx       # Flight search form + results
│   ├── FlightCard.tsx         # Individual flight offer display
│   ├── HotelSearch.tsx        # Hotel search form + results
│   ├── HotelCard.tsx          # Individual hotel offer display
│   ├── PriceConfirmation.tsx  # Price verification step
│   └── BookingModal.tsx       # Booking flow modal (Phase 2)

types/
└── amadeus.ts                 # Exported Amadeus types
```

### Files to Modify

| File | Changes |
|------|---------|
| `types/index.ts` | Add booking-related types, extend Trip type |
| `lib/gemini.ts` | Integrate real flight/hotel data in prompts |
| `app/api/ai/generate/route.ts` | Optionally fetch real prices during generation |
| `app/trips/[id]/TripDetailClient.tsx` | Add flight/hotel search tabs |
| `components/ai/AIAssistant.tsx` | Handle flight/hotel search intents |
| `.env.local` | Add Amadeus credentials |

---

## 4. Implementation Details

### 4.1 Environment Variables

```bash
# .env.local additions
AMADEUS_CLIENT_ID=your_client_id
AMADEUS_CLIENT_SECRET=your_client_secret
AMADEUS_HOSTNAME=test  # or 'production' for live
```

### 4.2 Amadeus Client (`lib/amadeus/client.ts`)

```typescript
import Amadeus from 'amadeus';

// Singleton pattern for client reuse
let amadeusClient: Amadeus | null = null;

export function getAmadeusClient(): Amadeus {
  if (!amadeusClient) {
    amadeusClient = new Amadeus({
      clientId: process.env.AMADEUS_CLIENT_ID!,
      clientSecret: process.env.AMADEUS_CLIENT_SECRET!,
      hostname: (process.env.AMADEUS_HOSTNAME as 'test' | 'production') || 'test',
      logLevel: process.env.NODE_ENV === 'development' ? 'debug' : 'silent',
    });
  }
  return amadeusClient;
}

// Token is managed automatically by SDK
// Refreshed every ~30 minutes
```

### 4.3 Type Definitions (`lib/amadeus/types.ts`)

```typescript
// Flight Search Request
export interface FlightSearchParams {
  origin: string;           // IATA code (e.g., "JFK")
  destination: string;      // IATA code (e.g., "CDG")
  departureDate: string;    // YYYY-MM-DD
  returnDate?: string;      // YYYY-MM-DD (optional for one-way)
  adults: number;           // 1-9
  children?: number;        // 0-8
  infants?: number;         // 0-8
  travelClass?: 'ECONOMY' | 'PREMIUM_ECONOMY' | 'BUSINESS' | 'FIRST';
  nonStop?: boolean;
  maxPrice?: number;
  max?: number;             // Max results (default 250)
}

// Flight Offer (simplified from Amadeus response)
export interface FlightOffer {
  id: string;
  source: string;
  instantTicketingRequired: boolean;
  nonHomogeneous: boolean;
  oneWay: boolean;
  lastTicketingDate: string;
  numberOfBookableSeats: number;
  itineraries: Itinerary[];
  price: FlightPrice;
  pricingOptions: PricingOptions;
  validatingAirlineCodes: string[];
  travelerPricings: TravelerPricing[];
}

export interface Itinerary {
  duration: string;         // ISO 8601 (e.g., "PT12H30M")
  segments: FlightSegment[];
}

export interface FlightSegment {
  departure: {
    iataCode: string;
    terminal?: string;
    at: string;             // ISO 8601 datetime
  };
  arrival: {
    iataCode: string;
    terminal?: string;
    at: string;
  };
  carrierCode: string;
  number: string;           // Flight number
  aircraft: { code: string };
  operating?: { carrierCode: string };
  duration: string;
  numberOfStops: number;
  blacklistedInEU: boolean;
}

export interface FlightPrice {
  currency: string;
  total: string;
  base: string;
  fees: Array<{ amount: string; type: string }>;
  grandTotal: string;
}

// Hotel Search Request
export interface HotelSearchParams {
  cityCode?: string;        // IATA city code
  latitude?: number;        // For geo search
  longitude?: number;
  radius?: number;          // km
  radiusUnit?: 'KM' | 'MILE';
  hotelIds?: string[];      // Specific hotel IDs
  checkInDate: string;      // YYYY-MM-DD
  checkOutDate: string;
  adults: number;
  roomQuantity?: number;
  priceRange?: string;      // "100-200"
  currency?: string;
  ratings?: string[];       // ["4", "5"]
  amenities?: string[];     // ["SWIMMING_POOL", "SPA"]
}

// Hotel Offer (simplified)
export interface HotelOffer {
  type: string;
  hotel: {
    hotelId: string;
    name: string;
    cityCode: string;
    chainCode?: string;
    latitude: number;
    longitude: number;
  };
  available: boolean;
  offers: Array<{
    id: string;
    checkInDate: string;
    checkOutDate: string;
    rateCode: string;
    room: {
      type: string;
      typeEstimated: {
        category: string;
        beds: number;
        bedType: string;
      };
      description: { text: string };
    };
    guests: { adults: number };
    price: {
      currency: string;
      base: string;
      total: string;
      variations?: {
        average: { base: string };
        changes: Array<{
          startDate: string;
          endDate: string;
          base: string;
        }>;
      };
    };
    policies?: {
      cancellation?: {
        deadline: string;
        amount: string;
      };
      paymentType: string;
    };
  }>;
}

// Location/Airport Search
export interface LocationResult {
  type: string;
  subType: 'AIRPORT' | 'CITY';
  name: string;
  iataCode: string;
  address: {
    cityName: string;
    cityCode: string;
    countryName: string;
    countryCode: string;
  };
}
```

### 4.4 Flight Search Service (`lib/amadeus/flights.ts`)

```typescript
import { getAmadeusClient } from './client';
import type { FlightSearchParams, FlightOffer } from './types';

export async function searchFlights(params: FlightSearchParams): Promise<{
  data: FlightOffer[];
  dictionaries: Record<string, unknown>;
}> {
  const amadeus = getAmadeusClient();

  const response = await amadeus.shopping.flightOffersSearch.get({
    originLocationCode: params.origin,
    destinationLocationCode: params.destination,
    departureDate: params.departureDate,
    returnDate: params.returnDate,
    adults: params.adults.toString(),
    children: params.children?.toString(),
    infants: params.infants?.toString(),
    travelClass: params.travelClass,
    nonStop: params.nonStop,
    maxPrice: params.maxPrice,
    max: params.max || 10, // Limit results to save quota
  });

  return {
    data: response.data as FlightOffer[],
    dictionaries: response.result.dictionaries,
  };
}

export async function confirmFlightPrice(flightOffer: FlightOffer): Promise<{
  data: FlightOffer;
  priceChanged: boolean;
}> {
  const amadeus = getAmadeusClient();

  const response = await amadeus.shopping.flightOffers.pricing.post(
    JSON.stringify({
      data: {
        type: 'flight-offers-pricing',
        flightOffers: [flightOffer],
      },
    })
  );

  const confirmedOffer = response.data.flightOffers[0] as FlightOffer;
  const priceChanged = confirmedOffer.price.grandTotal !== flightOffer.price.grandTotal;

  return { data: confirmedOffer, priceChanged };
}

// Phase 2: Booking
export async function createFlightOrder(
  flightOffer: FlightOffer,
  travelers: TravelerInfo[],
  contact: ContactInfo
): Promise<{ orderId: string; reference: string }> {
  const amadeus = getAmadeusClient();

  const response = await amadeus.booking.flightOrders.post(
    JSON.stringify({
      data: {
        type: 'flight-order',
        flightOffers: [flightOffer],
        travelers,
        remarks: {
          general: [{ subType: 'GENERAL_MISCELLANEOUS', text: 'MonkeyTravel Booking' }],
        },
        ticketingAgreement: { option: 'DELAY_TO_QUEUE' },
        contacts: [contact],
      },
    })
  );

  return {
    orderId: response.data.id,
    reference: response.data.associatedRecords[0].reference,
  };
}
```

### 4.5 Hotel Search Service (`lib/amadeus/hotels.ts`)

```typescript
import { getAmadeusClient } from './client';
import type { HotelSearchParams, HotelOffer } from './types';

export async function searchHotelsByCity(cityCode: string): Promise<{
  data: Array<{ hotelId: string; name: string; iataCode: string }>;
}> {
  const amadeus = getAmadeusClient();

  const response = await amadeus.referenceData.locations.hotels.byCity.get({
    cityCode,
    radius: 30,
    radiusUnit: 'KM',
    ratings: ['4', '5'], // 4-5 star hotels
  });

  return { data: response.data };
}

export async function searchHotelOffers(params: HotelSearchParams): Promise<{
  data: HotelOffer[];
}> {
  const amadeus = getAmadeusClient();

  // First get hotel IDs if not provided
  let hotelIds = params.hotelIds;
  if (!hotelIds && params.cityCode) {
    const hotels = await searchHotelsByCity(params.cityCode);
    hotelIds = hotels.data.slice(0, 20).map(h => h.hotelId); // Limit to 20
  }

  if (!hotelIds || hotelIds.length === 0) {
    return { data: [] };
  }

  const response = await amadeus.shopping.hotelOffersSearch.get({
    hotelIds: hotelIds.join(','),
    adults: params.adults.toString(),
    checkInDate: params.checkInDate,
    checkOutDate: params.checkOutDate,
    roomQuantity: params.roomQuantity?.toString() || '1',
    currency: params.currency || 'USD',
  });

  return { data: response.data as HotelOffer[] };
}
```

### 4.6 Rate Limiter (`lib/amadeus/rate-limiter.ts`)

```typescript
// Simple rate limiter for Amadeus API (10 TPS test, 20 TPS prod)
const RATE_LIMIT_MS = process.env.AMADEUS_HOSTNAME === 'production' ? 50 : 100;

let lastRequestTime = 0;
const requestQueue: Array<() => Promise<void>> = [];
let isProcessing = false;

async function processQueue() {
  if (isProcessing || requestQueue.length === 0) return;

  isProcessing = true;

  while (requestQueue.length > 0) {
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime;

    if (timeSinceLastRequest < RATE_LIMIT_MS) {
      await new Promise(resolve =>
        setTimeout(resolve, RATE_LIMIT_MS - timeSinceLastRequest)
      );
    }

    const request = requestQueue.shift();
    if (request) {
      lastRequestTime = Date.now();
      await request();
    }
  }

  isProcessing = false;
}

export function enqueueRequest<T>(request: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    requestQueue.push(async () => {
      try {
        const result = await request();
        resolve(result);
      } catch (error) {
        reject(error);
      }
    });
    processQueue();
  });
}
```

### 4.7 Caching Layer (`lib/amadeus/cache.ts`)

```typescript
import { createClient } from '@/lib/supabase/server';

interface CacheEntry {
  data: unknown;
  timestamp: number;
  expiresAt: number;
}

// In-memory cache for short-term caching
const memoryCache = new Map<string, CacheEntry>();

// Cache TTLs (in milliseconds)
const CACHE_TTL = {
  locations: 24 * 60 * 60 * 1000,     // 24 hours - rarely change
  flights: 5 * 60 * 1000,              // 5 minutes - prices volatile
  hotels: 15 * 60 * 1000,              // 15 minutes
  hotelList: 24 * 60 * 60 * 1000,     // 24 hours
};

export function getCacheKey(type: string, params: Record<string, unknown>): string {
  const sortedParams = Object.keys(params)
    .sort()
    .map(k => `${k}=${params[k]}`)
    .join('&');
  return `amadeus:${type}:${sortedParams}`;
}

export function getFromCache<T>(key: string): T | null {
  const entry = memoryCache.get(key);
  if (!entry) return null;

  if (Date.now() > entry.expiresAt) {
    memoryCache.delete(key);
    return null;
  }

  return entry.data as T;
}

export function setCache(key: string, data: unknown, type: keyof typeof CACHE_TTL): void {
  const ttl = CACHE_TTL[type];
  memoryCache.set(key, {
    data,
    timestamp: Date.now(),
    expiresAt: Date.now() + ttl,
  });
}

// Cleanup old entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of memoryCache.entries()) {
    if (now > entry.expiresAt) {
      memoryCache.delete(key);
    }
  }
}, 60 * 1000); // Every minute
```

---

## 5. API Routes Implementation

### 5.1 Flight Search Route (`app/api/amadeus/flights/search/route.ts`)

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { searchFlights } from '@/lib/amadeus/flights';
import { enqueueRequest } from '@/lib/amadeus/rate-limiter';
import { getCacheKey, getFromCache, setCache } from '@/lib/amadeus/cache';
import type { FlightSearchParams } from '@/lib/amadeus/types';

export async function GET(request: NextRequest) {
  const startTime = Date.now();

  try {
    // Auth check
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse params
    const searchParams = request.nextUrl.searchParams;
    const params: FlightSearchParams = {
      origin: searchParams.get('origin') || '',
      destination: searchParams.get('destination') || '',
      departureDate: searchParams.get('departureDate') || '',
      returnDate: searchParams.get('returnDate') || undefined,
      adults: parseInt(searchParams.get('adults') || '1'),
      travelClass: searchParams.get('travelClass') as FlightSearchParams['travelClass'],
      nonStop: searchParams.get('nonStop') === 'true',
      max: parseInt(searchParams.get('max') || '10'),
    };

    // Validate required params
    if (!params.origin || !params.destination || !params.departureDate) {
      return NextResponse.json(
        { error: 'Missing required parameters: origin, destination, departureDate' },
        { status: 400 }
      );
    }

    // Check cache
    const cacheKey = getCacheKey('flights', params);
    const cached = getFromCache<typeof result>(cacheKey);
    if (cached) {
      return NextResponse.json({ ...cached, cached: true });
    }

    // Search with rate limiting
    const result = await enqueueRequest(() => searchFlights(params));

    // Cache results
    setCache(cacheKey, result, 'flights');

    // Log API usage
    await supabase.from('api_request_logs').insert({
      api_name: 'amadeus',
      endpoint: '/flights/search',
      request_params: { user_id: user.id, ...params },
      response_status: 200,
      response_time_ms: Date.now() - startTime,
      cache_hit: false,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('[Amadeus Flights] Search error:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const statusCode = errorMessage.includes('429') ? 429 : 500;

    return NextResponse.json(
      { error: 'Failed to search flights', details: errorMessage },
      { status: statusCode }
    );
  }
}
```

### 5.2 Hotel Search Route (`app/api/amadeus/hotels/search/route.ts`)

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { searchHotelOffers } from '@/lib/amadeus/hotels';
import { enqueueRequest } from '@/lib/amadeus/rate-limiter';
import { getCacheKey, getFromCache, setCache } from '@/lib/amadeus/cache';
import type { HotelSearchParams } from '@/lib/amadeus/types';

export async function GET(request: NextRequest) {
  const startTime = Date.now();

  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const params: HotelSearchParams = {
      cityCode: searchParams.get('cityCode') || undefined,
      checkInDate: searchParams.get('checkInDate') || '',
      checkOutDate: searchParams.get('checkOutDate') || '',
      adults: parseInt(searchParams.get('adults') || '2'),
      roomQuantity: parseInt(searchParams.get('rooms') || '1'),
      ratings: searchParams.get('ratings')?.split(','),
    };

    if (!params.cityCode || !params.checkInDate || !params.checkOutDate) {
      return NextResponse.json(
        { error: 'Missing required parameters: cityCode, checkInDate, checkOutDate' },
        { status: 400 }
      );
    }

    const cacheKey = getCacheKey('hotels', params);
    const cached = getFromCache<typeof result>(cacheKey);
    if (cached) {
      return NextResponse.json({ ...cached, cached: true });
    }

    const result = await enqueueRequest(() => searchHotelOffers(params));
    setCache(cacheKey, result, 'hotels');

    await supabase.from('api_request_logs').insert({
      api_name: 'amadeus',
      endpoint: '/hotels/search',
      request_params: { user_id: user.id, ...params },
      response_status: 200,
      response_time_ms: Date.now() - startTime,
      cache_hit: false,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('[Amadeus Hotels] Search error:', error);
    return NextResponse.json(
      { error: 'Failed to search hotels' },
      { status: 500 }
    );
  }
}
```

### 5.3 Location Search Route (`app/api/amadeus/locations/search/route.ts`)

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getAmadeusClient } from '@/lib/amadeus/client';
import { getCacheKey, getFromCache, setCache } from '@/lib/amadeus/cache';

export async function GET(request: NextRequest) {
  try {
    const keyword = request.nextUrl.searchParams.get('keyword');
    if (!keyword || keyword.length < 2) {
      return NextResponse.json({ data: [] });
    }

    const cacheKey = getCacheKey('locations', { keyword });
    const cached = getFromCache(cacheKey);
    if (cached) {
      return NextResponse.json(cached);
    }

    const amadeus = getAmadeusClient();
    const response = await amadeus.referenceData.locations.get({
      keyword,
      subType: 'CITY,AIRPORT',
      'page[limit]': 10,
    });

    const result = { data: response.data };
    setCache(cacheKey, result, 'locations');

    return NextResponse.json(result);
  } catch (error) {
    console.error('[Amadeus Locations] Search error:', error);
    return NextResponse.json({ data: [] });
  }
}
```

---

## 6. Frontend Components

### 6.1 Flight Search Component (`components/booking/FlightSearch.tsx`)

```tsx
"use client";

import { useState, useCallback } from 'react';
import { useDebounce } from '@/hooks/useDebounce';
import type { FlightOffer, LocationResult } from '@/lib/amadeus/types';

interface FlightSearchProps {
  tripDestination: string;
  tripStartDate: string;
  tripEndDate: string;
  onFlightSelect?: (flight: FlightOffer) => void;
}

export default function FlightSearch({
  tripDestination,
  tripStartDate,
  tripEndDate,
  onFlightSelect,
}: FlightSearchProps) {
  const [origin, setOrigin] = useState('');
  const [originSuggestions, setOriginSuggestions] = useState<LocationResult[]>([]);
  const [selectedOrigin, setSelectedOrigin] = useState<LocationResult | null>(null);
  const [flights, setFlights] = useState<FlightOffer[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const debouncedOrigin = useDebounce(origin, 300);

  // Fetch location suggestions
  const fetchSuggestions = useCallback(async (keyword: string) => {
    if (keyword.length < 2) {
      setOriginSuggestions([]);
      return;
    }

    try {
      const response = await fetch(
        `/api/amadeus/locations/search?keyword=${encodeURIComponent(keyword)}`
      );
      const data = await response.json();
      setOriginSuggestions(data.data || []);
    } catch {
      setOriginSuggestions([]);
    }
  }, []);

  // Search flights
  const searchFlights = async () => {
    if (!selectedOrigin) {
      setError('Please select a departure city');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        origin: selectedOrigin.iataCode,
        destination: tripDestination, // Needs IATA code
        departureDate: tripStartDate,
        returnDate: tripEndDate,
        adults: '1',
        max: '10',
      });

      const response = await fetch(`/api/amadeus/flights/search?${params}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to search flights');
      }

      setFlights(data.data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6">
      <h3 className="text-lg font-semibold text-slate-900 mb-4">
        Find Flights to {tripDestination}
      </h3>

      {/* Origin Input with Autocomplete */}
      <div className="relative mb-4">
        <label className="block text-sm font-medium text-slate-700 mb-1">
          Departing from
        </label>
        <input
          type="text"
          value={origin}
          onChange={(e) => {
            setOrigin(e.target.value);
            fetchSuggestions(e.target.value);
          }}
          placeholder="City or airport..."
          className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 outline-none"
        />

        {/* Suggestions Dropdown */}
        {originSuggestions.length > 0 && (
          <div className="absolute z-10 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-60 overflow-auto">
            {originSuggestions.map((loc) => (
              <button
                key={loc.iataCode}
                onClick={() => {
                  setSelectedOrigin(loc);
                  setOrigin(`${loc.name} (${loc.iataCode})`);
                  setOriginSuggestions([]);
                }}
                className="w-full px-4 py-2 text-left hover:bg-slate-50 flex items-center gap-2"
              >
                <span className="text-slate-900">{loc.name}</span>
                <span className="text-slate-500 text-sm">({loc.iataCode})</span>
                <span className="text-slate-400 text-xs ml-auto">
                  {loc.address.countryName}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Search Button */}
      <button
        onClick={searchFlights}
        disabled={loading || !selectedOrigin}
        className="w-full bg-[var(--primary)] text-white py-2 rounded-lg font-medium hover:bg-[var(--primary)]/90 disabled:opacity-50"
      >
        {loading ? 'Searching...' : 'Search Flights'}
      </button>

      {/* Error */}
      {error && (
        <div className="mt-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* Results */}
      {flights.length > 0 && (
        <div className="mt-6 space-y-4">
          <h4 className="font-medium text-slate-900">
            {flights.length} flights found
          </h4>
          {flights.map((flight) => (
            <FlightCard
              key={flight.id}
              flight={flight}
              onSelect={() => onFlightSelect?.(flight)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
```

---

## 7. Integration with Existing Features

### 7.1 Enhance Trip Generation

Modify `lib/gemini.ts` to optionally include real flight prices:

```typescript
// In buildUserPrompt(), add real pricing context if available
async function buildUserPromptWithPricing(params: TripCreationParams): Promise<string> {
  const basePrompt = buildUserPrompt(params);

  // Optionally fetch real price estimates (uses 1 API call)
  try {
    const priceEstimate = await getFlightPriceEstimate(
      'NYC', // Default origin for estimates
      params.destination,
      params.startDate
    );

    return `${basePrompt}

## Real-Time Price Context
Current flight prices from major US cities to ${params.destination}:
- Estimated round-trip: ${priceEstimate.currency} ${priceEstimate.minPrice} - ${priceEstimate.maxPrice}

Use these real prices to inform your budget estimates.`;
  } catch {
    return basePrompt; // Fallback to regular prompt
  }
}
```

### 7.2 AI Assistant Flight/Hotel Intent

Add to `app/api/ai/assistant/route.ts`:

```typescript
// Detect booking intent
function detectBookingIntent(message: string): {
  type: 'flight' | 'hotel' | null;
  params: Record<string, string>;
} {
  const flightKeywords = ['flight', 'fly', 'plane', 'airline', 'airport'];
  const hotelKeywords = ['hotel', 'stay', 'accommodation', 'room', 'booking'];

  const lowerMessage = message.toLowerCase();

  if (flightKeywords.some(k => lowerMessage.includes(k))) {
    return { type: 'flight', params: {} };
  }

  if (hotelKeywords.some(k => lowerMessage.includes(k))) {
    return { type: 'hotel', params: {} };
  }

  return { type: null, params: {} };
}

// In POST handler, add booking search capability
const bookingIntent = detectBookingIntent(message);
if (bookingIntent.type === 'flight') {
  // Return structured card with flight search UI
  return NextResponse.json({
    message: {
      role: 'assistant',
      content: "I'll help you find flights. Use the search panel to find the best options.",
      card: {
        type: 'flight_search',
        destination: tripContext.destination,
        dates: {
          start: tripContext.startDate,
          end: tripContext.endDate,
        },
      },
    },
  });
}
```

---

## 8. Database Schema Updates

### 8.1 New Tables

```sql
-- Store user's saved flight/hotel searches
CREATE TABLE saved_searches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  trip_id UUID REFERENCES trips(id) ON DELETE CASCADE,
  search_type TEXT NOT NULL CHECK (search_type IN ('flight', 'hotel')),
  search_params JSONB NOT NULL,
  results_count INTEGER,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Store selected flights/hotels for a trip
CREATE TABLE trip_bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID REFERENCES trips(id) ON DELETE CASCADE,
  booking_type TEXT NOT NULL CHECK (booking_type IN ('flight', 'hotel')),
  provider TEXT NOT NULL DEFAULT 'amadeus',
  offer_data JSONB NOT NULL,          -- Full Amadeus offer object
  price_confirmed BOOLEAN DEFAULT FALSE,
  confirmed_price JSONB,               -- Price at confirmation time
  booking_reference TEXT,              -- PNR or confirmation number
  booking_status TEXT DEFAULT 'selected' CHECK (
    booking_status IN ('selected', 'price_confirmed', 'booked', 'cancelled')
  ),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Index for faster lookups
CREATE INDEX idx_trip_bookings_trip ON trip_bookings(trip_id);
CREATE INDEX idx_saved_searches_user ON saved_searches(user_id);
```

### 8.2 Update Trip Type

```typescript
// In types/index.ts, extend Trip
export interface Trip {
  // ... existing fields ...

  // New booking fields
  bookings?: {
    flights: TripBooking[];
    hotels: TripBooking[];
  };
}

export interface TripBooking {
  id: string;
  booking_type: 'flight' | 'hotel';
  provider: 'amadeus';
  offer_data: FlightOffer | HotelOffer;
  price_confirmed: boolean;
  confirmed_price?: FlightPrice | HotelPrice;
  booking_reference?: string;
  booking_status: 'selected' | 'price_confirmed' | 'booked' | 'cancelled';
  created_at: string;
}
```

---

## 9. Implementation Phases

### Phase 1: Foundation (Week 1)
- [x] Research & Documentation
- [ ] Set up Amadeus developer account
- [ ] Add environment variables
- [ ] Create `lib/amadeus/` client and types
- [ ] Implement rate limiter and cache
- [ ] Create location search API route
- [ ] Test authentication flow

### Phase 2: Flight Search (Week 2)
- [ ] Implement flight search service
- [ ] Create flight search API route
- [ ] Build FlightSearch component
- [ ] Build FlightCard component
- [ ] Add flight search to trip detail page
- [ ] Test with real API calls

### Phase 3: Hotel Search (Week 2-3)
- [ ] Implement hotel search service
- [ ] Create hotel search API routes
- [ ] Build HotelSearch component
- [ ] Build HotelCard component
- [ ] Add hotel search to trip detail page

### Phase 4: AI Integration (Week 3)
- [ ] Add booking intent detection to AI Assistant
- [ ] Create structured cards for flight/hotel results
- [ ] Enhance trip generation with real pricing
- [ ] Test end-to-end flows

### Phase 5: Booking Flow (Phase 2 - Future)
- [ ] Implement price confirmation
- [ ] Build PriceConfirmation component
- [ ] Implement flight/hotel booking
- [ ] Set up consolidator partnership
- [ ] Add payment integration

---

## 10. Cost Projections

### Monthly API Usage Estimates

| Scenario | Flight Searches | Hotel Searches | Total Calls | Cost |
|----------|-----------------|----------------|-------------|------|
| Low (100 users) | 500 | 300 | 800 | **$0** (free tier) |
| Medium (500 users) | 2,500 | 1,500 | 4,000 | ~$8-16 |
| High (2,000 users) | 10,000 | 6,000 | 16,000 | ~$56-112 |

### Optimization Strategies
1. **Caching**: 5-15 min cache reduces duplicate calls by ~60%
2. **Limit results**: Request max 10 results vs default 250
3. **Lazy loading**: Only search when user requests
4. **Rate limiting**: Queue requests to avoid 429 errors

---

## 11. Testing Strategy

### Unit Tests
```typescript
// lib/amadeus/__tests__/flights.test.ts
describe('Flight Search', () => {
  it('returns flight offers for valid params', async () => {
    const result = await searchFlights({
      origin: 'JFK',
      destination: 'CDG',
      departureDate: '2025-06-01',
      adults: 1,
    });
    expect(result.data).toBeInstanceOf(Array);
    expect(result.data[0]).toHaveProperty('price');
  });

  it('handles rate limit errors gracefully', async () => {
    // Mock rate limit response
    // ...
  });
});
```

### Integration Tests
- Test with Amadeus test environment
- Verify cache behavior
- Test error handling
- Validate response parsing

### E2E Tests
- Complete flight search flow
- Complete hotel search flow
- AI Assistant booking intent detection

---

## 12. Monitoring & Observability

### Metrics to Track
- API call count per endpoint
- Cache hit rate
- Average response time
- Error rate by type
- Cost per user

### Logging
```typescript
// Structured logging for Amadeus calls
console.log(JSON.stringify({
  timestamp: new Date().toISOString(),
  service: 'amadeus',
  endpoint: '/flights/search',
  params: { origin, destination, departureDate },
  responseTime: Date.now() - startTime,
  cacheHit: false,
  resultCount: flights.length,
}));
```

---

## Summary

This integration plan provides a comprehensive roadmap for adding Amadeus flight and hotel search to MonkeyTravel. Key highlights:

1. **Minimal disruption**: New routes and components, few changes to existing code
2. **Cost-effective**: Aggressive caching and rate limiting to stay in free tier
3. **Scalable**: Architecture supports future booking capabilities
4. **Type-safe**: Full TypeScript coverage for Amadeus responses
5. **Observable**: Built-in logging and monitoring

Next steps: Begin Phase 1 implementation after plan approval.
