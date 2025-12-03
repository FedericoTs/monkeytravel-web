"use client";

import { useState, useEffect } from "react";
import ImageCarousel from "./ui/ImageCarousel";
/* eslint-disable @next/next/no-img-element */

interface PlacePhoto {
  url: string;
  thumbnailUrl: string;
  width: number;
  height: number;
  attribution: string;
}

interface PlaceData {
  placeId: string;
  name: string;
  address: string;
  location: { latitude: number; longitude: number };
  photos: PlacePhoto[];
  rating?: number;
  reviewCount?: number;
  website?: string;
  googleMapsUrl?: string;
  priceLevel?: number;
  priceLevelSymbol?: string;
  priceLevelLabel?: string;
  priceRange?: string;
  openNow?: boolean;
  openingHours?: string[];
}

interface PlaceGalleryProps {
  placeName: string;
  placeAddress: string;
  className?: string;
  maxPhotos?: number;
  showRating?: boolean;
  compact?: boolean;
}

export default function PlaceGallery({
  placeName,
  placeAddress,
  className = "",
  maxPhotos = 4,
  showRating = true,
  compact = false,
}: PlaceGalleryProps) {
  const [placeData, setPlaceData] = useState<PlaceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState<number | null>(null);

  useEffect(() => {
    const fetchPlaceData = async () => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch("/api/places", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: `${placeName} ${placeAddress}`,
            maxPhotos,
          }),
        });

        if (!response.ok) {
          throw new Error("Failed to fetch place data");
        }

        const data = await response.json();
        setPlaceData(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    };

    if (placeName) {
      fetchPlaceData();
    }
  }, [placeName, placeAddress, maxPhotos]);

  if (loading) {
    return (
      <div className={`${className}`}>
        <div className="flex gap-2 overflow-hidden">
          {Array.from({ length: compact ? 2 : 4 }).map((_, i) => (
            <div
              key={i}
              className={`${compact ? "w-16 h-16" : "w-24 h-24"} bg-slate-200 rounded-lg animate-pulse flex-shrink-0`}
            />
          ))}
        </div>
      </div>
    );
  }

  if (error || !placeData?.photos?.length) {
    return null; // Silently fail - don't show anything if no photos
  }

  return (
    <>
      <div className={`${className} w-full overflow-hidden`}>
        {/* Info Badges */}
        {showRating && (placeData.rating || placeData.priceLevelSymbol) && (
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 mb-2">
            {/* Rating */}
            {placeData.rating && (
              <div className="flex items-center gap-1 px-2 py-0.5 bg-amber-50 rounded-full border border-amber-100">
                <svg className="w-3.5 h-3.5 text-amber-500" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                </svg>
                <span className="text-xs font-medium text-amber-700">
                  {placeData.rating.toFixed(1)}
                </span>
                {placeData.reviewCount && (
                  <span className="text-xs text-slate-500">
                    ({placeData.reviewCount.toLocaleString()})
                  </span>
                )}
              </div>
            )}

            {/* Verified Price Level */}
            {placeData.priceLevelSymbol && (
              <div className="flex items-center gap-1 px-2 py-0.5 bg-green-50 rounded-full border border-green-100" title={`Verified: ${placeData.priceLevelLabel}`}>
                <svg className="w-3 h-3 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                <span className="text-xs font-semibold text-green-700">
                  {placeData.priceLevelSymbol}
                </span>
              </div>
            )}

            {/* Price Range if available */}
            {placeData.priceRange && (
              <span className="text-xs text-slate-600 bg-slate-100 px-2 py-0.5 rounded-full">
                {placeData.priceRange}
              </span>
            )}

            {/* Open Now status */}
            {placeData.openNow !== undefined && (
              <span className={`text-xs px-2 py-0.5 rounded-full ${
                placeData.openNow
                  ? "bg-green-50 text-green-700 border border-green-100"
                  : "bg-red-50 text-red-700 border border-red-100"
              }`}>
                {placeData.openNow ? "Open Now" : "Closed"}
              </span>
            )}

            {/* Website link */}
            {placeData.website && (
              <a
                href={placeData.website}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-[var(--primary)] hover:underline"
              >
                Website
              </a>
            )}
          </div>
        )}

        {/* Photo Grid */}
        <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
          {placeData.photos.map((photo, idx) => (
            <button
              key={idx}
              onClick={() => setSelectedPhotoIndex(idx)}
              className={`${
                compact ? "w-16 h-16" : "w-20 h-20 sm:w-24 sm:h-24"
              } flex-shrink-0 rounded-xl overflow-hidden relative group cursor-pointer transition-all duration-300 hover:scale-105 hover:shadow-lg active:scale-95 ring-1 ring-black/5`}
            >
              <img
                src={photo.thumbnailUrl}
                alt={`${placeName} photo ${idx + 1}`}
                className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                loading="lazy"
              />
              {/* Gradient overlay on hover */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-all duration-300" />
              {/* Expand icon */}
              <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300">
                <div className="w-9 h-9 rounded-full bg-white/90 backdrop-blur-sm flex items-center justify-center shadow-lg transform scale-75 group-hover:scale-100 transition-transform duration-300">
                  <svg
                    className="w-4 h-4 text-slate-700"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5v-4m0 4h-4m4 0l-5-5"
                    />
                  </svg>
                </div>
              </div>
              {/* Photo number badge */}
              <div className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded-md bg-black/50 backdrop-blur-sm text-[10px] font-medium text-white opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                {idx + 1}/{placeData.photos.length}
              </div>
            </button>
          ))}
          {/* View all button if many photos */}
          {placeData.photos.length > 4 && (
            <button
              onClick={() => setSelectedPhotoIndex(0)}
              className={`${
                compact ? "w-16 h-16" : "w-20 h-20 sm:w-24 sm:h-24"
              } flex-shrink-0 rounded-xl overflow-hidden relative group cursor-pointer transition-all duration-300 hover:scale-105 active:scale-95 bg-gradient-to-br from-[var(--primary)] to-[var(--primary-dark)] flex items-center justify-center`}
            >
              <div className="text-center">
                <svg className="w-5 h-5 mx-auto text-white/90 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                </svg>
                <span className="text-xs font-semibold text-white">View All</span>
              </div>
            </button>
          )}
        </div>
      </div>

      {/* Image Carousel Lightbox */}
      {selectedPhotoIndex !== null && placeData.photos.length > 0 && (
        <ImageCarousel
          images={placeData.photos.map((photo) => ({
            url: photo.url,
            thumbnailUrl: photo.thumbnailUrl,
            alt: `${placeName} photo`,
            attribution: photo.attribution,
          }))}
          initialIndex={selectedPhotoIndex}
          onClose={() => setSelectedPhotoIndex(null)}
          placeName={placeName}
        />
      )}
    </>
  );
}
