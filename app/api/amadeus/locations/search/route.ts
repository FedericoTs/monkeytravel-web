/**
 * Location/Airport Search API Route
 *
 * GET /api/amadeus/locations/search
 *
 * Search for airports and cities using Amadeus Airport & City Search API.
 * Used for autocomplete in flight search forms.
 * Includes caching (24h TTL since locations rarely change).
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getAmadeusClient,
  withAmadeusErrorHandling,
  enqueueRequest,
  getCacheKey,
  getFromCache,
  setCache,
  isAmadeusConfigured,
} from '@/lib/amadeus';
import type { LocationResult } from '@/lib/amadeus/types';

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

    // Parse query parameters
    const searchParams = request.nextUrl.searchParams;
    const keyword = searchParams.get('keyword');
    const subType = searchParams.get('subType') || 'CITY,AIRPORT';
    const countryCode = searchParams.get('countryCode');
    const limit = parseInt(searchParams.get('limit') || '10');

    // Validate keyword
    if (!keyword || keyword.length < 2) {
      return NextResponse.json({
        data: [],
        meta: {
          count: 0,
          message: 'Keyword must be at least 2 characters',
        },
      });
    }

    // Check cache first
    const cacheParams = { keyword: keyword.toLowerCase(), subType, countryCode };
    const cacheKey = getCacheKey('locations', cacheParams);
    const cached = getFromCache<{ data: LocationResult[] }>(cacheKey);

    if (cached) {
      return NextResponse.json({
        ...cached,
        meta: {
          count: cached.data.length,
          cached: true,
          responseTime: Date.now() - startTime,
        },
      });
    }

    // Make API request with rate limiting
    const result = await enqueueRequest(async () => {
      return withAmadeusErrorHandling(async () => {
        const amadeus = getAmadeusClient();

        const response = await amadeus.referenceData.locations.get({
          keyword,
          subType,
          ...(countryCode && { countryCode }),
          'page[limit]': Math.min(limit, 20), // Cap at 20
        });

        return { data: response.data as LocationResult[] };
      }, 'searchLocations');
    });

    // Cache the result (24h TTL for locations)
    setCache(cacheKey, result, 'locations');

    // Sort by relevance (traveler score)
    const sortedData = result.data.sort((a, b) => {
      const scoreA = a.analytics?.travelers?.score || 0;
      const scoreB = b.analytics?.travelers?.score || 0;
      return scoreB - scoreA;
    });

    return NextResponse.json({
      data: sortedData,
      meta: {
        count: sortedData.length,
        cached: false,
        responseTime: Date.now() - startTime,
        keyword,
      },
    });
  } catch (error) {
    console.error('[Amadeus Locations] Search error:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    // Return empty array instead of error for autocomplete UX
    // Errors should not break the typing experience
    return NextResponse.json({
      data: [],
      meta: {
        count: 0,
        error: errorMessage,
        responseTime: Date.now() - startTime,
      },
    });
  }
}
