import { placesCostForCall } from "@/lib/api-gateway/places-sku";
// Field masks drive Google's SKU (lib/api-gateway/places-sku.ts). The gallery
// search asks for rating, hours, price and website because PlaceGallery renders
// them (Enterprise tier); the destination cover search stays on Pro.
const GALLERY_SEARCH_FIELD_MASK =
  "places.id,places.displayName,places.formattedAddress,places.location,places.photos,places.rating,places.userRatingCount,places.websiteUri,places.googleMapsUri,places.priceLevel,places.priceRange,places.currentOpeningHours";
const DESTINATION_SEARCH_FIELD_MASK =
  "places.id,places.displayName,places.formattedAddress,places.location,places.photos";
import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { deduplicatedFetch, generateKey } from "@/lib/api/request-dedup";
import { checkApiAccess, logApiCall } from "@/lib/api-gateway";
import { checkUsageLimit, incrementUsage } from "@/lib/usage-limits";
import { getAuthenticatedUser } from "@/lib/api/auth";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { withPhotoIndex } from "@/lib/places/heal-dedupe";
import { destinationPhotos } from "@/lib/images/destination-photos";
import { readJsonBody } from "@/lib/api/json-body";

const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY || "";

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
 * Build a same-origin URL for a Google Places photo.
 *
 * NEVER hand `places.googleapis.com/.../media?key=...` to a browser. Two
 * independent reasons, either one sufficient:
 *   1. It embeds GOOGLE_PLACES_API_KEY in a URL the client can read.
 *   2. Google 504s those media endpoints for direct browser loads anyway
 *      (see the long note in app/api/places/photo/route.ts), so the image
 *      silently fails to render even when the key is fine.
 */
function placePhotoUrl(photoName: string, w: number, h: number): string {
  return `/api/places/photo?name=${encodeURIComponent(photoName)}&w=${w}&h=${h}`;
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
    /** The X-Goog-FieldMask of the call; decides the SKU. Defaults to the gallery search. */
    fieldMask?: string;
  } = {}
): Promise<void> {
  const { cacheHit = false, status = 200, error, responseTimeMs = 0, userId, fieldMask = GALLERY_SEARCH_FIELD_MASK } = options;

  await logApiCall({
    apiName: "google_places_search",
    endpoint,
    status,
    responseTimeMs,
    cacheHit,
    costUsd: cacheHit || status >= 400 ? 0 : placesCostForCall({ kind: "textSearch", fieldMask }).usd,
    error,
    userId,
  });
}

// Search for a place and get its details including photos
export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    // Require authentication to prevent anonymous abuse
    const { user, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;

    const { body: payload, invalidBody } = await readJsonBody(request);
    if (invalidBody) return invalidBody;
    const { query, maxPhotos = 5 } = payload;

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
            "X-Goog-FieldMask": GALLERY_SEARCH_FIELD_MASK,
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

    const place: PlaceResult | undefined = searchData.places?.[0];

    if (!place) {
      return errors.notFound("Place not found");
    }

    // Construct photo URLs
    const photos =
      place.photos?.slice(0, maxPhotos).map((photo) => ({
        url: placePhotoUrl(photo.name, 1200, 800),
        thumbnailUrl: placePhotoUrl(photo.name, 300, 200),
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

    // Google's answer is shown, never kept: its terms allow storing only place IDs and,
    // for 30 days, coordinates.
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

// Get destination cover image and info.
// Open to signed-out visitors: DestinationHero on /trips/new shows this cover
// to everyone before they save. Cost is held by the server-side cache (most
// destinations are hits), the checkApiAccess() kill switch, and the usage
// limit for signed-in users (below). No per-IP rate limit yet. POST (generic
// searches) stays signed-in only.
export async function GET(request: NextRequest) {
  const startTime = Date.now();
  const { searchParams } = new URL(request.url);
  const destination = searchParams.get("destination");

  if (!destination) {
    return errors.badRequest("Destination is required");
  }

  try {
    // Wikimedia first: free, stored once and credited. Google's photos are
    // paid on every view and may not be stored (lib/images/wikimedia.ts).
    const wiki = await destinationPhotos(destination, request);
    if (wiki) {
      return apiSuccess({
        placeId: "",
        name: destination,
        address: "",
        location: { latitude: 0, longitude: 0 },
        coverImageUrl: wiki.cover,
        galleryPhotos: wiki.gallery.map((url) => ({ url, thumbnailUrl: url })),
        source: "wikimedia",
      });
    }

    // The planner's preview of a plan nobody has kept yet gets no Google
    // photo; it falls back to a stock cover (DestinationHero).
    if (searchParams.get("free") === "1") {
      return apiSuccess({
        placeId: "",
        name: destination,
        address: "",
        location: { latitude: 0, longitude: 0 },
        coverImageUrl: null,
        galleryPhotos: [],
        source: "none",
      });
    }

    // Read auth state if present (for usage tracking + per-user rate-limit).
    // Missing user is now an expected, non-error condition.
    const supabaseAuth = await createClient();
    const { data: { user } } = await supabaseAuth.auth.getUser();

    // Check API access control
    const access = await checkApiAccess("google_places_search");
    if (!access.allowed) {
      await logPlacesApiRequest("/places:searchText (destination)", {
        fieldMask: DESTINATION_SEARCH_FIELD_MASK,
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
        fieldMask: DESTINATION_SEARCH_FIELD_MASK,
        status: 500,
        error: "API key not configured or blocked",
        userId: user?.id,
      });
      return errors.internal("Google Places API key not configured", "Places Destination");
    }

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
            // The field mask drives the Places SKU. `editorialSummary` is an
            // Atmosphere-tier field that forces the priciest Text Search SKU,
            // and its result (`description` below) is NEVER rendered — the only
            // consumer, DestinationHero, reads only coverImageUrl + galleryPhotos.
            // Dropped to keep this call on the cheaper Pro tier. `photos` (Pro)
            // stays — it powers the cover + gallery.
            "X-Goog-FieldMask": DESTINATION_SEARCH_FIELD_MASK,
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

    const place = searchData.places?.[0];

    if (!place) {
      return errors.notFound("Destination not found");
    }

    // Return proxy URLs that stream the photo through our /api/places/photo
    // route: browsers get HTTP 504 from Google's photo URLs, and the proxy
    // keeps the API key server-side. The CDN caches the proxied bytes.
    const proxyUrl = (photoName: string, w: number, h: number): string =>
      `/api/places/photo?name=${encodeURIComponent(photoName)}&w=${w}&h=${h}`;

    const coverPhoto = place.photos?.[0];
    const coverImageUrl = coverPhoto ? proxyUrl(coverPhoto.name, 1920, 1200) : null;

    // Google returns photos at their NATIVE aspect ratio capped to the
    // requested box, so a portrait original asked for at 200x150 comes back
    // as 68x150, letterboxed in our landscape gallery tiles. The gallery
    // keeps roughly landscape photos.
    const isLandscapeFriendly = (p: PlacePhoto): boolean => {
      if (!p.widthPx || !p.heightPx) return true; // Be permissive on missing meta
      const ratio = p.widthPx / p.heightPx;
      return ratio >= 1.1; // Allow square-ish to wide; reject portraits
    };

    const candidates: PlacePhoto[] = (place.photos || []).slice(1);
    const landscape = candidates.filter(isLandscapeFriendly);
    // Fall back to any photos if filtering left nothing — better something
    // (even an awkward portrait) than an empty gallery.
    const galleryPhotosSource = (landscape.length >= 3 ? landscape : candidates).slice(0, 4);

    // Each tile's URLs carry its photo's index in place.photos, so a dead name
    // heals to that photo rather than to the cover.
    const galleryPhotos = galleryPhotosSource.map((photo: PlacePhoto) => {
      const index = place.photos.indexOf(photo);
      return {
        url: withPhotoIndex(proxyUrl(photo.name, 800, 600), index),
        thumbnailUrl: withPhotoIndex(proxyUrl(photo.name, 200, 150), index),
      };
    });

    const result = {
      placeId: place.id,
      name: place.displayName?.text,
      address: place.formattedAddress,
      location: place.location,
      coverImageUrl,
      galleryPhotos,
      description: place.editorialSummary?.text,
    };

    // Google's answer is shown, never kept (as for the search above).
    await logPlacesApiRequest("/places:searchText (destination)", {
        fieldMask: DESTINATION_SEARCH_FIELD_MASK,
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
        fieldMask: DESTINATION_SEARCH_FIELD_MASK,
      status: 500,
      error: error instanceof Error ? error.message : String(error),
      responseTimeMs: Date.now() - startTime,
      userId: undefined, // User context lost in catch block
    });

    return errors.internal("Internal server error", "Places Destination");
  }
}
