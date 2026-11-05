"use client";

import { useState, useCallback, useEffect, useRef, useId } from "react";
import { Link } from "@/lib/i18n/routing";
import { formatDateRange } from "@/lib/datetime";
import { cardSizedSrc, proxyImageUrl } from "@/lib/img/proxyUrl";

type TFn = (key: string) => string;

// Gradient fallbacks for loading states - Fresh Voyager theme
const DESTINATION_GRADIENTS: Record<string, { from: string; to: string; accent: string }> = {
  tokyo: { from: "#FFB7C5", to: "#FF6B9D", accent: "#FFF0F3" },
  paris: { from: "#E8B4B8", to: "#D4919A", accent: "#FDF4F5" },
  rome: { from: "#C9A86C", to: "#9E7B4F", accent: "#FAF6F0" },
  london: { from: "#6B7B8C", to: "#4A5568", accent: "#F0F4F8" },
  "new york": { from: "#4A5568", to: "#2D3748", accent: "#EDF2F7" },
  barcelona: { from: "#F6AD55", to: "#ED8936", accent: "#FFFAF0" },
  amsterdam: { from: "#68D391", to: "#48BB78", accent: "#F0FFF4" },
  dubai: { from: "#D69E2E", to: "#B7791F", accent: "#FFFFF0" },
  bali: { from: "#4FD1C5", to: "#38B2AC", accent: "#E6FFFA" },
  sydney: { from: "#63B3ED", to: "#4299E1", accent: "#EBF8FF" },
  default: { from: "#FF6B6B", to: "#E85555", accent: "#FFF5EB" },
};

function getDestinationGradient(title: string) {
  const destination = title.toLowerCase().replace(/ trip$/i, "").replace(/trip to /i, "").trim();
  return DESTINATION_GRADIENTS[destination] || DESTINATION_GRADIENTS.default;
}

export interface Trip {
  id: string;
  title: string;
  description?: string;
  start_date: string;
  end_date: string;
  status: string;
  cover_image_url?: string;
  created_at: string;
  is_archived?: boolean;
}

const STATUS_COLORS: Record<string, string> = {
  planning: "bg-amber-100 text-amber-700",
  confirmed: "bg-green-100 text-green-700",
  active: "bg-blue-100 text-blue-700",
  completed: "bg-purple-100 text-purple-700", // "Memories" - purple for nostalgia
  cancelled: "bg-red-100 text-red-700",
};

interface TripCardProps {
  trip: Trip;
  t: TFn;
  locale: string;
  getStatusLabel: (status: string) => string;
  onAction: (tripId: string, tripTitle: string, action: "archive" | "delete" | "unarchive") => void;
  /** The first card on screen: its cover loads first, the rest lazily. */
  priority?: boolean;
}

/**
 * Enhanced trip card with lazy destination-image fetching.
 *
 * Hoisted to module scope (was previously declared inside TripsPageClient).
 * Inline declaration created a fresh component identity on every parent
 * render — every keystroke in the search input remounted every card and
 * refired the /api/images/destination request, burning Pexels quota and
 * flickering covers. Task #155 / #159.
 *
 * The destination-image fetch carries its own AbortController so any
 * remount that does happen (cover_image_url flip, route refresh) cancels
 * the in-flight request instead of racing. Mirrors the canonical pattern
 * in components/trip/SeasonalContextCard.tsx.
 */
export default function TripCard({ trip, t, locale, getStatusLabel, onAction, priority = false }: TripCardProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(trip.cover_image_url || null);
  const [imageError, setImageError] = useState(false);
  // Initial imageLoading: false when trip already has a cover URL — the
  // <img> mounts with that src and either fires onLoad from the network
  // OR (for cached images) skips onLoad entirely, so starting at true and
  // waiting for onLoad would leave repeat visitors stuck at opacity:0.
  // For the lazy-fetch path (no cover_image_url yet) we flip to true so
  // the skeleton still shimmers while we wait for /api/images/destination.
  const [imageLoading, setImageLoading] = useState(!trip.cover_image_url);
  const [menuOpen, setMenuOpen] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);
  // Menu a11y plumbing (task #194): the action menu is a popup attached
  // to a button. We need a stable id to wire aria-controls + give the
  // items a roving-tabindex feel by focusing them via refs on arrow keys.
  const menuId = useId();
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const gradient = getDestinationGradient(trip.title);
  const destination = trip.title.replace(/ Trip$/i, "").replace(/Trip to /i, "");
  const isArchived = trip.is_archived;

  // When the menu opens, focus the first menu item so keyboard users
  // can immediately arrow-navigate. When it closes (after action or
  // Esc), restore focus to the trigger button. WAI-ARIA menu pattern.
  useEffect(() => {
    if (!menuOpen) return;

    const focusFrame = requestAnimationFrame(() => {
      const firstItem = menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]');
      firstItem?.focus();
    });

    return () => cancelAnimationFrame(focusFrame);
  }, [menuOpen]);

  // Keyboard navigation inside the menu: ArrowUp/Down cycle items,
  // Home/End jump to first/last, Esc closes and restores focus.
  const handleMenuKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!menuRef.current) return;

    const items = Array.from(
      menuRef.current.querySelectorAll<HTMLElement>('[role="menuitem"]')
    );
    if (items.length === 0) return;

    const currentIndex = items.findIndex((el) => el === document.activeElement);

    switch (e.key) {
      case "ArrowDown": {
        e.preventDefault();
        const next = items[(currentIndex + 1) % items.length] ?? items[0];
        next.focus();
        break;
      }
      case "ArrowUp": {
        e.preventDefault();
        const prev = items[(currentIndex - 1 + items.length) % items.length] ?? items[items.length - 1];
        prev.focus();
        break;
      }
      case "Home": {
        e.preventDefault();
        items[0].focus();
        break;
      }
      case "End": {
        e.preventDefault();
        items[items.length - 1].focus();
        break;
      }
      case "Escape": {
        e.preventDefault();
        e.stopPropagation();
        setMenuOpen(false);
        menuButtonRef.current?.focus();
        break;
      }
      case "Tab": {
        // Tabbing out closes the menu — matches native <select> popup behaviour.
        setMenuOpen(false);
        break;
      }
    }
  }, []);

  // Fetch destination image if no cover_image_url. AbortController guards
  // against stale responses if the component unmounts (router.refresh,
  // filter change before fix) or remounts before the prior request lands.
  useEffect(() => {
    if (trip.cover_image_url || imageUrl) return;

    const controller = new AbortController();
    let cancelled = false;

    const fetchImage = async () => {
      try {
        const response = await fetch(
          `/api/images/destination?destination=${encodeURIComponent(destination)}`,
          { signal: controller.signal }
        );
        if (cancelled || controller.signal.aborted) return;
        if (response.ok) {
          const data = await response.json();
          if (cancelled || controller.signal.aborted) return;
          setImageUrl(data.url);
        }
      } catch (error) {
        // AbortError fires when a newer effect supersedes this one or the
        // component unmounts — expected, don't report.
        const isAbort = error instanceof Error && error.name === "AbortError";
        if (isAbort || cancelled || controller.signal.aborted) return;
        console.error("Failed to fetch destination image:", error);
      }
    };

    fetchImage();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [trip.cover_image_url, destination, imageUrl]);

  // Safety net for cached images: if the <img> is already complete by
  // the time React commits (browser cache hit), onLoad never fires.
  // Reconcile state by inspecting the ref after every imageUrl change.
  useEffect(() => {
    if (!imageUrl) return;
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth > 0) {
      setImageLoading(false);
    }
  }, [imageUrl]);

  // Check if image URL is valid and usable
  const hasValidImage = imageUrl && !imageError;

  // Handle image load error
  const handleImageError = useCallback(() => {
    setImageError(true);
    setImageLoading(false);
  }, []);

  // Handle image load success
  const handleImageLoad = useCallback(() => {
    setImageLoading(false);
  }, []);

  return (
    <Link
      href={`/trips/${trip.id}`}
      className="group bg-white rounded-xl sm:rounded-2xl border border-slate-200 overflow-hidden hover:shadow-xl transition-all duration-300 hover:border-slate-300 active:scale-[0.98] hover:-translate-y-1"
    >
      {/* Cover Image Section */}
      <div
        className="h-36 sm:h-44 relative overflow-hidden"
        style={{
          background: hasValidImage && !imageLoading
            ? undefined
            : `linear-gradient(135deg, ${gradient.from} 0%, ${gradient.to} 100%)`
        }}
      >
        {/* Loading state with gradient */}
        {(!hasValidImage || imageLoading) && (
          <div className="absolute inset-0 overflow-hidden">
            {/* Subtle dot pattern */}
            <svg className="absolute inset-0 w-full h-full opacity-10" viewBox="0 0 100 100" preserveAspectRatio="none">
              <defs>
                <pattern id={`grid-${trip.id}`} width="20" height="20" patternUnits="userSpaceOnUse">
                  <circle cx="10" cy="10" r="1.5" fill="white"/>
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill={`url(#grid-${trip.id})`}/>
            </svg>

            {/* Loading indicator */}
            <div className="absolute inset-0 flex items-center justify-center text-white">
              <svg className="w-10 h-10 opacity-40 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>

            {/* Decorative blurs */}
            <div className="absolute -top-10 -right-10 w-32 h-32 rounded-full bg-white/10 blur-2xl" />
            <div className="absolute -bottom-8 -left-8 w-24 h-24 rounded-full bg-white/10 blur-xl" />
          </div>
        )}

        {/* Actual Image with error handling.
            Wrap Pexels/Unsplash through same-origin proxy — they 504
            direct browser loads behind Cloudflare. Live-confirmed
            2026-05-31. See lib/img/proxyUrl.ts. */}
        {imageUrl && !imageError && (
          // Already sized and proxied here: next/image would optimise it again.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            ref={imgRef}
            src={cardSizedSrc(proxyImageUrl(imageUrl) || imageUrl)}
            loading={priority ? "eager" : "lazy"}
            fetchPriority={priority ? "high" : undefined}
            alt={trip.title}
            onError={handleImageError}
            onLoad={handleImageLoad}
            className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-500 ${
              imageLoading ? 'opacity-0' : 'opacity-100'
            }`}
          />
        )}

        {/* Loading skeleton */}
        {imageLoading && imageUrl && !imageError && (
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-shimmer"
               style={{ backgroundSize: '200% 100%' }} />
        )}

        {/* Gradient overlay for text readability */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />

        {/* Title overlay */}
        <div className="absolute bottom-0 left-0 right-0 p-3 sm:p-4">
          <h3 className="text-lg sm:text-xl font-bold text-white drop-shadow-lg line-clamp-2 group-hover:text-white/90 transition-colors">
            {trip.title}
          </h3>
        </div>

        {/* Destination badge */}
        <div className="absolute top-3 left-3">
          <span
            className="px-2.5 py-1 rounded-full text-xs font-semibold backdrop-blur-md shadow-lg"
            style={{
              backgroundColor: `${gradient.accent}ee`,
              color: gradient.to
            }}
          >
            {destination}
          </span>
        </div>

        {/* Action menu button */}
        <div className="absolute top-3 right-3">
          <button
            ref={menuButtonRef}
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setMenuOpen(!menuOpen);
            }}
            onKeyDown={(e) => {
              // Down-arrow on the trigger opens the menu and lands focus
              // on the first item — WAI-ARIA menubutton convention. Space
              // and Enter already fire onClick natively.
              if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !menuOpen) {
                e.preventDefault();
                e.stopPropagation();
                setMenuOpen(true);
              }
            }}
            className="p-1.5 rounded-full bg-black/30 backdrop-blur-md text-white hover:bg-black/50 transition-colors"
            aria-label={t('tripActions')}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-controls={menuId}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
            </svg>
          </button>

          {/* Dropdown menu */}
          {menuOpen && (
            <>
              {/* Backdrop to close menu */}
              <div
                className="fixed inset-0 z-10"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setMenuOpen(false);
                }}
                aria-hidden="true"
              />
              <div
                ref={menuRef}
                id={menuId}
                role="menu"
                aria-label={t('tripActions')}
                onKeyDown={handleMenuKeyDown}
                className="absolute right-0 top-8 z-20 bg-white rounded-lg shadow-lg border border-slate-200 py-1 min-w-[140px]"
              >
                {isArchived ? (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setMenuOpen(false);
                      onAction(trip.id, trip.title, "unarchive");
                    }}
                    className="w-full px-3 py-2 text-left text-sm text-green-600 hover:bg-green-50 focus:bg-green-50 focus:outline-none flex items-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    {t('unarchiveTrip')}
                  </button>
                ) : (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setMenuOpen(false);
                      onAction(trip.id, trip.title, "archive");
                    }}
                    className="w-full px-3 py-2 text-left text-sm text-amber-600 hover:bg-amber-50 focus:bg-amber-50 focus:outline-none flex items-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                    </svg>
                    {t('archiveTrip')}
                  </button>
                )}
                <button
                  type="button"
                  role="menuitem"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setMenuOpen(false);
                    onAction(trip.id, trip.title, "delete");
                  }}
                  className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 focus:bg-red-50 focus:outline-none flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  {t('deleteTrip')}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Trip Info */}
      <div className="p-3 sm:p-4">
        <div className="flex items-center gap-2 text-slate-600 text-xs sm:text-sm mb-2">
          <svg
            className="w-4 h-4 flex-shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
          <span className="truncate">{formatDateRange(trip.start_date, trip.end_date, locale)}</span>
        </div>

        {trip.description && (
          <p className="text-slate-600 text-xs sm:text-sm line-clamp-2 mb-2">
            {trip.description}
          </p>
        )}

        {/* Status Badge with enhanced styling */}
        <div className="mt-2 sm:mt-3 flex items-center justify-between">
          <span
            className={`px-2.5 py-1 rounded-full text-xs font-medium ${
              STATUS_COLORS[trip.status] || STATUS_COLORS.planning
            }`}
          >
            {getStatusLabel(trip.status)}
          </span>

          {/* Arrow indicator on hover */}
          <span className="text-slate-500 group-hover:text-[var(--primary-ink)] transition-colors group-hover:translate-x-1 transform duration-200">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </span>
        </div>
      </div>
    </Link>
  );
}
