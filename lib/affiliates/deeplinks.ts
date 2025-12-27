/**
 * Travelpayouts Deep Link Generator
 *
 * Generates affiliate deep links for all Travelpayouts partners.
 * Uses the official Travelpayouts click tracking format.
 */

import { PARTNERS, MARKER, type PartnerKey } from "./partners";

/**
 * Create a Travelpayouts deep link for any partner
 *
 * @param partner - Partner key (e.g., "booking", "klook")
 * @param targetUrl - The destination URL on the partner site
 * @param subId - Optional SubID for tracking (e.g., "hotels", "activities")
 * @returns Affiliate tracking URL
 */
export function createDeepLink(
  partner: PartnerKey,
  targetUrl: string,
  subId?: string
): string {
  const config = PARTNERS[partner];
  const shmarker = subId ? `${MARKER}.${subId}` : MARKER;

  const params = new URLSearchParams({
    shmarker,
    promo_id: config.promo_id,
    source_type: "customlink",
    type: "click",
    custom_url: targetUrl,
  });

  return `https://${config.subdomain}.travelpayouts.com/click?${params.toString()}`;
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
 * Generate Booking.com hotel search link
 */
export function generateBookingLink(params: HotelSearchParams): string {
  const { destination, checkIn, checkOut, guests, rooms = 1 } = params;

  const targetUrl =
    `https://www.booking.com/searchresults.html?` +
    `ss=${encodeURIComponent(destination)}&` +
    `checkin=${checkIn}&checkout=${checkOut}&` +
    `group_adults=${guests}&no_rooms=${rooms}`;

  return createDeepLink("booking", targetUrl, "hotels");
}

/**
 * Generate Agoda hotel search link
 */
export function generateAgodaLink(params: HotelSearchParams): string {
  const { destination, checkIn, checkOut, guests, rooms = 1 } = params;

  const targetUrl =
    `https://www.agoda.com/search?` +
    `city=${encodeURIComponent(destination)}&` +
    `checkIn=${checkIn}&los=${calculateNights(checkIn, checkOut)}&` +
    `adults=${guests}&rooms=${rooms}`;

  return createDeepLink("agoda", targetUrl, "hotels");
}

/**
 * Generate VRBO vacation rental search link
 */
export function generateVrboLink(params: HotelSearchParams): string {
  const { destination, checkIn, checkOut, guests } = params;

  const targetUrl =
    `https://www.vrbo.com/search?` +
    `destination=${encodeURIComponent(destination)}&` +
    `startDate=${checkIn}&endDate=${checkOut}&` +
    `adults=${guests}`;

  return createDeepLink("vrbo", targetUrl, "vacation_rentals");
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

  let targetUrl =
    `https://www.trip.com/flights/${originSlug}-to-${destSlug}?` +
    `departure=${departDate}&adult=${passengers}`;

  if (returnDate) {
    targetUrl += `&return=${returnDate}`;
  }

  return createDeepLink("tripcom", targetUrl, "flights");
}

/**
 * Generate CheapOair flight search link
 */
export function generateCheapOairLink(params: FlightSearchParams): string {
  const { origin, destination, departDate, returnDate, passengers } = params;

  const tripType = returnDate ? "roundtrip" : "oneway";
  let targetUrl =
    `https://www.cheapoair.com/flights?` +
    `origin=${encodeURIComponent(origin)}&` +
    `destination=${encodeURIComponent(destination)}&` +
    `departDate=${departDate}&tripType=${tripType}&` +
    `numAdults=${passengers}`;

  if (returnDate) {
    targetUrl += `&returnDate=${returnDate}`;
  }

  return createDeepLink("cheapoair", targetUrl, "flights");
}

/**
 * Generate Expedia flight search link
 */
export function generateExpediaFlightLink(params: FlightSearchParams): string {
  const { origin, destination, departDate, returnDate, passengers } = params;

  // Expedia format: /Flights-Search?leg1=from:NYC,to:PAR,departure:2025-03-15
  let targetUrl =
    `https://www.expedia.com/Flights-Search?` +
    `leg1=from:${encodeURIComponent(origin)},to:${encodeURIComponent(destination)},departure:${departDate}`;

  if (returnDate) {
    targetUrl += `&leg2=from:${encodeURIComponent(destination)},to:${encodeURIComponent(origin)},departure:${returnDate}`;
  }

  targetUrl += `&passengers=adults:${passengers}`;

  return createDeepLink("expedia", targetUrl, "flights");
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
 * Generate Klook activity search link
 */
export function generateKlookLink(params: ActivitySearchParams): string {
  const { destination, activityName } = params;

  const searchQuery = activityName
    ? `${activityName} ${destination}`
    : destination;

  const targetUrl = `https://www.klook.com/search/?query=${encodeURIComponent(searchQuery)}`;

  return createDeepLink("klook", targetUrl, "activities");
}

/**
 * Generate Tiqets attraction search link
 */
export function generateTiqetsLink(params: ActivitySearchParams): string {
  const { destination, activityName } = params;

  const searchQuery = activityName || destination;

  const targetUrl = `https://www.tiqets.com/search/?q=${encodeURIComponent(searchQuery)}`;

  return createDeepLink("tiqets", targetUrl, "activities");
}

/**
 * Generate all activity partner links
 */
export function generateAllActivityLinks(params: ActivitySearchParams): {
  klook: string;
  tiqets: string;
} {
  return {
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

  const targetUrl =
    `https://www.omio.com/search?` +
    `from=${encodeURIComponent(origin)}&` +
    `to=${encodeURIComponent(destination)}&` +
    `date=${date}&passengers=${passengers}`;

  return createDeepLink("omio", targetUrl, "transport");
}

// ============================================================================
// Travel Services Links
// ============================================================================

/**
 * Generate Yesim eSIM link for a destination
 */
export function generateYesimLink(destination: string): string {
  const destSlug = destination.toLowerCase().replace(/\s+/g, "-");
  const targetUrl = `https://yesim.app/destinations/${destSlug}`;

  return createDeepLink("yesim", targetUrl, "esim");
}

/**
 * Generate Saily eSIM link for a destination
 */
export function generateSailyLink(destination: string): string {
  const destSlug = destination.toLowerCase().replace(/\s+/g, "-");
  const targetUrl = `https://saily.com/esim/${destSlug}`;

  return createDeepLink("saily", targetUrl, "esim");
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
  const targetUrl = "https://www.airhelp.com/en/claim/";
  return createDeepLink("airhelp", targetUrl, "compensation");
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
  activities: { klook: string; tiqets: string };
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
