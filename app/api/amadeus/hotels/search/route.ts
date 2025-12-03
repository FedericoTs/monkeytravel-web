/**
 * Hotel Search API Route
 *
 * GET /api/amadeus/hotels/search
 *
 * Search for hotel offers using Amadeus Hotel APIs.
 * Includes caching and rate limiting.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  searchHotelOffers,
  transformHotelOffer,
  isAmadeusConfigured,
  isValidDate,
  isFutureDate,
  calculateNights,
} from '@/lib/amadeus';
import type { HotelSearchParams, BoardType, HotelAmenity } from '@/lib/amadeus/types';

export async function GET(request: NextRequest) {
  const startTime = Date.now();

  try {
    // Check if Amadeus is configured
    if (!isAmadeusConfigured()) {
      return NextResponse.json(
        { error: 'Amadeus API not configured' },
        { status: 503 }
      );
    }

    // Auth check
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

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
      return NextResponse.json(
        {
          error: 'Missing required parameters',
          required: 'Either cityCode OR (latitude AND longitude)',
          received: { cityCode, latitude, longitude },
        },
        { status: 400 }
      );
    }

    if (!checkInDate || !checkOutDate) {
      return NextResponse.json(
        {
          error: 'Missing required date parameters',
          required: ['checkInDate', 'checkOutDate'],
          received: { checkInDate, checkOutDate },
        },
        { status: 400 }
      );
    }

    // Validate dates
    if (!isValidDate(checkInDate)) {
      return NextResponse.json(
        { error: `Invalid check-in date format: ${checkInDate}. Use YYYY-MM-DD.` },
        { status: 400 }
      );
    }

    if (!isValidDate(checkOutDate)) {
      return NextResponse.json(
        { error: `Invalid check-out date format: ${checkOutDate}. Use YYYY-MM-DD.` },
        { status: 400 }
      );
    }

    if (!isFutureDate(checkInDate)) {
      return NextResponse.json(
        { error: 'Check-in date must be in the future' },
        { status: 400 }
      );
    }

    if (new Date(checkOutDate) <= new Date(checkInDate)) {
      return NextResponse.json(
        { error: 'Check-out date must be after check-in date' },
        { status: 400 }
      );
    }

    // Validate stay length (Amadeus limit is typically 30 nights)
    const nights = calculateNights(checkInDate, checkOutDate);
    if (nights > 30) {
      return NextResponse.json(
        { error: 'Maximum stay is 30 nights' },
        { status: 400 }
      );
    }

    // Validate adults
    if (adults < 1 || adults > 9) {
      return NextResponse.json(
        { error: 'Adults must be between 1 and 9' },
        { status: 400 }
      );
    }

    // Validate room quantity
    if (roomQuantity < 1 || roomQuantity > 9) {
      return NextResponse.json(
        { error: 'Room quantity must be between 1 and 9' },
        { status: 400 }
      );
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

    // Log API usage (if user is authenticated)
    if (user) {
      try {
        await supabase.from('api_request_logs').insert({
          user_id: user.id,
          api_name: 'amadeus',
          endpoint: '/hotels/search',
          request_params: params,
          response_status: 200,
          response_time_ms: Date.now() - startTime,
          cache_hit: result.cached,
          result_count: result.data.length,
        });
      } catch (logError) {
        console.error('[Amadeus] Failed to log API usage:', logError);
      }
    }

    return NextResponse.json({
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

    let statusCode = 500;
    if (errorMessage.includes('rate limit')) {
      statusCode = 429;
    } else if (errorMessage.includes('authentication')) {
      statusCode = 401;
    } else if (errorMessage.includes('request error')) {
      statusCode = 400;
    }

    return NextResponse.json(
      {
        error: 'Failed to search hotels',
        details: errorMessage,
        responseTime: Date.now() - startTime,
      },
      { status: statusCode }
    );
  }
}
