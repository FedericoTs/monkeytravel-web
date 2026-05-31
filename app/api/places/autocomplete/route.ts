/**
 * Places Autocomplete API Route
 *
 * POST /api/places/autocomplete
 *
 * Uses Google Places Autocomplete (New) API to provide destination suggestions.
 * Filters to cities for travel destination selection.
 * Uses the unified lib/cache.withMemory layer (type: "autocomplete", 30-day TTL)
 * with prefix-collapsed normalized keys so a typing stream shares one upstream
 * fetch and hit-rate surfaces in /admin metrics.
 *
 * @see https://developers.google.com/maps/documentation/places/web-service/place-autocomplete
 */

import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkApiAccess, logApiCall } from "@/lib/api-gateway";
import { checkUsageLimit, incrementUsage } from "@/lib/usage-limits";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { createRateLimiter } from "@/lib/api/rate-limit";
import { cache } from "@/lib/cache";
import type { PlacePrediction } from "@/types";

const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY || "";

// Per-IP rate limit for ANONYMOUS callers. Authed users are already bounded
// by checkUsageLimit("placesAutocomplete") — this is the floor that keeps an
// unauth'd visitor from running $0.00283/keystroke spend on our card. 60/min
// is generous for human typing (debounce is 300ms client-side) while still
// stopping a credit-card-DoS script cold. Task #200.
const anonLimiter = createRateLimiter("places-autocomplete", 60, 60_000);

/**
 * Normalize autocomplete input for cache key generation.
 *
 * - lowercase
 * - trim leading/trailing whitespace
 * - collapse internal whitespace runs to a single space
 * - strip trailing punctuation (.,;:!?…)
 *
 * Returns the normalized string; callers derive a prefix key from it so
 * "par", "pari", "paris" all hit the same upstream "par" response (Google's
 * autocomplete result for the 3-char prefix is a superset; the client-side
 * filter narrows from there).
 */
function normalizeInput(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.,;:!?…]+$/g, "");
}

/**
 * Build the prefix-collapsed cache key. We key on the first 3 normalized
 * characters so a typing stream (p → pa → par → pari → paris) shares one
 * upstream Google fetch instead of 5. For inputs shorter than 3 chars we
 * fall back to the full normalized string (callers gate this path on
 * input.length >= 2 already).
 */
function getPrefixCacheKey(normalized: string): string {
  return normalized.length >= 3 ? normalized.slice(0, 3) : normalized;
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

    // Per-IP anon rate limit. Skip for authed users — they're already bounded
    // by checkUsageLimit() below, which gives them per-day quotas tied to
    // their tier instead of a coarse per-minute IP cap. This guards the
    // open-door case: an anonymous visitor (or bot) hammering keystrokes
    // straight into Google Places' $0.00283/req endpoint.
    if (!user) {
      const { allowed } = await anonLimiter.check(request);
      if (!allowed) {
        await logAutocompleteApiRequest({
          status: 429,
          error: "ANON_RATE_LIMIT",
        });
        return errors.rateLimit("Too many searches. Please slow down.");
      }
    }

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

    // Normalize input + derive prefix cache key. We migrated off a per-instance
    // Map (which Vercel cold containers couldn't share) to lib/cache.withMemory
    // so hit-rate shows up in admin metrics and the limiter/LRU is unified.
    // Prefix-keying means "par"/"pari"/"paris" all hit the same upstream fetch
    // — Google's autocomplete for "par" is a superset and the client already
    // narrows letter-by-letter via debounce.
    const normalizedInput = normalizeInput(input);
    const prefixKey = getPrefixCacheKey(normalizedInput);

    // Use the prefix-normalized input as the upstream query so cache entries
    // are reusable across keystrokes within the same prefix bucket.
    const upstreamInput = normalizedInput.length >= 3 ? prefixKey : normalizedInput;

    // cache.withMemory handles hit/miss + in-flight dedup. We only cache for
    // inputs >= 3 chars (single/double-letter prefixes are too noisy and
    // would balloon the working set).
    let cacheHit = false;
    let result: { predictions: PlacePrediction[] };

    const fetcher = async (): Promise<{ predictions: PlacePrediction[] }> => {
      // Call Google Places Autocomplete (New) API with field masking.
      // Field mask reduces response size by ~20%, saving $0.57/1000 calls.
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
            input: upstreamInput,
            includedPrimaryTypes: ["(cities)"], // Filter to cities only
            languageCode: "en",
            ...(sessionToken && { sessionToken }),
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error("[Places Autocomplete] API error:", errorText);
        throw new Error("UPSTREAM_FETCH_FAILED");
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

      return { predictions };
    };

    if (normalizedInput.length >= 3) {
      try {
        const cached = await cache.withMemory<{ predictions: PlacePrediction[] }>(
          "autocomplete",
          prefixKey,
          fetcher
        );
        result = cached.data;
        cacheHit = cached.cached;
        console.log(
          `[Places Autocomplete] Cache ${cacheHit ? "HIT" : cached.deduped ? "DEDUPED" : "MISS"} for prefix:`,
          prefixKey
        );
      } catch (err) {
        if (err instanceof Error && err.message === "UPSTREAM_FETCH_FAILED") {
          return errors.internal("Failed to fetch suggestions", "Places Autocomplete");
        }
        throw err;
      }
    } else {
      // Skip cache for <3-char prefixes; just call the fetcher directly.
      try {
        result = await fetcher();
      } catch (err) {
        if (err instanceof Error && err.message === "UPSTREAM_FETCH_FAILED") {
          return errors.internal("Failed to fetch suggestions", "Places Autocomplete");
        }
        throw err;
      }
    }

    // Log API usage with accurate cache-hit attribution (no cost on cache hit).
    logAutocompleteApiRequest({
      cacheHit,
      responseTimeMs: Date.now() - startTime,
    });

    // Increment usage counter for authenticated users (only on real API calls).
    if (user && !cacheHit) {
      await incrementUsage(user.id, "placesAutocomplete", 1);
    }

    return apiSuccess(result);
  } catch (error) {
    console.error("[Places Autocomplete] Error:", error);
    return errors.internal("Internal server error", "Places Autocomplete");
  }
}
