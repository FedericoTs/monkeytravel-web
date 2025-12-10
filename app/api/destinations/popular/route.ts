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

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

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

// Country code to flag emoji
const countryFlags: Record<string, string> = {
  FR: "🇫🇷", JP: "🇯🇵", US: "🇺🇸", GB: "🇬🇧", IT: "🇮🇹", ES: "🇪🇸",
  ID: "🇮🇩", AE: "🇦🇪", TH: "🇹🇭", AU: "🇦🇺", GR: "🇬🇷", PT: "🇵🇹",
  DE: "🇩🇪", NL: "🇳🇱", MX: "🇲🇽", BR: "🇧🇷", KR: "🇰🇷", CN: "🇨🇳",
  IN: "🇮🇳", SG: "🇸🇬", VN: "🇻🇳", TR: "🇹🇷", EG: "🇪🇬", MA: "🇲🇦",
  ZA: "🇿🇦", PE: "🇵🇪", AR: "🇦🇷", CL: "🇨🇱", NZ: "🇳🇿", CA: "🇨🇦",
  CH: "🇨🇭", AT: "🇦🇹", CZ: "🇨🇿", HU: "🇭🇺", PL: "🇵🇱", IE: "🇮🇪",
  HR: "🇭🇷", DK: "🇩🇰", SE: "🇸🇪", NO: "🇳🇴", FI: "🇫🇮", BE: "🇧🇪",
  IL: "🇮🇱", JO: "🇯🇴", MV: "🇲🇻", LK: "🇱🇰", PH: "🇵🇭", MY: "🇲🇾",
  KH: "🇰🇭", TW: "🇹🇼", HK: "🇭🇰", IS: "🇮🇸", PF: "🇵🇫", EC: "🇪🇨",
  CO: "🇨🇴", KE: "🇰🇪", TZ: "🇹🇿", SC: "🇸🇨", ZW: "🇿🇼", BO: "🇧🇴",
};

function getCountryCode(country: string): string | null {
  return countryToCode[country] || null;
}

function getCountryFlag(countryCode: string | null): string {
  if (!countryCode) return "🌍";
  return countryFlags[countryCode.toUpperCase()] || "🌍";
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
      return NextResponse.json({
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
      console.error("Failed to fetch popular destinations:", error);
      return NextResponse.json(
        { error: "Failed to fetch destinations" },
        { status: 500 }
      );
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
        flag: getCountryFlag(countryCode),
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

    return NextResponse.json({
      predictions: predictions.slice(0, limit),
      source: "local",
      cached: false,
    });
  } catch (error) {
    console.error("Popular destinations error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
