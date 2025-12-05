import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import crypto from "crypto";

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

    await supabase.from("google_places_cache").upsert(
      {
        place_id: cacheKey,
        cache_type: cacheType,
        data,
        cached_at: new Date().toISOString(),
        expires_at: expiresAt.toISOString(),
        hit_count: 0,
        last_accessed_at: new Date().toISOString(),
      },
      { onConflict: "place_id" }
    );
  } catch (error) {
    console.error("[Places Cache] Save error:", error);
  }
}

/**
 * Log API request for cost tracking
 */
async function logApiRequest(endpoint: string, cacheHit: boolean): Promise<void> {
  try {
    await supabase.from("api_request_logs").insert({
      api_name: "google_places",
      endpoint,
      response_status: 200,
      response_time_ms: 0,
      cache_hit: cacheHit,
      cost_usd: cacheHit ? 0 : 0.017, // Places Text Search costs ~$17 per 1000
    });
  } catch {
    // Ignore logging errors
  }
}

// Search for a place and get its details including photos
export async function POST(request: NextRequest) {
  try {
    const { query, maxPhotos = 5 } = await request.json();

    if (!query) {
      return NextResponse.json({ error: "Query is required" }, { status: 400 });
    }

    if (!GOOGLE_PLACES_API_KEY) {
      return NextResponse.json(
        { error: "Google Places API key not configured" },
        { status: 500 }
      );
    }

    // Check cache first
    const cacheKey = generateCacheKey(query, "search");
    const cachedResult = await getFromCache(cacheKey);

    if (cachedResult) {
      console.log("[Places API] Cache HIT for:", query);
      logApiRequest("/places:searchText", true);
      return NextResponse.json(cachedResult);
    }

    console.log("[Places API] Cache MISS for:", query);

    // Use Text Search to find the place
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
      console.error("Places API error:", errorText);
      return NextResponse.json(
        { error: "Failed to search for place" },
        { status: 500 }
      );
    }

    const searchData = await searchResponse.json();
    const place: PlaceResult | undefined = searchData.places?.[0];

    if (!place) {
      return NextResponse.json({ error: "Place not found" }, { status: 404 });
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
    logApiRequest("/places:searchText", false);

    return NextResponse.json(result);
  } catch (error) {
    console.error("Places API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// Get destination cover image and info
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const destination = searchParams.get("destination");

  if (!destination) {
    return NextResponse.json(
      { error: "Destination is required" },
      { status: 400 }
    );
  }

  if (!GOOGLE_PLACES_API_KEY) {
    return NextResponse.json(
      { error: "Google Places API key not configured" },
      { status: 500 }
    );
  }

  try {
    // Check cache first
    const cacheKey = generateCacheKey(destination, "destination");
    const cachedResult = await getFromCache(cacheKey);

    if (cachedResult) {
      console.log("[Places API] Cache HIT for destination:", destination);
      logApiRequest("/places:searchText (destination)", true);
      return NextResponse.json(cachedResult);
    }

    console.log("[Places API] Cache MISS for destination:", destination);

    // Search for the destination (city/landmark)
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
      return NextResponse.json(
        { error: "Failed to fetch destination" },
        { status: 500 }
      );
    }

    const searchData = await searchResponse.json();
    const place = searchData.places?.[0];

    if (!place) {
      return NextResponse.json(
        { error: "Destination not found" },
        { status: 404 }
      );
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
    logApiRequest("/places:searchText (destination)", false);

    return NextResponse.json(result);
  } catch (error) {
    console.error("Destination API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
