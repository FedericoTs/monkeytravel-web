"use client";

/**
 * HotelCard Component
 *
 * Displays a single hotel offer with image, name, rating,
 * amenities, room details, pricing, and proximity to activities.
 */

import type { HotelOfferDisplay } from '@/lib/amadeus/types';
import { formatDistance } from '@/lib/utils/geo';

// Extended hotel type with proximity info
interface HotelWithProximity extends HotelOfferDisplay {
  distanceFromCenter?: number;
  proximityLabel?: string;
  proximityColor?: string;
}

interface HotelCardProps {
  hotel: HotelWithProximity;
  nights: number;
  onSelect?: () => void;
  selected?: boolean;
}

export default function HotelCard({
  hotel,
  nights,
  onSelect,
  selected = false,
}: HotelCardProps) {
  // Render star rating
  const renderStars = (rating: number) => {
    return (
      <div className="flex items-center gap-0.5">
        {Array.from({ length: 5 }).map((_, i) => (
          <svg
            key={i}
            className={`w-4 h-4 ${i < rating ? 'text-yellow-400' : 'text-slate-200'}`}
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
          </svg>
        ))}
      </div>
    );
  };

  // Format amenities for display
  const formatAmenity = (amenity: string) => {
    return amenity
      .replace(/_/g, ' ')
      .toLowerCase()
      .replace(/\b\w/g, (l) => l.toUpperCase());
  };

  // Get display amenities (max 4)
  const displayAmenities = hotel.amenities?.slice(0, 4) || [];

  // Get cancellation badge color
  const getCancellationBadge = () => {
    if (!hotel.cancellationPolicy) return null;

    const isFreeCancellation = hotel.cancellationPolicy.toLowerCase().includes('free');

    return (
      <span
        className={`text-xs px-2 py-1 rounded-full ${
          isFreeCancellation
            ? 'bg-green-100 text-green-700'
            : 'bg-orange-100 text-orange-700'
        }`}
      >
        {isFreeCancellation ? 'Free cancellation' : hotel.cancellationPolicy}
      </span>
    );
  };

  return (
    <div
      className={`
        border rounded-xl overflow-hidden transition-all cursor-pointer
        ${selected
          ? 'border-[var(--primary)] ring-2 ring-[var(--primary)]/20'
          : 'border-slate-200 hover:border-[var(--primary)]/50 hover:shadow-md'
        }
      `}
      onClick={onSelect}
    >
      <div className="flex flex-col sm:flex-row">
        {/* Hotel Image */}
        <div className="sm:w-48 h-40 sm:h-auto relative flex-shrink-0 bg-slate-100">
          {hotel.image ? (
            <img
              src={hotel.image}
              alt={hotel.name}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-slate-400">
              <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
            </div>
          )}

          {/* Rating badge on image */}
          {hotel.rating > 0 && (
            <div className="absolute top-2 left-2 bg-white/90 backdrop-blur-sm rounded-lg px-2 py-1">
              {renderStars(hotel.rating)}
            </div>
          )}

          {/* Proximity badge on image */}
          {hotel.distanceFromCenter !== undefined && (
            <div className="absolute bottom-2 left-2 bg-white/90 backdrop-blur-sm rounded-lg px-2 py-1 flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5 text-[var(--primary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span className={`text-xs font-medium ${hotel.proximityColor || 'text-slate-600'}`}>
                {formatDistance(hotel.distanceFromCenter)}
              </span>
            </div>
          )}
        </div>

        {/* Hotel Details */}
        <div className="flex-1 p-4">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              {/* Hotel Name */}
              <h4 className="font-semibold text-slate-900 text-lg truncate">
                {hotel.name}
              </h4>

              {/* Address */}
              {hotel.address && (
                <p className="text-sm text-slate-500 truncate mt-0.5">
                  {hotel.address}
                </p>
              )}

              {/* Proximity to activities */}
              {hotel.proximityLabel && hotel.distanceFromCenter !== undefined && (
                <div className="mt-1 flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5 text-[var(--primary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  <span className={`text-sm ${hotel.proximityColor || 'text-slate-600'}`}>
                    {hotel.proximityLabel} to your activities
                  </span>
                  <span className="text-xs text-slate-400">
                    ({formatDistance(hotel.distanceFromCenter)})
                  </span>
                </div>
              )}

              {/* Room Type */}
              <div className="mt-2 flex items-center gap-2 text-sm text-slate-600">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                </svg>
                <span>{hotel.roomType}</span>
                {hotel.bedCount > 0 && (
                  <span className="text-slate-400">
                    &bull; {hotel.bedCount} {hotel.bedType}
                  </span>
                )}
              </div>

              {/* Board Type */}
              {hotel.boardType && (
                <div className="mt-1 text-sm text-slate-600">
                  <span className="text-green-600">
                    {hotel.boardType === 'BREAKFAST'
                      ? 'Breakfast included'
                      : hotel.boardType === 'HALF_BOARD'
                      ? 'Half board'
                      : hotel.boardType === 'FULL_BOARD'
                      ? 'Full board'
                      : hotel.boardType === 'ALL_INCLUSIVE'
                      ? 'All inclusive'
                      : 'Room only'}
                  </span>
                </div>
              )}

              {/* Amenities */}
              {displayAmenities.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {displayAmenities.map((amenity) => (
                    <span
                      key={amenity}
                      className="text-xs px-2 py-1 bg-slate-100 text-slate-600 rounded"
                    >
                      {formatAmenity(amenity)}
                    </span>
                  ))}
                  {(hotel.amenities?.length || 0) > 4 && (
                    <span className="text-xs px-2 py-1 text-slate-500">
                      +{(hotel.amenities?.length || 0) - 4} more
                    </span>
                  )}
                </div>
              )}

              {/* Cancellation Policy */}
              {hotel.cancellationPolicy && (
                <div className="mt-3">
                  {getCancellationBadge()}
                </div>
              )}
            </div>

            {/* Price Section */}
            <div className="flex flex-row sm:flex-col items-center sm:items-end justify-between sm:justify-start gap-2 sm:min-w-[120px] sm:text-right border-t sm:border-t-0 pt-3 sm:pt-0 mt-2 sm:mt-0">
              <div>
                <p className="text-2xl font-bold text-slate-900">
                  ${Math.round(hotel.pricePerNight)}
                </p>
                <p className="text-xs text-slate-500">per night</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-medium text-slate-700">
                  ${Math.round(hotel.totalPrice)} total
                </p>
                <p className="text-xs text-slate-400">
                  for {nights} {nights === 1 ? 'night' : 'nights'}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
