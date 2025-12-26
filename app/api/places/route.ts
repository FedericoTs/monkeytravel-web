import { NextRequest } from "next/server";
import { supabase } from "@/lib/supabase";
import { createClient } from "@/lib/supabase/server";
import crypto from "crypto";
import { deduplicatedFetch, generateKey } from "@/lib/api/request-dedup";
import { checkApiAccess, logApiCall, ApiBlockedError } from "@/lib/api-gateway";
import { checkUsageLimit, incrementUsage } from "@/lib/usage-limits";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";

const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY || "";

// Cache duration: 30 days for place details (they rarely change)
const CACHE_DURATION_DAYS = 30;

interface PlacePhoto {
  name: string;
  widthPx: number;
  heightPx: number;
  authorAttributions: { displayName: string; uri: string }[];
}

interface PlaceResult {
  id: string;
  displayName: { text: string };
  formattedAddress: string;
  location: { latitude: number; longitude: number };
  photos?: PlacePhoto[];
  rating?: number;
  userRatingCount?: number;
  websiteUri?: string;
  googleMapsUri?: string;
  priceLevel?: string; // PRICE_LEVEL_FREE, PRICE_LEVEL_INEXPENSIVE, PRICE_LEVEL_MODERATE, PRICE_LEVEL_EXPENSIVE, PRICE_LEVEL_VERY_EXPENSIVE
  priceRange?: {
    startPrice?: { currencyCode: string; units: string };
    endPrice?: { currencyCode: string; units: string };
  };
  currentOpeningHours?: {
    openNow: boolean;
    weekdayDescriptions: string[];
  };
}

/**
 * Generate cache key hash for a query
 */
function generateCacheKey(query: string, type: string): string {
  const normalized = query.toLowerCase().trim();
  return crypto.createHash("md5").update(`${type}:${normalized}`).digest("hex");
}

/**
 * Check cache for existing place data
 */
async function getFromCache(cacheKey: string): Promise<unknown | null> {
  try {
    const { data, error } = await supabase
      .from("google_places_cache")
      .select("*")
      .eq("place_id", cacheKey)
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

    return data.data;
  } catch {
    return null;
  }
}

/**
 * Store result in cache
 */
async function saveToCache(cacheKey: string, cacheType: string, data: unknown): Promise<void> {
  try {
    const expiresAt = new Date(Date.now() + CACHE_DURATION_DAYS * 24 * 60 * 60 * 1000);

    const { error } = await supabase.from("google_places_cache").upsert(
      {
        place_id: cacheKey,
        cache_type: cacheType,
        data,
        request_hash: cacheKey, // Required field - use cacheKey as hash
        cached_at: new Date().toISOString(),
        expires_at: expiresAt.toISOString(),
        hit_count: 0,
        last_accessed_at: new Date().toISOString(),
      },
      { onConflict: "place_id" }
    );

    if (error) {
      console.error("[Places Cache] Save error:", error.message, error.details);
    } else {
      console.log("[Places Cache] Saved:", cacheKey.substring(0, 16) + "...");
    }
  } catch (error) {
    console.error("[Places Cache] Save exception:", error);
  }
}

/**
 * Log API request for cost tracking (supports success and failure)
 */
async function logPlacesApiRequest(
  endpoint: string,
  options: {
    cacheHit?: boolean;
    status?: number;
    error?: string;
    responseTimeMs?: number;
    userId?: string;
  } = {}
): Promise<void> {
  const { cacheHit = false, status = 200, error, responseTimeMs = 0, userId } = options;

  await logApiCall({
    apiName: "google_places_search",
    endpoint,
    status,
    responseTimeMs,
    cacheHit,
    costUsd: cacheHit || status >= 400 ? 0 : 0.032, // Places Text Search Pro costs ~$32 per 1000
    error,
    userId,
  });
}

// Search for a place and get its details including photos
export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    // Check authentication (optional - for usage tracking)
    const supabaseAuth = await createClient();
    const { data: { user } } = await supabaseAuth.auth.getUser();

    const { query, maxPhotos = 5 } = await request.json();

    if (!query) {
      return errors.badRequest("Query is required");
    }

    // Check API access control
    const access = await checkApiAccess("google_places_search");
    if (!access.allowed) {
      await logPlacesApiRequest("/places:searchText", {
        status: 503,
        error: `BLOCKED: ${access.message}`,
        userId: user?.id,
      });
      return errors.serviceUnavailable(access.message || "Places API is currently disabled");
    }

    // Check usage limits for authenticated users
    let usageCheck = null;
    if (user) {
      usageCheck = await checkUsageLimit(user.id, "placesSearch", user.email);
      if (!usageCheck.allowed) {
        return errors.rateLimit(usageCheck.message || "Daily place search limit reached.", {
          usage: usageCheck,
          upgradeUrl: "/pricing",
        });
      }
    }

    if (!GOOGLE_PLACES_API_KEY || !access.shouldPassKey) {
      await logPlacesApiRequest("/places:searchText", {
        status: 500,
        error: "API key not configured or blocked",
        userId: user?.id,
      });
      return errors.internal("Google Places API key not configured", "Places Search");
    }

    // Check cache first
    const cacheKey = generateCacheKey(query, "search");
    const cachedResult = await getFromCache(cacheKey);

    if (cachedResult) {
      console.log("[Places Search] Cache HIT for:", query);
      await logPlacesApiRequest("/places:searchText", { cacheHit: true, userId: user?.id });
      return apiSuccess(cachedResult);
    }

    console.log("[Places Search] Cache MISS for:", query);

    // Use Text Search to find the place with request deduplication
    // This prevents duplicate concurrent API calls for the same query
    const dedupKey = generateKey("places_search", { query: query.toLowerCase().trim() });

    const searchData = await deduplicatedFetch(dedupKey, async () => {
      const searchResponse = await fetch(
        "https://places.googleapis.com/v1/places:searchText",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
            "X-Goog-FieldMask":
              "places.id,places.displayName,places.formattedAddress,places.location,places.photos,places.rating,places.userRatingCount,places.websiteUri,places.googleMapsUri,places.priceLevel,places.priceRange,places.currentOpeningHours",
          },
          body: JSON.stringify({
            textQuery: query,
            maxResultCount: 1,
          }),
        }
      );

      if (!searchResponse.ok) {
        const errorText = await searchResponse.text();
        console.error("[Places Search] Places API error:", errorText);
        throw new Error("Failed to search for place");
      }

      return searchResponse.json();
    });

    // Handle dedup errors
    if (searchData instanceof Error) {
      return errors.internal(searchData.message, "Places Search");
    }
    const place: PlaceResult | undefined = searchData.places?.[0];

    if (!place) {
      return errors.notFound("Place not found");
    }

    // Construct photo URLs
    const photos =
      place.photos?.slice(0, maxPhotos).map((photo) => ({
        url: `https://places.googleapis.com/v1/${photo.name}/media?maxHeightPx=800&maxWidthPx=1200&key=${GOOGLE_PLACES_API_KEY}`,
        thumbnailUrl: `https://places.googleapis.com/v1/${photo.name}/media?maxHeightPx=200&maxWidthPx=300&key=${GOOGLE_PLACES_API_KEY}`,
        width: photo.widthPx,
        height: photo.heightPx,
        attribution: photo.authorAttributions?.[0]?.displayName || "Google",
      })) || [];

    // Convert price level to symbols
    const priceLevelMap: Record<string, { level: number; symbol: string; label: string }> = {
      PRICE_LEVEL_FREE: { level: 0, symbol: "Free", label: "Free" },
      PRICE_LEVEL_INEXPENSIVE: { level: 1, symbol: "$", label: "Inexpensive" },
      PRICE_LEVEL_MODERATE: { level: 2, symbol: "$$", label: "Moderate" },
      PRICE_LEVEL_EXPENSIVE: { level: 3, symbol: "$$$", label: "Expensive" },
      PRICE_LEVEL_VERY_EXPENSIVE: { level: 4, symbol: "$$$$", label: "Very Expensive" },
    };

    const priceInfo = place.priceLevel ? priceLevelMap[place.priceLevel] : null;

    // Format price range if available
    let priceRangeText = null;
    if (place.priceRange?.startPrice && place.priceRange?.endPrice) {
      const currency = place.priceRange.startPrice.currencyCode || "USD";
      const start = place.priceRange.startPrice.units;
      const end = place.priceRange.endPrice.units;
      priceRangeText = `${currency} ${start}-${end}`;
    }

    const result = {
      placeId: place.id,
      name: place.displayName?.text,
      address: place.formattedAddress,
      location: place.location,
      photos,
      rating: place.rating,
      reviewCount: place.userRatingCount,
      website: place.websiteUri,
      googleMapsUrl: place.googleMapsUri,
      priceLevel: priceInfo?.level,
      priceLevelSymbol: priceInfo?.symbol,
      priceLevelLabel: priceInfo?.label,
      priceRange: priceRangeText,
      openNow: place.currentOpeningHours?.openNow,
      openingHours: place.currentOpeningHours?.weekdayDescriptions,
    };

    // Save to cache and log API usage
    saveToCache(cacheKey, "search", result);
    await logPlacesApiRequest("/places:searchText", {
      responseTimeMs: Date.now() - startTime,
      userId: user?.id,
    });

    // Increment usage counter for authenticated users (only on API calls, not cache hits)
    if (user) {
      await incrementUsage(user.id, "placesSearch", 1);
    }

    return apiSuccess(result);
  } catch (error) {
    console.error("[Places Search] Error:", error);

    // Log the failure (user may be undefined if auth failed)
    await logPlacesApiRequest("/places:searchText", {
      status: 500,
      error: error instanceof Error ? error.message : String(error),
      responseTimeMs: Date.now() - startTime,
      userId: undefined, // User context lost in catch block - need to capture earlier
    });

    return errors.internal("Internal server error", "Places Search");
  }
}

// Get destination cover image and info
export async function GET(request: NextRequest) {
  const startTime = Date.now();
  const { searchParams } = new URL(request.url);
  const destination = searchParams.get("destination");

  if (!destination) {
    return errors.badRequest("Destination is required");
  }

  try {
    // Check authentication (optional - for usage tracking)
    const supabaseAuth = await createClient();
    const { data: { user } } = await supabaseAuth.auth.getUser();

    // Check API access control
    const access = await checkApiAccess("google_places_search");
    if (!access.allowed) {
      await logPlacesApiRequest("/places:searchText (destination)", {
        status: 503,
        error: `BLOCKED: ${access.message}`,
        userId: user?.id,
      });
      return errors.serviceUnavailable(access.message || "Places API is currently disabled");
    }

    // Check usage limits for authenticated users
    if (user) {
      const usageCheck = await checkUsageLimit(user.id, "placesSearch", user.email);
      if (!usageCheck.allowed) {
        return errors.rateLimit(usageCheck.message || "Daily place search limit reached.", {
          usage: usageCheck,
          upgradeUrl: "/pricing",
        });
      }
    }

    if (!GOOGLE_PLACES_API_KEY || !access.shouldPassKey) {
      await logPlacesApiRequest("/places:searchText (destination)", {
        status: 500,
        error: "API key not configured or blocked",
        userId: user?.id,
      });
      return errors.internal("Google Places API key not configured", "Places Destination");
    }

    // Check cache first
    const cacheKey = generateCacheKey(destination, "destination");
    const cachedResult = await getFromCache(cacheKey);

    if (cachedResult) {
      console.log("[Places Destination] Cache HIT for:", destination);
      await logPlacesApiRequest("/places:searchText (destination)", { cacheHit: true, userId: user?.id });
      return apiSuccess(cachedResult);
    }

    console.log("[Places Destination] Cache MISS for:", destination);

    // Search for the destination (city/landmark) with request deduplication
    const dedupKey = generateKey("places_destination", { destination: destination.toLowerCase().trim() });

    const searchData = await deduplicatedFetch(dedupKey, async () => {
      const searchResponse = await fetch(
        "https://places.googleapis.com/v1/places:searchText",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
            "X-Goog-FieldMask":
              "places.id,places.displayName,places.formattedAddress,places.location,places.photos,places.editorialSummary",
          },
          body: JSON.stringify({
            textQuery: destination,
            maxResultCount: 1,
          }),
        }
      );

      if (!searchResponse.ok) {
        throw new Error("Failed to fetch destination");
      }

      return searchResponse.json();
    });

    // Handle dedup errors
    if (searchData instanceof Error) {
      return errors.internal(searchData.message, "Places Destination");
    }
    const place = searchData.places?.[0];

    if (!place) {
      return errors.notFound("Destination not found");
    }

    // Get cover image (first photo, high resolution)
    const coverPhoto = place.photos?.[0];
    const coverImageUrl = coverPhoto
      ? `https://places.googleapis.com/v1/${coverPhoto.name}/media?maxHeightPx=1200&maxWidthPx=1920&key=${GOOGLE_PLACES_API_KEY}`
      : null;

    // Get gallery photos (next 4 photos)
    const galleryPhotos =
      place.photos?.slice(1, 5).map((photo: PlacePhoto) => ({
        url: `https://places.googleapis.com/v1/${photo.name}/media?maxHeightPx=600&maxWidthPx=800&key=${GOOGLE_PLACES_API_KEY}`,
        thumbnailUrl: `https://places.googleapis.com/v1/${photo.name}/media?maxHeightPx=150&maxWidthPx=200&key=${GOOGLE_PLACES_API_KEY}`,
      })) || [];

    const result = {
      placeId: place.id,
      name: place.displayName?.text,
      address: place.formattedAddress,
      location: place.location,
      coverImageUrl,
      galleryPhotos,
      description: place.editorialSummary?.text,
    };

    // Save to cache and log API usage
    saveToCache(cacheKey, "destination", result);
    await logPlacesApiRequest("/places:searchText (destination)", {
      responseTimeMs: Date.now() - startTime,
      userId: user?.id,
    });

    // Increment usage counter for authenticated users (only on API calls, not cache hits)
    if (user) {
      await incrementUsage(user.id, "placesSearch", 1);
    }

    return apiSuccess(result);
  } catch (error) {
    console.error("[Places Destination] Error:", error);

    // Log the failure (user may be undefined if auth failed)
    await logPlacesApiRequest("/places:searchText (destination)", {
      status: 500,
      error: error instanceof Error ? error.message : String(error),
      responseTimeMs: Date.now() - startTime,
      userId: undefined, // User context lost in catch block
    });

    return errors.internal("Internal server error", "Places Destination");
  }
}
