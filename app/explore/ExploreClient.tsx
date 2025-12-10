"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import Image from "next/image";
import { Search, MapPin, Clock, TrendingUp, Copy, Eye, Loader2, Sparkles } from "lucide-react";

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

// Country code to flag emoji
function getFlagEmoji(countryCode: string | null): string {
  if (!countryCode) return "🌍";
  const codePoints = countryCode
    .toUpperCase()
    .split("")
    .map((char) => 127397 + char.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}

// Budget tier display
function getBudgetLabel(tier: string): string {
  switch (tier) {
    case "budget": return "Budget";
    case "balanced": return "Balanced";
    case "luxury": return "Luxury";
    default: return "Balanced";
  }
}

// Duration filter options
const durationFilters = [
  { label: "Any", min: null, max: null },
  { label: "1-3 days", min: 1, max: 3 },
  { label: "4-7 days", min: 4, max: 7 },
  { label: "8-14 days", min: 8, max: 14 },
  { label: "15+ days", min: 15, max: null },
];

// Budget filter options
const budgetFilters = ["any", "budget", "balanced", "luxury"];

export default function ExploreClient() {
  const [trips, setTrips] = useState<TrendingTrip[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [durationFilter, setDurationFilter] = useState(0); // index into durationFilters
  const [budgetFilter, setBudgetFilter] = useState("any");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  const fetchTrips = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("page", page.toString());
      params.set("per_page", "12");

      if (searchQuery) {
        params.set("destination", searchQuery);
      }

      const duration = durationFilters[durationFilter];
      if (duration.min !== null) {
        params.set("duration_min", duration.min.toString());
      }
      if (duration.max !== null) {
        params.set("duration_max", duration.max.toString());
      }

      if (budgetFilter !== "any") {
        params.set("budget", budgetFilter);
      }

      const response = await fetch(`/api/explore/trips?${params.toString()}`);
      const data = await response.json();

      if (response.ok) {
        setTrips(data.trips);
        setTotalPages(data.totalPages);
        setTotal(data.total);
      }
    } catch (error) {
      console.error("Failed to fetch trips:", error);
    } finally {
      setLoading(false);
    }
  }, [page, searchQuery, durationFilter, budgetFilter]);

  useEffect(() => {
    fetchTrips();
  }, [fetchTrips]);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [searchQuery, durationFilter, budgetFilter]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      {/* Navbar */}
      <nav className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-slate-100">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <Image
              src="/images/logo.png"
              alt="MonkeyTravel"
              width={32}
              height={32}
              className="w-8 h-8"
            />
            <span className="font-bold text-[var(--primary)]">MonkeyTravel</span>
          </Link>
          <div className="flex items-center gap-3">
            <Link
              href="/trips/new"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[var(--primary)] text-white text-sm font-medium hover:bg-[var(--primary)]/90 transition-colors"
            >
              <Sparkles className="w-4 h-4" />
              Create Trip
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <div className="bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 py-16">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <h1 className="text-4xl md:text-5xl font-bold text-slate-900 mb-4">
            Discover Amazing Trips
          </h1>
          <p className="text-lg text-slate-600 mb-8">
            Get inspired by AI-generated itineraries from travelers around the world
          </p>

          {/* Search Bar */}
          <div className="max-w-2xl mx-auto">
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search destinations (e.g., Tokyo, Paris, Bali...)"
                className="w-full pl-12 pr-4 py-4 rounded-2xl border border-slate-200 bg-white shadow-lg focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 outline-none text-lg"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="sticky top-16 z-40 bg-white border-b border-slate-100 py-4">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex flex-wrap items-center gap-4">
            {/* Duration Filter */}
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-slate-500" />
              <div className="flex gap-1">
                {durationFilters.map((filter, index) => (
                  <button
                    key={filter.label}
                    onClick={() => setDurationFilter(index)}
                    className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                      durationFilter === index
                        ? "bg-[var(--primary)] text-white"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Budget Filter */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-500">Budget:</span>
              <div className="flex gap-1">
                {budgetFilters.map((filter) => (
                  <button
                    key={filter}
                    onClick={() => setBudgetFilter(filter)}
                    className={`px-3 py-1.5 rounded-full text-sm font-medium capitalize transition-colors ${
                      budgetFilter === filter
                        ? "bg-[var(--primary)] text-white"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    {filter === "any" ? "Any" : getBudgetLabel(filter)}
                  </button>
                ))}
              </div>
            </div>

            {/* Results count */}
            <div className="ml-auto text-sm text-slate-500">
              {total} trips found
            </div>
          </div>
        </div>
      </div>

      {/* Trip Grid */}
      <div className="max-w-7xl mx-auto px-4 py-12">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 text-[var(--primary)] animate-spin" />
          </div>
        ) : trips.length === 0 ? (
          <div className="text-center py-20">
            <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <MapPin className="w-10 h-10 text-slate-400" />
            </div>
            <h3 className="text-xl font-semibold text-slate-900 mb-2">No trips found</h3>
            <p className="text-slate-600 mb-6">
              Try adjusting your filters or be the first to share a trip!
            </p>
            <Link
              href="/trips/new"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-[var(--primary)] text-white font-medium hover:bg-[var(--primary)]/90 transition-colors"
            >
              <Sparkles className="w-5 h-5" />
              Create Your Trip
            </Link>
          </div>
        ) : (
          <>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {trips.map((trip, index) => (
                <TripCard key={trip.id} trip={trip} index={index} />
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 mt-12">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-4 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Previous
                </button>
                <span className="px-4 py-2 text-slate-600">
                  Page {page} of {totalPages}
                </span>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="px-4 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* CTA */}
      <div className="bg-gradient-to-br from-[var(--primary)] to-blue-700 py-16">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <h2 className="text-3xl font-bold text-white mb-4">
            Ready to plan your own adventure?
          </h2>
          <p className="text-blue-100 mb-8">
            Create a personalized AI-powered itinerary in under 30 seconds
          </p>
          <Link
            href="/trips/new"
            className="inline-flex items-center gap-2 px-8 py-4 rounded-xl bg-white text-[var(--primary)] font-semibold hover:bg-blue-50 transition-colors shadow-lg"
          >
            <Sparkles className="w-5 h-5" />
            Start Planning for Free
          </Link>
        </div>
      </div>

      {/* Footer */}
      <footer className="py-8 border-t border-slate-100">
        <div className="max-w-7xl mx-auto px-4 text-center">
          <p className="text-sm text-slate-500">
            &copy; {new Date().getFullYear()} MonkeyTravel. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}

// Trip Card Component
function TripCard({ trip, index }: { trip: TrendingTrip; index: number }) {
  const isTrending = index < 3;

  return (
    <Link
      href={`/shared/${trip.shareToken}?source=trending`}
      className="group bg-white rounded-2xl overflow-hidden shadow-md hover:shadow-xl transition-all hover:-translate-y-1 border border-slate-100"
    >
      {/* Cover Image */}
      <div className="relative aspect-[16/10] bg-gradient-to-br from-slate-100 to-slate-200">
        {trip.coverImage ? (
          <Image
            src={trip.coverImage}
            alt={trip.title}
            fill
            className="object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <MapPin className="w-12 h-12 text-slate-300" />
          </div>
        )}

        {/* Overlay gradient */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/0 to-black/0" />

        {/* Trending badge */}
        {isTrending && (
          <div className="absolute top-3 left-3 flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white text-xs font-bold rounded-full shadow-lg">
            <TrendingUp className="w-3.5 h-3.5" />
            Trending
          </div>
        )}

        {/* Destination */}
        <div className="absolute bottom-3 left-3 flex items-center gap-2 text-white">
          <span className="text-2xl">{getFlagEmoji(trip.countryCode)}</span>
          <span className="font-semibold text-lg drop-shadow-lg">{trip.destination}</span>
        </div>
      </div>

      {/* Content */}
      <div className="p-4">
        <h3 className="font-semibold text-slate-900 mb-1 line-clamp-2 group-hover:text-[var(--primary)] transition-colors">
          {trip.title}
        </h3>

        {/* Stats */}
        <div className="flex items-center gap-4 text-sm text-slate-500 mt-3">
          <span className="flex items-center gap-1">
            <Clock className="w-4 h-4" />
            {trip.durationDays} days
          </span>
          <span className="flex items-center gap-1">
            <Copy className="w-4 h-4" />
            {trip.copyCount} saved
          </span>
          <span className="flex items-center gap-1">
            <Eye className="w-4 h-4" />
            {trip.viewCount}
          </span>
        </div>

        {/* Tags */}
        {trip.tags && trip.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {trip.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="px-2 py-0.5 bg-slate-100 text-slate-600 text-xs rounded-full"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </Link>
  );
}
