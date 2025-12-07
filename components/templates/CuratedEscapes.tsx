"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Sparkles, ChevronRight, Users } from "lucide-react";

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

// Mood tag configuration
const MOOD_OPTIONS: Record<string, { label: string; emoji: string }> = {
  romantic: { label: "Romantic", emoji: "💕" },
  adventure: { label: "Adventure", emoji: "🏔️" },
  cultural: { label: "Cultural", emoji: "🏛️" },
  relaxation: { label: "Relaxation", emoji: "🌴" },
  foodie: { label: "Foodie", emoji: "🍝" },
  family: { label: "Family", emoji: "👨‍👩‍👧‍👦" },
};

// Country code to flag emoji
function getFlagEmoji(countryCode: string): string {
  if (!countryCode) return "🌍";
  const codePoints = countryCode
    .toUpperCase()
    .split("")
    .map((char) => 127397 + char.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}

// Gradient fallbacks by destination
const DESTINATION_GRADIENTS: Record<string, { from: string; to: string }> = {
  paris: { from: "#E8B4B8", to: "#D4919A" },
  rome: { from: "#C9A86C", to: "#9E7B4F" },
  tokyo: { from: "#FFB7C5", to: "#FF6B9D" },
  barcelona: { from: "#F6AD55", to: "#ED8936" },
  bali: { from: "#4FD1C5", to: "#38B2AC" },
  london: { from: "#6B7B8C", to: "#4A5568" },
  dubai: { from: "#D69E2E", to: "#B7791F" },
  amsterdam: { from: "#68D391", to: "#48BB78" },
  santorini: { from: "#63B3ED", to: "#4299E1" },
  iceland: { from: "#A0AEC0", to: "#718096" },
  default: { from: "#718096", to: "#4A5568" },
};

function getGradient(destination: string) {
  const key = destination.toLowerCase().split(",")[0].trim();
  return DESTINATION_GRADIENTS[key] || DESTINATION_GRADIENTS.default;
}

interface TemplateCardProps {
  template: TemplateTrip;
}

function TemplateCard({ template }: TemplateCardProps) {
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
    <Link
      href={`/trips/template/${template.id}`}
      className="group bg-white rounded-2xl border border-slate-200 overflow-hidden hover:shadow-xl transition-all duration-300 hover:border-slate-300 hover:-translate-y-1 block"
    >
      {/* Cover Image */}
      <div
        className="h-40 sm:h-48 relative overflow-hidden"
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
            alt={template.title}
            onLoad={() => setImageLoaded(true)}
            onError={() => setImageError(true)}
            className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-500 group-hover:scale-105 ${
              imageLoaded ? "opacity-100" : "opacity-0"
            }`}
          />
        )}

        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />

        {/* Duration badge */}
        <div className="absolute top-3 left-3">
          <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-white/90 backdrop-blur-sm text-slate-700 shadow">
            {template.durationDays} days
          </span>
        </div>

        {/* Budget badge */}
        <div className="absolute top-3 right-3">
          <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-white/90 backdrop-blur-sm text-amber-600 shadow">
            {budgetLabel}
          </span>
        </div>

        {/* Destination + Country */}
        <div className="absolute bottom-0 left-0 right-0 p-4">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg">{getFlagEmoji(template.countryCode)}</span>
            <span className="text-white/80 text-sm">{template.country}</span>
          </div>
          <h3 className="text-xl font-bold text-white drop-shadow-lg line-clamp-1">
            {template.destination}
          </h3>
        </div>
      </div>

      {/* Info */}
      <div className="p-4">
        {/* Description */}
        <p className="text-slate-600 text-sm line-clamp-2 mb-3">
          {template.description}
        </p>

        {/* Mood tags */}
        <div className="flex flex-wrap gap-1.5 mb-4">
          {template.moodTags.slice(0, 3).map((mood) => {
            const option = MOOD_OPTIONS[mood];
            return (
              <span
                key={mood}
                className="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600"
              >
                {option?.emoji} {option?.label || mood}
              </span>
            );
          })}
        </div>

        {/* CTA */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-400 flex items-center gap-1">
            {template.copyCount > 0 && (
              <>
                <Users className="w-3.5 h-3.5" />
                {template.copyCount} travelers
              </>
            )}
          </span>
          <span className="text-[var(--primary)] font-medium text-sm flex items-center gap-1 group-hover:gap-2 transition-all">
            Explore
            <ChevronRight className="w-4 h-4" />
          </span>
        </div>
      </div>
    </Link>
  );
}

export default function CuratedEscapes() {
  const [templates, setTemplates] = useState<TemplateTrip[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch templates (no filters - fetch all featured)
  useEffect(() => {
    const fetchTemplates = async () => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch("/api/templates?limit=6");
        if (!response.ok) throw new Error("Failed to fetch templates");

        const data = await response.json();
        setTemplates(data.templates || []);
      } catch (err) {
        console.error("Error fetching templates:", err);
        setError("Failed to load templates");
      } finally {
        setLoading(false);
      }
    };

    fetchTemplates();
  }, []);

  // Don't render if no templates available
  if (!loading && templates.length === 0) {
    return null;
  }

  return (
    <section className="mb-10">
      {/* Section Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[var(--primary)] to-[var(--accent)] flex items-center justify-center shadow-lg">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-900">Curated Escapes</h2>
            <p className="text-sm text-slate-500">
              Hand-picked itineraries ready to explore
            </p>
          </div>
        </div>

        {/* Future: Browse All button when more templates exist */}
        {templates.length >= 6 && (
          <Link
            href="/templates"
            className="text-sm text-[var(--primary)] font-medium hover:underline flex items-center gap-1"
          >
            Browse All
            <ChevronRight className="w-4 h-4" />
          </Link>
        )}
      </div>

      {/* Templates Grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="bg-white rounded-2xl border border-slate-200 overflow-hidden animate-pulse"
            >
              <div className="h-48 bg-slate-200" />
              <div className="p-4 space-y-3">
                <div className="h-4 bg-slate-200 rounded w-3/4" />
                <div className="h-4 bg-slate-200 rounded w-1/2" />
                <div className="flex gap-2">
                  <div className="h-6 w-16 bg-slate-200 rounded-full" />
                  <div className="h-6 w-16 bg-slate-200 rounded-full" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="text-center py-8 bg-red-50 rounded-xl border border-red-100">
          <p className="text-red-600">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-2 text-sm text-red-700 font-medium hover:underline"
          >
            Try again
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
          {templates.map((template) => (
            <TemplateCard key={template.id} template={template} />
          ))}
        </div>
      )}
    </section>
  );
}
