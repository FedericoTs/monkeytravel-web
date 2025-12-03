"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { formatDateRange } from "@/lib/utils";
import MobileBottomNav from "@/components/ui/MobileBottomNav";

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

interface Trip {
  id: string;
  title: string;
  description?: string;
  start_date: string;
  end_date: string;
  status: string;
  cover_image_url?: string;
  created_at: string;
}

interface TripsPageClientProps {
  trips: Trip[];
  displayName: string;
}

type SortOption = "newest" | "oldest" | "upcoming" | "alphabetical";
type FilterStatus = "all" | "planning" | "confirmed" | "active" | "completed" | "cancelled";

export default function TripsPageClient({ trips, displayName }: TripsPageClientProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("newest");
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");
  const [showFilters, setShowFilters] = useState(false);

  // Calculate trip statistics
  const stats = useMemo(() => {
    const now = new Date();
    const upcoming = trips.filter(t => new Date(t.start_date) > now).length;
    const past = trips.filter(t => new Date(t.end_date) < now).length;
    const active = trips.filter(t => {
      const start = new Date(t.start_date);
      const end = new Date(t.end_date);
      return start <= now && end >= now;
    }).length;

    // Count unique destinations (extract from title)
    const destinations = new Set(trips.map(t => t.title.replace(/ Trip$/, "")));

    return {
      total: trips.length,
      upcoming,
      past,
      active,
      destinations: destinations.size,
    };
  }, [trips]);

  // Filter and sort trips
  const filteredTrips = useMemo(() => {
    let result = [...trips];

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        t =>
          t.title.toLowerCase().includes(query) ||
          t.description?.toLowerCase().includes(query)
      );
    }

    // Status filter
    if (filterStatus !== "all") {
      result = result.filter(t => t.status === filterStatus);
    }

    // Sort
    switch (sortBy) {
      case "newest":
        result.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        break;
      case "oldest":
        result.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        break;
      case "upcoming":
        result.sort((a, b) => new Date(a.start_date).getTime() - new Date(b.start_date).getTime());
        break;
      case "alphabetical":
        result.sort((a, b) => a.title.localeCompare(b.title));
        break;
    }

    return result;
  }, [trips, searchQuery, sortBy, filterStatus]);

  // Group trips by timeline
  const groupedTrips = useMemo(() => {
    const now = new Date();
    const upcoming: Trip[] = [];
    const current: Trip[] = [];
    const past: Trip[] = [];

    filteredTrips.forEach(trip => {
      const start = new Date(trip.start_date);
      const end = new Date(trip.end_date);

      if (start > now) {
        upcoming.push(trip);
      } else if (end < now) {
        past.push(trip);
      } else {
        current.push(trip);
      }
    });

    return { upcoming, current, past };
  }, [filteredTrips]);

  const statusColors = {
    planning: "bg-amber-100 text-amber-700",
    confirmed: "bg-green-100 text-green-700",
    active: "bg-blue-100 text-blue-700",
    completed: "bg-slate-100 text-slate-700",
    cancelled: "bg-red-100 text-red-700",
  };

  // Enhanced TripCard with automatic image fetching
  const TripCard = ({ trip }: { trip: Trip }) => {
    const [imageUrl, setImageUrl] = useState<string | null>(trip.cover_image_url || null);
    const [imageError, setImageError] = useState(false);
    const [imageLoading, setImageLoading] = useState(true);
    const gradient = getDestinationGradient(trip.title);
    const destination = trip.title.replace(/ Trip$/i, "").replace(/Trip to /i, "");

    // Fetch destination image if no cover_image_url
    useEffect(() => {
      if (!trip.cover_image_url && !imageUrl) {
        const fetchImage = async () => {
          try {
            const response = await fetch(
              `/api/images/destination?destination=${encodeURIComponent(destination)}`
            );
            if (response.ok) {
              const data = await response.json();
              setImageUrl(data.url);
            }
          } catch (error) {
            console.error("Failed to fetch destination image:", error);
          }
        };
        fetchImage();
      }
    }, [trip.cover_image_url, destination, imageUrl]);

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

          {/* Actual Image with error handling */}
          {imageUrl && !imageError && (
            <img
              src={imageUrl}
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
            <span className="truncate">{formatDateRange(trip.start_date, trip.end_date)}</span>
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
                statusColors[trip.status as keyof typeof statusColors] || statusColors.planning
              }`}
            >
              {trip.status.charAt(0).toUpperCase() + trip.status.slice(1)}
            </span>

            {/* Arrow indicator on hover */}
            <span className="text-slate-400 group-hover:text-[var(--primary)] transition-colors group-hover:translate-x-1 transform duration-200">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </span>
          </div>
        </div>
      </Link>
    );
  };

  const TripSection = ({ title, trips, icon, emptyText }: { title: string; trips: Trip[]; icon: React.ReactNode; emptyText?: string }) => {
    if (trips.length === 0 && !emptyText) return null;

    return (
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-4">
          {icon}
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          <span className="text-sm text-slate-500">({trips.length})</span>
        </div>
        {trips.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
            {trips.map((trip) => (
              <TripCard key={trip.id} trip={trip} />
            ))}
          </div>
        ) : emptyText ? (
          <div className="text-center py-8 bg-slate-50 rounded-xl border border-dashed border-slate-200">
            <p className="text-slate-500 text-sm">{emptyText}</p>
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-white overflow-x-hidden">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-lg border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-4 py-3 sm:py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <Image
              src="/images/logo.png"
              alt="MonkeyTravel"
              width={36}
              height={36}
              className="rounded-lg sm:w-10 sm:h-10"
            />
            <span className="font-bold text-lg sm:text-xl text-[var(--primary)]">
              MonkeyTravel
            </span>
          </Link>

          <div className="flex items-center gap-2 sm:gap-4">
            <span className="text-slate-600 text-sm sm:text-base hidden xs:inline">Hi, {displayName}</span>
            <form action="/auth/signout" method="post">
              <button
                type="submit"
                className="text-slate-500 hover:text-slate-700 text-xs sm:text-sm px-2 py-1 rounded-lg hover:bg-slate-100 transition-colors"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-4 py-6 sm:py-8">
        {/* Stats Cards */}
        {trips.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mb-6 sm:mb-8">
            <div className="bg-white rounded-xl border border-slate-200 p-3 sm:p-4">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-8 h-8 rounded-lg bg-[var(--primary)]/10 flex items-center justify-center">
                  <svg className="w-4 h-4 text-[var(--primary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064" />
                  </svg>
                </div>
                <span className="text-xs sm:text-sm text-slate-500">Total</span>
              </div>
              <div className="text-xl sm:text-2xl font-bold text-slate-900">{stats.total}</div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-3 sm:p-4">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-8 h-8 rounded-lg bg-green-100 flex items-center justify-center">
                  <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
                <span className="text-xs sm:text-sm text-slate-500">Upcoming</span>
              </div>
              <div className="text-xl sm:text-2xl font-bold text-slate-900">{stats.upcoming}</div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-3 sm:p-4">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
                  <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <span className="text-xs sm:text-sm text-slate-500">Completed</span>
              </div>
              <div className="text-xl sm:text-2xl font-bold text-slate-900">{stats.past}</div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-3 sm:p-4">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center">
                  <svg className="w-4 h-4 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  </svg>
                </div>
                <span className="text-xs sm:text-sm text-slate-500">Destinations</span>
              </div>
              <div className="text-xl sm:text-2xl font-bold text-slate-900">{stats.destinations}</div>
            </div>
          </div>
        )}

        {/* Page Header with Search */}
        <div className="flex flex-col gap-4 mb-6 sm:mb-8">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">Your Trips</h1>
              <p className="text-slate-600 text-sm sm:text-base mt-1">
                Plan and manage your AI-powered itineraries
              </p>
            </div>
            <Link
              href="/trips/new"
              className="bg-[var(--primary)] text-white px-4 sm:px-6 py-2.5 sm:py-3 rounded-xl font-medium hover:bg-[var(--primary)]/90 transition-colors flex items-center justify-center gap-2 w-full sm:w-auto shadow-lg shadow-[var(--primary)]/25"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 4v16m8-8H4"
                />
              </svg>
              Plan New Trip
            </Link>
          </div>

          {/* Search and Filters */}
          {trips.length > 0 && (
            <div className="flex flex-col sm:flex-row gap-3">
              {/* Search */}
              <div className="relative flex-1">
                <svg
                  className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
                <input
                  type="text"
                  placeholder="Search trips..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 outline-none transition-colors bg-white"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>

              {/* Filter Toggle (Mobile) */}
              <button
                onClick={() => setShowFilters(!showFilters)}
                className="sm:hidden flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-700 font-medium"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                </svg>
                Filters
                {(filterStatus !== "all" || sortBy !== "newest") && (
                  <span className="w-2 h-2 rounded-full bg-[var(--primary)]" />
                )}
              </button>

              {/* Sort & Filter (Desktop) */}
              <div className="hidden sm:flex items-center gap-3">
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as SortOption)}
                  className="px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-700 font-medium focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 outline-none"
                >
                  <option value="newest">Newest First</option>
                  <option value="oldest">Oldest First</option>
                  <option value="upcoming">By Date</option>
                  <option value="alphabetical">A-Z</option>
                </select>

                <select
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value as FilterStatus)}
                  className="px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-700 font-medium focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 outline-none"
                >
                  <option value="all">All Status</option>
                  <option value="planning">Planning</option>
                  <option value="confirmed">Confirmed</option>
                  <option value="active">Active</option>
                  <option value="completed">Completed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>
            </div>
          )}

          {/* Mobile Filters Panel */}
          {showFilters && (
            <div className="sm:hidden bg-white rounded-xl border border-slate-200 p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Sort by</label>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as SortOption)}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-700 font-medium"
                >
                  <option value="newest">Newest First</option>
                  <option value="oldest">Oldest First</option>
                  <option value="upcoming">By Date</option>
                  <option value="alphabetical">A-Z</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Filter by status</label>
                <select
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value as FilterStatus)}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-700 font-medium"
                >
                  <option value="all">All Status</option>
                  <option value="planning">Planning</option>
                  <option value="confirmed">Confirmed</option>
                  <option value="active">Active</option>
                  <option value="completed">Completed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>
              <button
                onClick={() => {
                  setSortBy("newest");
                  setFilterStatus("all");
                }}
                className="w-full text-sm text-[var(--primary)] font-medium"
              >
                Reset Filters
              </button>
            </div>
          )}
        </div>

        {/* Active Filters Indicator */}
        {(filterStatus !== "all" || searchQuery) && (
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <span className="text-sm text-slate-500">Showing:</span>
            {searchQuery && (
              <span className="inline-flex items-center gap-1 px-2 py-1 bg-slate-100 rounded-full text-xs font-medium text-slate-700">
                &quot;{searchQuery}&quot;
                <button onClick={() => setSearchQuery("")} className="hover:text-slate-900">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </span>
            )}
            {filterStatus !== "all" && (
              <span className="inline-flex items-center gap-1 px-2 py-1 bg-slate-100 rounded-full text-xs font-medium text-slate-700">
                {filterStatus.charAt(0).toUpperCase() + filterStatus.slice(1)}
                <button onClick={() => setFilterStatus("all")} className="hover:text-slate-900">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </span>
            )}
            <span className="text-sm text-slate-500">({filteredTrips.length} trips)</span>
          </div>
        )}

        {/* Trips Display */}
        {trips.length > 0 ? (
          filterStatus === "all" && !searchQuery ? (
            // Grouped view (no filters active)
            <>
              {/* Current/Active Trips */}
              <TripSection
                title="Happening Now"
                trips={groupedTrips.current}
                icon={
                  <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
                    <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  </div>
                }
              />

              {/* Upcoming Trips */}
              <TripSection
                title="Upcoming"
                trips={groupedTrips.upcoming}
                icon={
                  <div className="w-8 h-8 rounded-lg bg-green-100 flex items-center justify-center">
                    <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  </div>
                }
                emptyText="No upcoming trips planned. Start planning your next adventure!"
              />

              {/* Past Trips */}
              <TripSection
                title="Past Adventures"
                trips={groupedTrips.past}
                icon={
                  <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center">
                    <svg className="w-4 h-4 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                }
              />
            </>
          ) : (
            // Filtered/searched view
            filteredTrips.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
                {filteredTrips.map((trip) => (
                  <TripCard key={trip.id} trip={trip} />
                ))}
              </div>
            ) : (
              <div className="text-center py-12 sm:py-16 px-4">
                <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
                <h2 className="text-xl font-bold text-slate-900 mb-2">No trips found</h2>
                <p className="text-slate-600 text-sm mb-4">
                  Try adjusting your search or filters
                </p>
                <button
                  onClick={() => {
                    setSearchQuery("");
                    setFilterStatus("all");
                  }}
                  className="text-[var(--primary)] font-medium hover:underline"
                >
                  Clear all filters
                </button>
              </div>
            )
          )
        ) : (
          /* Empty State */
          <div className="text-center py-12 sm:py-16 px-4">
            <div className="w-20 h-20 sm:w-24 sm:h-24 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4 sm:mb-6">
              <svg
                className="w-10 h-10 sm:w-12 sm:h-12 text-slate-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            <h2 className="text-xl sm:text-2xl font-bold text-slate-900 mb-2">
              No trips yet
            </h2>
            <p className="text-slate-600 text-sm sm:text-base mb-6 sm:mb-8 max-w-md mx-auto">
              Create your first AI-powered trip and let MonkeyTravel plan the
              perfect itinerary for you.
            </p>
            <Link
              href="/trips/new"
              className="inline-flex items-center justify-center gap-2 bg-[var(--primary)] text-white px-6 sm:px-8 py-3 sm:py-4 rounded-xl font-medium hover:bg-[var(--primary)]/90 transition-colors w-full sm:w-auto max-w-xs shadow-lg shadow-[var(--primary)]/25"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 4v16m8-8H4"
                />
              </svg>
              Plan Your First Trip
            </Link>
          </div>
        )}
      </main>

      {/* Mobile Bottom Navigation */}
      <MobileBottomNav activePage="trips" />
    </div>
  );
}
