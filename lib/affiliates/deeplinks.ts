/**
 * Travelpayouts Deep Link Generator
 *
 * Generates affiliate deep links for all Travelpayouts partners.
 * Uses SIMPLE DIRECT LINK FORMAT with ?marker= parameter.
 *
 * This format works immediately without Travelpayouts dashboard configuration.
 * Partners receive tracking via the marker ID appended to URLs.
 */

import { PARTNERS, MARKER, type PartnerKey } from "./partners";

// ============================================================================
// Hotel Links
// ============================================================================

export interface HotelSearchParams {
  destination: string;
  checkIn: string; // YYYY-MM-DD
  checkOut: string; // YYYY-MM-DD
  guests: number;
  rooms?: number;
}

/**
 * Generate Booking.com hotel search link
 * Uses direct Booking.com URL with aid parameter for tracking
 */
export function generateBookingLink(params: HotelSearchParams): string {
  const { destination, checkIn, checkOut, guests, rooms = 1 } = params;

  const url = new URL("https://www.booking.com/searchresults.html");
  url.searchParams.set("ss", destination);
  url.searchParams.set("checkin", checkIn);
  url.searchParams.set("checkout", checkOut);
  url.searchParams.set("group_adults", String(guests));
  url.searchParams.set("no_rooms", String(rooms));
  url.searchParams.set("aid", MARKER); // Booking.com uses 'aid' parameter

  return url.toString();
}

/**
 * Generate Agoda hotel search link
 */
export function generateAgodaLink(params: HotelSearchParams): string {
  const { destination, checkIn, checkOut, guests, rooms = 1 } = params;

  const url = new URL("https://www.agoda.com/search");
  url.searchParams.set("city", destination);
  url.searchParams.set("checkIn", checkIn);
  url.searchParams.set("los", String(calculateNights(checkIn, checkOut)));
  url.searchParams.set("adults", String(guests));
  url.searchParams.set("rooms", String(rooms));
  url.searchParams.set("cid", MARKER); // Agoda uses 'cid' parameter

  return url.toString();
}

/**
 * Generate VRBO vacation rental search link
 */
export function generateVrboLink(params: HotelSearchParams): string {
  const { destination, checkIn, checkOut, guests } = params;

  const url = new URL("https://www.vrbo.com/search");
  url.searchParams.set("destination", destination);
  url.searchParams.set("startDate", checkIn);
  url.searchParams.set("endDate", checkOut);
  url.searchParams.set("adults", String(guests));
  url.searchParams.set("affcid", MARKER); // VRBO uses 'affcid' parameter

  return url.toString();
}

/**
 * Generate all hotel partner links
 */
export function generateAllHotelLinks(params: HotelSearchParams): {
  booking: string;
  agoda: string;
  vrbo: string;
} {
  return {
    booking: generateBookingLink(params),
    agoda: generateAgodaLink(params),
    vrbo: generateVrboLink(params),
  };
}

// ============================================================================
// Flight Links
// ============================================================================

export interface FlightSearchParams {
  origin: string; // City name or IATA code
  destination: string; // City name or IATA code
  departDate: string; // YYYY-MM-DD
  returnDate?: string; // YYYY-MM-DD (omit for one-way)
  passengers: number;
}

/**
 * Generate Trip.com flight search link
 */
export function generateTripComLink(params: FlightSearchParams): string {
  const { origin, destination, departDate, returnDate, passengers } = params;

  // Trip.com uses city names in the path
  const originSlug = origin.toLowerCase().replace(/\s+/g, "-");
  const destSlug = destination.toLowerCase().replace(/\s+/g, "-");

  const url = new URL(`https://www.trip.com/flights/${originSlug}-to-${destSlug}`);
  url.searchParams.set("departure", departDate);
  url.searchParams.set("adult", String(passengers));
  if (returnDate) {
    url.searchParams.set("return", returnDate);
  }
  url.searchParams.set("allianceid", MARKER); // Trip.com uses 'allianceid'

  return url.toString();
}

/**
 * Generate CheapOair flight search link
 */
export function generateCheapOairLink(params: FlightSearchParams): string {
  const { origin, destination, departDate, returnDate, passengers } = params;

  const tripType = returnDate ? "roundtrip" : "oneway";
  const url = new URL("https://www.cheapoair.com/flights");
  url.searchParams.set("origin", origin);
  url.searchParams.set("destination", destination);
  url.searchParams.set("departDate", departDate);
  url.searchParams.set("tripType", tripType);
  url.searchParams.set("numAdults", String(passengers));
  if (returnDate) {
    url.searchParams.set("returnDate", returnDate);
  }
  url.searchParams.set("utm_source", "travelpayouts");
  url.searchParams.set("utm_medium", "affiliate");
  url.searchParams.set("utm_campaign", MARKER);

  return url.toString();
}

/**
 * Generate Expedia flight search link
 */
export function generateExpediaFlightLink(params: FlightSearchParams): string {
  const { origin, destination, departDate, returnDate, passengers } = params;

  // Expedia format: /Flights-Search?leg1=from:NYC,to:PAR,departure:2025-03-15
  let searchPath = `leg1=from:${encodeURIComponent(origin)},to:${encodeURIComponent(destination)},departure:${departDate}`;

  if (returnDate) {
    searchPath += `&leg2=from:${encodeURIComponent(destination)},to:${encodeURIComponent(origin)},departure:${returnDate}`;
  }

  searchPath += `&passengers=adults:${passengers}`;

  const url = new URL(`https://www.expedia.com/Flights-Search?${searchPath}`);
  url.searchParams.set("affcid", MARKER); // Expedia uses 'affcid'

  return url.toString();
}

/**
 * Generate all flight partner links
 */
export function generateAllFlightLinks(params: FlightSearchParams): {
  tripcom: string;
  cheapoair: string;
  expedia: string;
} {
  return {
    tripcom: generateTripComLink(params),
    cheapoair: generateCheapOairLink(params),
    expedia: generateExpediaFlightLink(params),
  };
}

// ============================================================================
// Activity Links
// ============================================================================

export interface ActivitySearchParams {
  destination: string;
  activityName?: string;
  date?: string; // YYYY-MM-DD
}

/**
 * Generate GetYourGuide activity search link
 * This is the primary activity partner with 8% commission
 */
export function generateGetYourGuideLink(params: ActivitySearchParams): string {
  const { destination, activityName, date } = params;

  const searchQuery = activityName
    ? `${activityName} ${destination}`
    : destination;

  const url = new URL("https://www.getyourguide.com/s/");
  url.searchParams.set("q", searchQuery);
  url.searchParams.set("partner_id", MARKER); // GetYourGuide uses 'partner_id'

  if (date) {
    url.searchParams.set("date_from", date);
  }

  return url.toString();
}

/**
 * Generate Klook activity search link
 */
export function generateKlookLink(params: ActivitySearchParams): string {
  const { destination, activityName } = params;

  const searchQuery = activityName
    ? `${activityName} ${destination}`
    : destination;

  const url = new URL("https://www.klook.com/search/");
  url.searchParams.set("query", searchQuery);
  url.searchParams.set("aid", MARKER); // Klook uses 'aid' parameter

  return url.toString();
}

/**
 * Generate Tiqets attraction search link
 */
export function generateTiqetsLink(params: ActivitySearchParams): string {
  const { destination, activityName } = params;

  const searchQuery = activityName || destination;

  const url = new URL("https://www.tiqets.com/search/");
  url.searchParams.set("q", searchQuery);
  url.searchParams.set("partner", MARKER); // Tiqets uses 'partner'

  return url.toString();
}

/**
 * Generate all activity partner links
 */
export function generateAllActivityLinks(params: ActivitySearchParams): {
  getyourguide: string;
  klook: string;
  tiqets: string;
} {
  return {
    getyourguide: generateGetYourGuideLink(params),
    klook: generateKlookLink(params),
    tiqets: generateTiqetsLink(params),
  };
}

// ============================================================================
// Transport Links
// ============================================================================

export interface TransportSearchParams {
  origin: string;
  destination: string;
  date: string; // YYYY-MM-DD
  passengers?: number;
}

/**
 * Generate Omio train/bus search link
 */
export function generateOmioLink(params: TransportSearchParams): string {
  const { origin, destination, date, passengers = 1 } = params;

  const url = new URL("https://www.omio.com/search");
  url.searchParams.set("from", origin);
  url.searchParams.set("to", destination);
  url.searchParams.set("date", date);
  url.searchParams.set("passengers", String(passengers));
  url.searchParams.set("utm_medium", "affiliate");
  url.searchParams.set("utm_source", MARKER);

  return url.toString();
}

// ============================================================================
// Travel Services Links
// ============================================================================

/**
 * Generate Yesim eSIM link for a destination
 */
export function generateYesimLink(destination: string): string {
  const destSlug = destination.toLowerCase().replace(/\s+/g, "-");
  const url = new URL(`https://yesim.app/destinations/${destSlug}`);
  url.searchParams.set("ref", MARKER);

  return url.toString();
}

/**
 * Generate Saily eSIM link for a destination
 */
export function generateSailyLink(destination: string): string {
  const destSlug = destination.toLowerCase().replace(/\s+/g, "-");
  const url = new URL(`https://saily.com/esim/${destSlug}`);
  url.searchParams.set("ref", MARKER);

  return url.toString();
}

/**
 * Generate all eSIM partner links
 */
export function generateAllEsimLinks(destination: string): {
  yesim: string;
  saily: string;
} {
  return {
    yesim: generateYesimLink(destination),
    saily: generateSailyLink(destination),
  };
}

/**
 * Generate AirHelp flight compensation link
 */
export function generateAirHelpLink(): string {
  const url = new URL("https://www.airhelp.com/en/claim/");
  url.searchParams.set("utm_source", "travelpayouts");
  url.searchParams.set("utm_medium", "affiliate");
  url.searchParams.set("utm_campaign", MARKER);

  return url.toString();
}

// ============================================================================
// Legacy Compatibility - createDeepLink (now uses simple format)
// ============================================================================

/**
 * Create a simple affiliate link for any partner
 * Uses direct URL format instead of Travelpayouts click tracking
 *
 * @param partner - Partner key (e.g., "booking", "klook")
 * @param targetUrl - The destination URL on the partner site
 * @param subId - Optional SubID for tracking (appended to marker)
 * @returns Affiliate tracking URL with marker parameter
 */
export function createDeepLink(
  partner: PartnerKey,
  targetUrl: string,
  subId?: string
): string {
  // Parse the target URL and add marker parameter
  const url = new URL(targetUrl);
  const markerValue = subId ? `${MARKER}_${subId}` : MARKER;

  // Different partners use different affiliate parameter names
  switch (partner) {
    case "booking":
      url.searchParams.set("aid", markerValue);
      break;
    case "agoda":
      url.searchParams.set("cid", markerValue);
      break;
    case "tripcom":
      url.searchParams.set("allianceid", markerValue);
      break;
    case "expedia":
    case "vrbo":
      url.searchParams.set("affcid", markerValue);
      break;
    case "klook":
      url.searchParams.set("aid", markerValue);
      break;
    case "tiqets":
      url.searchParams.set("partner", markerValue);
      break;
    case "getyourguide":
      url.searchParams.set("partner_id", markerValue);
      break;
    case "omio":
      url.searchParams.set("utm_source", markerValue);
      break;
    case "yesim":
    case "saily":
      url.searchParams.set("ref", markerValue);
      break;
    case "airhelp":
    case "cheapoair":
      url.searchParams.set("utm_campaign", markerValue);
      break;
    default:
      url.searchParams.set("marker", markerValue);
  }

  return url.toString();
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Calculate number of nights between two dates
 */
function calculateNights(checkIn: string, checkOut: string): number {
  const start = new Date(checkIn);
  const end = new Date(checkOut);
  const diffTime = Math.abs(end.getTime() - start.getTime());
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

// ============================================================================
// Convenience: All-in-One Trip Booking Links
// ============================================================================

export interface TripBookingParams {
  destination: string;
  originCity?: string;
  startDate: string;
  endDate: string;
  travelers: number;
}

/**
 * Generate all booking links for a trip
 */
export function generateTripBookingLinks(params: TripBookingParams): {
  hotels: { booking: string; agoda: string; vrbo: string };
  flights: { tripcom: string; cheapoair: string; expedia: string } | null;
  activities: { getyourguide: string; klook: string; tiqets: string };
  transport: { omio: string };
  services: { yesim: string; saily: string; airhelp: string };
} {
  const { destination, originCity, startDate, endDate, travelers } = params;

  const hotels = generateAllHotelLinks({
    destination,
    checkIn: startDate,
    checkOut: endDate,
    guests: travelers,
  });

  const flights = originCity
    ? generateAllFlightLinks({
        origin: originCity,
        destination,
        departDate: startDate,
        returnDate: endDate,
        passengers: travelers,
      })
    : null;

  const activities = generateAllActivityLinks({ destination });

  const transport = {
    omio: generateOmioLink({
      origin: destination,
      destination: destination, // Will be updated with actual city pairs
      date: startDate,
      passengers: travelers,
    }),
  };

  const services = {
    ...generateAllEsimLinks(destination),
    airhelp: generateAirHelpLink(),
  };

  return { hotels, flights, activities, transport, services };
}
