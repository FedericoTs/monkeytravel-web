"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import { createClient } from "@/lib/supabase/client";
import type { GeneratedItinerary, TripCreationParams, TripVibe, SeasonalContext } from "@/types";
import DestinationHero from "@/components/DestinationHero";
import ActivityCard from "@/components/ActivityCard";
import VibeSelector from "@/components/trip/VibeSelector";
import SeasonalContextCard from "@/components/trip/SeasonalContextCard";
import GenerationProgress from "@/components/trip/GenerationProgress";
import MobileBottomNav from "@/components/ui/MobileBottomNav";
import DestinationAutocomplete, { PlacePrediction } from "@/components/ui/DestinationAutocomplete";
import { buildSeasonalContext } from "@/lib/seasonal";

// Dynamic import for TripMap to avoid SSR issues
const TripMap = dynamic(() => import("@/components/TripMap"), {
  ssr: false,
  loading: () => (
    <div className="h-[350px] bg-slate-100 rounded-xl animate-pulse flex items-center justify-center">
      <span className="text-slate-400">Loading map...</span>
    </div>
  ),
});

const INTERESTS = [
  { id: "culture", label: "Culture & Museums", emoji: "🏛️" },
  { id: "food", label: "Food & Dining", emoji: "🍽️" },
  { id: "nature", label: "Nature & Parks", emoji: "🌿" },
  { id: "adventure", label: "Adventure", emoji: "🎯" },
  { id: "relaxation", label: "Relaxation", emoji: "🧘" },
  { id: "nightlife", label: "Nightlife", emoji: "🌙" },
  { id: "shopping", label: "Shopping", emoji: "🛍️" },
  { id: "history", label: "History", emoji: "📜" },
  { id: "art", label: "Art & Design", emoji: "🎨" },
  { id: "photography", label: "Photography", emoji: "📸" },
];

const BUDGET_TIERS = [
  {
    id: "budget" as const,
    label: "Budget",
    description: "Free attractions, street food, public transport",
    range: "< $100/day",
    color: "text-green-600",
    bgColor: "bg-green-50",
    borderColor: "border-green-500",
  },
  {
    id: "balanced" as const,
    label: "Balanced",
    description: "Mix of experiences, local restaurants, some tours",
    range: "$100-250/day",
    color: "text-blue-600",
    bgColor: "bg-blue-50",
    borderColor: "border-blue-500",
  },
  {
    id: "premium" as const,
    label: "Premium",
    description: "Skip-the-line, fine dining, private tours",
    range: "$250+/day",
    color: "text-amber-600",
    bgColor: "bg-amber-50",
    borderColor: "border-amber-500",
  },
];

const PACE_OPTIONS = [
  { id: "relaxed" as const, label: "Relaxed", description: "2-3 activities/day" },
  { id: "moderate" as const, label: "Moderate", description: "3-4 activities/day" },
  { id: "active" as const, label: "Active", description: "5+ activities/day" },
];

export default function NewTripPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatedItinerary, setGeneratedItinerary] = useState<GeneratedItinerary | null>(null);

  // Form state
  const [destination, setDestination] = useState("");
  const [destinationCoords, setDestinationCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [budgetTier, setBudgetTier] = useState<"budget" | "balanced" | "premium">("balanced");
  const [pace, setPace] = useState<"relaxed" | "moderate" | "active">("moderate");
  const [selectedVibes, setSelectedVibes] = useState<TripVibe[]>([]);
  const [selectedInterests, setSelectedInterests] = useState<string[]>([]);
  const [requirements, setRequirements] = useState("");
  const [seasonalContext, setSeasonalContext] = useState<SeasonalContext | null>(null);

  const TOTAL_STEPS = 4; // Added vibe step

  // Build seasonal context when destination and dates are set
  // Uses latitude for accurate hemisphere detection (fixes Southern Hemisphere bug)
  useEffect(() => {
    if (destination && startDate) {
      const context = buildSeasonalContext(
        destination,
        startDate,
        destinationCoords?.latitude // Pass latitude for correct hemisphere
      );
      setSeasonalContext(context);
    } else {
      setSeasonalContext(null);
    }
  }, [destination, startDate, destinationCoords]);

  const toggleInterest = (id: string) => {
    if (selectedInterests.includes(id)) {
      setSelectedInterests(selectedInterests.filter((i) => i !== id));
    } else if (selectedInterests.length < 5) {
      setSelectedInterests([...selectedInterests, id]);
    }
  };

  const canProceed = () => {
    switch (step) {
      case 1:
        return destination.length >= 2;
      case 2:
        return startDate && endDate && new Date(endDate) >= new Date(startDate);
      case 3:
        return selectedVibes.length > 0; // At least one vibe required
      case 4:
        return selectedInterests.length > 0;
      default:
        return false;
    }
  };

  // Handle destination selection from autocomplete
  const handleDestinationSelect = (prediction: PlacePrediction) => {
    if (prediction.coordinates) {
      setDestinationCoords(prediction.coordinates);
    }
  };

  // Handle vibe suggestion from seasonal context
  const handleVibeSuggestion = (vibeId: TripVibe) => {
    if (!selectedVibes.includes(vibeId) && selectedVibes.length < 3) {
      setSelectedVibes([...selectedVibes, vibeId]);
    }
  };

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);

    try {
      const params: TripCreationParams = {
        destination,
        startDate,
        endDate,
        budgetTier,
        pace,
        vibes: selectedVibes,
        seasonalContext: seasonalContext || undefined,
        interests: selectedInterests,
        requirements: requirements || undefined,
      };

      const response = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Generation failed");
      }

      setGeneratedItinerary(data.itinerary);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setGenerating(false);
    }
  };

  const handleSaveTrip = async () => {
    if (!generatedItinerary) return;

    setLoading(true);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) throw new Error("Not authenticated");

      // Fetch a proper cover image for this destination
      let coverImageUrl: string | undefined;
      try {
        const imageResponse = await fetch(
          `/api/images/destination?destination=${encodeURIComponent(generatedItinerary.destination.name)}`
        );
        if (imageResponse.ok) {
          const imageData = await imageResponse.json();
          coverImageUrl = imageData.url;
        }
      } catch (imageError) {
        console.error("Failed to fetch cover image:", imageError);
      }

      // Fallback: Try to find a high-quality activity image
      if (!coverImageUrl) {
        for (const day of generatedItinerary.days) {
          for (const activity of day.activities) {
            // Prefer Google Places photos (they have maps.googleapis.com)
            if (activity.image_url && activity.image_url.includes("googleapis.com")) {
              coverImageUrl = activity.image_url;
              break;
            }
          }
          if (coverImageUrl) break;
        }
      }

      // Build trip metadata from generated itinerary (preserves AI-generated data)
      const tripMeta = {
        weather_note: generatedItinerary.destination.weather_note,
        highlights: generatedItinerary.trip_summary.highlights,
        booking_links: generatedItinerary.booking_links,
        destination_best_for: generatedItinerary.destination.best_for,
        packing_suggestions: generatedItinerary.trip_summary.packing_suggestions,
      };

      const { data: trip, error: tripError } = await supabase
        .from("trips")
        .insert({
          user_id: user.id,
          title: `${generatedItinerary.destination.name} Trip`,
          description: generatedItinerary.destination.description,
          start_date: startDate,
          end_date: endDate,
          status: "planning",
          visibility: "private",
          itinerary: generatedItinerary.days,
          cover_image_url: coverImageUrl,
          budget: {
            total: generatedItinerary.trip_summary.total_estimated_cost,
            spent: 0,
            currency: generatedItinerary.trip_summary.currency,
          },
          tags: selectedInterests,
          trip_meta: tripMeta, // Preserve AI-generated metadata
          packing_list: generatedItinerary.trip_summary.packing_suggestions, // Also store in packing_list column
        })
        .select()
        .single();

      if (tripError) throw tripError;

      router.push(`/trips/${trip.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save trip");
    } finally {
      setLoading(false);
    }
  };

  // Show generated itinerary
  if (generatedItinerary) {
    const fullDestination = `${generatedItinerary.destination.name}, ${generatedItinerary.destination.country}`;

    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-white">
        {/* Hero with Cover Image */}
        <DestinationHero
          destination={fullDestination}
          title={fullDestination}
          subtitle={generatedItinerary.destination.description}
          dateRange={`${startDate} to ${endDate}`}
          budget={{
            total: generatedItinerary.trip_summary.total_estimated_cost,
            currency: generatedItinerary.trip_summary.currency,
          }}
          days={generatedItinerary.days.length}
          tags={generatedItinerary.destination.best_for}
          showBackButton={false}
        />

        {/* Sticky Save Button */}
        <div className="sticky top-0 z-50 bg-white/80 backdrop-blur-lg border-b border-slate-200">
          <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
            <Link href="/trips" className="flex items-center gap-2 text-slate-600 hover:text-slate-900">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Discard
            </Link>
            <div className="flex items-center gap-3">
              <span className="text-sm text-slate-500 hidden sm:block">
                {generatedItinerary.days.length} days · {generatedItinerary.trip_summary.currency} {generatedItinerary.trip_summary.total_estimated_cost}
              </span>
              <button
                onClick={handleSaveTrip}
                disabled={loading}
                className="bg-[var(--primary)] text-white px-6 py-2.5 rounded-lg font-medium hover:bg-[var(--primary)]/90 transition-colors disabled:opacity-50 shadow-lg shadow-[var(--primary)]/25"
              >
                {loading ? "Saving..." : "Save Trip"}
              </button>
            </div>
          </div>
        </div>

        <main className="max-w-6xl mx-auto px-4 py-8">
          {/* Interactive Map */}
          <div className="mb-8">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-slate-900">Trip Overview</h2>
              <span className="text-sm text-slate-500">{generatedItinerary.destination.weather_note}</span>
            </div>
            <TripMap
              days={generatedItinerary.days}
              destination={fullDestination}
              className="h-[350px]"
            />
          </div>

          {/* Summary Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="text-sm text-slate-500">Duration</div>
              <div className="font-semibold text-xl text-slate-900">{generatedItinerary.days.length} days</div>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="text-sm text-slate-500">Est. Budget</div>
              <div className="font-semibold text-xl text-slate-900">
                {generatedItinerary.trip_summary.currency} {generatedItinerary.trip_summary.total_estimated_cost}
              </div>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="text-sm text-slate-500">Activities</div>
              <div className="font-semibold text-xl text-slate-900">
                {generatedItinerary.days.reduce((acc, day) => acc + day.activities.length, 0)}
              </div>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="text-sm text-slate-500">Pace</div>
              <div className="font-semibold text-xl text-slate-900 capitalize">{pace}</div>
            </div>
          </div>

          {/* Booking Links */}
          {generatedItinerary.booking_links && (
            <div className="bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-xl p-6 mb-8">
              <h3 className="font-semibold text-amber-900 mb-4 flex items-center gap-2">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Book Your Travel
              </h3>
              <div className="grid md:grid-cols-2 gap-6">
                <div>
                  <div className="text-sm font-medium text-amber-800 mb-3">Flights</div>
                  <div className="flex flex-wrap gap-2">
                    {generatedItinerary.booking_links.flights.map((link) => (
                      <a
                        key={link.provider}
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-4 py-2 bg-white border border-amber-200 rounded-lg text-sm text-amber-900 hover:bg-amber-50 hover:border-amber-300 transition-colors shadow-sm"
                      >
                        {link.provider} ↗
                      </a>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="text-sm font-medium text-amber-800 mb-3">Hotels</div>
                  <div className="flex flex-wrap gap-2">
                    {generatedItinerary.booking_links.hotels.map((link) => (
                      <a
                        key={link.provider}
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-4 py-2 bg-white border border-amber-200 rounded-lg text-sm text-amber-900 hover:bg-amber-50 hover:border-amber-300 transition-colors shadow-sm"
                      >
                        {link.provider} ↗
                      </a>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Day by Day with ActivityCards */}
          <div className="space-y-8">
            {generatedItinerary.days.map((day) => (
              <div key={day.day_number}>
                {/* Day Header */}
                <div className="flex items-center gap-4 mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[var(--primary)] to-[var(--primary)]/80 text-white flex items-center justify-center font-bold text-lg shadow-lg">
                      {day.day_number}
                    </div>
                    <div>
                      <h2 className="font-bold text-xl text-slate-900">Day {day.day_number}</h2>
                      {day.theme && <p className="text-slate-500 text-sm">{day.theme}</p>}
                    </div>
                  </div>
                  {day.daily_budget && (
                    <div className="ml-auto text-right">
                      <div className="text-sm text-slate-500">Est. Budget</div>
                      <div className="font-semibold text-slate-900">
                        {generatedItinerary.trip_summary.currency} {day.daily_budget.total}
                      </div>
                    </div>
                  )}
                </div>

                {/* Activities as Cards */}
                <div className="grid gap-4">
                  {day.activities.map((activity, idx) => (
                    <ActivityCard
                      key={idx}
                      activity={activity}
                      index={idx}
                      currency={generatedItinerary.trip_summary.currency}
                      showGallery={true}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Packing Suggestions */}
          {generatedItinerary.trip_summary.packing_suggestions.length > 0 && (
            <div className="mt-10 bg-slate-50 rounded-xl p-6">
              <h3 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                </svg>
                Packing Suggestions
              </h3>
              <div className="flex flex-wrap gap-2">
                {generatedItinerary.trip_summary.packing_suggestions.map((item) => (
                  <span key={item} className="px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-700 shadow-sm">
                    {item}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* AI Disclaimer */}
          <div className="mt-10 p-5 bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-xl">
            <div className="flex gap-4">
              <div className="flex-shrink-0">
                <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
                  <svg className="w-5 h-5 text-amber-600" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                  </svg>
                </div>
              </div>
              <div>
                <h4 className="font-semibold text-amber-900 mb-1">AI-Generated Itinerary with Verified Data</h4>
                <p className="text-sm text-amber-800">
                  This itinerary was created by AI and enriched with real-time data from Google Places.
                  Click "More" on any activity to see verified photos, ratings, and price levels.
                  We recommend double-checking opening hours before your trip.
                </p>
              </div>
            </div>
          </div>

          {/* Bottom Save CTA */}
          <div className="mt-10 text-center">
            <button
              onClick={handleSaveTrip}
              disabled={loading}
              className="bg-[var(--primary)] text-white px-10 py-4 rounded-xl font-semibold text-lg hover:bg-[var(--primary)]/90 transition-colors disabled:opacity-50 shadow-xl shadow-[var(--primary)]/25"
            >
              {loading ? "Saving Your Trip..." : "Save This Trip"}
            </button>
            <p className="text-sm text-slate-500 mt-3">
              Your trip will be saved to your account and accessible anytime
            </p>
          </div>
        </main>
      </div>
    );
  }

  // Generating state - use premium progress component
  if (generating) {
    return (
      <GenerationProgress
        destination={destination}
        isGenerating={generating}
      />
    );
  }

  // Wizard form
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-white">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-lg border-b border-slate-200">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link
            href="/trips"
            className="flex items-center gap-1.5 text-slate-600 hover:text-slate-900 px-2 py-1.5 -ml-2 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            <span className="hidden sm:inline">Back</span>
          </Link>
          <div className="flex items-center gap-2">
            {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
              <div
                key={i}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  i + 1 <= step ? "bg-[var(--primary)] w-8" : "bg-slate-200 w-4"
                }`}
              />
            ))}
          </div>
          <div className="text-sm text-slate-500">
            {step}/{TOTAL_STEPS}
          </div>
        </div>
      </header>

      {/* Form Content */}
      <main className="max-w-2xl mx-auto px-4 py-8">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6">
            {error}
          </div>
        )}

        {/* Step 1: Destination */}
        {step === 1 && (
          <div className="space-y-6">
            <div>
              <h1 className="text-3xl font-bold text-slate-900 mb-2">
                Where do you want to go?
              </h1>
              <p className="text-slate-600">
                Search for a city to start planning your trip
              </p>
            </div>

            <DestinationAutocomplete
              value={destination}
              onChange={setDestination}
              onSelect={handleDestinationSelect}
              placeholder="e.g., Paris, Tokyo, New York..."
              autoFocus
            />

            {/* Popular destinations - with coordinates for accurate weather */}
            <div>
              <div className="text-sm text-slate-500 mb-3">Popular destinations</div>
              <div className="flex flex-wrap gap-2">
                {[
                  { name: "Paris, France", flag: "🇫🇷", coords: { latitude: 48.8566, longitude: 2.3522 } },
                  { name: "Tokyo, Japan", flag: "🇯🇵", coords: { latitude: 35.6762, longitude: 139.6503 } },
                  { name: "Rome, Italy", flag: "🇮🇹", coords: { latitude: 41.9028, longitude: 12.4964 } },
                  { name: "Barcelona, Spain", flag: "🇪🇸", coords: { latitude: 41.3851, longitude: 2.1734 } },
                  { name: "New York, USA", flag: "🇺🇸", coords: { latitude: 40.7128, longitude: -74.0060 } },
                  { name: "Sydney, Australia", flag: "🇦🇺", coords: { latitude: -33.8688, longitude: 151.2093 } },
                ].map((place) => (
                  <button
                    key={place.name}
                    onClick={() => {
                      setDestination(place.name);
                      setDestinationCoords(place.coords);
                    }}
                    className="px-4 py-2 rounded-full border border-slate-200 text-slate-700
                               hover:border-[var(--primary)] hover:text-[var(--primary)]
                               hover:bg-[var(--primary)]/5 transition-all duration-200
                               flex items-center gap-2"
                  >
                    <span>{place.flag}</span>
                    <span>{place.name}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Step 2: Dates */}
        {step === 2 && (
          <div className="space-y-6">
            <div>
              <h1 className="text-3xl font-bold text-slate-900 mb-2">
                When are you traveling?
              </h1>
              <p className="text-slate-600">Select your trip dates (max 14 days)</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Start Date
                </label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  min={new Date().toISOString().split("T")[0]}
                  className="w-full px-4 py-3 rounded-xl border border-slate-300 focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 outline-none transition-colors"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  End Date
                </label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  min={startDate || new Date().toISOString().split("T")[0]}
                  className="w-full px-4 py-3 rounded-xl border border-slate-300 focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 outline-none transition-colors"
                />
              </div>
            </div>

            {/* Seasonal Context Card - Auto-displays when dates are set */}
            {destination && startDate && endDate && (
              <SeasonalContextCard
                destination={destination}
                startDate={startDate}
                endDate={endDate}
                coordinates={destinationCoords || undefined}
                onVibeSuggestionClick={handleVibeSuggestion}
                className="mt-6"
              />
            )}
          </div>
        )}

        {/* Step 3: Vibe Selection (NEW) */}
        {step === 3 && (
          <div className="space-y-6">
            <div>
              <h1 className="text-3xl font-bold text-slate-900 mb-2">
                What's your travel vibe?
              </h1>
              <p className="text-slate-600">
                Choose the mood that captures your ideal {destination} experience
              </p>
            </div>

            <VibeSelector
              selectedVibes={selectedVibes}
              onVibesChange={setSelectedVibes}
              maxVibes={3}
            />
          </div>
        )}

        {/* Step 4: Preferences */}
        {step === 4 && (
          <div className="space-y-8">
            <div>
              <h1 className="text-3xl font-bold text-slate-900 mb-2">
                Fine-tune your trip
              </h1>
              <p className="text-slate-600">
                Set your budget, pace, and specific interests
              </p>
            </div>

            {/* Budget */}
            <div>
              <div className="text-sm font-medium text-slate-700 mb-3">Budget preference</div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {BUDGET_TIERS.map((tier) => (
                  <button
                    key={tier.id}
                    onClick={() => setBudgetTier(tier.id)}
                    className={`p-4 rounded-xl border-2 text-left transition-all ${
                      budgetTier === tier.id
                        ? `${tier.borderColor} ${tier.bgColor}`
                        : "border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    <div className="flex items-center justify-between sm:block">
                      <div>
                        <div className={`font-semibold ${tier.color}`}>{tier.label}</div>
                        <div className="text-xs text-slate-500 mt-0.5 sm:mt-1 hidden sm:block">{tier.description}</div>
                      </div>
                      <div className="text-sm text-slate-600 sm:hidden">{tier.range}</div>
                    </div>
                    <div className="text-xs text-slate-500 mt-1 hidden sm:block">{tier.range}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Pace */}
            <div>
              <div className="text-sm font-medium text-slate-700 mb-3">Travel pace</div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {PACE_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    onClick={() => setPace(option.id)}
                    className={`p-4 rounded-xl border-2 text-left transition-all ${
                      pace === option.id
                        ? "border-[var(--primary)] bg-[var(--primary)]/5"
                        : "border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    <div className="flex items-center justify-between sm:block">
                      <div className="font-semibold text-slate-900">{option.label}</div>
                      <div className="text-xs text-slate-500 sm:mt-1">{option.description}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Interests */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm font-medium text-slate-700">
                  What interests you?
                </div>
                <div className="text-sm text-slate-500">
                  {selectedInterests.length}/5 selected
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {INTERESTS.map((interest) => {
                  const isSelected = selectedInterests.includes(interest.id);
                  const isDisabled = !isSelected && selectedInterests.length >= 5;

                  return (
                    <button
                      key={interest.id}
                      onClick={() => !isDisabled && toggleInterest(interest.id)}
                      disabled={isDisabled}
                      className={`px-4 py-2 rounded-full text-sm font-medium flex items-center gap-1.5 transition-all ${
                        isSelected
                          ? "bg-[var(--primary)] text-white"
                          : isDisabled
                          ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                          : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                      }`}
                    >
                      <span>{interest.emoji}</span>
                      <span>{interest.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Special Requirements */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Special requirements (optional)
              </label>
              <textarea
                value={requirements}
                onChange={(e) => setRequirements(e.target.value)}
                placeholder="e.g., wheelchair accessible, kid-friendly, vegetarian restaurants..."
                rows={3}
                className="w-full px-4 py-3 rounded-xl border border-slate-300 focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 outline-none transition-colors resize-none"
              />
            </div>
          </div>
        )}

        {/* Navigation */}
        <div className="flex items-center justify-between mt-8 pt-6 border-t border-slate-200">
          {step > 1 ? (
            <button
              onClick={() => setStep(step - 1)}
              className="flex items-center gap-2 px-4 py-2.5 text-slate-600 hover:text-slate-900 font-medium rounded-lg hover:bg-slate-100 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              <span className="hidden sm:inline">Back</span>
            </button>
          ) : (
            <div />
          )}

          {step < TOTAL_STEPS ? (
            <button
              onClick={() => setStep(step + 1)}
              disabled={!canProceed()}
              className="bg-[var(--primary)] text-white px-8 py-3 rounded-xl font-medium hover:bg-[var(--primary)]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Continue →
            </button>
          ) : (
            <button
              onClick={handleGenerate}
              disabled={!canProceed()}
              className="bg-[var(--accent)] text-slate-900 px-8 py-3 rounded-xl font-medium hover:bg-[var(--accent)]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              Generate Itinerary
            </button>
          )}
        </div>
      </main>

      {/* Mobile Bottom Navigation */}
      <MobileBottomNav activePage="new" />
    </div>
  );
}
