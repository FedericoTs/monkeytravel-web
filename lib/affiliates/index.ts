/**
 * Affiliate Link Generation Module
 *
 * Export all affiliate-related utilities for generating booking links.
 */

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
