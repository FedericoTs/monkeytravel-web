/**
 * Amadeus API Integration Module
 *
 * Main entry point for all Amadeus-related functionality.
 * Re-exports everything from submodules for convenience.
 *
 * @example
 * import { searchFlights, searchHotelOffers, getAmadeusClient } from '@/lib/amadeus';
 */

// Client
export {
  getAmadeusClient,
  isAmadeusConfigured,
  getAmadeusEnvironment,
  resetAmadeusClient,
  withAmadeusErrorHandling,
  testAmadeusConnection,
} from './client';

// Types
export * from './types';

// Rate Limiter
export {
  enqueueRequest,
  getQueueLength,
  getRateLimiterStats,
  resetRateLimiterStats,
  clearQueue,
  withRateLimit,
} from './rate-limiter';

// Cache
export {
  getCacheKey,
  getFromCache,
  setCache,
  hasValidCache,
  invalidateCache,
  invalidateCachePattern,
  clearCache,
  getCacheStats,
  resetCacheStats,
  getCacheEntryInfo,
  cleanupExpiredEntries,
  withCache,
  CACHE_TTL,
} from './cache';

// Flights
export {
  searchFlights,
  confirmFlightPrice,
  createFlightOrder,
  transformFlightOffer,
  getCheapestFlight,
  getFastestFlight,
  filterByStops,
  sortFlights,
} from './flights';

// Hotels
export {
  searchHotelsByCity,
  searchHotelsByGeo,
  searchHotelOffers,
  getHotelOffer,
  bookHotel,
  transformHotelOffer,
  getCheapestHotel,
  filterByRating,
  sortHotels,
  groupByPriceRange,
} from './hotels';

// Utilities
export {
  parseDuration,
  formatDuration,
  formatMinutesToDuration,
  formatTime,
  formatDate,
  formatDateTime,
  formatCurrency,
  calculateNights,
  getIATACode,
  getAirlineName,
  calculateLayover,
  formatLayover,
  isValidDate,
  isFutureDate,
  getTomorrowDate,
  formatDateToISO,
  addDays,
  formatStops,
  getCabinClassName,
  calculatePricePerPerson,
  isValidIATACode,
  normalizeIATACode,
} from './utils';
