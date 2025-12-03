/**
 * Flight Search API Route
 *
 * GET /api/amadeus/flights/search
 *
 * Search for flight offers using Amadeus Flight Offers Search API.
 * Includes caching and rate limiting.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  searchFlights,
  transformFlightOffer,
  isAmadeusConfigured,
  isValidDate,
  isFutureDate,
  isValidIATACode,
  normalizeIATACode,
} from '@/lib/amadeus';
import type { FlightSearchParams, TravelClass } from '@/lib/amadeus/types';

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

    // Auth check (optional for now, can be enforced later)
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    // Parse query parameters
    const searchParams = request.nextUrl.searchParams;

    const origin = searchParams.get('origin');
    const destination = searchParams.get('destination');
    const departureDate = searchParams.get('departureDate');
    const returnDate = searchParams.get('returnDate');
    const adults = parseInt(searchParams.get('adults') || '1');
    const children = parseInt(searchParams.get('children') || '0');
    const infants = parseInt(searchParams.get('infants') || '0');
    const travelClass = searchParams.get('travelClass') as TravelClass | undefined;
    const nonStop = searchParams.get('nonStop') === 'true';
    const maxPrice = searchParams.get('maxPrice')
      ? parseInt(searchParams.get('maxPrice')!)
      : undefined;
    const max = parseInt(searchParams.get('max') || '10');
    const currencyCode = searchParams.get('currency') || 'USD';

    // Validate required parameters
    if (!origin || !destination || !departureDate) {
      return NextResponse.json(
        {
          error: 'Missing required parameters',
          required: ['origin', 'destination', 'departureDate'],
          received: { origin, destination, departureDate },
        },
        { status: 400 }
      );
    }

    // Validate IATA codes
    if (!isValidIATACode(origin)) {
      return NextResponse.json(
        { error: `Invalid origin IATA code: ${origin}. Must be 3 letters.` },
        { status: 400 }
      );
    }

    if (!isValidIATACode(destination)) {
      return NextResponse.json(
        { error: `Invalid destination IATA code: ${destination}. Must be 3 letters.` },
        { status: 400 }
      );
    }

    // Validate dates
    if (!isValidDate(departureDate)) {
      return NextResponse.json(
        { error: `Invalid departure date format: ${departureDate}. Use YYYY-MM-DD.` },
        { status: 400 }
      );
    }

    if (!isFutureDate(departureDate)) {
      return NextResponse.json(
        { error: 'Departure date must be in the future' },
        { status: 400 }
      );
    }

    if (returnDate) {
      if (!isValidDate(returnDate)) {
        return NextResponse.json(
          { error: `Invalid return date format: ${returnDate}. Use YYYY-MM-DD.` },
          { status: 400 }
        );
      }

      if (new Date(returnDate) < new Date(departureDate)) {
        return NextResponse.json(
          { error: 'Return date must be after departure date' },
          { status: 400 }
        );
      }
    }

    // Validate traveler counts
    if (adults < 1 || adults > 9) {
      return NextResponse.json(
        { error: 'Adults must be between 1 and 9' },
        { status: 400 }
      );
    }

    if (infants > adults) {
      return NextResponse.json(
        { error: 'Number of infants cannot exceed number of adults' },
        { status: 400 }
      );
    }

    // Build search params
    const params: FlightSearchParams = {
      origin: normalizeIATACode(origin),
      destination: normalizeIATACode(destination),
      departureDate,
      returnDate: returnDate || undefined,
      adults,
      children: children > 0 ? children : undefined,
      infants: infants > 0 ? infants : undefined,
      travelClass,
      nonStop,
      maxPrice,
      max: Math.min(max, 50), // Cap at 50 to conserve quota
      currencyCode,
    };

    // Search flights
    const result = await searchFlights(params);

    // Transform to display format
    const displayOffers = result.data.map((offer) =>
      transformFlightOffer(offer, result.dictionaries)
    );

    // Log API usage (if user is authenticated)
    if (user) {
      try {
        await supabase.from('api_request_logs').insert({
          user_id: user.id,
          api_name: 'amadeus',
          endpoint: '/flights/search',
          request_params: params,
          response_status: 200,
          response_time_ms: Date.now() - startTime,
          cache_hit: result.cached,
          result_count: result.data.length,
        });
      } catch (logError) {
        // Don't fail the request if logging fails
        console.error('[Amadeus] Failed to log API usage:', logError);
      }
    }

    return NextResponse.json({
      data: result.data,
      display: displayOffers,
      dictionaries: result.dictionaries,
      meta: {
        count: result.data.length,
        cached: result.cached,
        responseTime: Date.now() - startTime,
        params,
      },
    });
  } catch (error) {
    console.error('[Amadeus Flights] Search error:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    // Determine appropriate status code
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
        error: 'Failed to search flights',
        details: errorMessage,
        responseTime: Date.now() - startTime,
      },
      { status: statusCode }
    );
  }
}
