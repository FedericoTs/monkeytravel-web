"use client";

/**
 * FlightCard Component
 *
 * Displays a single flight offer with departure/arrival times,
 * duration, stops, airline info, and price.
 */

import type { FlightOfferDisplay } from '@/lib/amadeus/types';
import { AIRLINE_NAMES } from '@/lib/amadeus/types';

interface FlightCardProps {
  flight: FlightOfferDisplay;
  onSelect?: () => void;
  selected?: boolean;
}

export default function FlightCard({
  flight,
  onSelect,
  selected = false,
}: FlightCardProps) {
  const airlineName =
    flight.airlineName ||
    AIRLINE_NAMES[flight.airline] ||
    flight.airline;

  // Format time from ISO string
  const formatTime = (isoString: string) => {
    try {
      // Handle both full datetime strings and already formatted strings
      if (isoString.includes(',')) {
        return isoString.split(', ')[1] || isoString;
      }
      const date = new Date(isoString);
      return date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
    } catch {
      return isoString;
    }
  };

  // Format date for display
  const formatDate = (isoString: string) => {
    try {
      if (isoString.includes(',')) {
        return isoString.split(', ')[0] || '';
      }
      const date = new Date(isoString);
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return '';
    }
  };

  // Get stop text
  const getStopText = (stops: number) => {
    if (stops === 0) return 'Direct';
    if (stops === 1) return '1 stop';
    return `${stops} stops`;
  };

  // Get cabin class display
  const getCabinDisplay = (cabin: string) => {
    const cabins: Record<string, string> = {
      ECONOMY: 'Economy',
      PREMIUM_ECONOMY: 'Premium',
      BUSINESS: 'Business',
      FIRST: 'First',
    };
    return cabins[cabin] || cabin;
  };

  return (
    <div
      className={`
        border rounded-xl p-4 transition-all cursor-pointer
        ${selected
          ? 'border-[var(--primary)] bg-[var(--primary)]/5 ring-2 ring-[var(--primary)]/20'
          : 'border-slate-200 hover:border-[var(--primary)]/50 hover:shadow-md'
        }
      `}
      onClick={onSelect}
    >
      <div className="flex flex-col md:flex-row md:items-center gap-4">
        {/* Airline & Flight Info */}
        <div className="flex items-center gap-3 min-w-[140px]">
          {/* Airline logo placeholder */}
          <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center text-sm font-bold text-slate-600">
            {flight.airline}
          </div>
          <div>
            <p className="font-medium text-slate-900 text-sm">{airlineName}</p>
            <p className="text-xs text-slate-500">{flight.flightNumber}</p>
          </div>
        </div>

        {/* Flight Times & Route */}
        <div className="flex-1">
          {/* Outbound */}
          <div className="flex items-center gap-4">
            {/* Departure */}
            <div className="text-right min-w-[80px]">
              <p className="text-lg font-semibold text-slate-900">
                {formatTime(flight.outbound.departure.time)}
              </p>
              <p className="text-xs text-slate-500">
                {flight.departureAirport}
              </p>
            </div>

            {/* Duration & Stops */}
            <div className="flex-1 px-4">
              <div className="flex items-center gap-2">
                <div className="flex-1 border-t border-slate-300 border-dashed relative">
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 w-2 h-2 bg-slate-400 rounded-full" />
                  <div className="absolute right-0 top-1/2 -translate-y-1/2 w-2 h-2 bg-slate-400 rounded-full" />
                  {flight.stops > 0 && (
                    <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex gap-1">
                      {Array.from({ length: flight.stops }).map((_, i) => (
                        <div
                          key={i}
                          className="w-1.5 h-1.5 bg-orange-400 rounded-full"
                        />
                      ))}
                    </div>
                  )}
                </div>
                <svg className="w-4 h-4 text-slate-400" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z" />
                </svg>
              </div>
              <div className="flex justify-between mt-1 text-xs">
                <span className="text-slate-500">{flight.outbound.duration}</span>
                <span className={`${flight.stops === 0 ? 'text-green-600' : 'text-orange-600'}`}>
                  {getStopText(flight.stops)}
                </span>
              </div>
            </div>

            {/* Arrival */}
            <div className="min-w-[80px]">
              <p className="text-lg font-semibold text-slate-900">
                {formatTime(flight.outbound.arrival.time)}
              </p>
              <p className="text-xs text-slate-500">
                {flight.arrivalAirport}
              </p>
            </div>
          </div>

          {/* Return flight (if not one-way) */}
          {flight.inbound && (
            <div className="flex items-center gap-4 mt-3 pt-3 border-t border-slate-100">
              <div className="text-right min-w-[80px]">
                <p className="text-lg font-semibold text-slate-900">
                  {formatTime(flight.inbound.departure.time)}
                </p>
                <p className="text-xs text-slate-500">
                  {flight.arrivalAirport}
                </p>
              </div>

              <div className="flex-1 px-4">
                <div className="flex items-center gap-2">
                  <div className="flex-1 border-t border-slate-300 border-dashed relative">
                    <div className="absolute left-0 top-1/2 -translate-y-1/2 w-2 h-2 bg-slate-400 rounded-full" />
                    <div className="absolute right-0 top-1/2 -translate-y-1/2 w-2 h-2 bg-slate-400 rounded-full" />
                  </div>
                  <svg className="w-4 h-4 text-slate-400 rotate-180" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z" />
                  </svg>
                </div>
                <p className="text-center text-xs text-slate-500 mt-1">
                  {flight.inbound.duration}
                </p>
              </div>

              <div className="min-w-[80px]">
                <p className="text-lg font-semibold text-slate-900">
                  {formatTime(flight.inbound.arrival.time)}
                </p>
                <p className="text-xs text-slate-500">
                  {flight.departureAirport}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Price & Booking */}
        <div className="flex flex-row md:flex-col items-center md:items-end gap-2 md:gap-1 min-w-[100px]">
          <div className="text-right">
            <p className="text-2xl font-bold text-slate-900">
              ${Math.round(flight.price)}
            </p>
            <p className="text-xs text-slate-500">
              {getCabinDisplay(flight.cabin)}
            </p>
          </div>
          {flight.seatsAvailable && flight.seatsAvailable < 5 && (
            <span className="text-xs text-orange-600 font-medium">
              {flight.seatsAvailable} left
            </span>
          )}
        </div>
      </div>

      {/* Segment details (expandable in future) */}
      {flight.outbound.segments.length > 1 && (
        <div className="mt-3 pt-3 border-t border-slate-100">
          <p className="text-xs text-slate-500">
            Via:{' '}
            {flight.outbound.segments
              .slice(0, -1)
              .map((seg) => seg.arrival.airport)
              .join(', ')}
          </p>
        </div>
      )}
    </div>
  );
}
