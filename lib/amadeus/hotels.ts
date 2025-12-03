/**
 * Hotel Search Service
 *
 * Provides hotel search, offer retrieval, and booking functionality
 * using the Amadeus Hotel APIs.
 *
 * @see https://developers.amadeus.com/self-service/category/hotels/api-doc/hotel-list
 * @see https://developers.amadeus.com/self-service/category/hotels/api-doc/hotel-search
 */

import { getAmadeusClient, withAmadeusErrorHandling } from './client';
import { enqueueRequest } from './rate-limiter';
import { getCacheKey, getFromCache, setCache } from './cache';
import type {
  HotelSearchParams,
  HotelOffer,
  HotelBasic,
  HotelOfferDisplay,
  HotelSearchResponse,
} from './types';
import { formatCurrency, calculateNights } from './utils';

/**
 * Search for hotels by city code
 * Returns a list of hotels in the city (no pricing)
 *
 * @param cityCode - IATA city code (e.g., "PAR" for Paris)
 * @param options - Additional search options
 * @returns List of hotels in the city
 */
export async function searchHotelsByCity(
  cityCode: string,
  options?: {
    radius?: number;
    radiusUnit?: 'KM' | 'MILE';
    ratings?: string[];
    amenities?: string[];
  }
): Promise<{
  data: HotelBasic[];
  cached: boolean;
}> {
  const cacheKey = getCacheKey('hotelList', { cityCode, ...options });
  const cached = getFromCache<{ data: HotelBasic[] }>(cacheKey);

  if (cached) {
    return { ...cached, cached: true };
  }

  const result = await enqueueRequest(async () => {
    return withAmadeusErrorHandling(async () => {
      const amadeus = getAmadeusClient();

      const response = await amadeus.referenceData.locations.hotels.byCity.get({
        cityCode,
        radius: options?.radius || 30,
        radiusUnit: options?.radiusUnit || 'KM',
        ...(options?.ratings && { ratings: options.ratings }),
        ...(options?.amenities && { amenities: options.amenities }),
      });

      return { data: response.data as HotelBasic[] };
    }, 'searchHotelsByCity');
  });

  setCache(cacheKey, result, 'hotelList');

  return { ...result, cached: false };
}

/**
 * Search for hotels by geographic coordinates
 *
 * @param latitude - Latitude
 * @param longitude - Longitude
 * @param options - Additional search options
 * @returns List of hotels near the coordinates
 */
export async function searchHotelsByGeo(
  latitude: number,
  longitude: number,
  options?: {
    radius?: number;
    radiusUnit?: 'KM' | 'MILE';
    ratings?: string[];
  }
): Promise<{
  data: HotelBasic[];
  cached: boolean;
}> {
  const cacheKey = getCacheKey('hotelList', { latitude, longitude, ...options });
  const cached = getFromCache<{ data: HotelBasic[] }>(cacheKey);

  if (cached) {
    return { ...cached, cached: true };
  }

  const result = await enqueueRequest(async () => {
    return withAmadeusErrorHandling(async () => {
      const amadeus = getAmadeusClient();

      const response = await amadeus.referenceData.locations.hotels.byGeocode.get({
        latitude,
        longitude,
        radius: options?.radius || 10,
        radiusUnit: options?.radiusUnit || 'KM',
        ...(options?.ratings && { ratings: options.ratings }),
      });

      return { data: response.data as HotelBasic[] };
    }, 'searchHotelsByGeo');
  });

  setCache(cacheKey, result, 'hotelList');

  return { ...result, cached: false };
}

/**
 * Get hotel offers with pricing and availability
 *
 * @param params - Hotel search parameters
 * @returns Hotel offers with pricing
 */
export async function searchHotelOffers(params: HotelSearchParams): Promise<{
  data: HotelOffer[];
  cached: boolean;
}> {
  // First, get hotel IDs if not provided
  let hotelIds = params.hotelIds;

  if (!hotelIds?.length) {
    if (params.cityCode) {
      const hotels = await searchHotelsByCity(params.cityCode, {
        ratings: params.ratings,
        amenities: params.amenities,
      });
      // Limit to 8 hotels to avoid Vercel timeout (10s on Hobby plan)
      hotelIds = hotels.data.slice(0, 8).map((h) => h.hotelId);
    } else if (params.latitude && params.longitude) {
      const hotels = await searchHotelsByGeo(params.latitude, params.longitude, {
        radius: params.radius,
        radiusUnit: params.radiusUnit,
        ratings: params.ratings,
      });
      hotelIds = hotels.data.slice(0, 8).map((h) => h.hotelId);
    }
  }

  if (!hotelIds?.length) {
    return { data: [], cached: false };
  }

  // Check cache
  const cacheKey = getCacheKey('hotels', {
    hotelIds: hotelIds.slice(0, 10).join(','), // Limit cache key length
    checkInDate: params.checkInDate,
    checkOutDate: params.checkOutDate,
    adults: params.adults,
    roomQuantity: params.roomQuantity,
    currency: params.currency,
  });
  const cached = getFromCache<{ data: HotelOffer[] }>(cacheKey);

  if (cached) {
    return { ...cached, cached: true };
  }

  // Get offers
  const result = await enqueueRequest(async () => {
    return withAmadeusErrorHandling(async () => {
      const amadeus = getAmadeusClient();

      const response = await amadeus.shopping.hotelOffersSearch.get({
        hotelIds: hotelIds!.join(','),
        adults: params.adults.toString(),
        checkInDate: params.checkInDate,
        checkOutDate: params.checkOutDate,
        roomQuantity: (params.roomQuantity || 1).toString(),
        currency: params.currency || 'USD',
        ...(params.priceRange && { priceRange: params.priceRange }),
        ...(params.boardType && { boardType: params.boardType }),
        bestRateOnly: params.bestRateOnly !== false,
      });

      // Handle case where data might be undefined or not an array
      const data = response.data;
      if (!data || !Array.isArray(data)) {
        return { data: [] as HotelOffer[] };
      }
      return { data: data as HotelOffer[] };
    }, 'searchHotelOffers');
  });

  // Filter available hotels (handle undefined/empty result)
  const availableHotels = (result.data || []).filter((hotel) => hotel.available);

  setCache(cacheKey, { data: availableHotels }, 'hotels');

  return { data: availableHotels, cached: false };
}

/**
 * Get detailed offer for a specific hotel
 *
 * @param hotelId - Hotel ID
 * @param offerId - Offer ID
 * @returns Detailed hotel offer
 */
export async function getHotelOffer(
  hotelId: string,
  offerId: string
): Promise<{
  data: HotelOffer | null;
  cached: boolean;
}> {
  const cacheKey = getCacheKey('hotelOffer', { hotelId, offerId });
  const cached = getFromCache<{ data: HotelOffer }>(cacheKey);

  if (cached) {
    return { ...cached, cached: true };
  }

  const result = await enqueueRequest(async () => {
    return withAmadeusErrorHandling(async () => {
      const amadeus = getAmadeusClient();

      const response = await amadeus.shopping.hotelOfferSearch(offerId).get();

      return { data: response.data as HotelOffer };
    }, 'getHotelOffer');
  });

  setCache(cacheKey, result, 'hotelOffer');

  return { ...result, cached: false };
}

/**
 * Book a hotel room
 * Phase 2 feature - requires proper payment integration
 *
 * @param offerId - The offer ID to book
 * @param guests - Guest information
 * @param payment - Payment information
 * @returns Booking confirmation
 */
export async function bookHotel(
  offerId: string,
  guests: Array<{
    tid?: number;
    title?: string;
    firstName: string;
    lastName: string;
    phone?: string;
    email?: string;
  }>,
  payment: {
    vendorCode: string;
    cardNumber: string;
    expiryDate: string;
    holderName: string;
  }
): Promise<{
  bookingId: string;
  providerConfirmationId: string;
}> {
  return enqueueRequest(async () => {
    return withAmadeusErrorHandling(async () => {
      const amadeus = getAmadeusClient();

      const response = await amadeus.booking.hotelBookings.post(
        JSON.stringify({
          data: {
            type: 'hotel-booking',
            offerId,
            guests: guests.map((guest, index) => ({
              tid: guest.tid || index + 1,
              titleName: guest.title || 'MR',
              firstName: guest.firstName,
              lastName: guest.lastName,
              phone: guest.phone,
              email: guest.email,
            })),
            payments: [
              {
                method: 'CREDIT_CARD',
                paymentCard: {
                  vendorCode: payment.vendorCode,
                  cardNumber: payment.cardNumber,
                  expiryDate: payment.expiryDate,
                  holderName: payment.holderName,
                },
              },
            ],
          },
        })
      );

      const responseData = response.data as Array<{
        id: string;
        providerConfirmationId: string;
      }>;
      return {
        bookingId: responseData[0].id,
        providerConfirmationId: responseData[0].providerConfirmationId,
      };
    }, 'bookHotel');
  });
}

/**
 * Transform raw Amadeus hotel offer to display-friendly format
 *
 * @param offer - Raw hotel offer from API
 * @returns Display-friendly hotel offer
 */
export function transformHotelOffer(offer: HotelOffer): HotelOfferDisplay | null {
  if (!offer.offers?.length) return null;

  const hotel = offer.hotel;
  const roomOffer = offer.offers[0]; // Best/first offer
  const price = roomOffer.price;

  // Calculate price per night
  const nights = calculateNights(roomOffer.checkInDate, roomOffer.checkOutDate);
  const totalPrice = parseFloat(price.total);
  const pricePerNight = nights > 0 ? totalPrice / nights : totalPrice;

  // Build address string
  const address = [
    ...(hotel.address?.lines || []),
    hotel.address?.cityName,
    hotel.address?.countryCode,
  ]
    .filter(Boolean)
    .join(', ');

  // Get cancellation policy summary
  let cancellationPolicy: string | undefined;
  if (roomOffer.policies?.cancellation) {
    const cancellation = roomOffer.policies.cancellation;
    if (cancellation.type === 'FULL_STAY') {
      cancellationPolicy = 'Non-refundable';
    } else if (cancellation.deadline) {
      const deadline = new Date(cancellation.deadline);
      cancellationPolicy = `Free cancellation until ${deadline.toLocaleDateString()}`;
    } else {
      cancellationPolicy = cancellation.description?.text;
    }
  }

  return {
    id: roomOffer.id,
    hotelId: hotel.hotelId,
    name: hotel.name,
    address,
    rating: parseInt(hotel.rating || '0'),
    latitude: hotel.latitude,
    longitude: hotel.longitude,
    pricePerNight: Math.round(pricePerNight * 100) / 100,
    totalPrice,
    currency: price.currency,
    roomType: roomOffer.room?.typeEstimated?.category || roomOffer.room?.type || 'Standard Room',
    bedType: roomOffer.room?.typeEstimated?.bedType || 'Double',
    bedCount: roomOffer.room?.typeEstimated?.beds || 1,
    boardType: roomOffer.boardType,
    cancellationPolicy,
    amenities: hotel.amenities || [],
    image: hotel.media?.[0]?.uri,
    checkIn: roomOffer.checkInDate,
    checkOut: roomOffer.checkOutDate,
  };
}

/**
 * Get the cheapest hotel from search results
 */
export function getCheapestHotel(offers: HotelOffer[]): HotelOffer | null {
  if (offers.length === 0) return null;

  return offers.reduce((cheapest, current) => {
    const cheapestPrice = parseFloat(cheapest.offers?.[0]?.price?.total || '999999');
    const currentPrice = parseFloat(current.offers?.[0]?.price?.total || '999999');
    return currentPrice < cheapestPrice ? current : cheapest;
  });
}

/**
 * Filter hotels by rating
 */
export function filterByRating(
  offers: HotelOffer[],
  minRating: number
): HotelOffer[] {
  return offers.filter((offer) => {
    const rating = parseInt(offer.hotel.rating || '0');
    return rating >= minRating;
  });
}

/**
 * Sort hotels by price, rating, or name
 */
export function sortHotels(
  offers: HotelOffer[],
  sortBy: 'price' | 'rating' | 'name'
): HotelOffer[] {
  return [...offers].sort((a, b) => {
    switch (sortBy) {
      case 'price':
        return (
          parseFloat(a.offers?.[0]?.price?.total || '0') -
          parseFloat(b.offers?.[0]?.price?.total || '0')
        );
      case 'rating':
        return (
          parseInt(b.hotel.rating || '0') - parseInt(a.hotel.rating || '0')
        );
      case 'name':
        return a.hotel.name.localeCompare(b.hotel.name);
      default:
        return 0;
    }
  });
}

/**
 * Group hotels by price range for filtering UI
 */
export function groupByPriceRange(
  offers: HotelOffer[]
): Record<string, HotelOffer[]> {
  const groups: Record<string, HotelOffer[]> = {
    'budget': [],
    'moderate': [],
    'premium': [],
    'luxury': [],
  };

  offers.forEach((offer) => {
    const price = parseFloat(offer.offers?.[0]?.price?.total || '0');
    const nights = offer.offers?.[0]
      ? calculateNights(offer.offers[0].checkInDate, offer.offers[0].checkOutDate)
      : 1;
    const perNight = price / nights;

    if (perNight < 100) {
      groups.budget.push(offer);
    } else if (perNight < 200) {
      groups.moderate.push(offer);
    } else if (perNight < 400) {
      groups.premium.push(offer);
    } else {
      groups.luxury.push(offer);
    }
  });

  return groups;
}
