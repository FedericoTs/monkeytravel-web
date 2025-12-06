/**
 * Place Details API Route
 *
 * GET /api/places/details?placeId=...
 *
 * Fetches place details including coordinates from Google Places API.
 * Used to get latitude/longitude for accurate seasonal/weather calculations.
 * Includes database caching (90 days) since place details rarely change.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import crypto from "crypto";
import { checkApiAccess, logApiCall } from "@/lib/api-gateway";

const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY || "";

// Cache duration: 90 days for place details (coordinates rarely change)
const CACHE_DURATION_DAYS = 90;

/**
 * Generate cache key for place ID
 */
function generateCacheKey(placeId: string): string {
  return crypto.createHash("md5").update(`details:${placeId}`).digest("hex");
}

/**
 * Check cache for existing place details
 */
async function getFromCache(cacheKey: string): Promise<unknown | null> {
  try {
    const { data, error } = await supabase
      .from("google_places_cache")
      .select("*")
      .eq("place_id", cacheKey)
      .eq("cache_type", "details")
      .gt("expires_at", new Date().toISOString())
      .single();

    if (error || !data) return null;

    // Update hit count asynchronously
    supabase
      .from("google_places_cache")
      .update({
        hit_count: (data.hit_count || 0) + 1,
        last_accessed_at: new Date().toISOString(),
      })
      .eq("id", data.id)
      .then(() => {});

    console.log("[Place Details] Cache HIT for:", cacheKey.substring(0, 16) + "...");
    return data.data;
  } catch {
    return null;
  }
}

/**
 * Store result in cache
 */
async function saveToCache(cacheKey: string, data: unknown): Promise<void> {
  try {
    const expiresAt = new Date(Date.now() + CACHE_DURATION_DAYS * 24 * 60 * 60 * 1000);

    const { error } = await supabase.from("google_places_cache").upsert(
      {
        place_id: cacheKey,
        cache_type: "details",
        data,
        request_hash: cacheKey,
        cached_at: new Date().toISOString(),
        expires_at: expiresAt.toISOString(),
        hit_count: 0,
        last_accessed_at: new Date().toISOString(),
      },
      { onConflict: "place_id" }
    );

    if (error) {
      console.error("[Place Details Cache] Save error:", error.message);
    } else {
      console.log("[Place Details] Cached:", cacheKey.substring(0, 16) + "...");
    }
  } catch (error) {
    console.error("[Place Details Cache] Save exception:", error);
  }
}

/**
 * Log API request for cost tracking using centralized gateway
 */
async function logDetailsApiRequest(options: {
  cacheHit?: boolean;
  status?: number;
  error?: string;
  responseTimeMs?: number;
}): Promise<void> {
  const { cacheHit = false, status = 200, error, responseTimeMs = 0 } = options;

  await logApiCall({
    apiName: "google_places_details",
    endpoint: "/places/{placeId}",
    status,
    responseTimeMs,
    cacheHit,
    costUsd: cacheHit || status >= 400 ? 0 : 0.017, // Place Details costs ~$17 per 1000
    error,
  });
}

export async function GET(request: NextRequest) {
  const startTime = Date.now();
  const { searchParams } = new URL(request.url);
  const placeId = searchParams.get("placeId");

  if (!placeId) {
    return NextResponse.json(
      { error: "placeId is required" },
      { status: 400 }
    );
  }

  try {
    // Check API access control first
    const access = await checkApiAccess("google_places_details");
    if (!access.allowed) {
      await logDetailsApiRequest({
        status: 503,
        error: `BLOCKED: ${access.message}`,
      });
      return NextResponse.json(
        { error: access.message || "Place Details API is currently disabled" },
        { status: 503 }
      );
    }

    if (!GOOGLE_PLACES_API_KEY || !access.shouldPassKey) {
      await logDetailsApiRequest({
        status: 500,
        error: "API key not configured or blocked",
      });
      return NextResponse.json(
        { error: "Google Places API key not configured" },
        { status: 500 }
      );
    }
    // Check cache first
    const cacheKey = generateCacheKey(placeId);
    const cachedResult = await getFromCache(cacheKey);

    if (cachedResult) {
      logDetailsApiRequest({ cacheHit: true });
      return NextResponse.json(cachedResult);
    }

    console.log("[Place Details] Cache MISS for:", placeId);

    // Use Places API (New) to get place details
    const response = await fetch(
      `https://places.googleapis.com/v1/places/${placeId}`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
          "X-Goog-FieldMask": "id,displayName,formattedAddress,location,addressComponents",
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Places Details API error:", errorText);
      return NextResponse.json(
        { error: "Failed to fetch place details" },
        { status: 500 }
      );
    }

    const data = await response.json();

    // Extract country code from address components if available
    let countryCode: string | null = null;
    if (data.addressComponents) {
      const countryComponent = data.addressComponents.find(
        (component: { types: string[] }) =>
          component.types.includes("country")
      );
      if (countryComponent) {
        countryCode = countryComponent.shortText;
      }
    }

    const result = {
      placeId: data.id,
      name: data.displayName?.text,
      address: data.formattedAddress,
      location: data.location, // { latitude, longitude }
      countryCode,
    };

    // Save to cache and log API usage
    saveToCache(cacheKey, result);
    logDetailsApiRequest({ responseTimeMs: Date.now() - startTime });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Place Details API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
