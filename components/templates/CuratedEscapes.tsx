"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";

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
const MOOD_OPTIONS = [
  { id: "romantic", label: "Romantic", emoji: "💕" },
  { id: "adventure", label: "Adventure", emoji: "🏔️" },
  { id: "cultural", label: "Cultural", emoji: "🏛️" },
  { id: "relaxation", label: "Relaxation", emoji: "🌴" },
  { id: "foodie", label: "Foodie", emoji: "🍝" },
  { id: "family", label: "Family", emoji: "👨‍👩‍👧‍👦" },
];

const DURATION_OPTIONS = [
  { value: 7, label: "7 days" },
  { value: 10, label: "10 days" },
  { value: 14, label: "14 days" },
];

const BUDGET_OPTIONS = [
  { value: "budget", label: "€", description: "Budget" },
  { value: "moderate", label: "€€", description: "Moderate" },
  { value: "luxury", label: "€€€", description: "Luxury" },
];

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
  onSelect: (template: TemplateTrip) => void;
}

function TemplateCard({ template, onSelect }: TemplateCardProps) {
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
    <button
      onClick={() => onSelect(template)}
      className="group bg-white rounded-2xl border border-slate-200 overflow-hidden hover:shadow-xl transition-all duration-300 hover:border-slate-300 hover:-translate-y-1 text-left w-full"
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
            className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-500 ${
              imageLoaded ? "opacity-100" : "opacity-0"
            }`}
          />
        )}

        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />

        {/* Duration badge */}
        <div className="absolute top-3 left-3">
          <span className="px-2 py-1 rounded-full text-xs font-semibold bg-white/90 backdrop-blur-sm text-slate-700 shadow">
            {template.durationDays} days
          </span>
        </div>

        {/* Budget badge */}
        <div className="absolute top-3 right-3">
          <span className="px-2 py-1 rounded-full text-xs font-semibold bg-white/90 backdrop-blur-sm text-amber-600 shadow">
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
            const option = MOOD_OPTIONS.find((o) => o.id === mood);
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
          <span className="text-xs text-slate-400">
            {template.copyCount > 0 && `${template.copyCount} travelers used this`}
          </span>
          <span className="text-[var(--primary)] font-medium text-sm flex items-center gap-1 group-hover:gap-2 transition-all">
            Start Planning
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5l7 7-7 7"
              />
            </svg>
          </span>
        </div>
      </div>
    </button>
  );
}

interface DatePickerModalProps {
  template: TemplateTrip | null;
  onClose: () => void;
  onConfirm: (startDate: string) => void;
  isLoading: boolean;
}

function DatePickerModal({
  template,
  onClose,
  onConfirm,
  isLoading,
}: DatePickerModalProps) {
  const [startDate, setStartDate] = useState("");

  // Set default date to tomorrow
  useEffect(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    setStartDate(tomorrow.toISOString().split("T")[0]);
  }, []);

  if (!template) return null;

  const endDate = startDate
    ? (() => {
        const end = new Date(startDate);
        end.setDate(end.getDate() + template.durationDays - 1);
        return end.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        });
      })()
    : "";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-scale-up">
        {/* Header */}
        <div className="p-6 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="text-3xl">{getFlagEmoji(template.countryCode)}</div>
            <div>
              <h3 className="text-lg font-bold text-slate-900">
                {template.destination}
              </h3>
              <p className="text-sm text-slate-500">
                {template.durationDays} days · {template.moodTags.slice(0, 2).join(" & ")}
              </p>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-6">
          <label className="block text-sm font-medium text-slate-700 mb-2">
            When do you want to start your trip?
          </label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            min={new Date().toISOString().split("T")[0]}
            className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 outline-none text-lg"
          />

          {startDate && (
            <p className="mt-3 text-sm text-slate-500">
              Your trip will be from{" "}
              <span className="font-medium text-slate-700">
                {new Date(startDate).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })}
              </span>{" "}
              to{" "}
              <span className="font-medium text-slate-700">{endDate}</span>
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-slate-100 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-3 rounded-xl border border-slate-200 text-slate-700 font-medium hover:bg-slate-50 transition-colors"
            disabled={isLoading}
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(startDate)}
            disabled={!startDate || isLoading}
            className="flex-1 px-4 py-3 rounded-xl bg-[var(--primary)] text-white font-medium hover:bg-[var(--primary)]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <>
                <svg
                  className="animate-spin w-5 h-5"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                Creating...
              </>
            ) : (
              <>
                Create My Trip
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
                    d="M13 7l5 5m0 0l-5 5m5-5H6"
                  />
                </svg>
              </>
            )}
          </button>
        </div>
      </div>

      <style jsx>{`
        @keyframes scale-up {
          from {
            opacity: 0;
            transform: scale(0.95);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }
        .animate-scale-up {
          animation: scale-up 0.2s ease-out;
        }
      `}</style>
    </div>
  );
}

export default function CuratedEscapes() {
  const router = useRouter();
  const [templates, setTemplates] = useState<TemplateTrip[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [selectedMoods, setSelectedMoods] = useState<string[]>([]);
  const [selectedDuration, setSelectedDuration] = useState<number | null>(null);
  const [selectedBudget, setSelectedBudget] = useState<string | null>(null);

  // Modal state
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateTrip | null>(
    null
  );
  const [isCreating, setIsCreating] = useState(false);

  // Fetch templates
  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (selectedMoods.length > 0) {
        params.set("mood", selectedMoods.join(","));
      }
      if (selectedDuration) {
        params.set("duration", selectedDuration.toString());
      }
      if (selectedBudget) {
        params.set("budget", selectedBudget);
      }

      const response = await fetch(`/api/templates?${params.toString()}`);
      if (!response.ok) throw new Error("Failed to fetch templates");

      const data = await response.json();
      setTemplates(data.templates || []);
    } catch (err) {
      console.error("Error fetching templates:", err);
      setError("Failed to load templates");
    } finally {
      setLoading(false);
    }
  }, [selectedMoods, selectedDuration, selectedBudget]);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  // Toggle mood filter
  const toggleMood = (mood: string) => {
    setSelectedMoods((prev) =>
      prev.includes(mood)
        ? prev.filter((m) => m !== mood)
        : [...prev, mood]
    );
  };

  // Handle template selection
  const handleSelectTemplate = (template: TemplateTrip) => {
    setSelectedTemplate(template);
  };

  // Handle trip creation
  const handleCreateTrip = async (startDate: string) => {
    if (!selectedTemplate) return;

    setIsCreating(true);
    try {
      const response = await fetch(`/api/templates/${selectedTemplate.id}/copy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startDate }),
      });

      if (!response.ok) throw new Error("Failed to create trip");

      const data = await response.json();
      router.push(`/trips/${data.trip.id}`);
    } catch (err) {
      console.error("Error creating trip:", err);
      alert("Failed to create trip. Please try again.");
    } finally {
      setIsCreating(false);
    }
  };

  // Clear all filters
  const clearFilters = () => {
    setSelectedMoods([]);
    setSelectedDuration(null);
    setSelectedBudget(null);
  };

  const hasFilters =
    selectedMoods.length > 0 || selectedDuration || selectedBudget;

  // Don't render if no templates available
  if (!loading && templates.length === 0 && !hasFilters) {
    return null;
  }

  return (
    <section className="mb-10">
      {/* Section Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[var(--primary)] to-[var(--accent)] flex items-center justify-center shadow-lg">
            <svg
              className="w-5 h-5 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"
              />
            </svg>
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-900">Curated Escapes</h2>
            <p className="text-sm text-slate-500">
              Hand-picked itineraries ready to customize
            </p>
          </div>
        </div>

        {hasFilters && (
          <button
            onClick={clearFilters}
            className="text-sm text-[var(--primary)] font-medium hover:underline"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="mb-6 space-y-3">
        {/* Mood filters */}
        <div className="flex flex-wrap gap-2">
          {MOOD_OPTIONS.map((mood) => (
            <button
              key={mood.id}
              onClick={() => toggleMood(mood.id)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                selectedMoods.includes(mood.id)
                  ? "bg-[var(--primary)] text-white shadow-md"
                  : "bg-white text-slate-600 border border-slate-200 hover:border-slate-300"
              }`}
            >
              {mood.emoji} {mood.label}
            </button>
          ))}
        </div>

        {/* Duration & Budget */}
        <div className="flex flex-wrap gap-3">
          {/* Duration */}
          <div className="flex items-center gap-2 bg-white rounded-lg border border-slate-200 p-1">
            {DURATION_OPTIONS.map((option) => (
              <button
                key={option.value}
                onClick={() =>
                  setSelectedDuration(
                    selectedDuration === option.value ? null : option.value
                  )
                }
                className={`px-3 py-1 rounded-md text-sm font-medium transition-all ${
                  selectedDuration === option.value
                    ? "bg-[var(--primary)] text-white"
                    : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          {/* Budget */}
          <div className="flex items-center gap-2 bg-white rounded-lg border border-slate-200 p-1">
            {BUDGET_OPTIONS.map((option) => (
              <button
                key={option.value}
                onClick={() =>
                  setSelectedBudget(
                    selectedBudget === option.value ? null : option.value
                  )
                }
                className={`px-3 py-1 rounded-md text-sm font-medium transition-all ${
                  selectedBudget === option.value
                    ? "bg-amber-500 text-white"
                    : "text-slate-600 hover:bg-slate-50"
                }`}
                title={option.description}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
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
            onClick={fetchTemplates}
            className="mt-2 text-sm text-red-700 font-medium hover:underline"
          >
            Try again
          </button>
        </div>
      ) : templates.length === 0 ? (
        <div className="text-center py-12 bg-slate-50 rounded-xl border border-dashed border-slate-200">
          <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg
              className="w-8 h-8 text-slate-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-slate-900 mb-1">
            No matching escapes
          </h3>
          <p className="text-slate-500 text-sm mb-4">
            Try adjusting your filters or browse all destinations
          </p>
          <button
            onClick={clearFilters}
            className="text-[var(--primary)] font-medium hover:underline"
          >
            Clear all filters
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
          {templates.map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              onSelect={handleSelectTemplate}
            />
          ))}
        </div>
      )}

      {/* Date Picker Modal */}
      <DatePickerModal
        template={selectedTemplate}
        onClose={() => setSelectedTemplate(null)}
        onConfirm={handleCreateTrip}
        isLoading={isCreating}
      />
    </section>
  );
}
