"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles,
  Search,
  X,
  ChevronRight,
  ChevronLeft,
  Users,
  MapPin,
  Calendar,
  Wallet,
  ArrowLeft,
  Compass,
  Globe,
  Plane,
} from "lucide-react";
import MobileBottomNav from "@/components/ui/MobileBottomNav";

interface TemplateTrip {
  id: string;
  title: string;
  description: string;
  destination: string;
  country: string;
  countryCode: string;
  coverImageUrl: string;
  durationDays: number;
  budgetTier: "budget" | "moderate" | "luxury";
  moodTags: string[];
  tags: string[];
  copyCount: number;
}

// Mood options with emojis
const MOOD_OPTIONS = [
  { id: "all", label: "All", emoji: "✨" },
  { id: "romantic", label: "Romantic", emoji: "💕" },
  { id: "adventure", label: "Adventure", emoji: "🏔️" },
  { id: "cultural", label: "Cultural", emoji: "🏛️" },
  { id: "relaxation", label: "Relaxation", emoji: "🌴" },
  { id: "foodie", label: "Foodie", emoji: "🍝" },
  { id: "family", label: "Family", emoji: "👨‍👩‍👧‍👦" },
];

// Duration quick filters
const DURATION_FILTERS = [
  { value: 0, label: "Any" },
  { value: 5, label: "5 days" },
  { value: 7, label: "1 week" },
  { value: 10, label: "10+ days" },
];

// Budget quick filters
const BUDGET_FILTERS = [
  { value: "", label: "Any", icon: "💰" },
  { value: "budget", label: "€", icon: "€" },
  { value: "moderate", label: "€€", icon: "€€" },
  { value: "luxury", label: "€€€", icon: "€€€" },
];

// Gradient fallbacks for destinations
const DESTINATION_GRADIENTS: Record<string, { from: string; to: string }> = {
  paris: { from: "#E8B4B8", to: "#D4919A" },
  rome: { from: "#C9A86C", to: "#9E7B4F" },
  tokyo: { from: "#FFB7C5", to: "#FF6B9D" },
  barcelona: { from: "#F6AD55", to: "#ED8936" },
  bali: { from: "#4FD1C5", to: "#38B2AC" },
  "new york": { from: "#667EEA", to: "#764BA2" },
  default: { from: "#718096", to: "#4A5568" },
};

function getGradient(destination: string) {
  const key = destination.toLowerCase().split(",")[0].trim();
  return DESTINATION_GRADIENTS[key] || DESTINATION_GRADIENTS.default;
}

function getFlagEmoji(countryCode: string): string {
  if (!countryCode) return "🌍";
  const codePoints = countryCode
    .toUpperCase()
    .split("")
    .map((char) => 127397 + char.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}

// Featured Template Card - Hero style
function FeaturedCard({ template }: { template: TemplateTrip }) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const gradient = getGradient(template.destination);

  return (
    <Link
      href={`/trips/template/${template.id}`}
      className="group relative block rounded-2xl overflow-hidden aspect-[16/9] md:aspect-[21/9]"
    >
      {/* Background */}
      <div
        className="absolute inset-0"
        style={{
          background: `linear-gradient(135deg, ${gradient.from} 0%, ${gradient.to} 100%)`,
        }}
      />
      {template.coverImageUrl && (
        <img
          src={template.coverImageUrl}
          alt={template.destination}
          onLoad={() => setImageLoaded(true)}
          className={`absolute inset-0 w-full h-full object-cover transition-all duration-700 group-hover:scale-105 ${
            imageLoaded ? "opacity-100" : "opacity-0"
          }`}
        />
      )}

      {/* Gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/40 to-transparent" />

      {/* Content */}
      <div className="absolute inset-0 p-6 md:p-8 flex flex-col justify-end">
        <div className="max-w-lg">
          <div className="flex items-center gap-2 mb-2">
            <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-[var(--accent)] text-[var(--primary-dark)]">
              Featured
            </span>
            <span className="text-white/80 text-sm flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5" />
              {template.durationDays} days
            </span>
          </div>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-2xl">{getFlagEmoji(template.countryCode)}</span>
            <span className="text-white/70 text-sm">{template.country}</span>
          </div>
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-2 drop-shadow-lg">
            {template.destination}
          </h2>
          <p className="text-white/80 text-sm md:text-base line-clamp-2 mb-4 max-w-md">
            {template.description}
          </p>
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-2 px-4 py-2 bg-white text-[var(--primary)] font-semibold rounded-lg text-sm group-hover:bg-[var(--accent)] group-hover:text-[var(--primary-dark)] transition-colors">
              Explore Itinerary
              <ChevronRight className="w-4 h-4" />
            </span>
            {template.copyCount > 0 && (
              <span className="text-white/60 text-xs flex items-center gap-1">
                <Users className="w-3.5 h-3.5" />
                {template.copyCount} travelers
              </span>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}

// Template Card Component - Mobile Optimized
function TemplateCard({ template, index }: { template: TemplateTrip; index: number }) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const gradient = getGradient(template.destination);

  const budgetLabel =
    template.budgetTier === "budget"
      ? "€"
      : template.budgetTier === "moderate"
      ? "€€"
      : "€€€";

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.03, duration: 0.3 }}
    >
      <Link
        href={`/trips/template/${template.id}`}
        className="group bg-white rounded-2xl border border-slate-200/80 overflow-hidden hover:shadow-xl transition-all duration-300 hover:border-slate-300 hover:-translate-y-1 block active:scale-[0.98]"
      >
        {/* Cover Image - Responsive aspect ratio */}
        <div
          className="aspect-[4/3] sm:aspect-[16/10] relative overflow-hidden"
          style={{
            background:
              !template.coverImageUrl || imageError
                ? `linear-gradient(135deg, ${gradient.from} 0%, ${gradient.to} 100%)`
                : undefined,
          }}
        >
          {template.coverImageUrl && !imageError && (
            <img
              src={template.coverImageUrl}
              alt={template.destination}
              onLoad={() => setImageLoaded(true)}
              onError={() => setImageError(true)}
              className={`absolute inset-0 w-full h-full object-cover transition-all duration-500 group-hover:scale-105 ${
                imageLoaded ? "opacity-100" : "opacity-0"
              }`}
            />
          )}

          {/* Gradient overlay - stronger for better text readability */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />

          {/* Top badges row */}
          <div className="absolute top-3 left-3 right-3 flex justify-between items-start">
            <span className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-white/95 backdrop-blur-sm text-slate-700 flex items-center gap-1.5 shadow-sm">
              <Calendar className="w-3.5 h-3.5 text-slate-500" />
              {template.durationDays} days
            </span>
            <span className="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-amber-400/95 backdrop-blur-sm text-amber-900 shadow-sm">
              {budgetLabel}
            </span>
          </div>

          {/* Destination info - at bottom of image */}
          <div className="absolute bottom-0 left-0 right-0 p-4">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-lg drop-shadow-md">{getFlagEmoji(template.countryCode)}</span>
              <span className="text-white/90 text-xs font-medium tracking-wide uppercase">{template.country}</span>
            </div>
            <h3 className="text-xl sm:text-2xl font-bold text-white drop-shadow-lg leading-tight">
              {template.destination}
            </h3>
          </div>
        </div>

        {/* Info section - compact and touch-friendly */}
        <div className="p-4">
          {/* Description - single line on mobile for consistency */}
          <p className="text-slate-600 text-sm leading-relaxed line-clamp-2 mb-3">
            {template.description}
          </p>

          {/* Mood tags - horizontal scroll on mobile, max 2 visible */}
          <div className="flex gap-2 mb-4 overflow-x-auto scrollbar-hide -mx-1 px-1 pb-1">
            {template.moodTags.slice(0, 2).map((mood) => {
              const option = MOOD_OPTIONS.find((m) => m.id === mood);
              return (
                <span
                  key={mood}
                  className="flex-shrink-0 px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-100 text-slate-600 whitespace-nowrap"
                >
                  {option?.emoji} {option?.label || mood}
                </span>
              );
            })}
            {template.moodTags.length > 2 && (
              <span className="flex-shrink-0 px-2 py-1 rounded-lg text-xs font-medium bg-slate-50 text-slate-400">
                +{template.moodTags.length - 2}
              </span>
            )}
          </div>

          {/* CTA - larger touch target */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400 flex items-center gap-1.5">
              {template.copyCount > 0 && (
                <>
                  <Users className="w-4 h-4" />
                  <span>{template.copyCount} used</span>
                </>
              )}
            </span>
            <span className="text-[var(--primary)] font-semibold text-sm flex items-center gap-1 group-hover:gap-2 transition-all py-1">
              Explore
              <ChevronRight className="w-4 h-4" />
            </span>
          </div>
        </div>
      </Link>
    </motion.div>
  );
}

// Empty State Component
function EmptyState({ onClear }: { onClear: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="text-center py-16 px-4"
    >
      <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-slate-100 flex items-center justify-center">
        <Compass className="w-8 h-8 text-slate-400" />
      </div>
      <h3 className="text-lg font-bold text-slate-900 mb-2">No itineraries found</h3>
      <p className="text-slate-500 mb-6 text-sm max-w-sm mx-auto">
        Try adjusting your filters to discover more curated escapes.
      </p>
      <button
        onClick={onClear}
        className="px-5 py-2.5 bg-[var(--primary)] text-white font-medium rounded-lg hover:bg-[var(--primary)]/90 transition-colors text-sm"
      >
        Clear filters
      </button>
    </motion.div>
  );
}

// Loading Skeleton - matches new card design
function SkeletonCard() {
  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 overflow-hidden animate-pulse">
      <div className="aspect-[4/3] sm:aspect-[16/10] bg-slate-200" />
      <div className="p-4 space-y-3">
        <div className="h-3 bg-slate-200 rounded w-full" />
        <div className="h-3 bg-slate-200 rounded w-2/3" />
        <div className="flex gap-2">
          <div className="h-6 w-16 bg-slate-100 rounded-lg" />
          <div className="h-6 w-16 bg-slate-100 rounded-lg" />
        </div>
      </div>
    </div>
  );
}

export default function TemplatesPageClient() {
  const [templates, setTemplates] = useState<TemplateTrip[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedMood, setSelectedMood] = useState("all");
  const [selectedDuration, setSelectedDuration] = useState(0);
  const [selectedBudget, setSelectedBudget] = useState("");
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const moodScrollRef = useRef<HTMLDivElement>(null);

  // Fetch all templates
  useEffect(() => {
    const fetchTemplates = async () => {
      setLoading(true);
      try {
        const response = await fetch("/api/templates?limit=50");
        if (!response.ok) throw new Error("Failed to fetch");
        const data = await response.json();
        setTemplates(data.templates || []);
      } catch (error) {
        console.error("Error fetching templates:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchTemplates();
  }, []);

  // Filter templates
  const filteredTemplates = useMemo(() => {
    return templates.filter((template) => {
      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesSearch =
          template.destination.toLowerCase().includes(query) ||
          template.country.toLowerCase().includes(query) ||
          template.description.toLowerCase().includes(query);
        if (!matchesSearch) return false;
      }

      // Mood filter
      if (selectedMood !== "all") {
        if (!template.moodTags.includes(selectedMood)) return false;
      }

      // Duration filter
      if (selectedDuration > 0) {
        if (selectedDuration === 10) {
          if (template.durationDays < 10) return false;
        } else {
          if (template.durationDays !== selectedDuration) return false;
        }
      }

      // Budget filter
      if (selectedBudget && template.budgetTier !== selectedBudget) {
        return false;
      }

      return true;
    });
  }, [templates, searchQuery, selectedMood, selectedDuration, selectedBudget]);

  // Get featured template (most copied or first one)
  const featuredTemplate = useMemo(() => {
    if (templates.length === 0) return null;
    return [...templates].sort((a, b) => b.copyCount - a.copyCount)[0];
  }, [templates]);

  // Remaining templates (excluding featured)
  const remainingTemplates = useMemo(() => {
    if (!featuredTemplate) return filteredTemplates;
    return filteredTemplates.filter((t) => t.id !== featuredTemplate.id);
  }, [filteredTemplates, featuredTemplate]);

  const hasActiveFilters =
    searchQuery || selectedMood !== "all" || selectedDuration > 0 || selectedBudget;

  const clearFilters = () => {
    setSearchQuery("");
    setSelectedMood("all");
    setSelectedDuration(0);
    setSelectedBudget("");
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Compact Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Top bar with back and title */}
          <div className="flex items-center justify-between py-3 border-b border-slate-100">
            <Link
              href="/trips"
              className="flex items-center gap-2 text-slate-600 hover:text-slate-900 transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
              <span className="text-sm font-medium hidden sm:inline">My Trips</span>
            </Link>

            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-[var(--accent)]" />
              <h1 className="text-lg font-bold text-slate-900">Curated Escapes</h1>
            </div>

            <Link
              href="/trips/new"
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--primary)] text-white text-sm font-medium rounded-lg hover:bg-[var(--primary)]/90 transition-colors"
            >
              <Plane className="w-4 h-4" />
              <span className="hidden sm:inline">Create Trip</span>
            </Link>
          </div>

          {/* Search bar */}
          <div className="py-3">
            <div className="relative max-w-xl">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search destinations..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onFocus={() => setIsSearchFocused(true)}
                onBlur={() => setIsSearchFocused(false)}
                className={`w-full pl-10 pr-10 py-2.5 rounded-xl border text-sm transition-all ${
                  isSearchFocused
                    ? "border-[var(--primary)] ring-2 ring-[var(--primary)]/20"
                    : "border-slate-200"
                } bg-slate-50 focus:bg-white focus:outline-none`}
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-slate-200 flex items-center justify-center hover:bg-slate-300 transition-colors"
                >
                  <X className="w-3 h-3 text-slate-500" />
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Mood Filter Pills - Horizontal scroll */}
      <div className="bg-white border-b border-slate-200 sticky top-[105px] z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div
            ref={moodScrollRef}
            className="flex items-center gap-2 py-3 overflow-x-auto scrollbar-hide"
            style={{ WebkitOverflowScrolling: "touch" }}
          >
            {MOOD_OPTIONS.map((mood) => (
              <button
                key={mood.id}
                onClick={() => setSelectedMood(mood.id)}
                className={`flex-shrink-0 px-4 py-2 rounded-full text-sm font-medium transition-all ${
                  selectedMood === mood.id
                    ? "bg-[var(--primary)] text-white shadow-md"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {mood.emoji} {mood.label}
              </button>
            ))}

            {/* Divider */}
            <div className="w-px h-6 bg-slate-200 flex-shrink-0 mx-1" />

            {/* Duration filters */}
            {DURATION_FILTERS.map((dur) => (
              <button
                key={dur.value}
                onClick={() => setSelectedDuration(dur.value)}
                className={`flex-shrink-0 px-3 py-2 rounded-full text-sm font-medium transition-all ${
                  selectedDuration === dur.value
                    ? "bg-slate-800 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {dur.label}
              </button>
            ))}

            {/* Divider */}
            <div className="w-px h-6 bg-slate-200 flex-shrink-0 mx-1" />

            {/* Budget filters */}
            {BUDGET_FILTERS.map((bud) => (
              <button
                key={bud.value}
                onClick={() => setSelectedBudget(bud.value)}
                className={`flex-shrink-0 px-3 py-2 rounded-full text-sm font-medium transition-all ${
                  selectedBudget === bud.value
                    ? "bg-amber-500 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {bud.icon}
              </button>
            ))}

            {/* Clear filters */}
            {hasActiveFilters && (
              <>
                <div className="w-px h-6 bg-slate-200 flex-shrink-0 mx-1" />
                <button
                  onClick={clearFilters}
                  className="flex-shrink-0 px-3 py-2 rounded-full text-sm font-medium text-red-600 hover:bg-red-50 transition-colors flex items-center gap-1"
                >
                  <X className="w-3.5 h-3.5" />
                  Clear
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Loading state */}
        {loading && (
          <>
            {/* Featured skeleton */}
            <div className="mb-6 rounded-2xl bg-slate-200 animate-pulse aspect-[16/9] md:aspect-[21/9]" />
            {/* Grid skeleton - matches 2-column mobile layout */}
            <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <SkeletonCard key={i} />
              ))}
            </div>
          </>
        )}

        {/* Empty state */}
        {!loading && filteredTemplates.length === 0 && (
          <EmptyState onClear={clearFilters} />
        )}

        {/* Content */}
        {!loading && filteredTemplates.length > 0 && (
          <>
            {/* Featured Template - Only show when no filters active */}
            {!hasActiveFilters && featuredTemplate && (
              <section className="mb-8">
                <FeaturedCard template={featuredTemplate} />
              </section>
            )}

            {/* Results count */}
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm text-slate-500">
                {hasActiveFilters ? (
                  <>
                    <span className="font-medium text-slate-900">{filteredTemplates.length}</span>{" "}
                    {filteredTemplates.length === 1 ? "itinerary" : "itineraries"} found
                  </>
                ) : (
                  <>
                    <span className="font-medium text-slate-900">{remainingTemplates.length}</span>{" "}
                    more curated escapes
                  </>
                )}
              </p>
              <div className="flex items-center gap-1 text-xs text-slate-400">
                <Globe className="w-3.5 h-3.5" />
                Hand-picked by experts
              </div>
            </div>

            {/* Templates Grid - 2 columns on mobile for better space usage */}
            <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
              {(hasActiveFilters ? filteredTemplates : remainingTemplates).map((template, index) => (
                <TemplateCard key={template.id} template={template} index={index} />
              ))}
            </div>
          </>
        )}
      </main>

      {/* Bottom CTA */}
      {!loading && (
        <section className="bg-gradient-to-br from-[var(--primary)] to-[var(--primary)]/80 mt-8">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
            <div className="flex flex-col md:flex-row items-center justify-between gap-6">
              <div className="text-center md:text-left">
                <h2 className="text-2xl font-bold text-white mb-2">
                  Can't find what you're looking for?
                </h2>
                <p className="text-white/80 text-sm">
                  Create a personalized itinerary with our AI travel planner
                </p>
              </div>
              <Link
                href="/trips/new"
                className="inline-flex items-center gap-2 px-6 py-3 bg-white text-[var(--primary)] font-semibold rounded-xl hover:bg-[var(--accent)] hover:text-[var(--primary-dark)] transition-all shadow-lg"
              >
                <Sparkles className="w-5 h-5" />
                Create Custom Trip
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* Spacer for mobile nav */}
      <div className="h-4" />

      {/* Mobile Bottom Navigation */}
      <MobileBottomNav activePage="trips" />
    </div>
  );
}
