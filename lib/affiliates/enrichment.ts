/**
 * Data Enrichment for Booking Links
 *
 * Provides city IATA codes, region detection, and smart defaults
 * to maximize pre-fill quality for affiliate links.
 */

// ============================================================================
// City IATA Code Mapping
// ============================================================================

/**
 * City IATA codes for major destinations
 * Uses CITY codes (not airport codes) for maximum coverage
 *
 * NYC = All NYC airports (JFK, LGA, EWR)
 * LON = All London airports (LHR, LGW, STN, etc.)
 */
export const CITY_IATA_CODES: Record<string, string> = {
  // Europe - Major Cities
  Rome: "ROM",
  Paris: "PAR",
  London: "LON",
  Barcelona: "BCN",
  Madrid: "MAD",
  Amsterdam: "AMS",
  Berlin: "BER",
  Munich: "MUC",
  Vienna: "VIE",
  Prague: "PRG",
  Lisbon: "LIS",
  Dublin: "DUB",
  Milan: "MIL",
  Venice: "VCE",
  Florence: "FLR",
  Athens: "ATH",
  Brussels: "BRU",
  Zurich: "ZRH",
  Geneva: "GVA",
  Copenhagen: "CPH",
  Stockholm: "STO",
  Oslo: "OSL",
  Helsinki: "HEL",
  Warsaw: "WAW",
  Budapest: "BUD",
  Krakow: "KRK",
  Istanbul: "IST",
  Edinburgh: "EDI",
  Manchester: "MAN",

  // Americas
  "New York": "NYC",
  "Los Angeles": "LAX",
  Miami: "MIA",
  Chicago: "CHI",
  "San Francisco": "SFO",
  "Las Vegas": "LAS",
  Seattle: "SEA",
  Boston: "BOS",
  Washington: "WAS",
  Denver: "DEN",
  Toronto: "YTO",
  Vancouver: "YVR",
  Montreal: "YMQ",
  "Mexico City": "MEX",
  Cancun: "CUN",
  "Sao Paulo": "SAO",
  "Rio de Janeiro": "RIO",
  "Buenos Aires": "BUE",
  Lima: "LIM",
  Bogota: "BOG",

  // Asia
  Tokyo: "TYO",
  Osaka: "OSA",
  Kyoto: "KIX", // Uses Kansai
  Seoul: "SEL",
  Singapore: "SIN",
  Bangkok: "BKK",
  "Hong Kong": "HKG",
  Beijing: "BJS",
  Shanghai: "SHA",
  Taipei: "TPE",
  "Ho Chi Minh City": "SGN",
  Hanoi: "HAN",
  Manila: "MNL",
  "Kuala Lumpur": "KUL",
  Jakarta: "JKT",
  Bali: "DPS",
  Mumbai: "BOM",
  Delhi: "DEL",
  Dubai: "DXB",
  "Abu Dhabi": "AUH",
  Doha: "DOH",
  "Tel Aviv": "TLV",

  // Oceania
  Sydney: "SYD",
  Melbourne: "MEL",
  Brisbane: "BNE",
  Auckland: "AKL",
  Queenstown: "ZQN",

  // Africa
  Cairo: "CAI",
  Marrakech: "RAK",
  "Cape Town": "CPT",
  Johannesburg: "JNB",
  Nairobi: "NBO",
};

// ============================================================================
// Region Detection
// ============================================================================

export type Region = "europe" | "asia" | "americas" | "oceania" | "africa" | "middle_east";

const REGION_MAP: Record<string, Region> = {
  // Europe
  Rome: "europe",
  Paris: "europe",
  London: "europe",
  Barcelona: "europe",
  Madrid: "europe",
  Amsterdam: "europe",
  Berlin: "europe",
  Munich: "europe",
  Vienna: "europe",
  Prague: "europe",
  Lisbon: "europe",
  Dublin: "europe",
  Milan: "europe",
  Venice: "europe",
  Florence: "europe",
  Athens: "europe",
  Brussels: "europe",
  Zurich: "europe",
  Geneva: "europe",
  Copenhagen: "europe",
  Stockholm: "europe",
  Oslo: "europe",
  Helsinki: "europe",
  Warsaw: "europe",
  Budapest: "europe",
  Krakow: "europe",
  Istanbul: "europe",
  Edinburgh: "europe",
  Manchester: "europe",

  // Americas
  "New York": "americas",
  "Los Angeles": "americas",
  Miami: "americas",
  Chicago: "americas",
  "San Francisco": "americas",
  "Las Vegas": "americas",
  Seattle: "americas",
  Boston: "americas",
  Washington: "americas",
  Denver: "americas",
  Toronto: "americas",
  Vancouver: "americas",
  Montreal: "americas",
  "Mexico City": "americas",
  Cancun: "americas",
  "Sao Paulo": "americas",
  "Rio de Janeiro": "americas",
  "Buenos Aires": "americas",
  Lima: "americas",
  Bogota: "americas",

  // Asia
  Tokyo: "asia",
  Osaka: "asia",
  Kyoto: "asia",
  Seoul: "asia",
  Singapore: "asia",
  Bangkok: "asia",
  "Hong Kong": "asia",
  Beijing: "asia",
  Shanghai: "asia",
  Taipei: "asia",
  "Ho Chi Minh City": "asia",
  Hanoi: "asia",
  Manila: "asia",
  "Kuala Lumpur": "asia",
  Jakarta: "asia",
  Bali: "asia",
  Mumbai: "asia",
  Delhi: "asia",

  // Middle East
  Dubai: "middle_east",
  "Abu Dhabi": "middle_east",
  Doha: "middle_east",
  "Tel Aviv": "middle_east",

  // Oceania
  Sydney: "oceania",
  Melbourne: "oceania",
  Brisbane: "oceania",
  Auckland: "oceania",
  Queenstown: "oceania",

  // Africa
  Cairo: "africa",
  Marrakech: "africa",
  "Cape Town": "africa",
  Johannesburg: "africa",
  Nairobi: "africa",
};

// ============================================================================
// Functions
// ============================================================================

/**
 * Get IATA code for a city
 *
 * @param cityName - City name (e.g., "Paris", "Paris, France")
 * @returns IATA code or null if not found
 */
export function getCityIATA(cityName: string): string | null {
  // Direct lookup
  if (CITY_IATA_CODES[cityName]) {
    return CITY_IATA_CODES[cityName];
  }

  // Try without country suffix (e.g., "Paris, France" → "Paris")
  const baseCity = cityName.split(",")[0].trim();
  if (CITY_IATA_CODES[baseCity]) {
    return CITY_IATA_CODES[baseCity];
  }

  // Fuzzy match: case-insensitive
  const normalized = baseCity.toLowerCase();
  for (const [city, code] of Object.entries(CITY_IATA_CODES)) {
    if (city.toLowerCase() === normalized) {
      return code;
    }
  }

  return null;
}

/**
 * Get region for a city
 */
export function getCityRegion(cityName: string): Region | null {
  const baseCity = cityName.split(",")[0].trim();

  if (REGION_MAP[baseCity]) {
    return REGION_MAP[baseCity];
  }

  // Fuzzy match
  const normalized = baseCity.toLowerCase();
  for (const [city, region] of Object.entries(REGION_MAP)) {
    if (city.toLowerCase() === normalized) {
      return region;
    }
  }

  return null;
}

/**
 * Get traveler count from trip data
 *
 * @param collaboratorCount - Number of collaborators on the trip
 * @returns Total travelers (collaborators + owner)
 */
export function getTravelerCount(collaboratorCount: number | undefined): number {
  // If we have collaborator count, add 1 for the owner
  // Otherwise default to 2 (reasonable assumption)
  return collaboratorCount !== undefined ? collaboratorCount + 1 : 2;
}

/**
 * Determine best activity partner for a destination
 *
 * @param destination - City name
 * @returns "klook" for Asia, "tiqets" for Europe, "klook" for others
 */
export function getBestActivityPartner(
  destination: string
): "klook" | "tiqets" {
  const region = getCityRegion(destination);

  switch (region) {
    case "asia":
      return "klook"; // Klook has best Asian coverage
    case "europe":
      return "tiqets"; // Tiqets excels at European museums/attractions
    default:
      return "klook"; // Klook has broader global coverage
  }
}

/**
 * Determine best flight partner for origin/destination
 *
 * @param origin - Origin city
 * @param destination - Destination city
 * @returns Best flight partner based on route
 */
export function getBestFlightPartner(
  origin: string,
  destination: string
): "tripcom" | "cheapoair" | "expedia" {
  const originRegion = getCityRegion(origin);
  const destRegion = getCityRegion(destination);

  // US origin → CheapOair (best for US market)
  if (originRegion === "americas") {
    return "cheapoair";
  }

  // Asia origin/dest → Trip.com (best for Asian routes)
  if (originRegion === "asia" || destRegion === "asia") {
    return "tripcom";
  }

  // Default to Expedia (good global coverage)
  return "expedia";
}

/**
 * Determine best hotel partner for a destination
 *
 * @param destination - City name
 * @returns Best hotel partner
 */
export function getBestHotelPartner(
  destination: string
): "booking" | "agoda" | "vrbo" {
  const region = getCityRegion(destination);

  switch (region) {
    case "asia":
      return "agoda"; // Agoda has best Asian hotel coverage
    default:
      return "booking"; // Booking.com is globally strong
  }
}

/**
 * Check if Omio is relevant for a route (Europe only)
 */
export function isOmioRelevant(
  origin: string,
  destination: string
): boolean {
  const originRegion = getCityRegion(origin);
  const destRegion = getCityRegion(destination);

  return originRegion === "europe" && destRegion === "europe";
}

/**
 * Format date for different partner APIs
 */
export function formatDate(
  dateStr: string,
  format: "iso" | "ddmm" | "dot"
): string {
  const date = new Date(dateStr);
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();

  switch (format) {
    case "iso":
      return `${year}-${month}-${day}`;
    case "ddmm":
      return `${day}${month}`;
    case "dot":
      return `${day}.${month}.${year}`;
    default:
      return dateStr;
  }
}
