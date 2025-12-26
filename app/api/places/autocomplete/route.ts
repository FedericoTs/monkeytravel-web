/**
 * Places Autocomplete API Route
 *
 * POST /api/places/autocomplete
 *
 * Uses Google Places Autocomplete (New) API to provide destination suggestions.
 * Filters to cities for travel destination selection.
 * Includes in-memory caching to reduce API costs.
 *
 * @see https://developers.google.com/maps/documentation/places/web-service/place-autocomplete
 */

import { NextRequest } from "next/server";
import crypto from "crypto";
import { createClient } from "@/lib/supabase/server";
import { checkApiAccess, logApiCall } from "@/lib/api-gateway";
import { checkUsageLimit, incrementUsage } from "@/lib/usage-limits";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import type { PlacePrediction } from "@/types";

const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY || "";

// In-memory cache for autocomplete (per instance)
// City name suggestions are very stable - cache longer to reduce API costs
const autocompleteCache = new Map<string, { data: unknown; timestamp: number }>();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes (increased from 5 - cities don't change)

/**
 * Generate cache key for autocomplete input
 */
function getCacheKey(input: string): string {
  const normalized = input.toLowerCase().trim();
  return crypto.createHash("md5").update(`autocomplete:${normalized}`).digest("hex");
}

/**
 * Get from in-memory cache
 */
function getFromCache(key: string): unknown | null {
  const cached = autocompleteCache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }
  if (cached) {
    autocompleteCache.delete(key); // Cleanup expired
  }
  return null;
}

/**
 * Save to in-memory cache
 */
function saveToCache(key: string, data: unknown): void {
  // Limit cache size to prevent memory issues
  if (autocompleteCache.size > 500) {
    // Remove oldest entries
    const entries = Array.from(autocompleteCache.entries());
    entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
    for (let i = 0; i < 100; i++) {
      autocompleteCache.delete(entries[i][0]);
    }
  }
  autocompleteCache.set(key, { data, timestamp: Date.now() });
}

/**
 * Log API request for cost tracking using centralized gateway
 */
async function logAutocompleteApiRequest(options: {
  cacheHit?: boolean;
  status?: number;
  error?: string;
  responseTimeMs?: number;
}): Promise<void> {
  const { cacheHit = false, status = 200, error, responseTimeMs = 0 } = options;

  await logApiCall({
    apiName: "google_places_autocomplete",
    endpoint: "/places:autocomplete",
    status,
    responseTimeMs,
    cacheHit,
    costUsd: cacheHit || status >= 400 ? 0 : 0.00283, // Autocomplete costs ~$2.83 per 1000
    error,
  });
}

// Country code to flag emoji mapping
const countryFlags: Record<string, string> = {
  AF: "🇦🇫", AL: "🇦🇱", DZ: "🇩🇿", AD: "🇦🇩", AO: "🇦🇴", AG: "🇦🇬", AR: "🇦🇷", AM: "🇦🇲",
  AU: "🇦🇺", AT: "🇦🇹", AZ: "🇦🇿", BS: "🇧🇸", BH: "🇧🇭", BD: "🇧🇩", BB: "🇧🇧", BY: "🇧🇾",
  BE: "🇧🇪", BZ: "🇧🇿", BJ: "🇧🇯", BT: "🇧🇹", BO: "🇧🇴", BA: "🇧🇦", BW: "🇧🇼", BR: "🇧🇷",
  BN: "🇧🇳", BG: "🇧🇬", BF: "🇧🇫", BI: "🇧🇮", KH: "🇰🇭", CM: "🇨🇲", CA: "🇨🇦", CV: "🇨🇻",
  CF: "🇨🇫", TD: "🇹🇩", CL: "🇨🇱", CN: "🇨🇳", CO: "🇨🇴", KM: "🇰🇲", CG: "🇨🇬", CR: "🇨🇷",
  HR: "🇭🇷", CU: "🇨🇺", CY: "🇨🇾", CZ: "🇨🇿", DK: "🇩🇰", DJ: "🇩🇯", DM: "🇩🇲", DO: "🇩🇴",
  EC: "🇪🇨", EG: "🇪🇬", SV: "🇸🇻", GQ: "🇬🇶", ER: "🇪🇷", EE: "🇪🇪", ET: "🇪🇹", FJ: "🇫🇯",
  FI: "🇫🇮", FR: "🇫🇷", GA: "🇬🇦", GM: "🇬🇲", GE: "🇬🇪", DE: "🇩🇪", GH: "🇬🇭", GR: "🇬🇷",
  GD: "🇬🇩", GT: "🇬🇹", GN: "🇬🇳", GW: "🇬🇼", GY: "🇬🇾", HT: "🇭🇹", HN: "🇭🇳", HU: "🇭🇺",
  IS: "🇮🇸", IN: "🇮🇳", ID: "🇮🇩", IR: "🇮🇷", IQ: "🇮🇶", IE: "🇮🇪", IL: "🇮🇱", IT: "🇮🇹",
  JM: "🇯🇲", JP: "🇯🇵", JO: "🇯🇴", KZ: "🇰🇿", KE: "🇰🇪", KI: "🇰🇮", KP: "🇰🇵", KR: "🇰🇷",
  KW: "🇰🇼", KG: "🇰🇬", LA: "🇱🇦", LV: "🇱🇻", LB: "🇱🇧", LS: "🇱🇸", LR: "🇱🇷", LY: "🇱🇾",
  LI: "🇱🇮", LT: "🇱🇹", LU: "🇱🇺", MK: "🇲🇰", MG: "🇲🇬", MW: "🇲🇼", MY: "🇲🇾", MV: "🇲🇻",
  ML: "🇲🇱", MT: "🇲🇹", MH: "🇲🇭", MR: "🇲🇷", MU: "🇲🇺", MX: "🇲🇽", FM: "🇫🇲", MD: "🇲🇩",
  MC: "🇲🇨", MN: "🇲🇳", ME: "🇲🇪", MA: "🇲🇦", MZ: "🇲🇿", MM: "🇲🇲", NA: "🇳🇦", NR: "🇳🇷",
  NP: "🇳🇵", NL: "🇳🇱", NZ: "🇳🇿", NI: "🇳🇮", NE: "🇳🇪", NG: "🇳🇬", NO: "🇳🇴", OM: "🇴🇲",
  PK: "🇵🇰", PW: "🇵🇼", PA: "🇵🇦", PG: "🇵🇬", PY: "🇵🇾", PE: "🇵🇪", PH: "🇵🇭", PL: "🇵🇱",
  PT: "🇵🇹", QA: "🇶🇦", RO: "🇷🇴", RU: "🇷🇺", RW: "🇷🇼", KN: "🇰🇳", LC: "🇱🇨", VC: "🇻🇨",
  WS: "🇼🇸", SM: "🇸🇲", ST: "🇸🇹", SA: "🇸🇦", SN: "🇸🇳", RS: "🇷🇸", SC: "🇸🇨", SL: "🇸🇱",
  SG: "🇸🇬", SK: "🇸🇰", SI: "🇸🇮", SB: "🇸🇧", SO: "🇸🇴", ZA: "🇿🇦", ES: "🇪🇸", LK: "🇱🇰",
  SD: "🇸🇩", SR: "🇸🇷", SZ: "🇸🇿", SE: "🇸🇪", CH: "🇨🇭", SY: "🇸🇾", TW: "🇹🇼", TJ: "🇹🇯",
  TZ: "🇹🇿", TH: "🇹🇭", TL: "🇹🇱", TG: "🇹🇬", TO: "🇹🇴", TT: "🇹🇹", TN: "🇹🇳", TR: "🇹🇷",
  TM: "🇹🇲", TV: "🇹🇻", UG: "🇺🇬", UA: "🇺🇦", AE: "🇦🇪", GB: "🇬🇧", US: "🇺🇸", UY: "🇺🇾",
  UZ: "🇺🇿", VU: "🇻🇺", VA: "🇻🇦", VE: "🇻🇪", VN: "🇻🇳", YE: "🇾🇪", ZM: "🇿🇲", ZW: "🇿🇼",
  HK: "🇭🇰", MO: "🇲🇴", PR: "🇵🇷", VI: "🇻🇮", GU: "🇬🇺",
};

function getCountryFlag(countryCode: string): string {
  return countryFlags[countryCode.toUpperCase()] || "🌍";
}

// Extract country code from address components in structured format
function extractCountryCode(structuredFormat: {
  mainText?: { text: string };
  secondaryText?: { text: string };
}): string | null {
  // Common country name to code mapping for fallback
  const countryNameToCode: Record<string, string> = {
    "France": "FR", "Italy": "IT", "Spain": "ES", "Germany": "DE", "United Kingdom": "GB",
    "UK": "GB", "United States": "US", "USA": "US", "Japan": "JP", "China": "CN",
    "Australia": "AU", "Canada": "CA", "Brazil": "BR", "Mexico": "MX", "India": "IN",
    "Indonesia": "ID", "Thailand": "TH", "Vietnam": "VN", "South Korea": "KR", "Portugal": "PT",
    "Netherlands": "NL", "Belgium": "BE", "Switzerland": "CH", "Austria": "AT", "Greece": "GR",
    "Turkey": "TR", "Egypt": "EG", "Morocco": "MA", "South Africa": "ZA", "Argentina": "AR",
    "Colombia": "CO", "Peru": "PE", "Chile": "CL", "New Zealand": "NZ", "Singapore": "SG",
    "Malaysia": "MY", "Philippines": "PH", "Taiwan": "TW", "Hong Kong": "HK", "Ireland": "IE",
    "Poland": "PL", "Czech Republic": "CZ", "Czechia": "CZ", "Hungary": "HU", "Croatia": "HR",
    "Norway": "NO", "Sweden": "SE", "Denmark": "DK", "Finland": "FI", "Iceland": "IS",
    "Russia": "RU", "Ukraine": "UA", "Romania": "RO", "Bulgaria": "BG", "Serbia": "RS",
    "Slovenia": "SI", "Slovakia": "SK", "Estonia": "EE", "Latvia": "LV", "Lithuania": "LT",
    "Israel": "IL", "United Arab Emirates": "AE", "UAE": "AE", "Saudi Arabia": "SA", "Qatar": "QA",
    "Kenya": "KE", "Nigeria": "NG", "Ghana": "GH", "Tanzania": "TZ", "Cuba": "CU",
    "Jamaica": "JM", "Puerto Rico": "PR", "Dominican Republic": "DO", "Costa Rica": "CR", "Panama": "PA",
  };

  const secondaryText = structuredFormat.secondaryText?.text || "";

  // Try to find country in the secondary text (usually last part)
  const parts = secondaryText.split(", ");
  const lastPart = parts[parts.length - 1]?.trim();

  if (lastPart && countryNameToCode[lastPart]) {
    return countryNameToCode[lastPart];
  }

  // Check all parts
  for (const part of parts) {
    const trimmed = part.trim();
    if (countryNameToCode[trimmed]) {
      return countryNameToCode[trimmed];
    }
  }

  return null;
}

// Re-export PlacePrediction for API consumers
export type { PlacePrediction } from "@/types";

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    // Check authentication (optional - for usage tracking)
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    // Check API access control first
    const access = await checkApiAccess("google_places_autocomplete");
    if (!access.allowed) {
      await logAutocompleteApiRequest({
        status: 503,
        error: `BLOCKED: ${access.message}`,
      });
      return errors.serviceUnavailable(access.message || "Places Autocomplete API is currently disabled");
    }

    // Check usage limits for authenticated users
    let usageCheck = null;
    if (user) {
      usageCheck = await checkUsageLimit(user.id, "placesAutocomplete", user.email);
      if (!usageCheck.allowed) {
        return errors.rateLimit(usageCheck.message || "Daily autocomplete limit reached.", {
          usage: usageCheck,
          upgradeUrl: "/pricing",
        });
      }
    }

    const { input, sessionToken } = await request.json();

    if (!input || input.length < 2) {
      return apiSuccess({ predictions: [] });
    }

    if (!GOOGLE_PLACES_API_KEY || !access.shouldPassKey) {
      await logAutocompleteApiRequest({
        status: 500,
        error: "API key not configured or blocked",
      });
      return errors.internal("Google Places API key not configured", "Places Autocomplete");
    }

    // Check cache first (for inputs >= 3 chars to allow common prefixes to cache)
    const cacheKey = getCacheKey(input);
    if (input.length >= 3) {
      const cached = getFromCache(cacheKey);
      if (cached) {
        console.log("[Places Autocomplete] Cache HIT for:", input);
        logAutocompleteApiRequest({ cacheHit: true });
        return apiSuccess(cached);
      }
    }

    console.log("[Places Autocomplete] Cache MISS for:", input);

    // Call Google Places Autocomplete (New) API with field masking
    // Field mask reduces response size by ~20%, saving $0.57/1000 calls
    const response = await fetch(
      "https://places.googleapis.com/v1/places:autocomplete",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
          // Only request fields we actually use - reduces payload size
          "X-Goog-FieldMask": "suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat,suggestions.placePrediction.types",
        },
        body: JSON.stringify({
          input,
          includedPrimaryTypes: ["(cities)"], // Filter to cities only
          languageCode: "en",
          ...(sessionToken && { sessionToken }),
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[Places Autocomplete] API error:", errorText);
      return errors.internal("Failed to fetch suggestions", "Places Autocomplete");
    }

    const data = await response.json();

    // Transform predictions to our format
    const predictions: PlacePrediction[] = (data.suggestions || [])
      .filter((suggestion: { placePrediction?: unknown }) => suggestion.placePrediction)
      .map((suggestion: {
        placePrediction: {
          placeId: string;
          text: { text: string };
          structuredFormat: {
            mainText: { text: string };
            secondaryText?: { text: string };
          };
          types?: string[];
        };
      }) => {
        const pred = suggestion.placePrediction;
        const structuredFormat = pred.structuredFormat;
        const countryCode = extractCountryCode(structuredFormat);

        return {
          placeId: pred.placeId,
          mainText: structuredFormat.mainText?.text || "",
          secondaryText: structuredFormat.secondaryText?.text || "",
          fullText: pred.text?.text || "",
          countryCode,
          flag: countryCode ? getCountryFlag(countryCode) : "🌍",
          types: pred.types || [],
        };
      });

    const result = { predictions };

    // Save to cache (only for inputs >= 3 chars)
    if (input.length >= 3) {
      saveToCache(cacheKey, result);
    }

    // Log API usage
    logAutocompleteApiRequest({ responseTimeMs: Date.now() - startTime });

    // Increment usage counter for authenticated users (only on API calls, not cache hits)
    if (user) {
      await incrementUsage(user.id, "placesAutocomplete", 1);
    }

    return apiSuccess(result);
  } catch (error) {
    console.error("[Places Autocomplete] Error:", error);
    return errors.internal("Internal server error", "Places Autocomplete");
  }
}
