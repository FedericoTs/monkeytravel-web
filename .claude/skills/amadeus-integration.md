# Amadeus Integration Skill

A skill for integrating Amadeus travel APIs for flight search, hotel booking, and travel services.

## Overview

This skill provides patterns and implementations for connecting to Amadeus Self-Service APIs to enhance travel itineraries with real booking capabilities.

**Note**: This is designed for future enhancement (post-POC). The POC will focus on itinerary generation first.

---

## Amadeus API Setup

### Getting Started

1. Create account at [Amadeus for Developers](https://developers.amadeus.com/)
2. Create a new app in the dashboard
3. Get API Key and API Secret
4. Use Test environment for development (free, limited data)

### Environment Variables

```env
AMADEUS_API_KEY=your-api-key
AMADEUS_API_SECRET=your-api-secret
AMADEUS_ENV=test  # or 'production'
```

### SDK Installation

```bash
npm install amadeus
```

---

## Client Configuration

```typescript
// lib/amadeus.ts

import Amadeus from "amadeus";

const amadeus = new Amadeus({
  clientId: process.env.AMADEUS_API_KEY!,
  clientSecret: process.env.AMADEUS_API_SECRET!,
  hostname: process.env.AMADEUS_ENV === "production"
    ? "production"
    : "test",
});

export default amadeus;

// Helper to handle API errors
export class AmadeusError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public details?: unknown
  ) {
    super(message);
    this.name = "AmadeusError";
  }
}

export function handleAmadeusError(error: unknown): never {
  if (error && typeof error === "object" && "response" in error) {
    const response = (error as { response: { statusCode: number; result: unknown } }).response;
    throw new AmadeusError(
      "Amadeus API error",
      response.statusCode,
      response.result
    );
  }
  throw error;
}
```

---

## Flight Search API

### Search for Flights

```typescript
// lib/amadeus/flights.ts

import amadeus, { handleAmadeusError } from "../amadeus";

export interface FlightSearchParams {
  origin: string;        // IATA code (e.g., "JFK")
  destination: string;   // IATA code (e.g., "CDG")
  departureDate: string; // YYYY-MM-DD
  returnDate?: string;   // YYYY-MM-DD (optional for one-way)
  adults: number;
  travelClass?: "ECONOMY" | "PREMIUM_ECONOMY" | "BUSINESS" | "FIRST";
  maxResults?: number;
}

export interface FlightOffer {
  id: string;
  price: {
    total: string;
    currency: string;
    grandTotal: string;
  };
  itineraries: Array<{
    duration: string;
    segments: Array<{
      departure: {
        iataCode: string;
        at: string;
      };
      arrival: {
        iataCode: string;
        at: string;
      };
      carrierCode: string;
      number: string;
      duration: string;
    }>;
  }>;
  validatingAirlineCodes: string[];
  numberOfBookableSeats: number;
}

export async function searchFlights(
  params: FlightSearchParams
): Promise<FlightOffer[]> {
  try {
    const response = await amadeus.shopping.flightOffersSearch.get({
      originLocationCode: params.origin,
      destinationLocationCode: params.destination,
      departureDate: params.departureDate,
      returnDate: params.returnDate,
      adults: params.adults,
      travelClass: params.travelClass || "ECONOMY",
      max: params.maxResults || 10,
      currencyCode: "USD",
    });

    return response.data as FlightOffer[];
  } catch (error) {
    handleAmadeusError(error);
  }
}

// Get cheapest flight for a date range
export async function getCheapestFlights(params: {
  origin: string;
  destination: string;
  departureDate: string;
  adults?: number;
}): Promise<FlightOffer[]> {
  try {
    const response = await amadeus.shopping.flightOffersSearch.get({
      originLocationCode: params.origin,
      destinationLocationCode: params.destination,
      departureDate: params.departureDate,
      adults: params.adults || 1,
      max: 5,
      currencyCode: "USD",
    });

    // Sort by price
    const offers = response.data as FlightOffer[];
    return offers.sort(
      (a, b) => parseFloat(a.price.total) - parseFloat(b.price.total)
    );
  } catch (error) {
    handleAmadeusError(error);
  }
}
```

### API Route for Flights

```typescript
// app/api/flights/search/route.ts

import { NextRequest, NextResponse } from "next/server";
import { searchFlights, FlightSearchParams } from "@/lib/amadeus/flights";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  const searchParams: FlightSearchParams = {
    origin: params.get("origin") || "",
    destination: params.get("destination") || "",
    departureDate: params.get("departureDate") || "",
    returnDate: params.get("returnDate") || undefined,
    adults: parseInt(params.get("adults") || "1"),
    travelClass: (params.get("travelClass") as FlightSearchParams["travelClass"]) || undefined,
  };

  // Validation
  if (!searchParams.origin || !searchParams.destination || !searchParams.departureDate) {
    return NextResponse.json(
      { error: "Missing required parameters" },
      { status: 400 }
    );
  }

  try {
    const flights = await searchFlights(searchParams);

    return NextResponse.json({
      success: true,
      count: flights.length,
      flights,
    });
  } catch (error) {
    console.error("Flight search error:", error);
    return NextResponse.json(
      { error: "Failed to search flights" },
      { status: 500 }
    );
  }
}
```

---

## Hotel Search API

### Search for Hotels

```typescript
// lib/amadeus/hotels.ts

import amadeus, { handleAmadeusError } from "../amadeus";

export interface HotelSearchParams {
  cityCode: string;      // IATA code (e.g., "PAR" for Paris)
  checkInDate: string;   // YYYY-MM-DD
  checkOutDate: string;  // YYYY-MM-DD
  adults: number;
  roomQuantity?: number;
  priceRange?: string;   // e.g., "100-300"
  currency?: string;
  ratings?: string[];    // ["3", "4", "5"]
}

export interface HotelOffer {
  hotel: {
    hotelId: string;
    name: string;
    rating: string;
    cityCode: string;
    latitude: number;
    longitude: number;
    address: {
      lines: string[];
      cityName: string;
      countryCode: string;
    };
  };
  offers: Array<{
    id: string;
    checkInDate: string;
    checkOutDate: string;
    room: {
      type: string;
      description: {
        text: string;
      };
    };
    price: {
      total: string;
      currency: string;
    };
  }>;
}

export async function searchHotels(
  params: HotelSearchParams
): Promise<HotelOffer[]> {
  try {
    // First, get hotel list for the city
    const hotelList = await amadeus.referenceData.locations.hotels.byCity.get({
      cityCode: params.cityCode,
    });

    const hotelIds = hotelList.data.slice(0, 20).map((h: { hotelId: string }) => h.hotelId);

    if (hotelIds.length === 0) {
      return [];
    }

    // Then get offers for those hotels
    const offersResponse = await amadeus.shopping.hotelOffersSearch.get({
      hotelIds: hotelIds.join(","),
      checkInDate: params.checkInDate,
      checkOutDate: params.checkOutDate,
      adults: params.adults,
      roomQuantity: params.roomQuantity || 1,
      currency: params.currency || "USD",
    });

    return offersResponse.data as HotelOffer[];
  } catch (error) {
    handleAmadeusError(error);
  }
}

// Get hotel details by ID
export async function getHotelDetails(hotelId: string): Promise<unknown> {
  try {
    const response = await amadeus.shopping.hotelOfferSearch.get({
      hotelId,
    });
    return response.data;
  } catch (error) {
    handleAmadeusError(error);
  }
}
```

### API Route for Hotels

```typescript
// app/api/hotels/search/route.ts

import { NextRequest, NextResponse } from "next/server";
import { searchHotels, HotelSearchParams } from "@/lib/amadeus/hotels";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  const searchParams: HotelSearchParams = {
    cityCode: params.get("cityCode") || "",
    checkInDate: params.get("checkInDate") || "",
    checkOutDate: params.get("checkOutDate") || "",
    adults: parseInt(params.get("adults") || "1"),
    roomQuantity: parseInt(params.get("rooms") || "1"),
    currency: params.get("currency") || "USD",
  };

  // Validation
  if (!searchParams.cityCode || !searchParams.checkInDate || !searchParams.checkOutDate) {
    return NextResponse.json(
      { error: "Missing required parameters" },
      { status: 400 }
    );
  }

  try {
    const hotels = await searchHotels(searchParams);

    // Sort by price
    const sorted = hotels.sort((a, b) => {
      const priceA = parseFloat(a.offers[0]?.price.total || "0");
      const priceB = parseFloat(b.offers[0]?.price.total || "0");
      return priceA - priceB;
    });

    return NextResponse.json({
      success: true,
      count: sorted.length,
      hotels: sorted,
    });
  } catch (error) {
    console.error("Hotel search error:", error);
    return NextResponse.json(
      { error: "Failed to search hotels" },
      { status: 500 }
    );
  }
}
```

---

## Location/Airport Search

```typescript
// lib/amadeus/locations.ts

import amadeus, { handleAmadeusError } from "../amadeus";

export interface Location {
  type: string;
  subType: string;  // "AIRPORT" | "CITY"
  name: string;
  iataCode: string;
  address: {
    cityName: string;
    countryCode: string;
  };
}

export async function searchLocations(keyword: string): Promise<Location[]> {
  try {
    const response = await amadeus.referenceData.locations.get({
      keyword,
      subType: "AIRPORT,CITY",
    });

    return response.data as Location[];
  } catch (error) {
    handleAmadeusError(error);
  }
}

// Get IATA code for a city name
export async function getCityCode(cityName: string): Promise<string | null> {
  const locations = await searchLocations(cityName);
  const city = locations.find((l) => l.subType === "CITY");
  return city?.iataCode || null;
}

// Get airport code for a city
export async function getAirportCode(cityName: string): Promise<string | null> {
  const locations = await searchLocations(cityName);
  const airport = locations.find((l) => l.subType === "AIRPORT");
  return airport?.iataCode || null;
}
```

### Location Autocomplete API

```typescript
// app/api/locations/search/route.ts

import { NextRequest, NextResponse } from "next/server";
import { searchLocations } from "@/lib/amadeus/locations";

export async function GET(request: NextRequest) {
  const keyword = request.nextUrl.searchParams.get("q");

  if (!keyword || keyword.length < 2) {
    return NextResponse.json({ locations: [] });
  }

  try {
    const locations = await searchLocations(keyword);

    // Format for autocomplete
    const formatted = locations.map((loc) => ({
      code: loc.iataCode,
      name: loc.name,
      city: loc.address.cityName,
      country: loc.address.countryCode,
      type: loc.subType.toLowerCase(),
    }));

    return NextResponse.json({
      success: true,
      locations: formatted,
    });
  } catch (error) {
    console.error("Location search error:", error);
    return NextResponse.json({ locations: [] });
  }
}
```

---

## Points of Interest (POI)

```typescript
// lib/amadeus/poi.ts

import amadeus, { handleAmadeusError } from "../amadeus";

export interface PointOfInterest {
  id: string;
  name: string;
  category: string;
  rank: number;
  geoCode: {
    latitude: number;
    longitude: number;
  };
}

export async function getPointsOfInterest(
  latitude: number,
  longitude: number,
  radius?: number
): Promise<PointOfInterest[]> {
  try {
    const response = await amadeus.referenceData.locations.pointsOfInterest.get({
      latitude,
      longitude,
      radius: radius || 2, // km
    });

    return response.data as PointOfInterest[];
  } catch (error) {
    handleAmadeusError(error);
  }
}

// Get POIs by city square (bounding box)
export async function getPointsOfInterestBySquare(params: {
  north: number;
  west: number;
  south: number;
  east: number;
}): Promise<PointOfInterest[]> {
  try {
    const response = await amadeus.referenceData.locations.pointsOfInterest.bySquare.get({
      ...params,
    });

    return response.data as PointOfInterest[];
  } catch (error) {
    handleAmadeusError(error);
  }
}
```

---

## Caching Strategy

To reduce API costs, implement caching for Amadeus responses:

```typescript
// lib/amadeus/cache.ts

import { supabase } from "../supabase";

const CACHE_DURATIONS = {
  locations: 7 * 24 * 60 * 60 * 1000,  // 7 days
  flights: 15 * 60 * 1000,              // 15 minutes
  hotels: 60 * 60 * 1000,               // 1 hour
  poi: 24 * 60 * 60 * 1000,             // 24 hours
};

export async function getCached<T>(
  cacheKey: string,
  type: keyof typeof CACHE_DURATIONS
): Promise<T | null> {
  const { data } = await supabase
    .from("amadeus_cache")
    .select("data, created_at")
    .eq("cache_key", cacheKey)
    .single();

  if (!data) return null;

  const age = Date.now() - new Date(data.created_at).getTime();
  if (age > CACHE_DURATIONS[type]) {
    // Cache expired
    await supabase.from("amadeus_cache").delete().eq("cache_key", cacheKey);
    return null;
  }

  return data.data as T;
}

export async function setCache<T>(
  cacheKey: string,
  type: keyof typeof CACHE_DURATIONS,
  data: T
): Promise<void> {
  await supabase.from("amadeus_cache").upsert({
    cache_key: cacheKey,
    cache_type: type,
    data,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + CACHE_DURATIONS[type]).toISOString(),
  });
}

// Wrapper to use with any Amadeus call
export async function withCache<T>(
  cacheKey: string,
  type: keyof typeof CACHE_DURATIONS,
  fetchFn: () => Promise<T>
): Promise<T> {
  const cached = await getCached<T>(cacheKey, type);
  if (cached) return cached;

  const data = await fetchFn();
  await setCache(cacheKey, type, data);
  return data;
}
```

### Cache Table Migration

```sql
-- Migration: Create amadeus_cache table

CREATE TABLE amadeus_cache (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cache_key TEXT UNIQUE NOT NULL,
  cache_type TEXT NOT NULL,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

-- Index for cleanup
CREATE INDEX idx_amadeus_cache_expires ON amadeus_cache(expires_at);

-- Cleanup function (run daily)
CREATE OR REPLACE FUNCTION cleanup_expired_amadeus_cache()
RETURNS void AS $$
BEGIN
  DELETE FROM amadeus_cache WHERE expires_at < NOW();
END;
$$ LANGUAGE plpgsql;
```

---

## Error Handling

```typescript
// Common Amadeus error codes and handling

export function getAmadeusErrorMessage(statusCode: number, details?: unknown): string {
  switch (statusCode) {
    case 400:
      return "Invalid request parameters. Please check your search criteria.";
    case 401:
      return "API authentication failed. Please check credentials.";
    case 429:
      return "Too many requests. Please try again in a moment.";
    case 500:
      return "Amadeus service is temporarily unavailable.";
    default:
      return "An error occurred while searching. Please try again.";
  }
}

// Retry logic for transient errors
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  delayMs = 1000
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Only retry on 429 or 5xx errors
      if (error instanceof AmadeusError) {
        if (error.statusCode === 429 || error.statusCode >= 500) {
          await new Promise((resolve) => setTimeout(resolve, delayMs * (attempt + 1)));
          continue;
        }
      }
      throw error;
    }
  }

  throw lastError;
}
```

---

## Integration with Gemini

Enhance AI-generated itineraries with real booking data:

```typescript
// lib/amadeus/enhance-itinerary.ts

import { GeneratedItinerary } from "@/types/itinerary";
import { searchFlights, getCheapestFlights } from "./flights";
import { searchHotels } from "./hotels";
import { getAirportCode, getCityCode } from "./locations";

export interface EnhancedItinerary extends GeneratedItinerary {
  travel_options?: {
    flights?: Array<{
      price: string;
      currency: string;
      carrier: string;
      duration: string;
      departureTime: string;
      arrivalTime: string;
    }>;
    hotels?: Array<{
      name: string;
      rating: string;
      price: string;
      currency: string;
      address: string;
    }>;
  };
}

export async function enhanceWithBookingOptions(
  itinerary: GeneratedItinerary,
  originCity: string
): Promise<EnhancedItinerary> {
  const destinationCode = await getCityCode(itinerary.destination.name);
  const originAirport = await getAirportCode(originCity);

  if (!destinationCode || !originAirport) {
    return itinerary; // Can't enhance without codes
  }

  const startDate = itinerary.days[0].date;
  const endDate = itinerary.days[itinerary.days.length - 1].date;

  // Fetch flights and hotels in parallel
  const [flights, hotels] = await Promise.allSettled([
    getCheapestFlights({
      origin: originAirport,
      destination: destinationCode,
      departureDate: startDate,
    }),
    searchHotels({
      cityCode: destinationCode,
      checkInDate: startDate,
      checkOutDate: endDate,
      adults: 1,
    }),
  ]);

  const enhanced: EnhancedItinerary = { ...itinerary };

  if (flights.status === "fulfilled" && flights.value.length > 0) {
    enhanced.travel_options = enhanced.travel_options || {};
    enhanced.travel_options.flights = flights.value.slice(0, 3).map((f) => ({
      price: f.price.total,
      currency: f.price.currency,
      carrier: f.validatingAirlineCodes[0],
      duration: f.itineraries[0].duration,
      departureTime: f.itineraries[0].segments[0].departure.at,
      arrivalTime: f.itineraries[0].segments[f.itineraries[0].segments.length - 1].arrival.at,
    }));
  }

  if (hotels.status === "fulfilled" && hotels.value.length > 0) {
    enhanced.travel_options = enhanced.travel_options || {};
    enhanced.travel_options.hotels = hotels.value.slice(0, 3).map((h) => ({
      name: h.hotel.name,
      rating: h.hotel.rating,
      price: h.offers[0]?.price.total || "N/A",
      currency: h.offers[0]?.price.currency || "USD",
      address: h.hotel.address.lines.join(", "),
    }));
  }

  return enhanced;
}
```

---

## Rate Limiting for Amadeus

```typescript
// Amadeus API limits (Self-Service)
const AMADEUS_LIMITS = {
  test: {
    callsPerSecond: 1,
    callsPerMonth: 2000,
  },
  production: {
    callsPerSecond: 10,
    callsPerMonth: 10000, // Depends on plan
  },
};

// Simple rate limiter
let lastCallTime = 0;
const MIN_INTERVAL = 1100; // 1.1 seconds between calls in test mode

export async function rateLimitedCall<T>(fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const timeSinceLastCall = now - lastCallTime;

  if (timeSinceLastCall < MIN_INTERVAL) {
    await new Promise((resolve) =>
      setTimeout(resolve, MIN_INTERVAL - timeSinceLastCall)
    );
  }

  lastCallTime = Date.now();
  return fn();
}
```

---

## Testing

```typescript
// Test Amadeus integration

async function testAmadeusIntegration() {
  console.log("Testing Amadeus integration...\n");

  // Test location search
  console.log("1. Testing location search...");
  const locations = await searchLocations("Paris");
  console.log(`   Found ${locations.length} locations`);
  console.log(`   First result: ${locations[0]?.name} (${locations[0]?.iataCode})`);

  // Test flight search
  console.log("\n2. Testing flight search...");
  const flights = await searchFlights({
    origin: "JFK",
    destination: "CDG",
    departureDate: "2025-03-01",
    adults: 1,
  });
  console.log(`   Found ${flights.length} flight offers`);
  if (flights[0]) {
    console.log(`   Cheapest: $${flights[0].price.total}`);
  }

  // Test hotel search
  console.log("\n3. Testing hotel search...");
  const hotels = await searchHotels({
    cityCode: "PAR",
    checkInDate: "2025-03-01",
    checkOutDate: "2025-03-03",
    adults: 1,
  });
  console.log(`   Found ${hotels.length} hotels`);
  if (hotels[0]) {
    console.log(`   First hotel: ${hotels[0].hotel.name}`);
  }

  console.log("\nAll tests passed!");
}
```

---

## Dependencies

```bash
npm install amadeus
```

Environment variables:
```env
AMADEUS_API_KEY=your-api-key
AMADEUS_API_SECRET=your-api-secret
AMADEUS_ENV=test
```

---

*Skill Version: 1.0*
*For: Future Enhancement (Post-POC)*
*API Documentation: https://developers.amadeus.com/self-service*
