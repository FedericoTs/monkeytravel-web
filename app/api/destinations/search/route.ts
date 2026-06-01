/**
 * Local Destinations Search API
 *
 * POST /api/destinations/search
 *
 * Searches the local destinations database for travel destinations.
 * Returns results in the same format as Places Autocomplete for seamless integration.
 * Eliminates Google Places API costs for popular destinations.
 *
 * Cost: $0 (local database query)
 */

import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";

// Country name to ISO code mapping
const countryToCode: Record<string, string> = {
  "Afghanistan": "AF", "Albania": "AL", "Algeria": "DZ", "Andorra": "AD", "Angola": "AO",
  "Argentina": "AR", "Armenia": "AM", "Australia": "AU", "Austria": "AT", "Azerbaijan": "AZ",
  "Bahamas": "BS", "Bahrain": "BH", "Bangladesh": "BD", "Barbados": "BB", "Belarus": "BY",
  "Belgium": "BE", "Belize": "BZ", "Benin": "BJ", "Bhutan": "BT", "Bolivia": "BO",
  "Bosnia and Herzegovina": "BA", "Botswana": "BW", "Brazil": "BR", "Brunei": "BN", "Bulgaria": "BG",
  "Cambodia": "KH", "Cameroon": "CM", "Canada": "CA", "Cape Verde": "CV", "Chile": "CL",
  "China": "CN", "Colombia": "CO", "Costa Rica": "CR", "Croatia": "HR", "Cuba": "CU",
  "Cyprus": "CY", "Czech Republic": "CZ", "Denmark": "DK", "Dominican Republic": "DO",
  "Ecuador": "EC", "Egypt": "EG", "El Salvador": "SV", "Estonia": "EE", "Ethiopia": "ET",
  "Fiji": "FJ", "Finland": "FI", "France": "FR", "French Polynesia": "PF",
  "Georgia": "GE", "Germany": "DE", "Ghana": "GH", "Greece": "GR", "Guatemala": "GT",
  "Haiti": "HT", "Honduras": "HN", "Hong Kong": "HK", "Hungary": "HU",
  "Iceland": "IS", "India": "IN", "Indonesia": "ID", "Iran": "IR", "Iraq": "IQ",
  "Ireland": "IE", "Israel": "IL", "Italy": "IT", "Jamaica": "JM", "Japan": "JP",
  "Jordan": "JO", "Kazakhstan": "KZ", "Kenya": "KE", "Kuwait": "KW", "Kyrgyzstan": "KG",
  "Laos": "LA", "Latvia": "LV", "Lebanon": "LB", "Lithuania": "LT", "Luxembourg": "LU",
  "Malaysia": "MY", "Maldives": "MV", "Malta": "MT", "Mauritius": "MU", "Mexico": "MX",
  "Moldova": "MD", "Monaco": "MC", "Mongolia": "MN", "Montenegro": "ME", "Morocco": "MA",
  "Myanmar": "MM", "Namibia": "NA", "Nepal": "NP", "Netherlands": "NL", "New Zealand": "NZ",
  "Nicaragua": "NI", "Nigeria": "NG", "North Korea": "KP", "Norway": "NO",
  "Oman": "OM", "Pakistan": "PK", "Panama": "PA", "Paraguay": "PY", "Peru": "PE",
  "Philippines": "PH", "Poland": "PL", "Portugal": "PT", "Puerto Rico": "PR", "Qatar": "QA",
  "Romania": "RO", "Russia": "RU", "Rwanda": "RW", "Saudi Arabia": "SA", "Senegal": "SN",
  "Serbia": "RS", "Seychelles": "SC", "Singapore": "SG", "Slovakia": "SK", "Slovenia": "SI",
  "South Africa": "ZA", "South Korea": "KR", "Spain": "ES", "Sri Lanka": "LK", "Sweden": "SE",
  "Switzerland": "CH", "Syria": "SY", "Taiwan": "TW", "Tajikistan": "TJ", "Tanzania": "TZ",
  "Thailand": "TH", "Tunisia": "TN", "Turkey": "TR", "Turkmenistan": "TM", "Uganda": "UG",
  "Ukraine": "UA", "United Arab Emirates": "AE", "United Kingdom": "GB", "United States": "US",
  "Uruguay": "UY", "Uzbekistan": "UZ", "Vatican City": "VA", "Venezuela": "VE", "Vietnam": "VN",
  "Yemen": "YE", "Zambia": "ZM", "Zimbabwe": "ZW",
};

// Country code to flag emoji
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
  HK: "🇭🇰", MO: "🇲🇴", PR: "🇵🇷", VI: "🇻🇮", GU: "🇬🇺", PF: "🇵🇫",
};

function getCountryCode(country: string): string | null {
  return countryToCode[country] || null;
}

function getCountryFlag(countryCode: string | null): string {
  if (!countryCode) return "🌍";
  return countryFlags[countryCode.toUpperCase()] || "🌍";
}

/**
 * Common destination aliases and abbreviations
 * These help users find destinations using common shorthand
 */
const DESTINATION_ALIASES: Record<string, string[]> = {
  // US Cities
  "nyc": ["New York City", "New York"],
  "ny": ["New York City", "New York"],
  "la": ["Los Angeles"],
  "sf": ["San Francisco"],
  "vegas": ["Las Vegas"],
  "lv": ["Las Vegas"],
  "dc": ["Washington"],
  "chi": ["Chicago"],
  "nola": ["New Orleans"],
  "atl": ["Atlanta"],
  "philly": ["Philadelphia"],
  "sd": ["San Diego"],

  // International
  "uk": ["London", "United Kingdom"],
  "uae": ["Dubai", "United Arab Emirates"],
  "hk": ["Hong Kong"],
  "sg": ["Singapore"],
  "bkk": ["Bangkok"],
  "cdmx": ["Mexico City"],
  "bcn": ["Barcelona"],
  "ams": ["Amsterdam"],
  "rio": ["Rio de Janeiro"],
  "ba": ["Buenos Aires"],
  "ist": ["Istanbul"],

  // Country shortcuts
  "usa": ["United States", "New York City", "Los Angeles"],
  "japan": ["Tokyo", "Kyoto", "Osaka"],
  "france": ["Paris", "Nice", "Lyon"],
  "italy": ["Rome", "Florence", "Venice", "Milan"],
  "spain": ["Barcelona", "Madrid", "Seville"],
  "thailand": ["Bangkok", "Phuket", "Chiang Mai"],
  "australia": ["Sydney", "Melbourne", "Brisbane"],
  "mexico": ["Mexico City", "Cancun", "Tulum"],

  // Italian endonyms (cities + countries) — Italian users typing
  // "Roma" expect Rome, not Bucharest (whose country "Romania" matched
  // `%roma%` by accident). Live audit 2026-05-31 caught this on
  // /it/trips/new. Same logic for IT-localized country names.
  "roma": ["Rome"],
  "firenze": ["Florence"],
  "venezia": ["Venice"],
  "milano": ["Milan"],
  "napoli": ["Naples"],
  "torino": ["Turin"],
  "genova": ["Genoa"],
  "palermo": ["Palermo"],
  "bologna": ["Bologna"],
  "verona": ["Verona"],
  "atene": ["Athens"],
  "lisbona": ["Lisbon"],
  "londra": ["London"],
  "parigi": ["Paris"],
  "berlino": ["Berlin"],
  "monaco di baviera": ["Munich"],
  "vienna": ["Vienna"],
  "varsavia": ["Warsaw"],
  "praga": ["Prague"],
  "stoccolma": ["Stockholm"],
  "copenaghen": ["Copenhagen"],
  "mosca": ["Moscow"],
  "san pietroburgo": ["Saint Petersburg"],
  "pechino": ["Beijing"],
  "shangai": ["Shanghai"],
  "il cairo": ["Cairo"],
  "marrakech": ["Marrakech"],
  "città del messico": ["Mexico City"],
  "san paolo": ["Sao Paulo"],

  // Spanish endonyms — same logic for /es users.
  "roma es": ["Rome"], // disambiguate from IT (Spanish also uses "Roma" but maps to Rome too)
  "londres": ["London"],
  "parís": ["Paris"],
  "paris es": ["Paris"],
  "berlín": ["Berlin"],
  "viena": ["Vienna"],
  "praga es": ["Prague"],
  "moscú": ["Moscow"],
  "pekín": ["Beijing"],
  "el cairo": ["Cairo"],
  "ciudad de méxico": ["Mexico City"],
  "san pablo": ["Sao Paulo"],
  "florencia": ["Florence"],
  "venecia": ["Venice"],
  "milán": ["Milan"],
  "nápoles": ["Naples"],
  "turín": ["Turin"],
  "génova": ["Genoa"],
  "atenas": ["Athens"],
  "lisboa": ["Lisbon"],
  "varsovia": ["Warsaw"],
  "estocolmo": ["Stockholm"],
};

/**
 * Expand search term with aliases
 */
function expandSearchWithAliases(input: string): string[] {
  const normalized = input.toLowerCase().trim();
  const aliases = DESTINATION_ALIASES[normalized];

  if (aliases) {
    return [normalized, ...aliases.map(a => a.toLowerCase())];
  }

  return [normalized];
}

/**
 * Escape special characters for PostgREST ilike queries
 * PostgREST uses commas, dots, parentheses as operators
 */
function escapeForPostgrest(input: string): string {
  // Remove or escape characters that break PostgREST queries
  return input
    .replace(/[%_]/g, "\\$&") // Escape SQL wildcards
    .replace(/[,.()\[\]{}]/g, "") // Remove PostgREST operators
    .replace(/'/g, "''"); // Escape single quotes
}

export interface LocalDestinationPrediction {
  placeId: string; // "local_" + destination id
  mainText: string;
  secondaryText: string;
  fullText: string;
  countryCode: string | null;
  flag: string;
  types: string[];
  coordinates?: {
    latitude: number;
    longitude: number;
  };
  source: "local"; // Always "local" for this endpoint
}

export async function POST(request: NextRequest) {
  try {
    const { input, limit = 8 } = await request.json();

    if (!input || input.length < 2) {
      return apiSuccess({ predictions: [], source: "local" });
    }

    const supabase = await createClient();
    const searchTerm = input.toLowerCase().trim();

    // Expand search term with aliases (e.g., "nyc" -> ["nyc", "new york city", "new york"])
    const searchTerms = expandSearchWithAliases(searchTerm);

    // Build OR conditions for all search terms
    const orConditions = searchTerms.map(term => {
      const escapedTerm = escapeForPostgrest(term);
      return `name.ilike.%${escapedTerm}%,country.ilike.%${escapedTerm}%,city.ilike.%${escapedTerm}%`;
    }).join(",");

    // Use trigram similarity for fuzzy matching
    // This query searches name and country with similarity scoring
    const { data: destinations, error } = await supabase
      .from("destinations")
      .select("id, name, country, city, latitude, longitude, tags, rating")
      .or(orConditions)
      .order("rating", { ascending: false })
      .limit(limit);

    if (error) {
      console.error("[Destinations Search] Local destinations search error:", error);
      return errors.internal("Failed to search destinations", "Destinations Search");
    }

    // Transform to PlacePrediction format
    const predictions: LocalDestinationPrediction[] = (destinations || []).map(
      (dest) => {
        const countryCode = getCountryCode(dest.country);
        return {
          placeId: `local_${dest.id}`,
          mainText: dest.name,
          secondaryText: dest.country,
          fullText: `${dest.name}, ${dest.country}`,
          countryCode,
          flag: getCountryFlag(countryCode),
          types: ["(cities)"],
          coordinates:
            dest.latitude && dest.longitude
              ? {
                  latitude: dest.latitude,
                  longitude: dest.longitude,
                }
              : undefined,
          source: "local" as const,
        };
      }
    );

    // Sort by relevance: exact name matches first, then starts-with, then contains
    predictions.sort((a, b) => {
      const aName = a.mainText.toLowerCase();
      const bName = b.mainText.toLowerCase();

      // Exact match
      if (aName === searchTerm && bName !== searchTerm) return -1;
      if (bName === searchTerm && aName !== searchTerm) return 1;

      // Starts with
      const aStarts = aName.startsWith(searchTerm);
      const bStarts = bName.startsWith(searchTerm);
      if (aStarts && !bStarts) return -1;
      if (bStarts && !aStarts) return 1;

      // Country match bonus
      const aCountry = a.secondaryText.toLowerCase();
      const bCountry = b.secondaryText.toLowerCase();
      const aCountryMatch = aCountry.includes(searchTerm);
      const bCountryMatch = bCountry.includes(searchTerm);
      if (aCountryMatch && !bCountryMatch) return 1;
      if (bCountryMatch && !aCountryMatch) return -1;

      return 0;
    });

    return apiSuccess({
      predictions,
      source: "local",
      hasMore: (destinations?.length || 0) >= limit,
    });
  } catch (error) {
    console.error("[Destinations Search] Local destinations search error:", error);
    return errors.internal("Internal server error", "Destinations Search");
  }
}
