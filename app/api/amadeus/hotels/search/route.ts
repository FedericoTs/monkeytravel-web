/**
 * Hotel Search API Route
 *
 * GET /api/amadeus/hotels/search
 *
 * Search for hotel offers using Amadeus Hotel APIs.
 * Includes caching and rate limiting.
 *
 * Note: Vercel Hobby plan has 10s timeout. We optimize by:
 * - Limiting hotel count to 5
 * - Skipping non-essential auth/logging
 */

import { NextRequest } from 'next/server';
import {
  searchHotelOffers,
  transformHotelOffer,
  isAmadeusConfigured,
  isValidDate,
  isFutureDate,
  calculateNights,
} from '@/lib/amadeus';
import type { HotelSearchParams, BoardType, HotelAmenity } from '@/lib/amadeus/types';
import { errors, apiSuccess, apiError, getErrorStatus } from "@/lib/api/response-wrapper";

export async function GET(request: NextRequest) {
  const startTime = Date.now();

  try {
    // Check if Amadeus is configured
    if (!isAmadeusConfigured()) {
      return errors.serviceUnavailable('Amadeus API not configured');
    }

    // Skip auth check to save time (hotel search is read-only)

    // Parse query parameters
    const searchParams = request.nextUrl.searchParams;

    const cityCode = searchParams.get('cityCode');
    const latitude = searchParams.get('latitude')
      ? parseFloat(searchParams.get('latitude')!)
      : undefined;
    const longitude = searchParams.get('longitude')
      ? parseFloat(searchParams.get('longitude')!)
      : undefined;
    const checkInDate = searchParams.get('checkInDate');
    const checkOutDate = searchParams.get('checkOutDate');
    const adults = parseInt(searchParams.get('adults') || '2');
    const roomQuantity = parseInt(searchParams.get('rooms') || '1');
    const ratings = searchParams.get('ratings')?.split(',');
    const priceRange = searchParams.get('priceRange');
    const currency = searchParams.get('currency') || 'USD';
    const boardType = searchParams.get('boardType') as BoardType | undefined;
    const amenities = searchParams.get('amenities')?.split(',') as HotelAmenity[] | undefined;
    const radius = searchParams.get('radius')
      ? parseInt(searchParams.get('radius')!)
      : undefined;
    const radiusUnit = (searchParams.get('radiusUnit') || 'KM') as 'KM' | 'MILE';

    // Validate required parameters
    if (!cityCode && (!latitude || !longitude)) {
      return errors.badRequest('Missing required parameters', {
        required: 'Either cityCode OR (latitude AND longitude)',
        received: { cityCode, latitude, longitude },
      });
    }

    if (!checkInDate || !checkOutDate) {
      return errors.badRequest('Missing required date parameters', {
        required: ['checkInDate', 'checkOutDate'],
        received: { checkInDate, checkOutDate },
      });
    }

    // Validate dates
    if (!isValidDate(checkInDate)) {
      return errors.badRequest(`Invalid check-in date format: ${checkInDate}. Use YYYY-MM-DD.`);
    }

    if (!isValidDate(checkOutDate)) {
      return errors.badRequest(`Invalid check-out date format: ${checkOutDate}. Use YYYY-MM-DD.`);
    }

    if (!isFutureDate(checkInDate)) {
      return errors.badRequest('Check-in date must be in the future');
    }

    if (new Date(checkOutDate) <= new Date(checkInDate)) {
      return errors.badRequest('Check-out date must be after check-in date');
    }

    // Validate stay length (Amadeus limit is typically 30 nights)
    const nights = calculateNights(checkInDate, checkOutDate);
    if (nights > 30) {
      return errors.badRequest('Maximum stay is 30 nights');
    }

    // Validate adults
    if (adults < 1 || adults > 9) {
      return errors.badRequest('Adults must be between 1 and 9');
    }

    // Validate room quantity
    if (roomQuantity < 1 || roomQuantity > 9) {
      return errors.badRequest('Room quantity must be between 1 and 9');
    }

    // Build search params
    const params: HotelSearchParams = {
      cityCode: cityCode || undefined,
      latitude,
      longitude,
      radius,
      radiusUnit,
      checkInDate,
      checkOutDate,
      adults,
      roomQuantity,
      ratings,
      priceRange: priceRange || undefined,
      currency,
      boardType,
      amenities,
      bestRateOnly: true,
    };

    // Search hotels
    const result = await searchHotelOffers(params);

    // Transform to display format
    const displayOffers = result.data
      .map((offer) => transformHotelOffer(offer))
      .filter(Boolean);

    // Skip API logging to save time on Hobby plan timeout

    return apiSuccess({
      data: result.data,
      display: displayOffers,
      meta: {
        count: result.data.length,
        displayCount: displayOffers.length,
        cached: result.cached,
        responseTime: Date.now() - startTime,
        nights,
        params: {
          cityCode,
          checkInDate,
          checkOutDate,
          adults,
          rooms: roomQuantity,
        },
      },
    });
  } catch (error) {
    console.error('[Amadeus Hotels] Search error:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const statusCode = getErrorStatus(errorMessage);

    return apiError('Failed to search hotels', {
      status: statusCode,
      context: {
        details: errorMessage,
        responseTime: Date.now() - startTime,
      },
      category: 'Amadeus Hotels',
    });
  }
}
