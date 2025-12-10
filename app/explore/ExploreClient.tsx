"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import {
  Search,
  TrendingUp,
  MapPin,
  Clock,
  Eye,
  Copy,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Filter,
  X,
  Compass,
} from "lucide-react";

interface TrendingTrip {
  id: string;
  title: string;
  description: string;
  shareToken: string;
  destination: string;
  countryCode: string | null;
  durationDays: number;
  coverImage: string | null;
  tags: string[];
  budgetTier: string;
  trendingScore: number;
  viewCount: number;
  copyCount: number;
  sharedAt: string;
}

interface ExploreResponse {
  trips: TrendingTrip[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

const BUDGET_OPTIONS = [
  { value: "", label: "Any Budget" },
  { value: "budget", label: "Budget-Friendly" },
  { value: "balanced", label: "Balanced" },
  { value: "luxury", label: "Luxury" },
];

const DURATION_OPTIONS = [
  { value: "", label: "Any Duration" },
  { value: "1-3", label: "Weekend (1-3 days)" },
  { value: "4-7", label: "Week (4-7 days)" },
  { value: "8-14", label: "Extended (8-14 days)" },
  { value: "15+", label: "Long Trip (15+ days)" },
];

export default function ExploreClient() {
  const router = useRouter();
  const [trips, setTrips] = useState<TrendingTrip[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [budget, setBudget] = useState("");
  const [duration, setDuration] = useState("");
  const [showFilters, setShowFilters] = useState(false);

  const fetchTrips = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      params.set("page", page.toString());
      params.set("per_page", "12");

      if (searchQuery) {
        params.set("destination", searchQuery);
      }
      if (budget) {
        params.set("budget", budget);
      }
      if (duration) {
        const [min, max] = duration.split("-");
        if (min) params.set("duration_min", min);
        if (max && max !== "+") params.set("duration_max", max);
        if (max === "+") params.set("duration_min", min);
      }

      const response = await fetch(`/api/explore/trips?${params.toString()}`);

      if (!response.ok) {
        throw new Error("Failed to fetch trips");
      }

      const data: ExploreResponse = await response.json();
      setTrips(data.trips);
      setTotalPages(data.totalPages);
      setTotal(data.total);
    } catch (err) {
      setError("Failed to load trips. Please try again.");
      console.error("Explore fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, [page, searchQuery, budget, duration]);

  useEffect(() => {
    fetchTrips();
  }, [fetchTrips]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    fetchTrips();
  };

  const clearFilters = () => {
    setSearchQuery("");
    setBudget("");
    setDuration("");
    setPage(1);
  };

  const hasActiveFilters = searchQuery || budget || duration;

  const getBudgetLabel = (tier: string) => {
    switch (tier) {
      case "budget":
        return "Budget";
      case "balanced":
        return "Balanced";
      case "luxury":
        return "Luxury";
      default:
        return "Balanced";
    }
  };

  const getBudgetColor = (tier: string) => {
    switch (tier) {
      case "budget":
        return "bg-green-100 text-green-700";
      case "balanced":
        return "bg-blue-100 text-blue-700";
      case "luxury":
        return "bg-purple-100 text-purple-700";
      default:
        return "bg-gray-100 text-gray-700";
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white">
      {/* Hero Section */}
      <div className="relative bg-gradient-to-r from-[var(--primary)] to-[#0A6B9E] text-white overflow-hidden">
        <div className="absolute inset-0 bg-[url('/images/pattern-dots.svg')] opacity-10" />
        <div className="max-w-7xl mx-auto px-4 py-12 sm:py-16 relative">
          <div className="text-center max-w-3xl mx-auto">
            <div className="flex items-center justify-center gap-2 mb-4">
              <Compass className="w-8 h-8" />
              <h1 className="text-3xl sm:text-4xl font-bold">Explore Trips</h1>
            </div>
            <p className="text-lg text-white/80 mb-8">
              Discover inspiring itineraries shared by travelers worldwide
            </p>

            {/* Search Bar */}
            <form onSubmit={handleSearch} className="max-w-2xl mx-auto">
              <div className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search destinations, cities, or countries..."
                  className="w-full pl-12 pr-4 py-4 rounded-xl text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[var(--accent)] shadow-lg"
                />
                <button
                  type="button"
                  onClick={() => setShowFilters(!showFilters)}
                  className={`absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-lg transition-colors ${
                    showFilters || hasActiveFilters
                      ? "bg-[var(--primary)] text-white"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  <Filter className="w-5 h-5" />
                </button>
              </div>
            </form>

            {/* Filter Panel */}
            {showFilters && (
              <div className="mt-4 bg-white rounded-xl p-4 shadow-lg text-left">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold text-gray-900">Filters</h3>
                  {hasActiveFilters && (
                    <button
                      onClick={clearFilters}
                      className="text-sm text-[var(--primary)] hover:underline flex items-center gap-1"
                    >
                      <X className="w-4 h-4" />
                      Clear all
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Budget
                    </label>
                    <select
                      value={budget}
                      onChange={(e) => {
                        setBudget(e.target.value);
                        setPage(1);
                      }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-gray-900"
                    >
                      {BUDGET_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Duration
                    </label>
                    <select
                      value={duration}
                      onChange={(e) => {
                        setDuration(e.target.value);
                        setPage(1);
                      }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-gray-900"
                    >
                      {DURATION_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Results Section */}
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Results Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-[var(--primary)]" />
            <span className="font-semibold text-gray-900">
              {loading ? "Loading..." : `${total} Trending Trip${total !== 1 ? "s" : ""}`}
            </span>
          </div>
          {hasActiveFilters && (
            <div className="flex items-center gap-2 flex-wrap">
              {searchQuery && (
                <span className="px-3 py-1 bg-gray-100 rounded-full text-sm text-gray-700 flex items-center gap-1">
                  {searchQuery}
                  <button onClick={() => setSearchQuery("")} className="hover:text-gray-900">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )}
              {budget && (
                <span className="px-3 py-1 bg-gray-100 rounded-full text-sm text-gray-700 flex items-center gap-1">
                  {BUDGET_OPTIONS.find((b) => b.value === budget)?.label}
                  <button onClick={() => setBudget("")} className="hover:text-gray-900">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )}
              {duration && (
                <span className="px-3 py-1 bg-gray-100 rounded-full text-sm text-gray-700 flex items-center gap-1">
                  {DURATION_OPTIONS.find((d) => d.value === duration)?.label}
                  <button onClick={() => setDuration("")} className="hover:text-gray-900">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )}
            </div>
          )}
        </div>

        {/* Loading State */}
        {loading && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="bg-white rounded-xl overflow-hidden shadow-sm animate-pulse">
                <div className="aspect-[4/3] bg-gray-200" />
                <div className="p-4 space-y-3">
                  <div className="h-4 bg-gray-200 rounded w-3/4" />
                  <div className="h-3 bg-gray-200 rounded w-1/2" />
                  <div className="h-3 bg-gray-200 rounded w-2/3" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Error State */}
        {error && !loading && (
          <div className="text-center py-12">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-100 mb-4">
              <X className="w-8 h-8 text-red-500" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Something went wrong</h3>
            <p className="text-gray-600 mb-4">{error}</p>
            <button
              onClick={fetchTrips}
              className="px-4 py-2 bg-[var(--primary)] text-white rounded-lg hover:bg-[var(--primary)]/90 transition-colors"
            >
              Try Again
            </button>
          </div>
        )}

        {/* Empty State */}
        {!loading && !error && trips.length === 0 && (
          <div className="text-center py-12">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gray-100 mb-4">
              <Compass className="w-8 h-8 text-gray-400" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No trips found</h3>
            <p className="text-gray-600 mb-4">
              {hasActiveFilters
                ? "Try adjusting your filters or search query"
                : "Be the first to share your trip with the community!"}
            </p>
            {hasActiveFilters ? (
              <button
                onClick={clearFilters}
                className="px-4 py-2 bg-[var(--primary)] text-white rounded-lg hover:bg-[var(--primary)]/90 transition-colors"
              >
                Clear Filters
              </button>
            ) : (
              <Link
                href="/trips/new"
                className="inline-flex items-center gap-2 px-4 py-2 bg-[var(--primary)] text-white rounded-lg hover:bg-[var(--primary)]/90 transition-colors"
              >
                <Sparkles className="w-4 h-4" />
                Plan Your Trip
              </Link>
            )}
          </div>
        )}

        {/* Trip Grid */}
        {!loading && !error && trips.length > 0 && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {trips.map((trip) => (
                <Link
                  key={trip.id}
                  href={`/trip/${trip.shareToken}`}
                  className="group bg-white rounded-xl overflow-hidden shadow-sm hover:shadow-lg transition-all duration-300 border border-gray-100"
                >
                  {/* Cover Image */}
                  <div className="aspect-[4/3] relative bg-gradient-to-br from-[var(--primary)]/20 to-[var(--accent)]/20 overflow-hidden">
                    {trip.coverImage ? (
                      <Image
                        src={trip.coverImage}
                        alt={trip.title}
                        fill
                        className="object-cover group-hover:scale-105 transition-transform duration-300"
                        sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
                      />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <MapPin className="w-12 h-12 text-[var(--primary)]/30" />
                      </div>
                    )}
                    {/* Trending Badge */}
                    {trip.trendingScore > 50 && (
                      <div className="absolute top-3 left-3 px-2 py-1 bg-[var(--accent)] text-gray-900 rounded-full text-xs font-semibold flex items-center gap-1 shadow-sm">
                        <TrendingUp className="w-3 h-3" />
                        Trending
                      </div>
                    )}
                    {/* Budget Badge */}
                    <div
                      className={`absolute top-3 right-3 px-2 py-1 rounded-full text-xs font-medium ${getBudgetColor(
                        trip.budgetTier
                      )}`}
                    >
                      {getBudgetLabel(trip.budgetTier)}
                    </div>
                  </div>

                  {/* Content */}
                  <div className="p-4">
                    <h3 className="font-semibold text-gray-900 line-clamp-1 group-hover:text-[var(--primary)] transition-colors">
                      {trip.title}
                    </h3>
                    <div className="flex items-center gap-1 text-sm text-gray-500 mt-1">
                      <MapPin className="w-3.5 h-3.5" />
                      <span className="line-clamp-1">{trip.destination}</span>
                    </div>
                    <div className="flex items-center gap-3 mt-3 text-xs text-gray-500">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5" />
                        {trip.durationDays} day{trip.durationDays !== 1 ? "s" : ""}
                      </span>
                      <span className="flex items-center gap-1">
                        <Eye className="w-3.5 h-3.5" />
                        {trip.viewCount}
                      </span>
                      <span className="flex items-center gap-1">
                        <Copy className="w-3.5 h-3.5" />
                        {trip.copyCount}
                      </span>
                    </div>
                    {/* Tags */}
                    {trip.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-3">
                        {trip.tags.slice(0, 3).map((tag) => (
                          <span
                            key={tag}
                            className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-xs"
                          >
                            {tag}
                          </span>
                        ))}
                        {trip.tags.length > 3 && (
                          <span className="px-2 py-0.5 text-gray-400 text-xs">
                            +{trip.tags.length - 3}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </Link>
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 mt-8">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <div className="flex items-center gap-1">
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    let pageNum: number;
                    if (totalPages <= 5) {
                      pageNum = i + 1;
                    } else if (page <= 3) {
                      pageNum = i + 1;
                    } else if (page >= totalPages - 2) {
                      pageNum = totalPages - 4 + i;
                    } else {
                      pageNum = page - 2 + i;
                    }
                    return (
                      <button
                        key={pageNum}
                        onClick={() => setPage(pageNum)}
                        className={`w-10 h-10 rounded-lg font-medium transition-colors ${
                          page === pageNum
                            ? "bg-[var(--primary)] text-white"
                            : "hover:bg-gray-100 text-gray-700"
                        }`}
                      >
                        {pageNum}
                      </button>
                    );
                  })}
                </div>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* CTA Section */}
      <div className="bg-gradient-to-r from-[var(--primary)] to-[#0A6B9E] text-white py-12 mt-8">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <Sparkles className="w-10 h-10 mx-auto mb-4 text-[var(--accent)]" />
          <h2 className="text-2xl sm:text-3xl font-bold mb-4">
            Ready to plan your own adventure?
          </h2>
          <p className="text-white/80 mb-6 max-w-lg mx-auto">
            Create AI-powered itineraries, discover hidden gems, and share your trips with
            travelers worldwide.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              href="/trips/new"
              className="w-full sm:w-auto px-6 py-3 bg-[var(--accent)] text-gray-900 rounded-xl font-semibold hover:bg-[var(--accent)]/90 transition-colors flex items-center justify-center gap-2"
            >
              <Sparkles className="w-5 h-5" />
              Start Planning
            </Link>
            <Link
              href="/auth/signup"
              className="w-full sm:w-auto px-6 py-3 bg-white/10 text-white rounded-xl font-semibold hover:bg-white/20 transition-colors backdrop-blur-sm"
            >
              Sign Up Free
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
