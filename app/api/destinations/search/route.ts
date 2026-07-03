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

// Inverse of countryToCode: ISO-2 code -> English country name. Used to render
// the secondaryText for geo_cities rows (which store only the country code).
const codeToCountryName: Record<string, string> = Object.fromEntries(
  Object.entries(countryToCode).map(([name, code]) => [code, name])
);

// Lower-case the query and strip LIKE wildcards (so user input can't inject
// `%`/`_` into the RPC's LIKE pattern). Accent-stripping is done SERVER-SIDE in
// search_geo_cities via unaccent(normalize(q, NFC)) — deliberately NOT here:
// the client-side `.normalize("NFD")` + `\p{Diacritic}` strip silently misbehaved
// in the Turbopack/Vercel runtime (accented queries like "Málaga" returned 0),
// so the robust path is to send the raw lower-cased string and let Postgres
// handle diacritics.
function normalizeForGeo(input: string): string {
  return input
    .toLowerCase()
    .replace(/[%_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
    // Return ONLY the resolved city names — NOT the raw alias term.
    // Keeping the raw term caused false country matches: "roma" (→ Rome)
    // also matched country.ilike.%roma% → "Romania", so Bucharest surfaced
    // as a suggestion for Italian users typing their own capital. The curated
    // alias IS the intent, so search the mapped cities alone. Completes the
    // partial fix from task #360 (live-caught on a 2026-07-02 re-probe).
    return aliases.map(a => a.toLowerCase());
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
    const { input, limit = 8, locale } = await request.json();

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

    // GEO_CITIES LAYER — broaden with the population-ranked GeoNames table
    // (~69k cities, task #372). This supersedes Photon as the primary long-tail
    // + native-name + accented-name source: deterministic, population-ranked
    // (Málaga ES 592k outranks Málaga CO), sub-10ms, no third-party dependency.
    // Additive + deduped against the curated `destinations` hits above, so if it
    // returns nothing the flow still falls through to Photon — zero regression.
    if (predictions.length < limit) {
      const nq = normalizeForGeo(searchTerm);
      if (nq.length >= 2) {
        try {
          const { data: geo, error: geoErr } = await supabase.rpc(
            "search_geo_cities",
            { q: nq, lim: limit }
          );
          if (geoErr) {
            console.warn("[Destinations Search] geo_cities RPC error:", geoErr.message);
          } else if (Array.isArray(geo)) {
            const seen = new Set(
              predictions.map(
                (p) =>
                  `${p.mainText.toLowerCase()}|${(p.secondaryText || "").toLowerCase()}`
              )
            );
            for (const g of geo as Array<{
              id: number;
              name: string;
              country_code: string;
              latitude: number | null;
              longitude: number | null;
            }>) {
              if (predictions.length >= limit) break;
              const countryName = codeToCountryName[g.country_code] || g.country_code;
              const key = `${g.name.toLowerCase()}|${countryName.toLowerCase()}`;
              if (seen.has(key)) continue;
              seen.add(key);
              predictions.push({
                placeId: `geo_${g.id}`,
                mainText: g.name,
                secondaryText: countryName,
                fullText: `${g.name}, ${countryName}`,
                countryCode: g.country_code,
                flag: getCountryFlag(g.country_code),
                types: ["(cities)"],
                coordinates:
                  g.latitude != null && g.longitude != null
                    ? { latitude: g.latitude, longitude: g.longitude }
                    : undefined,
                source: "local" as const,
              });
            }
          }
        } catch (e) {
          console.warn(
            "[Destinations Search] geo_cities query failed:",
            e instanceof Error ? e.message : e
          );
        }
      }
    }

    // FALLBACK PATH — when both the curated DB and geo_cities have nothing,
    // hit Photon (OSM-backed, free, no-auth, fast) so users typing
    // less popular cities, towns, or villages still get real
    // suggestions instead of the "no results" panel. Without this,
    // the 190-city local table caps autocomplete coverage and the
    // wizard's #1 input feels broken for anything off the beaten
    // path. Photon is Komoot's public geocoder; we limit ourselves to
    // city/town/village/island place-types and an 800ms hard timeout
    // so a slow upstream never blocks the autocomplete render.
    if (predictions.length === 0 && searchTerm.length >= 3) {
      try {
        const photonLang = resolvePhotonLang(
          locale,
          request.headers.get("accept-language")
        );
        const photon = await fetchPhotonSuggestions(searchTerm, limit, photonLang);
        if (photon.length > 0) {
          return apiSuccess({
            predictions: photon,
            source: "photon",
            hasMore: false,
          });
        }
      } catch (err) {
        // Non-fatal — fall through to empty result + the wizard's
        // "Continue with <typed>" manual-prediction CTA still works.
        console.warn(
          "[Destinations Search] Photon fallback failed:",
          err instanceof Error ? err.message : err
        );
      }
    }

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

// ----- Photon (OSM) fallback ------------------------------------------------
//
// Why Photon and not Google Places Autocomplete:
//   1. Zero cost. Google session-based autocomplete is ~$2.83/1K sessions,
//      and we just spent the night cutting Google Places spend.
//   2. No API key, no per-host rate limit documented. Komoot uses it
//      themselves at scale.
//   3. OSM coverage is excellent for cities/towns; we don't need Google's
//      POI tail because the wizard only takes city-level destinations.
//   4. Sub-300ms response globally from photon.komoot.io.
//
// Plan B (future): seed a server-side cities5000 table from GeoNames CC-BY
// and put it BEFORE this Photon call. Removes the third-party dependency
// and makes the long-tail lookup deterministic + sub-10ms. See task #372.

interface PhotonFeature {
  geometry?: { type?: string; coordinates?: [number, number] };
  properties?: {
    osm_id?: number;
    osm_type?: string;
    osm_key?: string;
    osm_value?: string;
    name?: string;
    country?: string;
    countrycode?: string;
    state?: string;
  };
}
interface PhotonResponse {
  features?: PhotonFeature[];
}

const PHOTON_TIMEOUT_MS = 800;
const PHOTON_PLACE_TYPES = new Set(["city", "town", "village", "island"]);

// Photon ONLY supports these display languages. It hard-400s on anything
// else — and it silently DROPPED "it" support, which meant every Italian
// user (Accept-Language: it-*) got HTTP 400 → empty fallback → "no results"
// on the wizard's #1 input. That killed long-tail/native-name search for the
// worst-converting locale (it: step1→2 25.6% vs en 47.7%). For unsupported
// locales (it/es/pt/…) we use "default", which returns endonyms
// ("Firenze, Italia", "Sevilla, España") that match what native-language
// users actually type. Live-confirmed 2026-07-03: `lang=it` → 400
// {"message":"Language is not supported. Supported are: default, de, en, fr"}.
const PHOTON_SUPPORTED_LANGS = new Set(["de", "en", "fr"]);

function resolvePhotonLang(
  locale?: string,
  acceptLanguage?: string | null
): string {
  // Prefer the explicit app locale (authoritative — the client forwards it)
  // over the browser's Accept-Language, which often disagrees with the site
  // locale (an Italian user browsing /it on an English-configured browser).
  const raw = (locale || acceptLanguage || "").toLowerCase();
  const two = raw.slice(0, 2);
  return PHOTON_SUPPORTED_LANGS.has(two) ? two : "default";
}

async function fetchPhotonSuggestions(
  query: string,
  limit: number,
  lang: string
): Promise<LocalDestinationPrediction[]> {
  // Photon API: https://github.com/komoot/photon
  //   GET /api/?q=<query>&limit=<n>&lang=<default|de|en|fr>
  //
  // We DON'T pre-filter by osm_tag in the request because Photon's
  // tag filter is too restrictive (drops some valid city hits). Filter
  // client-side on the response instead.
  const url = new URL("https://photon.komoot.io/api/");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", String(Math.max(limit, 8)));
  url.searchParams.set("lang", lang);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PHOTON_TIMEOUT_MS);
  let json: PhotonResponse;
  try {
    const res = await fetch(url.toString(), {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return [];
    json = (await res.json()) as PhotonResponse;
  } finally {
    clearTimeout(timer);
  }

  const features = json.features ?? [];
  const predictions: LocalDestinationPrediction[] = [];
  const seen = new Set<string>();

  for (const feat of features) {
    const p = feat.properties ?? {};
    if (!p.name || !p.country) continue;
    // Restrict to settlement-type results. Drops countries, mountains,
    // POIs, and the long tail of non-destination matches.
    if (p.osm_key !== "place" || !p.osm_value || !PHOTON_PLACE_TYPES.has(p.osm_value)) {
      continue;
    }

    // Dedup by (name, country) — Photon can return the same city
    // multiple times (admin region vs. populated place node).
    const dedupKey = `${p.name.toLowerCase()}|${p.country.toLowerCase()}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);

    const cc = (p.countrycode ?? "").toUpperCase() || null;
    const coords = feat.geometry?.coordinates;
    const longitude = Array.isArray(coords) ? coords[0] : undefined;
    const latitude = Array.isArray(coords) ? coords[1] : undefined;

    predictions.push({
      placeId: `photon_${p.osm_type ?? "X"}${p.osm_id ?? Math.random().toString(36).slice(2)}`,
      mainText: p.name,
      secondaryText: p.country,
      fullText: `${p.name}, ${p.country}`,
      countryCode: cc,
      flag: getCountryFlag(cc),
      types: ["(cities)"],
      coordinates:
        typeof latitude === "number" && typeof longitude === "number"
          ? { latitude, longitude }
          : undefined,
      // Keep source: 'local' so the existing client union type doesn't
      // need to grow tonight. The server-side response field below
      // says 'photon' for telemetry / debugging.
      source: "local",
    });

    if (predictions.length >= limit) break;
  }

  return predictions;
}
