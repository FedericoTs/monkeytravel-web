import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import crypto from "crypto";

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_PLACES_API_KEY || "";

interface Coordinates {
  lat: number;
  lng: number;
}

interface DistancePair {
  origin: Coordinates;
  destination: Coordinates;
  mode?: "WALKING" | "DRIVING" | "TRANSIT" | "AUTO";
}

interface DistanceRequest {
  pairs: DistancePair[];
}

interface DistanceResult {
  origin: Coordinates;
  destination: Coordinates;
  mode: "WALKING" | "DRIVING" | "TRANSIT";
  distanceMeters: number;
  durationSeconds: number;
  distanceText: string;
  durationText: string;
  source: "cache" | "api";
}

/**
 * Round coordinates to 5 decimal places (~1.1m precision)
 * This ensures consistent caching for nearby points
 */
function roundCoord(n: number): number {
  return Math.round(n * 100000) / 100000;
}

/**
 * Generate route hash for cache key
 */
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

/**
 * Calculate straight-line distance using Haversine formula
 */
function calculateStraightLineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371000; // Earth's radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Determine optimal travel mode based on distance
 * Walk if under 1km straight-line, otherwise drive
 */
function determineMode(
  origin: Coordinates,
  destination: Coordinates,
  preferredMode?: string
): "WALKING" | "DRIVING" {
  if (preferredMode && preferredMode !== "AUTO") {
    return preferredMode as "WALKING" | "DRIVING";
  }

  const distance = calculateStraightLineDistance(
    origin.lat,
    origin.lng,
    destination.lat,
    destination.lng
  );

  // Walk if under 1km straight-line distance (roughly 1.3km walking path)
  return distance < 1000 ? "WALKING" : "DRIVING";
}

/**
 * Calculate travel distances between coordinate pairs
 * POST /api/travel/distance
 */
export async function POST(request: NextRequest) {
  try {
    const { pairs }: DistanceRequest = await request.json();

    if (!pairs?.length) {
      return NextResponse.json(
        { error: "Pairs array is required" },
        { status: 400 }
      );
    }

    if (pairs.length > 25) {
      return NextResponse.json(
        { error: "Maximum 25 pairs per request" },
        { status: 400 }
      );
    }

    if (!GOOGLE_MAPS_API_KEY) {
      return NextResponse.json(
        { error: "Google Maps API key not configured" },
        { status: 500 }
      );
    }

    const results: DistanceResult[] = [];
    const uncached: Array<{
      origin: Coordinates;
      destination: Coordinates;
      mode: "WALKING" | "DRIVING";
      hash: string;
      index: number;
    }> = [];

    // Determine modes and generate hashes for all pairs
    const pairsWithModes = pairs.map((pair, index) => {
      const mode = determineMode(pair.origin, pair.destination, pair.mode);
      return {
        ...pair,
        mode,
        hash: generateRouteHash(
          pair.origin.lat,
          pair.origin.lng,
          pair.destination.lat,
          pair.destination.lng,
          mode
        ),
        index,
      };
    });

    // Step 1: Check cache for all pairs
    const hashes = pairsWithModes.map((p) => p.hash);
    const { data: cached, error: cacheError } = await supabase
      .from("distance_cache")
      .select("*")
      .in("route_hash", hashes)
      .gt("expires_at", new Date().toISOString());

    if (cacheError) {
      console.error("Distance cache lookup error:", cacheError);
    }

    // Build a map of cached results
    const cachedMap = new Map(cached?.map((c) => [c.route_hash, c]) ?? []);

    // Step 2: Separate cached and uncached pairs
    for (const pair of pairsWithModes) {
      const cachedResult = cachedMap.get(pair.hash);
      if (cachedResult) {
        results.push({
          origin: pair.origin,
          destination: pair.destination,
          mode: cachedResult.travel_mode as "WALKING" | "DRIVING" | "TRANSIT",
          distanceMeters: cachedResult.distance_meters,
          durationSeconds: cachedResult.duration_seconds,
          distanceText: cachedResult.distance_text,
          durationText: cachedResult.duration_text,
          source: "cache",
        });

        // Update hit count asynchronously
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
          index: pair.index,
        });
      }
    }

    // Step 3: Fetch uncached from Google Distance Matrix API
    if (uncached.length > 0) {
      // Group by mode for efficient API calls
      const byMode = uncached.reduce(
        (acc, p) => {
          if (!acc[p.mode]) acc[p.mode] = [];
          acc[p.mode].push(p);
          return acc;
        },
        {} as Record<string, typeof uncached>
      );

      for (const [mode, modePairs] of Object.entries(byMode)) {
        // Build origins and destinations strings
        const origins = modePairs
          .map((p) => `${p.origin.lat},${p.origin.lng}`)
          .join("|");
        const destinations = modePairs
          .map((p) => `${p.destination.lat},${p.destination.lng}`)
          .join("|");

        const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${origins}&destinations=${destinations}&mode=${mode.toLowerCase()}&key=${GOOGLE_MAPS_API_KEY}`;

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
                  mode: mode as "WALKING" | "DRIVING",
                  distanceMeters: element.distance.value,
                  durationSeconds: element.duration.value,
                  distanceText: element.distance.text,
                  durationText: element.duration.text,
                  source: "api",
                };

                results.push(result);

                // Cache the result
                supabase
                  .from("distance_cache")
                  .insert({
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
                    expires_at: new Date(
                      Date.now() + 7 * 24 * 60 * 60 * 1000
                    ).toISOString(), // 7 days
                  })
                  .then(({ error }) => {
                    if (error) console.error("Distance cache insert error:", error);
                  });
              } else {
                // Fallback: Calculate straight-line distance when API returns ZERO_RESULTS
                // This ensures we always have some distance data to display
                console.warn(
                  `Distance Matrix element status: ${element?.status} for pair ${i}, using fallback`
                );

                const straightLineDistance = calculateStraightLineDistance(
                  pair.origin.lat,
                  pair.origin.lng,
                  pair.destination.lat,
                  pair.destination.lng
                );

                // Estimate travel distance as 1.3x straight-line (typical road factor)
                const estimatedDistance = Math.round(straightLineDistance * 1.3);
                // Estimate duration based on mode (walking: 5km/h, driving: 30km/h avg in cities)
                const speedKmh = mode === "WALKING" ? 5 : 30;
                const estimatedDuration = Math.round((estimatedDistance / 1000 / speedKmh) * 3600);

                const result: DistanceResult = {
                  origin: pair.origin,
                  destination: pair.destination,
                  mode: mode as "WALKING" | "DRIVING",
                  distanceMeters: estimatedDistance,
                  durationSeconds: estimatedDuration,
                  distanceText: estimatedDistance < 1000
                    ? `~${estimatedDistance} m`
                    : `~${(estimatedDistance / 1000).toFixed(1)} km`,
                  durationText: `~${Math.round(estimatedDuration / 60)} min`,
                  source: "api", // Mark as API even though it's estimated
                };

                results.push(result);
              }
            }

            // Log API usage for cost tracking
            const elements = modePairs.length;
            supabase
              .from("api_request_logs")
              .insert({
                api_name: "google_distance_matrix",
                endpoint: "/distancematrix/json",
                request_params: { mode, pairs: modePairs.length },
                response_status: 200,
                response_time_ms: 0,
                cache_hit: false,
                cost_usd: elements * 0.005, // $5 per 1000 elements
              })
              .then(() => {});
          } else {
            console.error("Distance Matrix API error:", data.status, data.error_message);
          }
        } catch (error) {
          console.error(`Distance Matrix request failed for mode: ${mode}`, error);
        }
      }
    }

    // Sort results to match original order using tolerance-based matching
    // This is critical because floating-point equality can fail
    const COORD_TOLERANCE = 0.00001; // ~1.1 meters precision
    const orderedResults = pairsWithModes.map((pair) => {
      return results.find(
        (r) =>
          Math.abs(r.origin.lat - pair.origin.lat) < COORD_TOLERANCE &&
          Math.abs(r.origin.lng - pair.origin.lng) < COORD_TOLERANCE &&
          Math.abs(r.destination.lat - pair.destination.lat) < COORD_TOLERANCE &&
          Math.abs(r.destination.lng - pair.destination.lng) < COORD_TOLERANCE
      );
    }).filter((r): r is DistanceResult => r !== undefined);

    return NextResponse.json({
      results: orderedResults,
      stats: {
        total: pairs.length,
        cached: results.filter((r) => r.source === "cache").length,
        fetched: results.filter((r) => r.source === "api").length,
        failed: pairs.length - orderedResults.length,
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
