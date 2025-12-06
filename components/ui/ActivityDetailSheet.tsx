"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { Activity } from "@/types";
import PlaceGallery from "@/components/PlaceGallery";

interface ActivityDetailSheetProps {
  activity: Activity;
  currency?: string;
  isOpen: boolean;
  onClose: () => void;
  /**
   * When true, NO API calls will be made.
   * Used for saved trips to ensure zero external API costs.
   */
  disableApiCalls?: boolean;
}

export default function ActivityDetailSheet({
  activity,
  currency = "USD",
  isOpen,
  onClose,
  disableApiCalls = false,
}: ActivityDetailSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);

  // Generate URLs
  const mapSearchQuery = encodeURIComponent(
    `${activity.name} ${activity.address || activity.location}`
  );
  const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${mapSearchQuery}`;
  const googleSearchUrl = `https://www.google.com/search?q=${mapSearchQuery}`;

  const typeColors: Record<string, { bg: string; text: string; border: string; icon: string }> = {
    // Food & Drink
    restaurant: { bg: "bg-orange-50", text: "text-orange-700", border: "border-orange-200", icon: "🍽️" },
    food: { bg: "bg-orange-50", text: "text-orange-700", border: "border-orange-200", icon: "🍽️" },
    cafe: { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200", icon: "☕" },
    bar: { bg: "bg-rose-50", text: "text-rose-700", border: "border-rose-200", icon: "🍷" },
    foodie: { bg: "bg-orange-50", text: "text-orange-700", border: "border-orange-200", icon: "🍽️" },
    "wine bar": { bg: "bg-rose-50", text: "text-rose-700", border: "border-rose-200", icon: "🍷" },
    // Attractions & Culture
    attraction: { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200", icon: "🏛️" },
    cultural: { bg: "bg-indigo-50", text: "text-indigo-700", border: "border-indigo-200", icon: "🎭" },
    museum: { bg: "bg-indigo-50", text: "text-indigo-700", border: "border-indigo-200", icon: "🏛️" },
    landmark: { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200", icon: "🗿" },
    // Activities & Nature
    activity: { bg: "bg-green-50", text: "text-green-700", border: "border-green-200", icon: "🎯" },
    nature: { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200", icon: "🌲" },
    park: { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200", icon: "🌳" },
    // Shopping & Entertainment
    shopping: { bg: "bg-pink-50", text: "text-pink-700", border: "border-pink-200", icon: "🛍️" },
    market: { bg: "bg-pink-50", text: "text-pink-700", border: "border-pink-200", icon: "🛒" },
    entertainment: { bg: "bg-fuchsia-50", text: "text-fuchsia-700", border: "border-fuchsia-200", icon: "🎪" },
    nightlife: { bg: "bg-violet-50", text: "text-violet-700", border: "border-violet-200", icon: "🌙" },
    // Wellness
    spa: { bg: "bg-teal-50", text: "text-teal-700", border: "border-teal-200", icon: "💆" },
    wellness: { bg: "bg-teal-50", text: "text-teal-700", border: "border-teal-200", icon: "🧘" },
    // Transport & Other
    transport: { bg: "bg-purple-50", text: "text-purple-700", border: "border-purple-200", icon: "🚗" },
    event: { bg: "bg-yellow-50", text: "text-yellow-700", border: "border-yellow-200", icon: "🎉" },
  };

  const colors = typeColors[activity.type] || { bg: "bg-slate-50", text: "text-slate-700", border: "border-slate-200", icon: "📍" };

  // Handle escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (isOpen) {
      document.addEventListener("keydown", handleEscape);
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "";
    };
  }, [isOpen, onClose]);

  // Handle drag to close
  const handleDragStart = useRef<{ y: number; startTime: number } | null>(null);

  const onTouchStart = (e: React.TouchEvent) => {
    handleDragStart.current = {
      y: e.touches[0].clientY,
      startTime: Date.now(),
    };
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    if (!handleDragStart.current || !sheetRef.current) return;

    const deltaY = e.changedTouches[0].clientY - handleDragStart.current.y;
    const deltaTime = Date.now() - handleDragStart.current.startTime;
    const velocity = deltaY / deltaTime;

    // Close if swiped down more than 100px or with velocity > 0.5
    if (deltaY > 100 || velocity > 0.5) {
      onClose();
    }

    handleDragStart.current = null;
  };

  if (!isOpen) return null;

  const content = (
    <div className="fixed inset-0 z-[100]">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
      />

      {/* Sheet */}
      <div
        ref={sheetRef}
        className="absolute bottom-0 left-0 right-0 bg-white rounded-t-3xl shadow-2xl animate-slide-up max-h-[85vh] overflow-hidden flex flex-col"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {/* Hero Image - shown when image_url is available */}
        {activity.image_url && (
          <div className="relative h-40 w-full overflow-hidden flex-shrink-0">
            <img
              src={activity.image_url}
              alt={activity.name}
              className="w-full h-full object-cover"
            />
            {/* Gradient overlay */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" />
            {/* Close button on image */}
            <button
              onClick={onClose}
              className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center transition-colors hover:bg-black/60"
            >
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            {/* Drag handle on image */}
            <div className="absolute top-2 left-1/2 -translate-x-1/2">
              <div className="w-12 h-1.5 rounded-full bg-white/60" />
            </div>
          </div>
        )}

        {/* Drag Handle - only shown when no image */}
        {!activity.image_url && (
          <div className="flex justify-center pt-3 pb-2 flex-shrink-0">
            <div className="w-12 h-1.5 rounded-full bg-slate-300" />
          </div>
        )}

        {/* Header */}
        <div className={`px-5 pb-4 border-b border-slate-100 flex-shrink-0 ${activity.image_url ? 'pt-3' : ''}`}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span
                  className={`text-xs px-2 py-0.5 rounded-full ${colors.bg} ${colors.text} ${colors.border} border`}
                >
                  {colors.icon} {activity.type}
                </span>
                {activity.booking_required && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                    Booking Required
                  </span>
                )}
              </div>
              <h2 className="text-xl font-bold text-slate-900 line-clamp-2">
                {activity.name}
              </h2>
            </div>
            {/* Close button - only shown when no image (image has its own close button) */}
            {!activity.image_url && (
              <button
                onClick={onClose}
                className="w-10 h-10 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center flex-shrink-0 transition-colors"
              >
                <svg className="w-5 h-5 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto overscroll-contain">
          <div className="px-5 py-4 space-y-5">
            {/* Time & Cost Row */}
            <div className="flex items-center justify-between gap-4 p-4 bg-slate-50 rounded-xl">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-white shadow-sm flex items-center justify-center">
                  <svg className="w-5 h-5 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <div className="text-sm text-slate-500">Start Time</div>
                  <div className="font-semibold text-slate-900">{activity.start_time}</div>
                </div>
              </div>
              <div className="h-8 w-px bg-slate-200" />
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-white shadow-sm flex items-center justify-center">
                  <svg className="w-5 h-5 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <div className="text-sm text-slate-500">Est. Cost</div>
                  <div className="font-semibold text-slate-900">
                    {activity.estimated_cost.amount === 0
                      ? "Free"
                      : `${activity.estimated_cost.currency || currency} ${activity.estimated_cost.amount}`}
                  </div>
                </div>
              </div>
            </div>

            {/* Duration Badge */}
            <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-slate-100 rounded-full">
              <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M12 5l7 7-7 7" />
              </svg>
              <span className="text-sm text-slate-600">
                <span className="font-medium">{activity.duration_minutes} min</span> duration
              </span>
            </div>

            {/* Description */}
            <div>
              <h3 className="text-sm font-semibold text-slate-700 mb-2">About</h3>
              <p className="text-slate-600 text-sm leading-relaxed">
                {activity.description}
              </p>
            </div>

            {/* Location */}
            <div className="flex items-start gap-3 p-4 bg-slate-50 rounded-xl">
              <div className="w-10 h-10 rounded-full bg-[var(--primary)]/10 flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-[var(--primary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-slate-500 mb-0.5">Location</div>
                <p className="text-slate-900 font-medium text-sm">
                  {activity.address || activity.location}
                </p>
              </div>
            </div>

            {/* Photo Gallery - Only shown if API calls are enabled */}
            {!disableApiCalls && (
              <div>
                <h3 className="text-sm font-semibold text-slate-700 mb-3">Photos</h3>
                <PlaceGallery
                  placeName={activity.name}
                  placeAddress={activity.address || activity.location}
                  maxPhotos={6}
                  showRating={true}
                  disableApiCalls={disableApiCalls}
                />
              </div>
            )}

            {/* Tips */}
            {activity.tips && activity.tips.length > 0 && (
              <div className="bg-blue-50 rounded-xl p-4 border border-blue-100">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
                    <svg className="w-4 h-4 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <span className="font-semibold text-blue-800">Insider Tips</span>
                </div>
                <ul className="space-y-2">
                  {activity.tips.map((tip, i) => (
                    <li key={i} className="text-sm text-blue-700 flex items-start gap-2">
                      <span className="text-blue-400 mt-0.5">•</span>
                      <span>{tip}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>

        {/* Action Buttons - Fixed at bottom */}
        <div className="flex-shrink-0 px-5 py-4 border-t border-slate-100 bg-white">
          <div className="flex gap-3">
            <a
              href={googleMapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 flex items-center justify-center gap-2 py-3 bg-[var(--primary)] text-white font-medium rounded-xl hover:bg-[var(--primary)]/90 transition-colors"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" />
              </svg>
              Open in Maps
            </a>
            <a
              href={googleSearchUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 px-5 py-3 bg-slate-100 text-slate-700 font-medium rounded-xl hover:bg-slate-200 transition-colors"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
              </svg>
              Search
            </a>
            {activity.official_website && (
              <a
                href={activity.official_website}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 px-5 py-3 bg-slate-100 text-slate-700 font-medium rounded-xl hover:bg-slate-200 transition-colors"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
            )}
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes slide-up {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
        .animate-fade-in {
          animation: fade-in 0.2s ease-out;
        }
        .animate-slide-up {
          animation: slide-up 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        }
      `}</style>
    </div>
  );

  // Use portal to render at document body level
  if (typeof window !== "undefined") {
    return createPortal(content, document.body);
  }

  return null;
}
