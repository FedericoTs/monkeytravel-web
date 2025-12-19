import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import crypto from "crypto";
import { checkApiAccess, logApiCall } from "@/lib/api-gateway";
import { estimateTravelTime, calculateHaversineDistance, determineOptimalMode } from "@/lib/utils/travel-estimation";

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_PLACES_API_KEY || "";

interface Coordinates {
  lat: number;
  lng: number;
}

interface DistancePair {
  index: number; // Index for matching results back to pairs
  origin?: Coordinates;
  destination?: Coordinates;
  originAddress?: string;
  destinationAddress?: string;
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
  // 4 decimals (~11m precision) improves cache hit rate while maintaining accuracy
  return Math.round(n * 10000) / 10000;
}

/**
 * Generate route hash for cache key
 * Prefers addresses for more accurate caching, falls back to coordinates
 */
function generateRouteHash(
  originAddress: string | undefined,
  destAddress: string | undefined,
  originCoords: Coordinates | undefined,
  destCoords: Coordinates | undefined,
  mode: string
): string {
  // Prefer addresses for cache key (more semantically accurate)
  const originKey = originAddress?.toLowerCase().trim() ||
    (originCoords ? `${roundCoord(originCoords.lat)},${roundCoord(originCoords.lng)}` : "unknown");
  const destKey = destAddress?.toLowerCase().trim() ||
    (destCoords ? `${roundCoord(destCoords.lat)},${roundCoord(destCoords.lng)}` : "unknown");

  const key = `${originKey}|${destKey}|${mode}`;
  return crypto.createHash("md5").update(key).digest("hex");
}

/**
 * Determine optimal travel mode based on distance
 * Uses the utility function which has better threshold (1.2km for ~15-20 min walk)
 * If no coordinates available, defaults to DRIVING for safety
 */
function determineMode(
  origin: Coordinates | undefined,
  destination: Coordinates | undefined,
  preferredMode?: string
): "WALKING" | "DRIVING" {
  if (preferredMode && preferredMode !== "AUTO") {
    return preferredMode as "WALKING" | "DRIVING";
  }

  // If we don't have coordinates, default to driving (safer for long distances)
  if (!origin || !destination) {
    return "DRIVING";
  }

  // Use the utility function for consistent mode determination
  return determineOptimalMode(origin, destination);
}

/**
 * Calculate travel distances between coordinate pairs
 * POST /api/travel/distance
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    // Check API access control first
    const access = await checkApiAccess("google_distance_matrix");
    const useLocalEstimation = !access.allowed || !GOOGLE_MAPS_API_KEY;

    if (useLocalEstimation) {
      console.log("[Distance API] Using local coordinate-based estimation (API disabled or no key)");
    }

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

    // If using local estimation (API disabled), calculate all results locally
    if (useLocalEstimation) {
      const results: (DistanceResult & { index: number })[] = [];

      for (const pair of pairs) {
        // Need coordinates for local estimation
        if (pair.origin?.lat && pair.origin?.lng && pair.destination?.lat && pair.destination?.lng) {
          const estimate = estimateTravelTime(
            pair.origin,
            pair.destination,
            pair.mode as "WALKING" | "DRIVING" | "AUTO" | undefined
          );

          results.push({
            index: pair.index,
            origin: pair.origin,
            destination: pair.destination,
            mode: estimate.mode,
            distanceMeters: estimate.distanceMeters,
            durationSeconds: estimate.durationSeconds,
            distanceText: `~${estimate.distanceText}`,
            durationText: `~${estimate.durationText}`,
            source: "api", // Mark as "api" for compatibility, but it's estimated
          });
        } else {
          // No coordinates, use default fallback
          const mode = pair.mode === "WALKING" ? "WALKING" : "DRIVING";
          results.push({
            index: pair.index,
            origin: pair.origin || { lat: 0, lng: 0 },
            destination: pair.destination || { lat: 0, lng: 0 },
            mode,
            distanceMeters: mode === "WALKING" ? 500 : 5000,
            durationSeconds: mode === "WALKING" ? 360 : 600,
            distanceText: mode === "WALKING" ? "~500 m" : "~5 km",
            durationText: mode === "WALKING" ? "~6 min" : "~10 min",
            source: "api",
          });
        }
      }

      // Log as estimated (no cost)
      await logApiCall({
        apiName: "google_distance_matrix",
        endpoint: "/distancematrix/json (local estimation)",
        status: 200,
        responseTimeMs: Date.now() - startTime,
        cacheHit: false,
        costUsd: 0,
        metadata: { estimated: true, pairs: pairs.length },
      });

      return NextResponse.json({
        results: results.sort((a, b) => a.index - b.index),
        stats: {
          total: pairs.length,
          cached: 0,
          fetched: 0,
          estimated: results.length,
        },
      });
    }

    const results: (DistanceResult & { index: number })[] = [];
    const uncached: Array<{
      originAddress?: string;
      destinationAddress?: string;
      origin?: Coordinates;
      destination?: Coordinates;
      mode: "WALKING" | "DRIVING";
      hash: string;
      index: number;
    }> = [];

    // Determine modes and generate hashes for all pairs
    const pairsWithModes = pairs.map((pair) => {
      const mode = determineMode(pair.origin, pair.destination, pair.mode);
      return {
        ...pair,
        mode,
        hash: generateRouteHash(
          pair.originAddress,
          pair.destinationAddress,
          pair.origin,
          pair.destination,
          mode
        ),
      };
    });

    // Debug: Log mode breakdown
    const walkingCount = pairsWithModes.filter(p => p.mode === "WALKING").length;
    const drivingCount = pairsWithModes.filter(p => p.mode === "DRIVING").length;
    console.log("[Distance API] Pairs received:", {
      total: pairs.length,
      walking: walkingCount,
      driving: drivingCount,
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
          index: pair.index,
          origin: pair.origin || { lat: cachedResult.origin_lat, lng: cachedResult.origin_lng },
          destination: pair.destination || { lat: cachedResult.destination_lat, lng: cachedResult.destination_lng },
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

        // Log cache hit for cost tracking
        logApiCall({
          apiName: "google_distance_matrix",
          endpoint: "/distancematrix/json",
          status: 200,
          responseTimeMs: 0,
          cacheHit: true,
          costUsd: 0, // Cache hit = FREE
        });
      } else {
        uncached.push({
          originAddress: pair.originAddress,
          destinationAddress: pair.destinationAddress,
          origin: pair.origin,
          destination: pair.destination,
          mode: pair.mode,
          hash: pair.hash,
          index: pair.index,
        });
      }
    }

    // Debug: Log cache results
    console.log("[Distance API] Cache results:", {
      cacheHits: results.length,
      uncachedPairs: uncached.length,
      uncachedByMode: {
        walking: uncached.filter(p => p.mode === "WALKING").length,
        driving: uncached.filter(p => p.mode === "DRIVING").length,
      },
    });

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
        // Filter pairs that have BOTH valid origin AND destination
        // This ensures origins and destinations arrays match 1-to-1
        const validPairs = modePairs.filter((p) => {
          const hasOrigin = p.originAddress || (p.origin?.lat && p.origin?.lng);
          const hasDestination = p.destinationAddress || (p.destination?.lat && p.destination?.lng);
          return hasOrigin && hasDestination;
        });

        // Handle pairs without valid locations - add fallback results for them
        const invalidPairs = modePairs.filter((p) => {
          const hasOrigin = p.originAddress || (p.origin?.lat && p.origin?.lng);
          const hasDestination = p.destinationAddress || (p.destination?.lat && p.destination?.lng);
          return !hasOrigin || !hasDestination;
        });

        // Add fallback results for invalid pairs immediately
        for (const pair of invalidPairs) {
          console.warn(`[Distance API] No valid location for pair index ${pair.index}, using fallback`);
          const result: DistanceResult & { index: number } = {
            index: pair.index,
            origin: pair.origin || { lat: 0, lng: 0 },
            destination: pair.destination || { lat: 0, lng: 0 },
            mode: mode as "WALKING" | "DRIVING",
            distanceMeters: mode === "WALKING" ? 500 : 5000,
            durationSeconds: mode === "WALKING" ? 360 : 600,
            distanceText: mode === "WALKING" ? "~500 m" : "~5 km",
            durationText: mode === "WALKING" ? "~6 min" : "~10 min",
            source: "api",
          };
          results.push(result);
        }

        // Skip API call if no valid pairs
        if (validPairs.length === 0) {
          console.log(`[Distance API] No valid pairs for ${mode}, skipping API call`);
          continue;
        }

        // Build origins and destinations strings - prefer addresses over coordinates
        // Addresses give more accurate results as Google can resolve them properly
        const origins = validPairs
          .map((p) => {
            if (p.originAddress) {
              return encodeURIComponent(p.originAddress);
            }
            return `${p.origin!.lat},${p.origin!.lng}`;
          })
          .join("|");

        const destinations = validPairs
          .map((p) => {
            if (p.destinationAddress) {
              return encodeURIComponent(p.destinationAddress);
            }
            return `${p.destination!.lat},${p.destination!.lng}`;
          })
          .join("|");

        const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${origins}&destinations=${destinations}&mode=${mode.toLowerCase()}&key=${GOOGLE_MAPS_API_KEY}`;

        try {
          console.log(`[Distance API] Calling Google API for ${mode}:`, {
            validPairs: validPairs.length,
            totalPairs: modePairs.length,
            origins: validPairs.map(p => p.originAddress || `${p.origin?.lat.toFixed(4)},${p.origin?.lng.toFixed(4)}`),
          });

          const response = await fetch(url);
          const data = await response.json();

          console.log(`[Distance API] Google API response for ${mode}:`, {
            status: data.status,
            errorMessage: data.error_message,
            rowsCount: data.rows?.length,
            expectedRows: validPairs.length,
          });

          if (data.status === "OK") {
            // Distance Matrix returns a matrix, but we want diagonal (1-to-1)
            // Since validPairs, origins, and destinations all have the same length and order,
            // rows[i].elements[i] gives us the distance from origin[i] to destination[i]
            for (let i = 0; i < validPairs.length; i++) {
              const element = data.rows[i]?.elements[i];
              const pair = validPairs[i];

              if (element?.status === "OK") {
                const result: DistanceResult & { index: number } = {
                  index: pair.index,
                  origin: pair.origin || { lat: 0, lng: 0 },
                  destination: pair.destination || { lat: 0, lng: 0 },
                  mode: mode as "WALKING" | "DRIVING",
                  distanceMeters: element.distance.value,
                  durationSeconds: element.duration.value,
                  distanceText: element.distance.text,
                  durationText: element.duration.text,
                  source: "api",
                };

                results.push(result);

                // Cache the result - use coordinates if available
                if (pair.origin && pair.destination) {
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
                        Date.now() + 60 * 24 * 60 * 60 * 1000
                      ).toISOString(), // 60 days - distances between fixed points are very stable
                    })
                    .then(({ error }) => {
                      if (error) console.error("Distance cache insert error:", error);
                    });
                }
              } else {
                // Fallback: Use coordinate-based estimation when API returns ZERO_RESULTS
                // This ensures we always have some distance data to display
                console.warn(
                  `Distance Matrix element status: ${element?.status} for pair ${i}, using coordinate estimation`
                );

                // Only calculate fallback if we have coordinates
                if (pair.origin && pair.destination) {
                  const estimate = estimateTravelTime(
                    pair.origin,
                    pair.destination,
                    mode as "WALKING" | "DRIVING"
                  );

                  const result: DistanceResult & { index: number } = {
                    index: pair.index,
                    origin: pair.origin,
                    destination: pair.destination,
                    mode: estimate.mode,
                    distanceMeters: estimate.distanceMeters,
                    durationSeconds: estimate.durationSeconds,
                    distanceText: `~${estimate.distanceText}`,
                    durationText: `~${estimate.durationText}`,
                    source: "api", // Mark as API even though it's estimated
                  };

                  results.push(result);
                } else {
                  // No coordinates available, use a default estimate (5km driving)
                  console.warn(`No coordinates for fallback, using default estimate for pair ${i}`);
                  const result: DistanceResult & { index: number } = {
                    index: pair.index,
                    origin: { lat: 0, lng: 0 },
                    destination: { lat: 0, lng: 0 },
                    mode: mode as "WALKING" | "DRIVING",
                    distanceMeters: mode === "WALKING" ? 500 : 5000,
                    durationSeconds: mode === "WALKING" ? 360 : 600,
                    distanceText: mode === "WALKING" ? "~500 m" : "~5 km",
                    durationText: mode === "WALKING" ? "~6 min" : "~10 min",
                    source: "api",
                  };
                  results.push(result);
                }
              }
            }

            // Log API usage for cost tracking using centralized gateway
            const elements = validPairs.length;
            logApiCall({
              apiName: "google_distance_matrix",
              endpoint: "/distancematrix/json",
              status: 200,
              responseTimeMs: 0,
              cacheHit: false,
              costUsd: elements * 0.005, // $5 per 1000 elements
              metadata: { mode, pairs: validPairs.length },
            });
          } else {
            console.error("Distance Matrix API error:", data.status, data.error_message);
            // Add fallback results for all pairs when API fails using coordinate estimation
            for (const pair of validPairs) {
              if (pair.origin && pair.destination) {
                const estimate = estimateTravelTime(
                  pair.origin,
                  pair.destination,
                  mode as "WALKING" | "DRIVING"
                );

                results.push({
                  index: pair.index,
                  origin: pair.origin,
                  destination: pair.destination,
                  mode: estimate.mode,
                  distanceMeters: estimate.distanceMeters,
                  durationSeconds: estimate.durationSeconds,
                  distanceText: `~${estimate.distanceText}`,
                  durationText: `~${estimate.durationText}`,
                  source: "api",
                });
              } else {
                results.push({
                  index: pair.index,
                  origin: { lat: 0, lng: 0 },
                  destination: { lat: 0, lng: 0 },
                  mode: mode as "WALKING" | "DRIVING",
                  distanceMeters: mode === "WALKING" ? 500 : 5000,
                  durationSeconds: mode === "WALKING" ? 360 : 600,
                  distanceText: mode === "WALKING" ? "~500 m" : "~5 km",
                  durationText: mode === "WALKING" ? "~6 min" : "~10 min",
                  source: "api",
                });
              }
            }
          }
        } catch (error) {
          console.error(`Distance Matrix request failed for mode: ${mode}`, error);
          // Add fallback results when request fails completely using coordinate estimation
          for (const pair of validPairs) {
            if (pair.origin && pair.destination) {
              const estimate = estimateTravelTime(
                pair.origin,
                pair.destination,
                mode as "WALKING" | "DRIVING"
              );

              results.push({
                index: pair.index,
                origin: pair.origin,
                destination: pair.destination,
                mode: estimate.mode,
                distanceMeters: estimate.distanceMeters,
                durationSeconds: estimate.durationSeconds,
                distanceText: `~${estimate.distanceText}`,
                durationText: `~${estimate.durationText}`,
                source: "api",
              });
            } else {
              results.push({
                index: pair.index,
                origin: { lat: 0, lng: 0 },
                destination: { lat: 0, lng: 0 },
                mode: mode as "WALKING" | "DRIVING",
                distanceMeters: mode === "WALKING" ? 500 : 5000,
                durationSeconds: mode === "WALKING" ? 360 : 600,
                distanceText: mode === "WALKING" ? "~500 m" : "~5 km",
                durationText: mode === "WALKING" ? "~6 min" : "~10 min",
                source: "api",
              });
            }
          }
        }
      }
    }

    // Results already have indices - just sort by index for consistency
    const sortedResults = results.sort((a, b) => a.index - b.index);

    console.log("[Distance API] Final results:", {
      totalPairs: pairs.length,
      resultsReturned: sortedResults.length,
      walkingResults: sortedResults.filter(r => r.mode === "WALKING").length,
      drivingResults: sortedResults.filter(r => r.mode === "DRIVING").length,
    });

    return NextResponse.json({
      results: sortedResults,
      stats: {
        total: pairs.length,
        cached: results.filter((r) => r.source === "cache").length,
        fetched: results.filter((r) => r.source === "api").length,
        failed: pairs.length - sortedResults.length,
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
