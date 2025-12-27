/**
 * Travelpayouts Affiliate Link Generation
 *
 * Generates deep links to Travelpayouts partner sites with our marker ID.
 * Users complete bookings on partner sites; we earn commission via cookies.
 *
 * Partner Programs:
 * - Aviasales: Flight bookings (1.6-2.2% commission)
 * - Hotellook: Hotel bookings (6-10% commission)
 * - RentalCars: Car rentals (6% commission)
 * - GetYourGuide: Tours/Activities (8% commission)
 * - Omio: Train/Bus tickets (3-5% commission)
 */

// Marker ID for affiliate tracking (public - appears in links)
const MARKER = process.env.NEXT_PUBLIC_TRAVELPAYOUTS_MARKER || "483997";

// Partner base URLs
const PARTNERS = {
  aviasales: "https://www.aviasales.com",
  hotellook: "https://search.hotellook.com",
  rentalcars: "https://www.rentalcars.com",
  getyourguide: "https://www.getyourguide.com",
  omio: "https://www.omio.com",
  kiwitaxi: "https://kiwitaxi.com",
} as const;

// ============================================================================
// Types
// ============================================================================

export interface FlightSearchParams {
  /** Origin airport IATA code (e.g., "JFK", "LAX") */
  origin: string;
  /** Destination airport IATA code (e.g., "CDG", "FCO") */
  destination: string;
  /** Departure date (YYYY-MM-DD) */
  departDate: string;
  /** Return date for round-trip (YYYY-MM-DD), omit for one-way */
  returnDate?: string;
  /** Number of adult passengers (default: 1) */
  passengers?: number;
  /** Cabin class: economy, business, first */
  cabinClass?: "economy" | "business" | "first";
}

export interface HotelSearchParams {
  /** Destination city name (e.g., "Paris", "Rome") */
  destination: string;
  /** Check-in date (YYYY-MM-DD) */
  checkIn: string;
  /** Check-out date (YYYY-MM-DD) */
  checkOut: string;
  /** Number of guests (default: 2) */
  guests?: number;
  /** Number of rooms (default: 1) */
  rooms?: number;
}

export interface CarRentalParams {
  /** Pickup location (city or airport code) */
  pickupLocation: string;
  /** Pickup date (YYYY-MM-DD) */
  pickupDate: string;
  /** Pickup time (HH:MM, default: "10:00") */
  pickupTime?: string;
  /** Drop-off date (YYYY-MM-DD) */
  dropoffDate: string;
  /** Drop-off time (HH:MM, default: "10:00") */
  dropoffTime?: string;
  /** Driver age (affects pricing, default: 30) */
  driverAge?: number;
}

export interface ActivitySearchParams {
  /** Destination city or region */
  destination: string;
  /** Activity name or search query */
  query?: string;
  /** Date for the activity (YYYY-MM-DD) */
  date?: string;
}

export interface TransferParams {
  /** Pickup location (usually airport or city) */
  from: string;
  /** Drop-off location */
  to: string;
  /** Date (YYYY-MM-DD) */
  date: string;
  /** Time (HH:MM) */
  time?: string;
  /** Number of passengers */
  passengers?: number;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Format date from YYYY-MM-DD to DDMM (Aviasales format)
 */
function formatDateDDMM(dateStr: string): string {
  const date = new Date(dateStr);
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return day + month;
}

/**
 * Format date from YYYY-MM-DD to DD.MM.YYYY
 */
function formatDateDot(dateStr: string): string {
  const [year, month, day] = dateStr.split("-");
  return `${day}.${month}.${year}`;
}

// ============================================================================
// Link Generators
// ============================================================================

/**
 * Generate Aviasales flight search link
 *
 * @example
 * generateFlightLink({
 *   origin: "JFK",
 *   destination: "CDG",
 *   departDate: "2025-03-15",
 *   returnDate: "2025-03-22",
 *   passengers: 2
 * })
 * // Returns: https://www.aviasales.com/search/JFK1503CDG22032?marker=483997
 */
export function generateFlightLink(params: FlightSearchParams): string {
  const {
    origin,
    destination,
    departDate,
    returnDate,
    passengers = 1,
  } = params;

  // Aviasales search path format: {origin}{DDMM}{destination}{DDMM}{passengers}
  const dept = formatDateDDMM(departDate);
  const ret = returnDate ? formatDateDDMM(returnDate) : "";

  // Build search path: ORIGIN + DDMM + DESTINATION + DDMM (return) + passengers
  const searchPath = `${origin.toUpperCase()}${dept}${destination.toUpperCase()}${ret}${passengers}`;

  const url = new URL(`${PARTNERS.aviasales}/search/${searchPath}`);
  url.searchParams.set("marker", MARKER);

  return url.toString();
}

/**
 * Generate Hotellook hotel search link
 *
 * @example
 * generateHotelLink({
 *   destination: "Paris",
 *   checkIn: "2025-03-15",
 *   checkOut: "2025-03-22",
 *   guests: 2
 * })
 */
export function generateHotelLink(params: HotelSearchParams): string {
  const { destination, checkIn, checkOut, guests = 2, rooms = 1 } = params;

  const url = new URL(PARTNERS.hotellook);
  url.searchParams.set("destination", destination);
  url.searchParams.set("checkIn", checkIn);
  url.searchParams.set("checkOut", checkOut);
  url.searchParams.set("adults", String(guests));
  url.searchParams.set("rooms", String(rooms));
  url.searchParams.set("marker", MARKER);

  return url.toString();
}

/**
 * Generate RentalCars car rental search link
 */
export function generateCarRentalLink(params: CarRentalParams): string {
  const {
    pickupLocation,
    pickupDate,
    pickupTime = "10:00",
    dropoffDate,
    dropoffTime = "10:00",
    driverAge = 30,
  } = params;

  const url = new URL(`${PARTNERS.rentalcars}/search`);
  url.searchParams.set("location", pickupLocation);
  url.searchParams.set("pickUpDate", formatDateDot(pickupDate));
  url.searchParams.set("pickUpTime", pickupTime);
  url.searchParams.set("dropOffDate", formatDateDot(dropoffDate));
  url.searchParams.set("dropOffTime", dropoffTime);
  url.searchParams.set("driversAge", String(driverAge));
  url.searchParams.set("affiliateCode", MARKER);

  return url.toString();
}

/**
 * Generate GetYourGuide activity search link
 */
export function generateActivityLink(params: ActivitySearchParams): string {
  const { destination, query, date } = params;

  const searchQuery = query || destination;
  const url = new URL(`${PARTNERS.getyourguide}/s/`);
  url.searchParams.set("q", searchQuery);
  url.searchParams.set("partner_id", MARKER);

  if (date) {
    url.searchParams.set("date_from", date);
  }

  return url.toString();
}

/**
 * Generate Omio train/bus search link
 */
export function generateTrainBusLink(params: {
  origin: string;
  destination: string;
  date: string;
  passengers?: number;
}): string {
  const { origin, destination, date, passengers = 1 } = params;

  const url = new URL(`${PARTNERS.omio}/search`);
  url.searchParams.set("from", origin);
  url.searchParams.set("to", destination);
  url.searchParams.set("date", date);
  url.searchParams.set("passengers", String(passengers));
  url.searchParams.set("marker", MARKER);

  return url.toString();
}

/**
 * Generate Kiwitaxi airport transfer link
 */
export function generateTransferLink(params: TransferParams): string {
  const { from, to, date, time = "12:00", passengers = 2 } = params;

  const url = new URL(PARTNERS.kiwitaxi);
  url.searchParams.set("from", from);
  url.searchParams.set("to", to);
  url.searchParams.set("date", date);
  url.searchParams.set("time", time);
  url.searchParams.set("pax", String(passengers));
  url.searchParams.set("marker", MARKER);

  return url.toString();
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Generate all relevant booking links for a trip
 */
export function generateTripBookingLinks(tripData: {
  destination: string;
  originCity?: string;
  originAirport?: string;
  destinationAirport?: string;
  startDate: string;
  endDate: string;
  travelers?: number;
}): {
  flight: string | null;
  hotel: string;
  carRental: string;
  activities: string;
  transfer: string | null;
} {
  const {
    destination,
    originAirport,
    destinationAirport,
    startDate,
    endDate,
    travelers = 2,
  } = tripData;

  // Flight link (only if we have airports)
  const flight =
    originAirport && destinationAirport
      ? generateFlightLink({
          origin: originAirport,
          destination: destinationAirport,
          departDate: startDate,
          returnDate: endDate,
          passengers: travelers,
        })
      : null;

  // Hotel link
  const hotel = generateHotelLink({
    destination,
    checkIn: startDate,
    checkOut: endDate,
    guests: travelers,
  });

  // Car rental link
  const carRental = generateCarRentalLink({
    pickupLocation: destinationAirport || destination,
    pickupDate: startDate,
    dropoffDate: endDate,
  });

  // Activities link
  const activities = generateActivityLink({
    destination,
  });

  // Transfer link (only if we have destination airport)
  const transfer = destinationAirport
    ? generateTransferLink({
        from: `${destinationAirport} Airport`,
        to: destination,
        date: startDate,
        passengers: travelers,
      })
    : null;

  return { flight, hotel, carRental, activities, transfer };
}

/**
 * Get the marker ID (for tracking/debugging)
 */
export function getMarker(): string {
  return MARKER;
}

/**
 * Check if affiliate links are configured
 */
export function isAffiliateConfigured(): boolean {
  return Boolean(MARKER && MARKER !== "");
}
