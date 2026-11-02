/**
 * Popular Destinations API
 *
 * GET /api/destinations/popular
 *
 * Returns the top-rated destinations from the database.
 * Used to show quick-pick suggestions before user starts typing.
 *
 * Cost: $0 (local database query)
 */

import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { flagEmoji } from "@/lib/utils/flag-emoji";

// Country name to ISO code mapping
const countryToCode: Record<string, string> = {
  "France": "FR", "Japan": "JP", "United States": "US", "United Kingdom": "GB",
  "Italy": "IT", "Spain": "ES", "Indonesia": "ID", "United Arab Emirates": "AE",
  "Thailand": "TH", "Australia": "AU", "Greece": "GR", "Portugal": "PT",
  "Germany": "DE", "Netherlands": "NL", "Mexico": "MX", "Brazil": "BR",
  "South Korea": "KR", "China": "CN", "India": "IN", "Singapore": "SG",
  "Vietnam": "VN", "Turkey": "TR", "Egypt": "EG", "Morocco": "MA",
  "South Africa": "ZA", "Peru": "PE", "Argentina": "AR", "Chile": "CL",
  "New Zealand": "NZ", "Canada": "CA", "Switzerland": "CH", "Austria": "AT",
  "Czech Republic": "CZ", "Hungary": "HU", "Poland": "PL", "Ireland": "IE",
  "Croatia": "HR", "Denmark": "DK", "Sweden": "SE", "Norway": "NO",
  "Finland": "FI", "Belgium": "BE", "Israel": "IL", "Jordan": "JO",
  "Maldives": "MV", "Sri Lanka": "LK", "Philippines": "PH", "Malaysia": "MY",
  "Cambodia": "KH", "Taiwan": "TW", "Hong Kong": "HK", "Iceland": "IS",
  "French Polynesia": "PF", "Ecuador": "EC", "Colombia": "CO", "Kenya": "KE",
  "Tanzania": "TZ", "Seychelles": "SC", "Zimbabwe": "ZW", "Bolivia": "BO",
};

function getCountryCode(country: string): string | null {
  return countryToCode[country] || null;
}

// In-memory cache for popular destinations (1 hour TTL)
let cachedPopular: { data: unknown[]; timestamp: number } | null = null;
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get("limit") || "8"), 20);

    // Check cache first
    if (cachedPopular && Date.now() - cachedPopular.timestamp < CACHE_TTL) {
      return apiSuccess({
        predictions: cachedPopular.data.slice(0, limit),
        source: "local",
        cached: true,
      });
    }

    const supabase = await createClient();

    // Get top-rated destinations
    const { data: destinations, error } = await supabase
      .from("destinations")
      .select("id, name, country, latitude, longitude, rating")
      .not("latitude", "is", null)
      .not("longitude", "is", null)
      .order("rating", { ascending: false })
      .limit(20); // Fetch more for variety, return limit

    if (error) {
      console.error("[Destinations Popular] Failed to fetch popular destinations:", error);
      return errors.internal("Failed to fetch destinations", "Destinations Popular");
    }

    // Transform to PlacePrediction format
    const predictions = (destinations || []).map((dest) => {
      const countryCode = getCountryCode(dest.country);
      return {
        placeId: `popular_${dest.id}`,
        mainText: dest.name,
        secondaryText: dest.country,
        fullText: `${dest.name}, ${dest.country}`,
        countryCode,
        flag: flagEmoji(countryCode),
        types: ["(cities)"],
        coordinates: {
          latitude: dest.latitude,
          longitude: dest.longitude,
        },
        source: "local",
      };
    });

    // Update cache
    cachedPopular = { data: predictions, timestamp: Date.now() };

    return apiSuccess({
      predictions: predictions.slice(0, limit),
      source: "local",
      cached: false,
    });
  } catch (error) {
    console.error("[Destinations Popular] Popular destinations error:", error);
    return errors.internal("Internal server error", "Destinations Popular");
  }
}
