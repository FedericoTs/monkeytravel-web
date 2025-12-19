import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import crypto from "crypto";
import { deduplicatedFetch, generateKey } from "@/lib/api/request-dedup";
import { checkApiAccess, logApiCall } from "@/lib/api-gateway";

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_PLACES_API_KEY || "";

interface GeocodeRequest {
  addresses: string[];
}

interface GeocodeResult {
  address: string;
  lat: number;
  lng: number;
  formattedAddress: string;
  placeId?: string;
  locationType?: string;
  source: "cache" | "api";
}

/**
 * Normalize address for consistent hashing
 * Removes special characters and converts to lowercase
 */
function normalizeAddress(addr: string): string {
  return addr
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Generate MD5 hash of normalized address
 */
function hashAddress(addr: string): string {
  return crypto.createHash("md5").update(normalizeAddress(addr)).digest("hex");
}

/**
 * Batch geocode addresses with caching
 * POST /api/travel/geocode
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    // Check API access control first
    const access = await checkApiAccess("google_geocoding");
    if (!access.allowed) {
      await logApiCall({
        apiName: "google_geocoding",
        endpoint: "/geocode/json",
        status: 503,
        responseTimeMs: Date.now() - startTime,
        cacheHit: false,
        costUsd: 0,
        error: `BLOCKED: ${access.message}`,
      });
      return NextResponse.json(
        { error: access.message || "Geocoding API is currently disabled" },
        { status: 503 }
      );
    }

    const { addresses }: GeocodeRequest = await request.json();

    if (!addresses?.length) {
      return NextResponse.json(
        { error: "Addresses array is required" },
        { status: 400 }
      );
    }

    if (addresses.length > 50) {
      return NextResponse.json(
        { error: "Maximum 50 addresses per request" },
        { status: 400 }
      );
    }

    if (!GOOGLE_MAPS_API_KEY || !access.shouldPassKey) {
      await logApiCall({
        apiName: "google_geocoding",
        endpoint: "/geocode/json",
        status: 500,
        responseTimeMs: Date.now() - startTime,
        cacheHit: false,
        costUsd: 0,
        error: "API key not configured or blocked",
      });
      return NextResponse.json(
        { error: "Google Maps API key not configured" },
        { status: 500 }
      );
    }

    const results: GeocodeResult[] = [];
    const uncachedAddresses: { address: string; hash: string; index: number }[] = [];

    // Generate hashes for all addresses
    const addressHashes = addresses.map((addr, index) => ({
      address: addr,
      hash: hashAddress(addr),
      index,
    }));

    // Step 1: Check cache for all addresses
    const hashes = addressHashes.map((h) => h.hash);
    const { data: cached, error: cacheError } = await supabase
      .from("geocode_cache")
      .select("*")
      .in("address_hash", hashes)
      .gt("expires_at", new Date().toISOString());

    if (cacheError) {
      console.error("Cache lookup error:", cacheError);
    }

    // Build a map of cached results
    const cachedMap = new Map(
      cached?.map((c) => [c.address_hash, c]) ?? []
    );

    // Step 2: Separate cached and uncached addresses
    for (const { address, hash, index } of addressHashes) {
      const cachedResult = cachedMap.get(hash);
      if (cachedResult) {
        results.push({
          address,
          lat: parseFloat(cachedResult.lat),
          lng: parseFloat(cachedResult.lng),
          formattedAddress: cachedResult.formatted_address || address,
          placeId: cachedResult.place_id,
          locationType: cachedResult.location_type,
          source: "cache",
        });

        // Update hit count asynchronously (fire and forget)
        supabase
          .from("geocode_cache")
          .update({
            hit_count: cachedResult.hit_count + 1,
            last_accessed_at: new Date().toISOString(),
          })
          .eq("id", cachedResult.id)
          .then(() => {});

        // Log cache hit for cost tracking
        logApiCall({
          apiName: "google_geocoding",
          endpoint: "/geocode/json",
          status: 200,
          responseTimeMs: 0,
          cacheHit: true,
          costUsd: 0, // Cache hit = FREE
        });
      } else {
        uncachedAddresses.push({ address, hash, index });
      }
    }

    // Step 3: Fetch uncached addresses from Google Geocoding API in parallel
    // Using batches of 10 to respect rate limits while maximizing throughput
    const apiResults: GeocodeResult[] = [];
    const BATCH_SIZE = 25; // Google supports up to 25 addresses per batch

    // Process a single address with deduplication for concurrent requests
    async function geocodeAddress(
      address: string,
      hash: string
    ): Promise<GeocodeResult | null> {
      // Use deduplication to coalesce concurrent requests for the same address
      const dedupKey = generateKey("geocode", { hash });

      return deduplicatedFetch(dedupKey, async () => {
        try {
          const response = await fetch(
            `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${GOOGLE_MAPS_API_KEY}`
          );

          const data = await response.json();

          if (data.status === "OK" && data.results[0]) {
            const result = data.results[0];
            const location = result.geometry.location;
            const locationType = result.geometry.location_type;

            // Determine confidence based on location type
            let confidence = 0.5;
            if (locationType === "ROOFTOP") confidence = 1.0;
            else if (locationType === "RANGE_INTERPOLATED") confidence = 0.8;
            else if (locationType === "GEOMETRIC_CENTER") confidence = 0.6;

            // Cache the result (fire and forget)
            supabase
              .from("geocode_cache")
              .insert({
                address_hash: hash,
                original_address: address,
                normalized_address: normalizeAddress(address),
                lat: location.lat,
                lng: location.lng,
                formatted_address: result.formatted_address,
                place_id: result.place_id,
                location_type: locationType,
                confidence,
                expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(), // 90 days
              })
              .then(({ error }) => {
                if (error) console.error("Cache insert error:", error);
              });

            // Log API usage for cost tracking using centralized gateway
            logApiCall({
              apiName: "google_geocoding",
              endpoint: "/geocode/json",
              status: 200,
              responseTimeMs: 0,
              cacheHit: false,
              costUsd: 0.005, // $5 per 1000 requests
              metadata: { address: address.substring(0, 100) },
            });

            return {
              address,
              lat: location.lat,
              lng: location.lng,
              formattedAddress: result.formatted_address,
              placeId: result.place_id,
              locationType,
              source: "api",
            } as GeocodeResult;
          } else if (data.status === "ZERO_RESULTS") {
            console.warn(`No geocode results for: ${address}`);
          } else {
            console.error(`Geocoding error for ${address}:`, data.status, data.error_message);
          }
        } catch (error) {
          console.error(`Geocoding request failed for: ${address}`, error);
        }
        return null;
      });
    }

    // Process in parallel batches
    for (let i = 0; i < uncachedAddresses.length; i += BATCH_SIZE) {
      const batch = uncachedAddresses.slice(i, i + BATCH_SIZE);
      console.log(`[Geocode] Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(uncachedAddresses.length / BATCH_SIZE)} (${batch.length} addresses)`);

      const batchResults = await Promise.all(
        batch.map(({ address, hash }) => geocodeAddress(address, hash))
      );

      // Filter out nulls and add to results
      for (const result of batchResults) {
        if (result) {
          apiResults.push(result);
          results.push(result);
        }
      }
    }

    // Sort results to match original order
    const orderedResults = addresses.map((addr) => {
      return results.find((r) => r.address === addr) || null;
    }).filter((r): r is GeocodeResult => r !== null);

    return NextResponse.json({
      results: orderedResults,
      stats: {
        total: addresses.length,
        cached: results.filter((r) => r.source === "cache").length,
        fetched: apiResults.length,
        failed: addresses.length - orderedResults.length,
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
