# Travel Distance Feature - Implementation Plan

## Executive Summary

Add travel distance and time calculations between consecutive activities within each day of a trip. The feature will display walking/driving times with smart mode selection based on distance, include daily summaries, and use aggressive caching to minimize API costs.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           Trip Detail Page                               │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │  Day 1: City Exploration                                            ││
│  │  ┌─────────────────────┐                                            ││
│  │  │   Activity Card 1   │  Colosseum                                 ││
│  │  └─────────────────────┘                                            ││
│  │           │                                                          ││
│  │  ┌────────┴────────┐                                                ││
│  │  │ TravelConnector │  🚶 12 min (850m) • Walk                       ││
│  │  └────────┬────────┘                                                ││
│  │           │                                                          ││
│  │  ┌─────────────────────┐                                            ││
│  │  │   Activity Card 2   │  Roman Forum                               ││
│  │  └─────────────────────┘                                            ││
│  │           │                                                          ││
│  │  ┌────────┴────────┐                                                ││
│  │  │ TravelConnector │  🚗 18 min (5.2km) • Drive                     ││
│  │  └────────┬────────┘                                                ││
│  │           │                                                          ││
│  │  ┌─────────────────────┐                                            ││
│  │  │   Activity Card 3   │  Vatican Museum                            ││
│  │  └─────────────────────┘                                            ││
│  │                                                                      ││
│  │  ┌─────────────────────────────────────────────────────────────────┐││
│  │  │ Day Summary: 6.1km total • ~45 min travel • 2 walks, 1 drive    │││
│  │  └─────────────────────────────────────────────────────────────────┘││
│  └─────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Database Schema

### 1.1 Geocode Cache Table

Stores address-to-coordinates mappings to avoid re-geocoding the same addresses.

```sql
CREATE TABLE geocode_cache (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Cache key: normalized address hash
  address_hash TEXT NOT NULL UNIQUE,

  -- Original and normalized addresses
  original_address TEXT NOT NULL,
  normalized_address TEXT,

  -- Geocode result
  lat DECIMAL(10, 7) NOT NULL,
  lng DECIMAL(10, 7) NOT NULL,
  formatted_address TEXT,
  place_id TEXT,

  -- Quality indicators
  location_type TEXT, -- ROOFTOP, RANGE_INTERPOLATED, GEOMETRIC_CENTER, APPROXIMATE
  confidence DECIMAL(3, 2), -- 0.00 to 1.00

  -- Cache management
  cached_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '90 days'),
  hit_count INTEGER NOT NULL DEFAULT 0,
  last_accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Metadata
  source TEXT DEFAULT 'google_geocoding', -- google_geocoding, activity_coordinates

  CONSTRAINT valid_coordinates CHECK (
    lat BETWEEN -90 AND 90 AND lng BETWEEN -180 AND 180
  )
);

-- Indexes for fast lookups
CREATE INDEX idx_geocode_cache_address_hash ON geocode_cache(address_hash);
CREATE INDEX idx_geocode_cache_expires ON geocode_cache(expires_at);
CREATE INDEX idx_geocode_cache_place_id ON geocode_cache(place_id);

-- Spatial index for nearby lookups (optional, requires PostGIS)
-- CREATE INDEX idx_geocode_cache_location ON geocode_cache USING GIST (
--   ST_SetSRID(ST_MakePoint(lng, lat), 4326)
-- );
```

### 1.2 Distance Cache Table

Stores distance/duration between coordinate pairs with travel mode.

```sql
CREATE TABLE distance_cache (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Cache key: hash of origin + destination + mode
  route_hash TEXT NOT NULL UNIQUE,

  -- Origin and destination coordinates
  origin_lat DECIMAL(10, 7) NOT NULL,
  origin_lng DECIMAL(10, 7) NOT NULL,
  destination_lat DECIMAL(10, 7) NOT NULL,
  destination_lng DECIMAL(10, 7) NOT NULL,

  -- Travel mode
  travel_mode TEXT NOT NULL, -- WALKING, DRIVING, TRANSIT

  -- Results
  distance_meters INTEGER NOT NULL,
  duration_seconds INTEGER NOT NULL,
  duration_in_traffic_seconds INTEGER, -- Only for DRIVING with traffic

  -- Formatted values (for display)
  distance_text TEXT NOT NULL, -- "850 m", "5.2 km"
  duration_text TEXT NOT NULL, -- "12 min", "1 hour 5 min"

  -- Route metadata
  polyline TEXT, -- Encoded polyline for optional map display
  status TEXT NOT NULL DEFAULT 'OK', -- OK, ZERO_RESULTS, NOT_FOUND

  -- Cache management
  cached_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  hit_count INTEGER NOT NULL DEFAULT 0,
  last_accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT valid_travel_mode CHECK (
    travel_mode IN ('WALKING', 'DRIVING', 'TRANSIT')
  ),
  CONSTRAINT valid_origin CHECK (
    origin_lat BETWEEN -90 AND 90 AND origin_lng BETWEEN -180 AND 180
  ),
  CONSTRAINT valid_destination CHECK (
    destination_lat BETWEEN -90 AND 90 AND destination_lng BETWEEN -180 AND 180
  )
);

-- Indexes
CREATE INDEX idx_distance_cache_route_hash ON distance_cache(route_hash);
CREATE INDEX idx_distance_cache_expires ON distance_cache(expires_at);
CREATE INDEX idx_distance_cache_mode ON distance_cache(travel_mode);

-- Composite index for coordinate lookups
CREATE INDEX idx_distance_cache_coords ON distance_cache(
  origin_lat, origin_lng, destination_lat, destination_lng, travel_mode
);
```

### 1.3 Helper Functions

```sql
-- Function to generate address hash
CREATE OR REPLACE FUNCTION normalize_address(addr TEXT)
RETURNS TEXT AS $$
BEGIN
  RETURN LOWER(
    REGEXP_REPLACE(
      REGEXP_REPLACE(addr, '[^a-zA-Z0-9]', '', 'g'),
      '\s+', '', 'g'
    )
  );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to generate route hash
CREATE OR REPLACE FUNCTION generate_route_hash(
  origin_lat DECIMAL,
  origin_lng DECIMAL,
  dest_lat DECIMAL,
  dest_lng DECIMAL,
  mode TEXT
)
RETURNS TEXT AS $$
BEGIN
  -- Round coordinates to 5 decimal places (~1m precision)
  RETURN MD5(
    ROUND(origin_lat::NUMERIC, 5)::TEXT || ',' ||
    ROUND(origin_lng::NUMERIC, 5)::TEXT || '|' ||
    ROUND(dest_lat::NUMERIC, 5)::TEXT || ',' ||
    ROUND(dest_lng::NUMERIC, 5)::TEXT || '|' ||
    mode
  );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to update hit count and last accessed
CREATE OR REPLACE FUNCTION update_cache_hit()
RETURNS TRIGGER AS $$
BEGIN
  NEW.hit_count := OLD.hit_count + 1;
  NEW.last_accessed_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Cleanup function for expired entries
CREATE OR REPLACE FUNCTION cleanup_expired_cache()
RETURNS void AS $$
BEGIN
  DELETE FROM geocode_cache WHERE expires_at < NOW();
  DELETE FROM distance_cache WHERE expires_at < NOW();
END;
$$ LANGUAGE plpgsql;
```

---

## Phase 2: API Layer

### 2.1 Geocoding API Endpoint

**File:** `/app/api/geocode/route.ts`

```typescript
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import crypto from "crypto";

interface GeocodeRequest {
  addresses: string[];
}

interface GeocodeResult {
  address: string;
  lat: number;
  lng: number;
  formattedAddress: string;
  placeId?: string;
  source: "cache" | "api";
}

// Normalize address for consistent hashing
function normalizeAddress(addr: string): string {
  return addr
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

function hashAddress(addr: string): string {
  return crypto.createHash("md5").update(normalizeAddress(addr)).digest("hex");
}

export async function POST(request: Request) {
  try {
    const { addresses }: GeocodeRequest = await request.json();

    if (!addresses?.length || addresses.length > 50) {
      return NextResponse.json(
        { error: "Provide 1-50 addresses" },
        { status: 400 }
      );
    }

    const results: GeocodeResult[] = [];
    const uncachedAddresses: { address: string; hash: string }[] = [];

    // Step 1: Check cache for all addresses
    const hashes = addresses.map((addr) => ({
      address: addr,
      hash: hashAddress(addr),
    }));

    const { data: cached } = await supabase
      .from("geocode_cache")
      .select("*")
      .in("address_hash", hashes.map((h) => h.hash));

    const cachedMap = new Map(
      cached?.map((c) => [c.address_hash, c]) ?? []
    );

    // Step 2: Separate cached and uncached
    for (const { address, hash } of hashes) {
      const cachedResult = cachedMap.get(hash);
      if (cachedResult) {
        results.push({
          address,
          lat: parseFloat(cachedResult.lat),
          lng: parseFloat(cachedResult.lng),
          formattedAddress: cachedResult.formatted_address,
          placeId: cachedResult.place_id,
          source: "cache",
        });

        // Update hit count asynchronously
        supabase
          .from("geocode_cache")
          .update({
            hit_count: cachedResult.hit_count + 1,
            last_accessed_at: new Date().toISOString()
          })
          .eq("id", cachedResult.id)
          .then(() => {});
      } else {
        uncachedAddresses.push({ address, hash });
      }
    }

    // Step 3: Fetch uncached from Google Geocoding API
    if (uncachedAddresses.length > 0) {
      const apiKey = process.env.GOOGLE_MAPS_API_KEY;

      for (const { address, hash } of uncachedAddresses) {
        try {
          const response = await fetch(
            `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`
          );
          const data = await response.json();

          if (data.status === "OK" && data.results[0]) {
            const result = data.results[0];
            const location = result.geometry.location;

            // Cache the result
            await supabase.from("geocode_cache").insert({
              address_hash: hash,
              original_address: address,
              normalized_address: normalizeAddress(address),
              lat: location.lat,
              lng: location.lng,
              formatted_address: result.formatted_address,
              place_id: result.place_id,
              location_type: result.geometry.location_type,
              confidence: result.geometry.location_type === "ROOFTOP" ? 1.0 : 0.8,
            });

            results.push({
              address,
              lat: location.lat,
              lng: location.lng,
              formattedAddress: result.formatted_address,
              placeId: result.place_id,
              source: "api",
            });

            // Log API usage
            await supabase.from("api_request_logs").insert({
              api_name: "google_geocoding",
              endpoint: "/geocode/json",
              request_params: { address },
              response_status: 200,
              response_time_ms: 0,
              cache_hit: false,
              cost_usd: 0.005, // $5 per 1000 requests
            });
          }
        } catch (error) {
          console.error(`Geocoding failed for: ${address}`, error);
        }
      }
    }

    return NextResponse.json({
      results,
      stats: {
        total: addresses.length,
        cached: results.filter((r) => r.source === "cache").length,
        fetched: results.filter((r) => r.source === "api").length,
      },
    });
  } catch (error) {
    console.error("Geocode API error:", error);
    return NextResponse.json(
      { error: "Failed to geocode addresses" },
      { status: 500 }
    );
  }
}
```

### 2.2 Distance Matrix API Endpoint

**File:** `/app/api/distance/route.ts`

```typescript
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import crypto from "crypto";

interface DistanceRequest {
  pairs: Array<{
    origin: { lat: number; lng: number };
    destination: { lat: number; lng: number };
    mode?: "WALKING" | "DRIVING" | "TRANSIT";
  }>;
}

interface DistanceResult {
  origin: { lat: number; lng: number };
  destination: { lat: number; lng: number };
  mode: string;
  distanceMeters: number;
  distanceText: string;
  durationSeconds: number;
  durationText: string;
  source: "cache" | "api";
}

// Round coordinates to 5 decimal places (~1m precision)
function roundCoord(n: number): number {
  return Math.round(n * 100000) / 100000;
}

function generateRouteHash(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number,
  mode: string
): string {
  const key = `${roundCoord(originLat)},${roundCoord(originLng)}|${roundCoord(destLat)},${roundCoord(destLng)}|${mode}`;
  return crypto.createHash("md5").update(key).digest("hex");
}

// Determine travel mode based on straight-line distance
function calculateStraightLineDistance(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const R = 6371000; // Earth's radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function determineMode(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
  preferredMode?: string
): "WALKING" | "DRIVING" {
  if (preferredMode && preferredMode !== "AUTO") {
    return preferredMode as "WALKING" | "DRIVING";
  }

  const distance = calculateStraightLineDistance(
    origin.lat, origin.lng,
    destination.lat, destination.lng
  );

  // Walk if under 1km straight-line (roughly 1.3km walking)
  return distance < 1000 ? "WALKING" : "DRIVING";
}

export async function POST(request: Request) {
  try {
    const { pairs }: DistanceRequest = await request.json();

    if (!pairs?.length || pairs.length > 25) {
      return NextResponse.json(
        { error: "Provide 1-25 coordinate pairs" },
        { status: 400 }
      );
    }

    const results: DistanceResult[] = [];
    const uncached: Array<{
      origin: { lat: number; lng: number };
      destination: { lat: number; lng: number };
      mode: string;
      hash: string;
    }> = [];

    // Determine modes and generate hashes
    const pairsWithModes = pairs.map((pair) => {
      const mode = determineMode(pair.origin, pair.destination, pair.mode);
      return {
        ...pair,
        mode,
        hash: generateRouteHash(
          pair.origin.lat, pair.origin.lng,
          pair.destination.lat, pair.destination.lng,
          mode
        ),
      };
    });

    // Check cache
    const hashes = pairsWithModes.map((p) => p.hash);
    const { data: cached } = await supabase
      .from("distance_cache")
      .select("*")
      .in("route_hash", hashes);

    const cachedMap = new Map(
      cached?.map((c) => [c.route_hash, c]) ?? []
    );

    // Separate cached and uncached
    for (const pair of pairsWithModes) {
      const cachedResult = cachedMap.get(pair.hash);
      if (cachedResult) {
        results.push({
          origin: pair.origin,
          destination: pair.destination,
          mode: cachedResult.travel_mode,
          distanceMeters: cachedResult.distance_meters,
          distanceText: cachedResult.distance_text,
          durationSeconds: cachedResult.duration_seconds,
          durationText: cachedResult.duration_text,
          source: "cache",
        });

        // Update hit count
        supabase
          .from("distance_cache")
          .update({
            hit_count: cachedResult.hit_count + 1,
            last_accessed_at: new Date().toISOString(),
          })
          .eq("id", cachedResult.id)
          .then(() => {});
      } else {
        uncached.push({
          origin: pair.origin,
          destination: pair.destination,
          mode: pair.mode,
          hash: pair.hash,
        });
      }
    }

    // Fetch uncached from Google Distance Matrix API
    if (uncached.length > 0) {
      const apiKey = process.env.GOOGLE_MAPS_API_KEY;

      // Group by mode for efficient API calls
      const byMode = uncached.reduce((acc, p) => {
        if (!acc[p.mode]) acc[p.mode] = [];
        acc[p.mode].push(p);
        return acc;
      }, {} as Record<string, typeof uncached>);

      for (const [mode, modePairs] of Object.entries(byMode)) {
        // Build origins and destinations strings
        const origins = modePairs
          .map((p) => `${p.origin.lat},${p.origin.lng}`)
          .join("|");
        const destinations = modePairs
          .map((p) => `${p.destination.lat},${p.destination.lng}`)
          .join("|");

        const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${origins}&destinations=${destinations}&mode=${mode.toLowerCase()}&key=${apiKey}`;

        try {
          const response = await fetch(url);
          const data = await response.json();

          if (data.status === "OK") {
            // Distance Matrix returns a matrix, but we want diagonal (1-to-1)
            for (let i = 0; i < modePairs.length; i++) {
              const element = data.rows[i]?.elements[i];
              const pair = modePairs[i];

              if (element?.status === "OK") {
                const result: DistanceResult = {
                  origin: pair.origin,
                  destination: pair.destination,
                  mode: mode,
                  distanceMeters: element.distance.value,
                  distanceText: element.distance.text,
                  durationSeconds: element.duration.value,
                  durationText: element.duration.text,
                  source: "api",
                };

                results.push(result);

                // Cache the result
                await supabase.from("distance_cache").insert({
                  route_hash: pair.hash,
                  origin_lat: pair.origin.lat,
                  origin_lng: pair.origin.lng,
                  destination_lat: pair.destination.lat,
                  destination_lng: pair.destination.lng,
                  travel_mode: mode,
                  distance_meters: element.distance.value,
                  duration_seconds: element.duration.value,
                  distance_text: element.distance.text,
                  duration_text: element.duration.text,
                  status: "OK",
                });
              }
            }

            // Log API usage (elements = origins × destinations for matrix)
            const elements = modePairs.length; // 1-to-1 mapping
            await supabase.from("api_request_logs").insert({
              api_name: "google_distance_matrix",
              endpoint: "/distancematrix/json",
              request_params: { mode, pairs: modePairs.length },
              response_status: 200,
              response_time_ms: 0,
              cache_hit: false,
              cost_usd: (elements * 0.005), // $5 per 1000 elements
            });
          }
        } catch (error) {
          console.error(`Distance Matrix failed for mode: ${mode}`, error);
        }
      }
    }

    return NextResponse.json({
      results,
      stats: {
        total: pairs.length,
        cached: results.filter((r) => r.source === "cache").length,
        fetched: results.filter((r) => r.source === "api").length,
      },
    });
  } catch (error) {
    console.error("Distance API error:", error);
    return NextResponse.json(
      { error: "Failed to calculate distances" },
      { status: 500 }
    );
  }
}
```

---

## Phase 3: Frontend Components

### 3.1 TravelConnector Component

**File:** `/components/trip/TravelConnector.tsx`

```tsx
"use client";

import { useMemo } from "react";
import {
  PersonWalking,
  Car,
  Bus,
  ArrowDown,
  Clock,
  Route
} from "lucide-react";

interface TravelConnectorProps {
  from: {
    name: string;
    lat?: number;
    lng?: number;
  };
  to: {
    name: string;
    lat?: number;
    lng?: number;
  };
  distanceMeters?: number;
  durationSeconds?: number;
  durationText?: string;
  distanceText?: string;
  mode?: "WALKING" | "DRIVING" | "TRANSIT";
  isLoading?: boolean;
  compact?: boolean;
}

export function TravelConnector({
  from,
  to,
  distanceMeters,
  durationSeconds,
  durationText,
  distanceText,
  mode = "WALKING",
  isLoading = false,
  compact = false,
}: TravelConnectorProps) {
  const modeConfig = useMemo(() => {
    switch (mode) {
      case "WALKING":
        return {
          icon: PersonWalking,
          label: "Walk",
          color: "text-emerald-600",
          bgColor: "bg-emerald-50",
          borderColor: "border-emerald-200",
        };
      case "DRIVING":
        return {
          icon: Car,
          label: "Drive",
          color: "text-blue-600",
          bgColor: "bg-blue-50",
          borderColor: "border-blue-200",
        };
      case "TRANSIT":
        return {
          icon: Bus,
          label: "Transit",
          color: "text-purple-600",
          bgColor: "bg-purple-50",
          borderColor: "border-purple-200",
        };
      default:
        return {
          icon: Route,
          label: "Travel",
          color: "text-gray-600",
          bgColor: "bg-gray-50",
          borderColor: "border-gray-200",
        };
    }
  }, [mode]);

  const Icon = modeConfig.icon;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-2">
        <div className="flex items-center gap-2 text-gray-400">
          <div className="w-1 h-8 bg-gray-200 rounded-full animate-pulse" />
          <div className="w-20 h-5 bg-gray-200 rounded animate-pulse" />
        </div>
      </div>
    );
  }

  // No data yet
  if (!distanceMeters && !durationSeconds) {
    return (
      <div className="flex items-center justify-center py-2">
        <div className="flex flex-col items-center">
          <div className="w-0.5 h-3 bg-gray-200" />
          <ArrowDown className="w-3 h-3 text-gray-300" />
          <div className="w-0.5 h-3 bg-gray-200" />
        </div>
      </div>
    );
  }

  if (compact) {
    return (
      <div className="flex items-center justify-center py-1.5">
        <div className="flex items-center gap-1.5 text-xs text-gray-500">
          <div className="w-0.5 h-2 bg-gray-200 rounded-full" />
          <Icon className={`w-3 h-3 ${modeConfig.color}`} />
          <span>{durationText || `${Math.round((durationSeconds || 0) / 60)} min`}</span>
          <div className="w-0.5 h-2 bg-gray-200 rounded-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center py-3 px-4">
      <div className="flex items-center gap-3">
        {/* Connector line */}
        <div className="flex flex-col items-center">
          <div className="w-0.5 h-3 bg-gradient-to-b from-gray-300 to-gray-200 rounded-full" />
          <div className={`w-1.5 h-1.5 rounded-full ${modeConfig.bgColor} border ${modeConfig.borderColor}`} />
          <div className="w-0.5 h-3 bg-gradient-to-b from-gray-200 to-gray-300 rounded-full" />
        </div>

        {/* Travel info pill */}
        <div
          className={`
            flex items-center gap-2 px-3 py-1.5 rounded-full
            ${modeConfig.bgColor} border ${modeConfig.borderColor}
            shadow-sm
          `}
        >
          <Icon className={`w-4 h-4 ${modeConfig.color}`} />

          <div className="flex items-center gap-1.5 text-sm">
            <Clock className="w-3 h-3 text-gray-400" />
            <span className={`font-medium ${modeConfig.color}`}>
              {durationText || `${Math.round((durationSeconds || 0) / 60)} min`}
            </span>
          </div>

          <span className="text-gray-300">•</span>

          <span className="text-xs text-gray-500">
            {distanceText || formatDistance(distanceMeters || 0)}
          </span>
        </div>
      </div>
    </div>
  );
}

function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  return `${(meters / 1000).toFixed(1)} km`;
}
```

### 3.2 DaySummary Component

**File:** `/components/trip/DaySummary.tsx`

```tsx
"use client";

import { useMemo } from "react";
import {
  Route,
  Clock,
  PersonWalking,
  Car,
  TrendingUp
} from "lucide-react";

interface TravelSegment {
  mode: "WALKING" | "DRIVING" | "TRANSIT";
  distanceMeters: number;
  durationSeconds: number;
}

interface DaySummaryProps {
  dayNumber: number;
  segments: TravelSegment[];
  className?: string;
}

export function DaySummary({ dayNumber, segments, className = "" }: DaySummaryProps) {
  const stats = useMemo(() => {
    const totals = segments.reduce(
      (acc, seg) => ({
        distance: acc.distance + seg.distanceMeters,
        duration: acc.duration + seg.durationSeconds,
        walks: acc.walks + (seg.mode === "WALKING" ? 1 : 0),
        drives: acc.drives + (seg.mode === "DRIVING" ? 1 : 0),
      }),
      { distance: 0, duration: 0, walks: 0, drives: 0 }
    );

    return {
      ...totals,
      distanceText: formatDistance(totals.distance),
      durationText: formatDuration(totals.duration),
    };
  }, [segments]);

  if (segments.length === 0) {
    return null;
  }

  return (
    <div
      className={`
        flex flex-wrap items-center gap-3 px-4 py-2.5
        bg-gradient-to-r from-slate-50 to-slate-100/50
        border border-slate-200/60 rounded-xl
        ${className}
      `}
    >
      {/* Total distance */}
      <div className="flex items-center gap-1.5 text-sm">
        <Route className="w-4 h-4 text-[var(--secondary)]" />
        <span className="font-medium text-slate-700">{stats.distanceText}</span>
        <span className="text-slate-400">total</span>
      </div>

      <span className="text-slate-300">•</span>

      {/* Total travel time */}
      <div className="flex items-center gap-1.5 text-sm">
        <Clock className="w-4 h-4 text-[var(--primary)]" />
        <span className="font-medium text-slate-700">~{stats.durationText}</span>
        <span className="text-slate-400">travel</span>
      </div>

      <span className="text-slate-300">•</span>

      {/* Mode breakdown */}
      <div className="flex items-center gap-2 text-xs text-slate-500">
        {stats.walks > 0 && (
          <div className="flex items-center gap-1">
            <PersonWalking className="w-3.5 h-3.5 text-emerald-500" />
            <span>{stats.walks}</span>
          </div>
        )}
        {stats.drives > 0 && (
          <div className="flex items-center gap-1">
            <Car className="w-3.5 h-3.5 text-blue-500" />
            <span>{stats.drives}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  return `${(meters / 1000).toFixed(1)} km`;
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes} min`;
}
```

### 3.3 useTravelDistances Hook

**File:** `/lib/hooks/useTravelDistances.ts`

```typescript
"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import type { Activity, ItineraryDay } from "@/types";

interface Coordinates {
  lat: number;
  lng: number;
}

interface TravelSegment {
  fromActivity: string;
  toActivity: string;
  origin: Coordinates;
  destination: Coordinates;
  mode: "WALKING" | "DRIVING" | "TRANSIT";
  distanceMeters: number;
  durationSeconds: number;
  distanceText: string;
  durationText: string;
}

interface DayTravelData {
  dayNumber: number;
  segments: TravelSegment[];
  totalDistanceMeters: number;
  totalDurationSeconds: number;
  isLoading: boolean;
  error?: string;
}

interface UseTravelDistancesResult {
  travelData: Map<number, DayTravelData>;
  isLoading: boolean;
  error?: string;
  refetch: () => void;
}

export function useTravelDistances(
  itinerary: ItineraryDay[]
): UseTravelDistancesResult {
  const [travelData, setTravelData] = useState<Map<number, DayTravelData>>(
    new Map()
  );
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string>();

  // Extract all unique addresses that need geocoding
  const addressesNeedingGeocode = useMemo(() => {
    const addresses: { dayNumber: number; activityId: string; address: string }[] = [];

    for (const day of itinerary) {
      for (const activity of day.activities) {
        // Skip if already has coordinates
        if (activity.coordinates?.lat && activity.coordinates?.lng) {
          continue;
        }

        const address = activity.address || activity.location;
        if (address) {
          addresses.push({
            dayNumber: day.day_number,
            activityId: activity.id,
            address,
          });
        }
      }
    }

    return addresses;
  }, [itinerary]);

  const fetchTravelData = useCallback(async () => {
    setIsLoading(true);
    setError(undefined);

    try {
      // Step 1: Geocode addresses that don't have coordinates
      let geocodedCoords: Map<string, Coordinates> = new Map();

      if (addressesNeedingGeocode.length > 0) {
        const uniqueAddresses = [...new Set(addressesNeedingGeocode.map(a => a.address))];

        const geocodeResponse = await fetch("/api/geocode", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ addresses: uniqueAddresses }),
        });

        if (geocodeResponse.ok) {
          const geocodeData = await geocodeResponse.json();
          for (const result of geocodeData.results) {
            geocodedCoords.set(result.address, { lat: result.lat, lng: result.lng });
          }
        }
      }

      // Step 2: Build coordinate pairs for each day
      const newTravelData = new Map<number, DayTravelData>();
      const allPairs: Array<{
        dayNumber: number;
        fromActivity: string;
        toActivity: string;
        origin: Coordinates;
        destination: Coordinates;
      }> = [];

      for (const day of itinerary) {
        const activities = day.activities;

        for (let i = 0; i < activities.length - 1; i++) {
          const fromActivity = activities[i];
          const toActivity = activities[i + 1];

          // Get coordinates (from activity or geocoded)
          const fromCoords = fromActivity.coordinates?.lat
            ? { lat: fromActivity.coordinates.lat, lng: fromActivity.coordinates.lng }
            : geocodedCoords.get(fromActivity.address || fromActivity.location);

          const toCoords = toActivity.coordinates?.lat
            ? { lat: toActivity.coordinates.lat, lng: toActivity.coordinates.lng }
            : geocodedCoords.get(toActivity.address || toActivity.location);

          if (fromCoords && toCoords) {
            allPairs.push({
              dayNumber: day.day_number,
              fromActivity: fromActivity.id,
              toActivity: toActivity.id,
              origin: fromCoords,
              destination: toCoords,
            });
          }
        }

        // Initialize day data
        newTravelData.set(day.day_number, {
          dayNumber: day.day_number,
          segments: [],
          totalDistanceMeters: 0,
          totalDurationSeconds: 0,
          isLoading: true,
        });
      }

      // Step 3: Fetch distances for all pairs
      if (allPairs.length > 0) {
        const distanceResponse = await fetch("/api/distance", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pairs: allPairs.map(p => ({
              origin: p.origin,
              destination: p.destination,
            })),
          }),
        });

        if (distanceResponse.ok) {
          const distanceData = await distanceResponse.json();

          // Match results back to days
          for (let i = 0; i < distanceData.results.length; i++) {
            const result = distanceData.results[i];
            const pair = allPairs[i];

            const dayData = newTravelData.get(pair.dayNumber);
            if (dayData) {
              dayData.segments.push({
                fromActivity: pair.fromActivity,
                toActivity: pair.toActivity,
                origin: pair.origin,
                destination: pair.destination,
                mode: result.mode,
                distanceMeters: result.distanceMeters,
                durationSeconds: result.durationSeconds,
                distanceText: result.distanceText,
                durationText: result.durationText,
              });
              dayData.totalDistanceMeters += result.distanceMeters;
              dayData.totalDurationSeconds += result.durationSeconds;
            }
          }
        }
      }

      // Mark all days as loaded
      for (const [dayNumber, data] of newTravelData) {
        data.isLoading = false;
      }

      setTravelData(newTravelData);
    } catch (err) {
      console.error("Failed to fetch travel distances:", err);
      setError("Failed to calculate travel distances");
    } finally {
      setIsLoading(false);
    }
  }, [itinerary, addressesNeedingGeocode]);

  useEffect(() => {
    fetchTravelData();
  }, [fetchTravelData]);

  return {
    travelData,
    isLoading,
    error,
    refetch: fetchTravelData,
  };
}
```

---

## Phase 4: Integration into TripDetailClient

### 4.1 Import and Use Hook

**File:** `/app/trips/[id]/TripDetailClient.tsx`

Add to imports:
```tsx
import { useTravelDistances } from "@/lib/hooks/useTravelDistances";
import { TravelConnector } from "@/components/trip/TravelConnector";
import { DaySummary } from "@/components/trip/DaySummary";
```

Add hook usage:
```tsx
// Inside TripDetailClient component
const { travelData, isLoading: travelLoading } = useTravelDistances(trip.itinerary);
```

### 4.2 Render TravelConnectors Between Activities

In the activities rendering loop, add:
```tsx
{day.activities.map((activity, activityIndex) => {
  // Get travel segment to next activity
  const dayTravelData = travelData.get(day.day_number);
  const segment = dayTravelData?.segments.find(
    s => s.fromActivity === activity.id
  );

  return (
    <React.Fragment key={activity.id}>
      <ActivityCard activity={activity} {...props} />

      {/* Travel connector (if not last activity) */}
      {activityIndex < day.activities.length - 1 && (
        <TravelConnector
          from={{ name: activity.name, ...activity.coordinates }}
          to={{
            name: day.activities[activityIndex + 1].name,
            ...day.activities[activityIndex + 1].coordinates
          }}
          distanceMeters={segment?.distanceMeters}
          durationSeconds={segment?.durationSeconds}
          durationText={segment?.durationText}
          distanceText={segment?.distanceText}
          mode={segment?.mode}
          isLoading={travelLoading || dayTravelData?.isLoading}
          compact={viewMode === "timeline"}
        />
      )}
    </React.Fragment>
  );
})}
```

### 4.3 Add Day Summary

After activities loop, add:
```tsx
{/* Day travel summary */}
{dayTravelData && dayTravelData.segments.length > 0 && (
  <DaySummary
    dayNumber={day.day_number}
    segments={dayTravelData.segments}
    className="mt-4"
  />
)}
```

---

## Phase 5: Environment & Configuration

### 5.1 Environment Variables

Add to `.env.local`:
```bash
# Google Maps API Key (already exists, ensure Distance Matrix API is enabled)
GOOGLE_MAPS_API_KEY=your_key_here
```

Ensure these APIs are enabled in Google Cloud Console:
- Geocoding API
- Distance Matrix API

### 5.2 API Costs & Budgeting

| API | Cost | Usage Pattern |
|-----|------|---------------|
| Geocoding | $5/1000 requests | Once per unique address, cached 90 days |
| Distance Matrix | $5/1000 elements | Once per unique route+mode, cached 7 days |

**Example Trip Cost:**
- 5-day trip, 5 activities/day = 20 consecutive activity pairs
- Assuming 70% cache hit rate after initial population
- Initial: ~$0.10 per new trip
- Subsequent views: ~$0.00 (cached)

---

## Implementation Order

1. **Database** - Apply migrations for `geocode_cache` and `distance_cache` tables
2. **API Endpoints** - Create `/api/geocode` and `/api/distance` endpoints
3. **Hook** - Implement `useTravelDistances` hook
4. **Components** - Create `TravelConnector` and `DaySummary` components
5. **Integration** - Update `TripDetailClient` to use travel data
6. **Testing** - Verify with sample trips, check caching behavior
7. **Polish** - Add loading states, error handling, mobile optimization

---

## Testing Checklist

- [ ] Geocoding works for addresses without coordinates
- [ ] Distance Matrix returns walking for < 1km
- [ ] Distance Matrix returns driving for > 1km
- [ ] Cache hits work correctly (check `hit_count` increment)
- [ ] Day summary shows correct totals
- [ ] Mobile layout is responsive
- [ ] Loading states display properly
- [ ] Errors are handled gracefully
- [ ] PDF export includes travel times (optional future enhancement)
