"use client";

import { useState, useEffect } from "react";
/* eslint-disable @next/next/no-img-element */

interface DestinationData {
  placeId: string;
  name: string;
  address: string;
  location: { latitude: number; longitude: number };
  coverImageUrl: string | null;
  galleryPhotos: { url: string; thumbnailUrl: string }[];
  description?: string;
}

interface DestinationHeroProps {
  destination: string;
  title: string;
  subtitle?: string;
  dateRange?: string;
  budget?: { total: number; currency: string };
  days?: number;
  tags?: string[];
  showBackButton?: boolean;
  onBack?: () => void;
  children?: React.ReactNode;
}

export default function DestinationHero({
  destination,
  title,
  subtitle,
  dateRange,
  budget,
  days,
  tags,
  showBackButton = true,
  onBack,
  children,
}: DestinationHeroProps) {
  const [destinationData, setDestinationData] = useState<DestinationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [imageLoaded, setImageLoaded] = useState(false);

  useEffect(() => {
    const fetchDestination = async () => {
      setLoading(true);
      try {
        const response = await fetch(
          `/api/places?destination=${encodeURIComponent(destination)}`
        );
        if (response.ok) {
          const data = await response.json();
          setDestinationData(data);
        }
      } catch (error) {
        console.error("Failed to fetch destination:", error);
      } finally {
        setLoading(false);
      }
    };

    if (destination) {
      fetchDestination();
    }
  }, [destination]);

  return (
    <div className="relative">
      {/* Hero Image Container */}
      <div className="relative h-64 md:h-80 lg:h-96 overflow-hidden">
        {/* Background Image */}
        {destinationData?.coverImageUrl ? (
          <>
            <img
              src={destinationData.coverImageUrl}
              alt={destination}
              className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-700 ${
                imageLoaded ? "opacity-100" : "opacity-0"
              }`}
              onLoad={() => setImageLoaded(true)}
            />
            {/* Gradient Overlay */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-black/20" />
          </>
        ) : (
          /* Fallback gradient */
          <div className="absolute inset-0 bg-gradient-to-br from-[var(--primary)] to-[var(--primary)]/80" />
        )}

        {/* Loading shimmer */}
        {loading && !destinationData && (
          <div className="absolute inset-0 bg-gradient-to-r from-slate-200 via-slate-100 to-slate-200 animate-pulse" />
        )}

        {/* Content */}
        <div className="absolute inset-0 flex flex-col justify-end">
          <div className="max-w-4xl mx-auto w-full px-4 pb-6">
            {/* Back button */}
            {showBackButton && onBack && (
              <button
                onClick={onBack}
                className="absolute top-4 left-4 flex items-center gap-2 text-white/90 hover:text-white transition-colors bg-black/20 hover:bg-black/30 backdrop-blur-sm px-3 py-1.5 rounded-full"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Back
              </button>
            )}

            {/* Title Section */}
            <div className="text-white">
              <h1 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-bold mb-2 drop-shadow-lg leading-tight">
                {title}
              </h1>
              {subtitle && (
                <p className="text-white/80 text-sm sm:text-base md:text-lg mb-3 sm:mb-4 drop-shadow-md max-w-2xl line-clamp-2 sm:line-clamp-none">
                  {subtitle}
                </p>
              )}

              {/* Meta info - compact on mobile */}
              <div className="flex flex-wrap items-center gap-2 sm:gap-4 text-xs sm:text-sm">
                {dateRange && (
                  <div className="flex items-center gap-1.5 sm:gap-2 bg-white/10 backdrop-blur-sm px-2 sm:px-3 py-1 sm:py-1.5 rounded-full">
                    <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <span className="truncate max-w-[120px] sm:max-w-none">{dateRange}</span>
                  </div>
                )}
                {budget && (
                  <div className="flex items-center gap-1.5 sm:gap-2 bg-white/10 backdrop-blur-sm px-2 sm:px-3 py-1 sm:py-1.5 rounded-full">
                    <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    {budget.currency} {budget.total.toLocaleString()}
                  </div>
                )}
                {days && (
                  <div className="flex items-center gap-1.5 sm:gap-2 bg-white/10 backdrop-blur-sm px-2 sm:px-3 py-1 sm:py-1.5 rounded-full">
                    <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    {days} days
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Tags - Below hero */}
      {tags && tags.length > 0 && (
        <div className="max-w-4xl mx-auto px-4 -mt-3 relative z-10">
          <div className="flex flex-wrap gap-2">
            {tags.map((tag) => (
              <span
                key={tag}
                className="px-3 py-1 bg-white shadow-md text-slate-700 rounded-full text-sm border border-slate-100"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Gallery preview - floating cards, hidden on very small screens */}
      {destinationData?.galleryPhotos && destinationData.galleryPhotos.length > 0 && (
        <div className="hidden sm:block max-w-4xl mx-auto px-4 -mt-6 relative z-10">
          <div className="flex gap-2 justify-end">
            {destinationData.galleryPhotos.slice(0, 3).map((photo, idx) => (
              <div
                key={idx}
                className="w-14 h-14 sm:w-16 sm:h-16 md:w-20 md:h-20 rounded-lg overflow-hidden shadow-lg border-2 border-white relative"
              >
                <img
                  src={photo.thumbnailUrl}
                  alt={`${destination} gallery ${idx + 1}`}
                  className="absolute inset-0 w-full h-full object-cover"
                  loading="lazy"
                />
              </div>
            ))}
            {destinationData.galleryPhotos.length > 3 && (
              <div className="w-14 h-14 sm:w-16 sm:h-16 md:w-20 md:h-20 rounded-lg overflow-hidden shadow-lg border-2 border-white bg-slate-900/80 flex items-center justify-center text-white text-xs sm:text-sm font-medium">
                +{destinationData.galleryPhotos.length - 3}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Optional children (for action buttons, etc.) */}
      {children}
    </div>
  );
}
