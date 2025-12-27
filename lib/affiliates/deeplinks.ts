/**
 * Travelpayouts Deep Link Generator
 *
 * Generates affiliate deep links for all Travelpayouts partners.
 * Uses Travelpayouts click-tracking redirect format for proper attribution.
 *
 * Link format: https://c{XX}.travelpayouts.com/click?shmarker={MARKER}&promo_id={ID}&...
 *
 * IMPORTANT: For tracking to work:
 * 1. Partner program must be ACTIVE in your Travelpayouts dashboard
 * 2. promo_id must match your dashboard configuration
 * 3. Your account must be approved for each partner
 */

import { PARTNERS, MARKER, type PartnerKey } from "./partners";

// Base domain for Travelpayouts click tracking
const TP_BASE = "travelpayouts.com/click";

/**
 * Create a Travelpayouts tracking URL
 * This is the proper format that Travelpayouts can track
 */
function createTravelpayoutsLink(
  subdomain: string,
  promo_id: string,
  targetUrl: string,
  subId?: string
): string {
  const params = new URLSearchParams({
    shmarker: subId ? `${MARKER}.${subId}` : MARKER,
    promo_id: promo_id,
    source_type: "searchform",
    type: "click",
    u: targetUrl,
  });

  return `https://${subdomain}.${TP_BASE}?${params.toString()}`;
}

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
 * Generate Booking.com hotel search link via Travelpayouts tracking
 */
export function generateBookingLink(params: HotelSearchParams): string {
  const { destination, checkIn, checkOut, guests, rooms = 1 } = params;

  // Build the target URL for Booking.com
  const targetUrl = new URL("https://www.booking.com/searchresults.html");
  targetUrl.searchParams.set("ss", destination);
  targetUrl.searchParams.set("checkin", checkIn);
  targetUrl.searchParams.set("checkout", checkOut);
  targetUrl.searchParams.set("group_adults", String(guests));
  targetUrl.searchParams.set("no_rooms", String(rooms));

  // Wrap with Travelpayouts tracking
  return createTravelpayoutsLink(
    PARTNERS.booking.subdomain,
    PARTNERS.booking.promo_id,
    targetUrl.toString(),
    "hotels"
  );
}

/**
 * Generate Agoda hotel search link via Travelpayouts tracking
 */
export function generateAgodaLink(params: HotelSearchParams): string {
  const { destination, checkIn, checkOut, guests, rooms = 1 } = params;

  const targetUrl = new URL("https://www.agoda.com/search");
  targetUrl.searchParams.set("city", destination);
  targetUrl.searchParams.set("checkIn", checkIn);
  targetUrl.searchParams.set("los", String(calculateNights(checkIn, checkOut)));
  targetUrl.searchParams.set("adults", String(guests));
  targetUrl.searchParams.set("rooms", String(rooms));

  return createTravelpayoutsLink(
    PARTNERS.agoda.subdomain,
    PARTNERS.agoda.promo_id,
    targetUrl.toString(),
    "hotels"
  );
}

/**
 * Generate VRBO vacation rental search link via Travelpayouts tracking
 */
export function generateVrboLink(params: HotelSearchParams): string {
  const { destination, checkIn, checkOut, guests } = params;

  const targetUrl = new URL("https://www.vrbo.com/search");
  targetUrl.searchParams.set("destination", destination);
  targetUrl.searchParams.set("startDate", checkIn);
  targetUrl.searchParams.set("endDate", checkOut);
  targetUrl.searchParams.set("adults", String(guests));

  return createTravelpayoutsLink(
    PARTNERS.vrbo.subdomain,
    PARTNERS.vrbo.promo_id,
    targetUrl.toString(),
    "hotels"
  );
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
 * Generate Trip.com flight search link via Travelpayouts tracking
 */
export function generateTripComLink(params: FlightSearchParams): string {
  const { origin, destination, departDate, returnDate, passengers } = params;

  const originSlug = origin.toLowerCase().replace(/\s+/g, "-");
  const destSlug = destination.toLowerCase().replace(/\s+/g, "-");

  const targetUrl = new URL(`https://www.trip.com/flights/${originSlug}-to-${destSlug}`);
  targetUrl.searchParams.set("departure", departDate);
  targetUrl.searchParams.set("adult", String(passengers));
  if (returnDate) {
    targetUrl.searchParams.set("return", returnDate);
  }

  return createTravelpayoutsLink(
    PARTNERS.tripcom.subdomain,
    PARTNERS.tripcom.promo_id,
    targetUrl.toString(),
    "flights"
  );
}

/**
 * Generate CheapOair flight search link via Travelpayouts tracking
 */
export function generateCheapOairLink(params: FlightSearchParams): string {
  const { origin, destination, departDate, returnDate, passengers } = params;

  const tripType = returnDate ? "roundtrip" : "oneway";
  const targetUrl = new URL("https://www.cheapoair.com/flights");
  targetUrl.searchParams.set("origin", origin);
  targetUrl.searchParams.set("destination", destination);
  targetUrl.searchParams.set("departDate", departDate);
  targetUrl.searchParams.set("tripType", tripType);
  targetUrl.searchParams.set("numAdults", String(passengers));
  if (returnDate) {
    targetUrl.searchParams.set("returnDate", returnDate);
  }

  return createTravelpayoutsLink(
    PARTNERS.cheapoair.subdomain,
    PARTNERS.cheapoair.promo_id,
    targetUrl.toString(),
    "flights"
  );
}

/**
 * Generate Expedia flight search link via Travelpayouts tracking
 */
export function generateExpediaFlightLink(params: FlightSearchParams): string {
  const { origin, destination, departDate, returnDate, passengers } = params;

  let searchPath = `leg1=from:${encodeURIComponent(origin)},to:${encodeURIComponent(destination)},departure:${departDate}`;

  if (returnDate) {
    searchPath += `&leg2=from:${encodeURIComponent(destination)},to:${encodeURIComponent(origin)},departure:${returnDate}`;
  }

  searchPath += `&passengers=adults:${passengers}`;

  const targetUrl = `https://www.expedia.com/Flights-Search?${searchPath}`;

  return createTravelpayoutsLink(
    PARTNERS.expedia.subdomain,
    PARTNERS.expedia.promo_id,
    targetUrl,
    "flights"
  );
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
 * Generate WeGoTrip activity search link via Travelpayouts
 * WeGoTrip specializes in audio guides and self-guided tours
 * THIS IS THE ONLY ACTIVE PARTNER - use this for testing!
 */
export function generateWeGoTripLink(params: ActivitySearchParams): string {
  const { destination, activityName } = params;

  const searchQuery = activityName
    ? `${activityName} ${destination}`
    : destination;

  const targetUrl = new URL("https://www.wegotrip.com/search/");
  targetUrl.searchParams.set("q", searchQuery);

  // WeGoTrip uses tpm.li short links format
  // Their promo_id is cG2oKoAL from: https://wegotrip.tpm.li/cG2oKoAL
  return createTravelpayoutsLink(
    PARTNERS.wegotrip.subdomain,
    PARTNERS.wegotrip.promo_id,
    targetUrl.toString(),
    "activities"
  );
}

/**
 * Generate GetYourGuide activity search link
 * NOTE: PENDING APPROVAL - clicks won't be tracked until approved
 */
export function generateGetYourGuideLink(params: ActivitySearchParams): string {
  const { destination, activityName, date } = params;

  const searchQuery = activityName
    ? `${activityName} ${destination}`
    : destination;

  // Direct link without Travelpayouts tracking (pending approval)
  const url = new URL("https://www.getyourguide.com/s/");
  url.searchParams.set("q", searchQuery);

  if (date) {
    url.searchParams.set("date_from", date);
  }

  return url.toString();
}

/**
 * Generate Klook activity search link via Travelpayouts tracking
 */
export function generateKlookLink(params: ActivitySearchParams): string {
  const { destination, activityName } = params;

  const searchQuery = activityName
    ? `${activityName} ${destination}`
    : destination;

  const targetUrl = new URL("https://www.klook.com/search/");
  targetUrl.searchParams.set("query", searchQuery);

  return createTravelpayoutsLink(
    PARTNERS.klook.subdomain,
    PARTNERS.klook.promo_id,
    targetUrl.toString(),
    "activities"
  );
}

/**
 * Generate Tiqets attraction search link via Travelpayouts tracking
 */
export function generateTiqetsLink(params: ActivitySearchParams): string {
  const { destination, activityName } = params;

  const searchQuery = activityName || destination;

  const targetUrl = new URL("https://www.tiqets.com/search/");
  targetUrl.searchParams.set("q", searchQuery);

  return createTravelpayoutsLink(
    PARTNERS.tiqets.subdomain,
    PARTNERS.tiqets.promo_id,
    targetUrl.toString(),
    "activities"
  );
}

/**
 * Generate all activity partner links
 * Note: Only WeGoTrip is currently ACTIVE for tracking
 */
export function generateAllActivityLinks(params: ActivitySearchParams): {
  wegotrip: string;
  getyourguide: string;
  klook: string;
  tiqets: string;
} {
  return {
    wegotrip: generateWeGoTripLink(params), // ACTIVE - use for testing!
    getyourguide: generateGetYourGuideLink(params), // Pending
    klook: generateKlookLink(params), // Pending
    tiqets: generateTiqetsLink(params), // Pending
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
 * Generate Omio train/bus search link via Travelpayouts tracking
 */
export function generateOmioLink(params: TransportSearchParams): string {
  const { origin, destination, date, passengers = 1 } = params;

  const targetUrl = new URL("https://www.omio.com/search");
  targetUrl.searchParams.set("from", origin);
  targetUrl.searchParams.set("to", destination);
  targetUrl.searchParams.set("date", date);
  targetUrl.searchParams.set("passengers", String(passengers));

  return createTravelpayoutsLink(
    PARTNERS.omio.subdomain,
    PARTNERS.omio.promo_id,
    targetUrl.toString(),
    "transport"
  );
}

// ============================================================================
// Travel Services Links
// ============================================================================

/**
 * Generate Yesim eSIM link via Travelpayouts tracking
 */
export function generateYesimLink(destination: string): string {
  const destSlug = destination.toLowerCase().replace(/\s+/g, "-");
  const targetUrl = `https://yesim.app/destinations/${destSlug}`;

  return createTravelpayoutsLink(
    PARTNERS.yesim.subdomain,
    PARTNERS.yesim.promo_id,
    targetUrl,
    "esim"
  );
}

/**
 * Generate Saily eSIM link via Travelpayouts tracking
 */
export function generateSailyLink(destination: string): string {
  const destSlug = destination.toLowerCase().replace(/\s+/g, "-");
  const targetUrl = `https://saily.com/esim/${destSlug}`;

  return createTravelpayoutsLink(
    PARTNERS.saily.subdomain,
    PARTNERS.saily.promo_id,
    targetUrl,
    "esim"
  );
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
 * Generate AirHelp flight compensation link via Travelpayouts tracking
 */
export function generateAirHelpLink(): string {
  const targetUrl = "https://www.airhelp.com/en/claim/";

  return createTravelpayoutsLink(
    PARTNERS.airhelp.subdomain,
    PARTNERS.airhelp.promo_id,
    targetUrl,
    "compensation"
  );
}

// ============================================================================
// Legacy/Direct Link Creation
// ============================================================================

/**
 * Create an affiliate link for any partner
 * Uses Travelpayouts click tracking format for proper attribution
 *
 * @param partner - Partner key (e.g., "booking", "klook")
 * @param targetUrl - The destination URL on the partner site
 * @param subId - Optional SubID for tracking (appended to marker)
 * @returns Travelpayouts tracking URL
 */
export function createDeepLink(
  partner: PartnerKey,
  targetUrl: string,
  subId?: string
): string {
  const config = PARTNERS[partner];

  // GetYourGuide uses direct affiliate, not Travelpayouts
  if (partner === "getyourguide") {
    return targetUrl; // No tracking for GYG until partner_id is configured
  }

  return createTravelpayoutsLink(
    config.subdomain,
    config.promo_id,
    targetUrl,
    subId
  );
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
