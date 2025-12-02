"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import type { GeneratedItinerary, TripCreationParams } from "@/types";

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
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [generatedItinerary, setGeneratedItinerary] = useState<GeneratedItinerary | null>(null);

  // Form state
  const [destination, setDestination] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [budgetTier, setBudgetTier] = useState<"budget" | "balanced" | "premium">("balanced");
  const [pace, setPace] = useState<"relaxed" | "moderate" | "active">("moderate");
  const [selectedInterests, setSelectedInterests] = useState<string[]>([]);
  const [requirements, setRequirements] = useState("");

  const TOTAL_STEPS = 3;

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
        return selectedInterests.length > 0;
      default:
        return false;
    }
  };

  const handleGenerate = async () => {
    setGenerating(true);
    setProgress(0);
    setError(null);

    // Simulate progress
    const progressInterval = setInterval(() => {
      setProgress((prev) => Math.min(prev + Math.random() * 15, 90));
    }, 500);

    try {
      const params: TripCreationParams = {
        destination,
        startDate,
        endDate,
        budgetTier,
        pace,
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

      clearInterval(progressInterval);
      setProgress(100);

      setGeneratedItinerary(data.itinerary);
    } catch (err) {
      clearInterval(progressInterval);
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
          budget: {
            total: generatedItinerary.trip_summary.total_estimated_cost,
            spent: 0,
            currency: generatedItinerary.trip_summary.currency,
          },
          tags: selectedInterests,
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
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-white">
        {/* Header */}
        <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-lg border-b border-slate-200">
          <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
            <Link href="/trips" className="flex items-center gap-2 text-slate-600 hover:text-slate-900">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back
            </Link>
            <button
              onClick={handleSaveTrip}
              disabled={loading}
              className="bg-[var(--primary)] text-white px-6 py-2 rounded-lg font-medium hover:bg-[var(--primary)]/90 transition-colors disabled:opacity-50"
            >
              {loading ? "Saving..." : "Save Trip"}
            </button>
          </div>
        </header>

        {/* Itinerary Display */}
        <main className="max-w-4xl mx-auto px-4 py-8">
          {/* Destination Header */}
          <div className="bg-gradient-to-br from-[var(--primary)] to-[var(--primary)]/80 rounded-2xl p-8 text-white mb-8">
            <h1 className="text-3xl font-bold mb-2">
              {generatedItinerary.destination.name}, {generatedItinerary.destination.country}
            </h1>
            <p className="text-white/80 mb-4">{generatedItinerary.destination.description}</p>
            <div className="flex flex-wrap gap-2">
              {generatedItinerary.destination.best_for.map((tag) => (
                <span key={tag} className="px-3 py-1 bg-white/20 rounded-full text-sm">
                  {tag}
                </span>
              ))}
            </div>
          </div>

          {/* Summary */}
          <div className="bg-white rounded-xl border border-slate-200 p-6 mb-8">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <div className="text-sm text-slate-500">Duration</div>
                <div className="font-semibold text-slate-900">
                  {generatedItinerary.days.length} days
                </div>
              </div>
              <div>
                <div className="text-sm text-slate-500">Est. Budget</div>
                <div className="font-semibold text-slate-900">
                  {generatedItinerary.trip_summary.currency} {generatedItinerary.trip_summary.total_estimated_cost}
                </div>
              </div>
              <div>
                <div className="text-sm text-slate-500">Weather</div>
                <div className="font-semibold text-slate-900">
                  {generatedItinerary.destination.weather_note}
                </div>
              </div>
              <div>
                <div className="text-sm text-slate-500">Pace</div>
                <div className="font-semibold text-slate-900 capitalize">{pace}</div>
              </div>
            </div>
          </div>

          {/* Booking Links */}
          {generatedItinerary.booking_links && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 mb-8">
              <h3 className="font-semibold text-amber-900 mb-4">Book Your Travel</h3>
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <div className="text-sm text-amber-700 mb-2">Flights</div>
                  <div className="flex flex-wrap gap-2">
                    {generatedItinerary.booking_links.flights.map((link) => (
                      <a
                        key={link.provider}
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-3 py-1.5 bg-white border border-amber-200 rounded-full text-sm text-amber-900 hover:bg-amber-100 transition-colors"
                      >
                        {link.provider} ↗
                      </a>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-amber-700 mb-2">Hotels</div>
                  <div className="flex flex-wrap gap-2">
                    {generatedItinerary.booking_links.hotels.map((link) => (
                      <a
                        key={link.provider}
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-3 py-1.5 bg-white border border-amber-200 rounded-full text-sm text-amber-900 hover:bg-amber-100 transition-colors"
                      >
                        {link.provider} ↗
                      </a>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Day by Day */}
          <div className="space-y-6">
            {generatedItinerary.days.map((day) => (
              <div key={day.day_number} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                {/* Day Header */}
                <div className="bg-slate-50 px-6 py-4 border-b border-slate-200">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-[var(--primary)] text-white flex items-center justify-center font-bold">
                      {day.day_number}
                    </div>
                    <div>
                      <div className="font-semibold text-slate-900">Day {day.day_number}</div>
                      <div className="text-sm text-slate-500">{day.theme}</div>
                    </div>
                    {day.daily_budget && (
                      <div className="ml-auto text-right">
                        <div className="text-sm text-slate-500">Est. Cost</div>
                        <div className="font-medium text-slate-900">
                          {generatedItinerary.trip_summary.currency} {day.daily_budget.total}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Activities */}
                <div className="p-6 space-y-4">
                  {day.activities.map((activity, idx) => (
                    <div key={idx} className="flex gap-4">
                      <div className="flex-shrink-0 text-center">
                        <div className="text-sm font-medium text-slate-900">{activity.start_time}</div>
                        <div className="text-xs text-slate-500">{activity.duration_minutes}min</div>
                      </div>
                      <div className="flex-1 border-l-2 border-slate-200 pl-4 pb-4">
                        <div className="flex items-start justify-between">
                          <div>
                            <h4 className="font-medium text-slate-900">{activity.name}</h4>
                            <p className="text-sm text-slate-600 mt-1">{activity.description}</p>
                            <div className="flex items-center gap-2 mt-2 text-sm text-slate-500">
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                              </svg>
                              {activity.location}
                            </div>
                            {activity.tips.length > 0 && (
                              <div className="mt-2 p-2 bg-blue-50 rounded-lg">
                                <div className="text-xs font-medium text-blue-700">Tips:</div>
                                <ul className="text-xs text-blue-600 mt-1">
                                  {activity.tips.map((tip, i) => (
                                    <li key={i}>• {tip}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>
                          <div className="text-right flex-shrink-0">
                            <div className="text-sm font-medium text-slate-900">
                              {activity.estimated_cost.amount === 0
                                ? "Free"
                                : `${activity.estimated_cost.currency} ${activity.estimated_cost.amount}`}
                            </div>
                            <span
                              className={`text-xs px-2 py-0.5 rounded-full ${
                                activity.type === "restaurant"
                                  ? "bg-orange-100 text-orange-700"
                                  : activity.type === "attraction"
                                  ? "bg-blue-100 text-blue-700"
                                  : activity.type === "activity"
                                  ? "bg-green-100 text-green-700"
                                  : "bg-purple-100 text-purple-700"
                              }`}
                            >
                              {activity.type}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Packing Suggestions */}
          {generatedItinerary.trip_summary.packing_suggestions.length > 0 && (
            <div className="mt-8 bg-slate-50 rounded-xl p-6">
              <h3 className="font-semibold text-slate-900 mb-4">Packing Suggestions</h3>
              <div className="flex flex-wrap gap-2">
                {generatedItinerary.trip_summary.packing_suggestions.map((item) => (
                  <span key={item} className="px-3 py-1 bg-white border border-slate-200 rounded-full text-sm text-slate-700">
                    {item}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* AI Disclaimer */}
          <div className="mt-8 p-4 bg-slate-100 rounded-lg text-center">
            <p className="text-sm text-slate-600">
              This itinerary was generated by AI. Please verify opening hours and availability before your trip.
            </p>
          </div>
        </main>
      </div>
    );
  }

  // Generating state
  if (generating) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-white flex items-center justify-center">
        <div className="text-center max-w-md mx-auto px-4">
          <div className="w-20 h-20 mx-auto mb-6 relative">
            <div className="absolute inset-0 rounded-full bg-[var(--primary)]/10 animate-ping" />
            <div className="relative w-full h-full rounded-full bg-[var(--primary)]/20 flex items-center justify-center">
              <svg className="w-10 h-10 text-[var(--primary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>

          <h2 className="text-2xl font-bold text-slate-900 mb-2">
            Creating your perfect trip...
          </h2>
          <p className="text-slate-600 mb-8">
            Our AI is researching {destination} and building your personalized itinerary
          </p>

          {/* Progress Bar */}
          <div className="w-full bg-slate-200 rounded-full h-2 mb-4">
            <div
              className="bg-[var(--primary)] h-2 rounded-full transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-sm text-slate-500">{Math.round(progress)}%</p>
        </div>
      </div>
    );
  }

  // Wizard form
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-white">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-lg border-b border-slate-200">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/trips" className="text-slate-600 hover:text-slate-900">
            ← Back
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
                Enter a city, region, or country to explore
              </p>
            </div>

            <div>
              <input
                type="text"
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                placeholder="e.g., Paris, France"
                className="w-full px-4 py-4 text-lg rounded-xl border border-slate-300 focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 outline-none transition-colors"
                autoFocus
              />
            </div>

            {/* Popular destinations */}
            <div>
              <div className="text-sm text-slate-500 mb-3">Popular destinations</div>
              <div className="flex flex-wrap gap-2">
                {["Paris, France", "Tokyo, Japan", "Rome, Italy", "Barcelona, Spain", "New York, USA", "Bali, Indonesia"].map(
                  (place) => (
                    <button
                      key={place}
                      onClick={() => setDestination(place)}
                      className="px-4 py-2 rounded-full border border-slate-200 text-slate-700 hover:border-[var(--primary)] hover:text-[var(--primary)] transition-colors"
                    >
                      {place}
                    </button>
                  )
                )}
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
          </div>
        )}

        {/* Step 3: Preferences */}
        {step === 3 && (
          <div className="space-y-8">
            <div>
              <h1 className="text-3xl font-bold text-slate-900 mb-2">
                Customize your trip
              </h1>
              <p className="text-slate-600">
                Tell us about your travel style and interests
              </p>
            </div>

            {/* Budget */}
            <div>
              <div className="text-sm font-medium text-slate-700 mb-3">Budget preference</div>
              <div className="grid grid-cols-3 gap-3">
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
                    <div className={`font-semibold ${tier.color}`}>{tier.label}</div>
                    <div className="text-xs text-slate-500 mt-1">{tier.range}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Pace */}
            <div>
              <div className="text-sm font-medium text-slate-700 mb-3">Travel pace</div>
              <div className="grid grid-cols-3 gap-3">
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
                    <div className="font-semibold text-slate-900">{option.label}</div>
                    <div className="text-xs text-slate-500 mt-1">{option.description}</div>
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
              className="px-6 py-3 text-slate-600 hover:text-slate-900 font-medium"
            >
              ← Back
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
    </div>
  );
}
