"use client";

/**
 * HotelSearch Component
 *
 * Search form for finding hotels at a destination.
 * Features:
 * - Activity-based geo search (prioritized when itinerary available)
 * - City-based search (fallback)
 * - Date selection
 * - Guest count
 * - Rating & amenity filters
 * - Real-time search via Amadeus API
 * - Proximity indicators showing distance from activities
 */

import { useState, useCallback, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import type { HotelOfferDisplay } from '@/lib/amadeus/types';
import type { ItineraryDay } from '@/types';
import { getHotelSearchCenter, formatDistance, getProximityLabel, calculateDistance, type GeoCenter, type Coordinates } from '@/lib/utils/geo';
import HotelCard from './HotelCard';

interface HotelSearchProps {
  tripDestination: string;
  tripDestinationCode?: string;  // IATA city code if known
  tripStartDate: string;
  tripEndDate: string;
  defaultGuests?: number;
  /** Trip itinerary for activity-based geo filtering */
  itinerary?: ItineraryDay[];
  onHotelSelect?: (hotel: HotelOfferDisplay) => void;
}

// Extended hotel display with distance info
interface HotelWithDistance extends HotelOfferDisplay {
  distanceFromCenter?: number;
  proximityLabel?: string;
  proximityColor?: string;
}

export default function HotelSearch({
  tripDestination,
  tripDestinationCode,
  tripStartDate,
  tripEndDate,
  defaultGuests = 2,
  itinerary,
  onHotelSelect,
}: HotelSearchProps) {
  const t = useTranslations('common.booking.hotels');

  // Search state
  const [hotels, setHotels] = useState<HotelWithDistance[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  // Guest & room settings
  const [guests, setGuests] = useState(defaultGuests);
  const [rooms, setRooms] = useState(1);

  // Filters
  const [sortBy, setSortBy] = useState<'price' | 'rating' | 'name' | 'distance'>('distance');
  const [minRating, setMinRating] = useState<number | null>(null);
  const [priceRange, setPriceRange] = useState<string | null>(null);

  // Calculate activity center from itinerary
  const geoCenter = useMemo<GeoCenter | null>(() => {
    if (!itinerary || itinerary.length === 0) return null;
    return getHotelSearchCenter(itinerary);
  }, [itinerary]);

  // Determine if we're using geo-based search
  const useGeoSearch = geoCenter !== null && geoCenter.coverage > 30; // Use geo if >30% activities have coordinates

  // Search hotels
  const searchHotels = useCallback(async () => {
    setLoading(true);
    setError(null);
    setHasSearched(true);

    try {
      const params = new URLSearchParams({
        checkInDate: tripStartDate,
        checkOutDate: tripEndDate,
        adults: guests.toString(),
        rooms: rooms.toString(),
      });

      // Use geo-based search if we have activity coordinates
      if (useGeoSearch && geoCenter) {
        params.append('latitude', geoCenter.center.lat.toString());
        params.append('longitude', geoCenter.center.lng.toString());
        params.append('radius', Math.ceil(geoCenter.radius).toString());
        params.append('radiusUnit', 'KM');
      } else {
        // Fall back to city-based search
        const cityCode = tripDestinationCode || tripDestination.substring(0, 3).toUpperCase();
        params.append('cityCode', cityCode);
      }

      if (minRating) {
        const ratings = Array.from({ length: 6 - minRating }, (_, i) => minRating + i);
        params.append('ratings', ratings.join(','));
      }

      if (priceRange) {
        params.append('priceRange', priceRange);
      }

      const response = await fetch(`/api/amadeus/hotels/search?${params}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || data.details || 'Failed to search hotels');
      }

      // Add distance information to hotels
      let hotelsWithDistance: HotelWithDistance[] = (data.display || []).map(
        (hotel: HotelOfferDisplay) => {
          if (geoCenter && hotel.latitude && hotel.longitude) {
            const hotelCoords: Coordinates = { lat: hotel.latitude, lng: hotel.longitude };
            const distance = calculateDistance(geoCenter.center, hotelCoords);
            const proximity = getProximityLabel(distance);
            return {
              ...hotel,
              distanceFromCenter: distance,
              proximityLabel: proximity.label,
              proximityColor: proximity.color,
            };
          }
          return hotel;
        }
      );

      // Sort results
      if (sortBy === 'distance' && geoCenter) {
        hotelsWithDistance = hotelsWithDistance.sort(
          (a, b) => (a.distanceFromCenter ?? 999) - (b.distanceFromCenter ?? 999)
        );
      } else if (sortBy === 'price') {
        hotelsWithDistance = hotelsWithDistance.sort(
          (a, b) => a.pricePerNight - b.pricePerNight
        );
      } else if (sortBy === 'rating') {
        hotelsWithDistance = hotelsWithDistance.sort(
          (a, b) => b.rating - a.rating
        );
      } else if (sortBy === 'name') {
        hotelsWithDistance = hotelsWithDistance.sort(
          (a, b) => a.name.localeCompare(b.name)
        );
      }

      setHotels(hotelsWithDistance);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
      setHotels([]);
    } finally {
      setLoading(false);
    }
  }, [tripDestination, tripDestinationCode, tripStartDate, tripEndDate, guests, rooms, minRating, priceRange, sortBy, useGeoSearch, geoCenter]);

  // Calculate nights
  const nights = Math.ceil(
    (new Date(tripEndDate).getTime() - new Date(tripStartDate).getTime()) /
      (1000 * 60 * 60 * 24)
  );

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-[var(--accent)] to-[var(--accent)]/80 px-6 py-4">
        <h3 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
          </svg>
          {t('findHotelsIn', { destination: tripDestination })}
        </h3>
        <p className="text-slate-700 text-sm mt-1">
          {tripStartDate} - {tripEndDate} ({nights} {nights === 1 ? t('night') : t('nights')})
        </p>
        {/* Geo-search indicator */}
        {useGeoSearch && geoCenter && (
          <div className="mt-2 flex items-center gap-2 text-xs bg-white/60 text-slate-700 px-2 py-1 rounded-full w-fit">
            <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span>
              {t('searchingNearActivities', { count: geoCenter.activityCount, radius: formatDistance(geoCenter.radius) })}
            </span>
          </div>
        )}
      </div>

      <div className="p-6 space-y-4">
        {/* Guest & Room Settings */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              {t('guests')}
            </label>
            <select
              value={guests}
              onChange={(e) => setGuests(parseInt(e.target.value))}
              className="w-full px-3 py-2.5 rounded-lg border border-slate-300 focus:border-[var(--primary)] outline-none"
            >
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <option key={n} value={n}>
                  {n} {n === 1 ? t('guest') : t('guestsPlural')}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              {t('rooms')}
            </label>
            <select
              value={rooms}
              onChange={(e) => setRooms(parseInt(e.target.value))}
              className="w-full px-3 py-2.5 rounded-lg border border-slate-300 focus:border-[var(--primary)] outline-none"
            >
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n} {n === 1 ? t('room') : t('roomsPlural')}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Filters Row */}
        <div className="flex flex-wrap gap-3">
          {/* Sort By */}
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            className="px-3 py-2 text-sm rounded-lg border border-slate-300 focus:border-[var(--primary)] outline-none"
          >
            {geoCenter && <option value="distance">{t('sortClosestToActivities')}</option>}
            <option value="price">{t('sortLowestPrice')}</option>
            <option value="rating">{t('sortHighestRating')}</option>
            <option value="name">{t('sortAZ')}</option>
          </select>

          {/* Rating Filter */}
          <select
            value={minRating ?? ''}
            onChange={(e) => setMinRating(e.target.value ? parseInt(e.target.value) : null)}
            className="px-3 py-2 text-sm rounded-lg border border-slate-300 focus:border-[var(--primary)] outline-none"
          >
            <option value="">{t('anyRating')}</option>
            <option value="5">{t('fiveStars')}</option>
            <option value="4">{t('fourPlusStars')}</option>
            <option value="3">{t('threePlusStars')}</option>
          </select>

          {/* Price Range Filter */}
          <select
            value={priceRange ?? ''}
            onChange={(e) => setPriceRange(e.target.value || null)}
            className="px-3 py-2 text-sm rounded-lg border border-slate-300 focus:border-[var(--primary)] outline-none"
          >
            <option value="">{t('anyPrice')}</option>
            <option value="0-100">{t('priceUnder100')}</option>
            <option value="100-200">{t('price100to200')}</option>
            <option value="200-400">{t('price200to400')}</option>
            <option value="400-1000">{t('price400plus')}</option>
          </select>
        </div>

        {/* Search Button */}
        <button
          onClick={searchHotels}
          disabled={loading}
          className="w-full bg-[var(--primary)] text-white py-3 rounded-lg font-medium hover:bg-[var(--primary)]/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
        >
          {loading ? (
            <>
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              {t('searching')}
            </>
          ) : (
            <>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              {t('searchHotels')}
            </>
          )}
        </button>

        {/* Error */}
        {error && (
          <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm flex items-start gap-2">
            <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {error}
          </div>
        )}

        {/* Results */}
        {hasSearched && !loading && !error && (
          <div className="mt-6 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-medium text-slate-900">
                {hotels.length === 1 ? t('hotelFound', { count: hotels.length }) : t('hotelsFound', { count: hotels.length })}
              </h4>
              {hotels.length > 0 && (
                <span className="text-xs text-slate-500">
                  {t('pricesPerNight')}
                </span>
              )}
            </div>

            {hotels.length > 0 ? (
              <div className="space-y-3">
                {hotels.map((hotel) => (
                  <HotelCard
                    key={hotel.id}
                    hotel={hotel}
                    nights={nights}
                    onSelect={() => onHotelSelect?.(hotel)}
                  />
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-slate-500">
                <svg className="w-12 h-12 mx-auto mb-3 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                </svg>
                <p>{t('noHotelsFound')}</p>
                <p className="text-sm mt-1">{t('tryAdjustingFilters')}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
