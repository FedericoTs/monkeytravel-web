"use client";

import { useState, useEffect, useCallback } from "react";
import Image from "next/image";

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

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (selectedPhotoIndex === null || !placeData?.photos) return;

      if (e.key === "Escape") {
        setSelectedPhotoIndex(null);
      } else if (e.key === "ArrowRight") {
        setSelectedPhotoIndex((prev) =>
          prev !== null ? (prev + 1) % placeData.photos.length : 0
        );
      } else if (e.key === "ArrowLeft") {
        setSelectedPhotoIndex((prev) =>
          prev !== null
            ? (prev - 1 + placeData.photos.length) % placeData.photos.length
            : 0
        );
      }
    },
    [selectedPhotoIndex, placeData?.photos]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

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
      <div className={`${className}`}>
        {/* Info Badges */}
        {showRating && (placeData.rating || placeData.priceLevelSymbol) && (
          <div className="flex flex-wrap items-center gap-2 mb-2">
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
                compact ? "w-16 h-16" : "w-24 h-24"
              } flex-shrink-0 rounded-lg overflow-hidden relative group cursor-pointer transition-transform hover:scale-105`}
            >
              <Image
                src={photo.thumbnailUrl}
                alt={`${placeName} photo ${idx + 1}`}
                fill
                className="object-cover"
                sizes={compact ? "64px" : "96px"}
              />
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                <svg
                  className="w-6 h-6 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7"
                  />
                </svg>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Lightbox */}
      {selectedPhotoIndex !== null && placeData.photos[selectedPhotoIndex] && (
        <div
          className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center"
          onClick={() => setSelectedPhotoIndex(null)}
        >
          {/* Close button */}
          <button
            onClick={() => setSelectedPhotoIndex(null)}
            className="absolute top-4 right-4 z-10 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
          >
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          {/* Navigation arrows */}
          {placeData.photos.length > 1 && (
            <>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedPhotoIndex((prev) =>
                    prev !== null
                      ? (prev - 1 + placeData.photos.length) % placeData.photos.length
                      : 0
                  );
                }}
                className="absolute left-4 z-10 p-3 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
              >
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedPhotoIndex((prev) =>
                    prev !== null ? (prev + 1) % placeData.photos.length : 0
                  );
                }}
                className="absolute right-4 z-10 p-3 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
              >
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </>
          )}

          {/* Main image */}
          <div
            className="relative max-w-[90vw] max-h-[85vh] aspect-[4/3]"
            onClick={(e) => e.stopPropagation()}
          >
            <Image
              src={placeData.photos[selectedPhotoIndex].url}
              alt={`${placeName} photo ${selectedPhotoIndex + 1}`}
              fill
              className="object-contain"
              sizes="90vw"
              priority
            />
          </div>

          {/* Photo counter and attribution */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1">
            <div className="text-white/80 text-sm">
              {selectedPhotoIndex + 1} / {placeData.photos.length}
            </div>
            <div className="text-white/50 text-xs">
              Photo by {placeData.photos[selectedPhotoIndex].attribution}
            </div>
          </div>

          {/* Thumbnail strip */}
          <div className="absolute bottom-16 left-1/2 -translate-x-1/2 flex gap-2">
            {placeData.photos.map((photo, idx) => (
              <button
                key={idx}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedPhotoIndex(idx);
                }}
                className={`w-12 h-12 rounded-lg overflow-hidden relative transition-all ${
                  idx === selectedPhotoIndex
                    ? "ring-2 ring-white scale-110"
                    : "opacity-60 hover:opacity-100"
                }`}
              >
                <Image
                  src={photo.thumbnailUrl}
                  alt={`Thumbnail ${idx + 1}`}
                  fill
                  className="object-cover"
                  sizes="48px"
                />
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
