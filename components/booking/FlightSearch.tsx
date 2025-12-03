"use client";

/**
 * FlightSearch Component
 *
 * Search form for finding flights to a destination.
 * Features:
 * - Airport/city autocomplete
 * - Date selection
 * - Passenger count
 * - Real-time search via Amadeus API
 */

import { useState, useCallback, useEffect } from 'react';
import { useDebounce } from '@/hooks/useDebounce';
import type { FlightOfferDisplay, LocationResult } from '@/lib/amadeus/types';
import FlightCard from './FlightCard';

interface FlightSearchProps {
  tripDestination: string;
  tripDestinationCode?: string;  // IATA code if known
  tripStartDate: string;
  tripEndDate: string;
  onFlightSelect?: (flight: FlightOfferDisplay) => void;
}

export default function FlightSearch({
  tripDestination,
  tripDestinationCode,
  tripStartDate,
  tripEndDate,
  onFlightSelect,
}: FlightSearchProps) {
  // Origin input state
  const [originInput, setOriginInput] = useState('');
  const [originSuggestions, setOriginSuggestions] = useState<LocationResult[]>([]);
  const [selectedOrigin, setSelectedOrigin] = useState<LocationResult | null>(null);
  const [showOriginDropdown, setShowOriginDropdown] = useState(false);

  // Search state
  const [flights, setFlights] = useState<FlightOfferDisplay[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  // Filters
  const [sortBy, setSortBy] = useState<'price' | 'duration' | 'departure'>('price');
  const [maxStops, setMaxStops] = useState<number | null>(null);

  const debouncedOrigin = useDebounce(originInput, 300);

  // Fetch airport/city suggestions
  const fetchSuggestions = useCallback(async (keyword: string) => {
    if (keyword.length < 2) {
      setOriginSuggestions([]);
      return;
    }

    setLoadingSuggestions(true);
    try {
      const response = await fetch(
        `/api/amadeus/locations/search?keyword=${encodeURIComponent(keyword)}`
      );
      const data = await response.json();
      setOriginSuggestions(data.data || []);
    } catch {
      setOriginSuggestions([]);
    } finally {
      setLoadingSuggestions(false);
    }
  }, []);

  // Trigger suggestions fetch when debounced input changes
  useEffect(() => {
    if (debouncedOrigin && debouncedOrigin !== selectedOrigin?.name) {
      fetchSuggestions(debouncedOrigin);
    }
  }, [debouncedOrigin, fetchSuggestions, selectedOrigin?.name]);

  // Search flights
  const searchFlights = async () => {
    if (!selectedOrigin) {
      setError('Please select a departure city or airport');
      return;
    }

    // Determine destination code
    const destinationCode = tripDestinationCode || tripDestination.substring(0, 3).toUpperCase();

    setLoading(true);
    setError(null);
    setHasSearched(true);

    try {
      const params = new URLSearchParams({
        origin: selectedOrigin.iataCode,
        destination: destinationCode,
        departureDate: tripStartDate,
        returnDate: tripEndDate,
        adults: '1',
        max: '15',
      });

      if (maxStops !== null) {
        params.append('nonStop', maxStops === 0 ? 'true' : 'false');
      }

      const response = await fetch(`/api/amadeus/flights/search?${params}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || data.details || 'Failed to search flights');
      }

      // Sort results
      let sortedFlights = data.display || [];
      if (sortBy === 'price') {
        sortedFlights = sortedFlights.sort(
          (a: FlightOfferDisplay, b: FlightOfferDisplay) => a.price - b.price
        );
      } else if (sortBy === 'duration') {
        sortedFlights = sortedFlights.sort(
          (a: FlightOfferDisplay, b: FlightOfferDisplay) =>
            parseDuration(a.duration) - parseDuration(b.duration)
        );
      } else if (sortBy === 'departure') {
        sortedFlights = sortedFlights.sort(
          (a: FlightOfferDisplay, b: FlightOfferDisplay) =>
            new Date(a.departureTime).getTime() - new Date(b.departureTime).getTime()
        );
      }

      // Filter by stops if set
      if (maxStops !== null) {
        sortedFlights = sortedFlights.filter(
          (f: FlightOfferDisplay) => f.stops <= maxStops
        );
      }

      setFlights(sortedFlights);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
      setFlights([]);
    } finally {
      setLoading(false);
    }
  };

  // Parse duration string to minutes for sorting
  const parseDuration = (duration: string): number => {
    const match = duration.match(/(\d+)h\s*(\d+)?m?/);
    if (!match) return 0;
    const hours = parseInt(match[1] || '0');
    const minutes = parseInt(match[2] || '0');
    return hours * 60 + minutes;
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-[var(--primary)] to-[var(--primary)]/80 px-6 py-4">
        <h3 className="text-lg font-semibold text-white flex items-center gap-2">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
          </svg>
          Find Flights to {tripDestination}
        </h3>
        <p className="text-white/80 text-sm mt-1">
          {tripStartDate} - {tripEndDate}
        </p>
      </div>

      <div className="p-6 space-y-4">
        {/* Origin Input with Autocomplete */}
        <div className="relative">
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Departing from
          </label>
          <div className="relative">
            <input
              type="text"
              value={originInput}
              onChange={(e) => {
                setOriginInput(e.target.value);
                setShowOriginDropdown(true);
                if (selectedOrigin && e.target.value !== `${selectedOrigin.name} (${selectedOrigin.iataCode})`) {
                  setSelectedOrigin(null);
                }
              }}
              onFocus={() => setShowOriginDropdown(true)}
              placeholder="Enter city or airport..."
              className="w-full px-4 py-3 rounded-lg border border-slate-300 focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 outline-none transition-all"
            />
            {loadingSuggestions && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                <div className="w-5 h-5 border-2 border-[var(--primary)]/30 border-t-[var(--primary)] rounded-full animate-spin" />
              </div>
            )}
          </div>

          {/* Suggestions Dropdown */}
          {showOriginDropdown && originSuggestions.length > 0 && (
            <div className="absolute z-20 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-60 overflow-auto">
              {originSuggestions.map((loc) => (
                <button
                  key={`${loc.iataCode}-${loc.id}`}
                  onClick={() => {
                    setSelectedOrigin(loc);
                    setOriginInput(`${loc.name} (${loc.iataCode})`);
                    setShowOriginDropdown(false);
                    setOriginSuggestions([]);
                  }}
                  className="w-full px-4 py-3 text-left hover:bg-slate-50 flex items-center justify-between border-b border-slate-100 last:border-0"
                >
                  <div>
                    <span className="font-medium text-slate-900">{loc.name}</span>
                    <span className="ml-2 text-[var(--primary)] font-mono">
                      ({loc.iataCode})
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-xs text-slate-500 block">
                      {loc.address?.cityName}
                    </span>
                    <span className="text-xs text-slate-400">
                      {loc.address?.countryName}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Filters Row */}
        <div className="flex flex-wrap gap-3">
          {/* Sort By */}
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            className="px-3 py-2 text-sm rounded-lg border border-slate-300 focus:border-[var(--primary)] outline-none"
          >
            <option value="price">Sort: Cheapest</option>
            <option value="duration">Sort: Fastest</option>
            <option value="departure">Sort: Departure</option>
          </select>

          {/* Stops Filter */}
          <select
            value={maxStops ?? ''}
            onChange={(e) => setMaxStops(e.target.value ? parseInt(e.target.value) : null)}
            className="px-3 py-2 text-sm rounded-lg border border-slate-300 focus:border-[var(--primary)] outline-none"
          >
            <option value="">Any stops</option>
            <option value="0">Direct only</option>
            <option value="1">1 stop max</option>
            <option value="2">2 stops max</option>
          </select>
        </div>

        {/* Search Button */}
        <button
          onClick={searchFlights}
          disabled={loading || !selectedOrigin}
          className="w-full bg-[var(--primary)] text-white py-3 rounded-lg font-medium hover:bg-[var(--primary)]/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
        >
          {loading ? (
            <>
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Searching...
            </>
          ) : (
            <>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              Search Flights
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
                {flights.length} {flights.length === 1 ? 'flight' : 'flights'} found
              </h4>
              {flights.length > 0 && (
                <span className="text-xs text-slate-500">
                  Prices include all taxes and fees
                </span>
              )}
            </div>

            {flights.length > 0 ? (
              <div className="space-y-3">
                {flights.map((flight) => (
                  <FlightCard
                    key={flight.id}
                    flight={flight}
                    onSelect={() => onFlightSelect?.(flight)}
                  />
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-slate-500">
                <svg className="w-12 h-12 mx-auto mb-3 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
                <p>No flights found for these dates.</p>
                <p className="text-sm mt-1">Try adjusting your search criteria.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
