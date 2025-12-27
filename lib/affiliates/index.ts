/**
 * Affiliate Link Generation Module
 *
 * Export all affiliate-related utilities for generating booking links.
 *
 * NEW (Travelpayouts Partners):
 * - partners.ts: Partner configuration (Booking.com, Klook, Tiqets, etc.)
 * - deeplinks.ts: Deep link generators for all partners
 * - enrichment.ts: City IATA codes, region detection, smart defaults
 *
 * LEGACY (kept for backward compatibility):
 * - travelpayouts.ts: Original implementation (Aviasales, Hotellook, etc.)
 */

// ============================================================================
// NEW: Travelpayouts Partners System
// ============================================================================

// Partner configuration
export {
  PARTNERS,
  MARKER,
  getPartnersByCategory,
  getPartnersByRegion,
  getHotelPartners,
  getFlightPartners,
  getActivityPartners,
  getEsimPartners,
  type PartnerKey,
  type PartnerCategory,
  type PartnerConfig,
} from "./partners";

// Deep link generators
export {
  // Core
  createDeepLink,
  // Hotels
  generateBookingLink,
  generateAgodaLink,
  generateVrboLink,
  generateAllHotelLinks,
  // Flights
  generateTripComLink,
  generateCheapOairLink,
  generateExpediaFlightLink,
  generateAllFlightLinks,
  // Activities
  generateKlookLink,
  generateTiqetsLink,
  generateAllActivityLinks,
  // Transport
  generateOmioLink,
  // Travel Services
  generateYesimLink,
  generateSailyLink,
  generateAllEsimLinks,
  generateAirHelpLink,
  // All-in-one
  generateTripBookingLinks as generateAllTripLinks,
  // Types
  type HotelSearchParams as NewHotelSearchParams,
  type FlightSearchParams as NewFlightSearchParams,
  type ActivitySearchParams as NewActivitySearchParams,
  type TransportSearchParams,
  type TripBookingParams,
} from "./deeplinks";

// Enrichment utilities
export {
  getCityIATA,
  getCityRegion,
  getTravelerCount,
  getBestActivityPartner,
  getBestFlightPartner,
  getBestHotelPartner,
  isOmioRelevant,
  formatDate,
  CITY_IATA_CODES,
  type Region,
} from "./enrichment";

// ============================================================================
// LEGACY: Original Implementation (backward compatibility)
// ============================================================================

export {
  // Link generators
  generateFlightLink,
  generateHotelLink,
  generateCarRentalLink,
  generateActivityLink,
  generateTrainBusLink,
  generateTransferLink,
  // Convenience functions
  generateTripBookingLinks,
  getMarker,
  isAffiliateConfigured,
  // Types
  type FlightSearchParams,
  type HotelSearchParams,
  type CarRentalParams,
  type ActivitySearchParams,
  type TransferParams,
} from "./travelpayouts";
