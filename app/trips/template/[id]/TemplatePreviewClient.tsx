"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import Image from "next/image";
import dynamic from "next/dynamic";
import type { ItineraryDay, TripMeta } from "@/types";
import DestinationHero from "@/components/DestinationHero";
import ActivityCard from "@/components/ActivityCard";
import TripPackingEssentials from "@/components/trip/TripPackingEssentials";
import DaySlider from "@/components/ui/DaySlider";
import TravelConnector from "@/components/trip/TravelConnector";
import DaySummary from "@/components/trip/DaySummary";
import HotelRecommendations from "@/components/trip/HotelRecommendations";
import SaveTripModal from "@/components/ui/SaveTripModal";
import { useTravelDistances } from "@/lib/hooks/useTravelDistances";
import { ensureActivityIds } from "@/lib/utils/activity-id";
import { useCurrency } from "@/lib/locale";
import {
  Sparkles,
  Copy,
  Map,
  MapPinOff,
  LayoutGrid,
  List,
  Users,
  Clock,
  Wallet,
  Check
} from "lucide-react";

// Dynamic import for TripMap
const TripMap = dynamic(() => import("@/components/TripMap"), {
  ssr: false,
  loading: () => (
    <div className="h-[400px] bg-slate-100 rounded-xl animate-pulse flex items-center justify-center">
      <span className="text-slate-400">Loading map...</span>
    </div>
  ),
});

// Mood tag configuration
const MOOD_OPTIONS: Record<string, { label: string; emoji: string }> = {
  romantic: { label: "Romantic", emoji: "💕" },
  adventure: { label: "Adventure", emoji: "🏔️" },
  cultural: { label: "Cultural", emoji: "🏛️" },
  relaxation: { label: "Relaxation", emoji: "🌴" },
  foodie: { label: "Foodie", emoji: "🍝" },
  family: { label: "Family", emoji: "👨‍👩‍👧‍👦" },
};

interface TemplatePreviewClientProps {
  template: {
    id: string;
    title: string;
    description: string;
    fullDescription?: string;
    destination: string;
    country: string;
    countryCode: string;
    coverImageUrl?: string;
    durationDays: number;
    budgetTier: string;
    moodTags: string[];
    tags: string[];
    copyCount: number;
    itinerary: ItineraryDay[];
    meta?: TripMeta;
    budget?: { total: number; currency: string };
    packingList: string[];
  };
}

export default function TemplatePreviewClient({ template }: TemplatePreviewClientProps) {
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [showMap, setShowMap] = useState(true);
  const [viewMode, setViewMode] = useState<"timeline" | "cards">("cards");
  const [showSaveModal, setShowSaveModal] = useState(false);

  // Currency conversion hook
  const { convert: convertCurrency } = useCurrency();

  // Format price with currency conversion
  const formatPrice = (amount: number, fromCurrency: string): string => {
    if (amount === 0) return "Free";
    const converted = convertCurrency(amount, fromCurrency);
    return converted.formatted;
  };

  // Memoize ensureActivityIds
  const displayItinerary = useMemo(
    () => ensureActivityIds(template.itinerary),
    [template.itinerary]
  );

  // Fetch travel distances (local calculation, no API)
  const { travelData, isLoading: travelLoading } = useTravelDistances(displayItinerary);

  // Calculate total activities
  const activitiesCount = useMemo(
    () => displayItinerary.reduce((acc, day) => acc + day.activities.length, 0),
    [displayItinerary]
  );

  const budgetLabel =
    template.budgetTier === "budget"
      ? "Budget-Friendly"
      : template.budgetTier === "luxury"
      ? "Luxury"
      : "Moderate";

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-white">
      {/* Hero */}
      <DestinationHero
        destination={template.destination}
        title={template.title}
        subtitle={template.fullDescription || template.description}
        budget={template.budget || undefined}
        days={template.durationDays}
        nights={template.durationDays - 1}
        activitiesCount={activitiesCount}
        weatherNote={template.meta?.weather_note}
        highlights={template.meta?.highlights}
        tags={template.tags}
        showBackButton={false}
        disableApiCalls={true}
        coverImageUrl={template.coverImageUrl}
      >
        {/* Template Badge */}
        <div className="absolute top-4 right-4">
          <span className="px-3 py-1.5 rounded-full text-sm font-medium shadow-lg bg-gradient-to-r from-[var(--primary)] to-[var(--primary)]/80 text-white flex items-center gap-1.5">
            <Sparkles className="w-4 h-4" />
            Curated Escape
          </span>
        </div>
      </DestinationHero>

      <main className="max-w-6xl mx-auto px-4 py-6 sm:py-8">
        {/* Template Info Bar */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 mb-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-4">
            {/* Duration */}
            <div className="flex items-center gap-2">
              <Clock className="w-5 h-5 text-slate-400" />
              <span className="font-medium text-slate-700">{template.durationDays} days</span>
            </div>

            {/* Budget Tier */}
            <div className="flex items-center gap-2">
              <Wallet className="w-5 h-5 text-slate-400" />
              <span className="font-medium text-slate-700">{budgetLabel}</span>
            </div>

            {/* Copy Count */}
            {template.copyCount > 0 && (
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-slate-400" />
                <span className="font-medium text-slate-700">
                  {template.copyCount} travelers used this
                </span>
              </div>
            )}
          </div>

          {/* Mood Tags */}
          <div className="flex flex-wrap gap-2">
            {template.moodTags.map((mood) => {
              const option = MOOD_OPTIONS[mood];
              return (
                <span
                  key={mood}
                  className="px-3 py-1 rounded-full text-sm font-medium bg-slate-100 text-slate-700"
                >
                  {option?.emoji} {option?.label || mood}
                </span>
              );
            })}
          </div>
        </div>

        {/* Controls Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 sm:gap-4 mb-6">
          {/* Left side - Back */}
          <div className="flex items-center gap-2">
            <Link
              href="/trips"
              className="flex items-center gap-1 sm:gap-2 text-slate-600 hover:text-slate-900 px-2 sm:px-3 py-2 rounded-lg hover:bg-slate-100 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              <span className="hidden sm:inline">Back to Trips</span>
            </Link>
          </div>

          {/* Right side - Controls */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* View Mode Toggle */}
            <div className="hidden sm:flex items-center bg-slate-100 rounded-lg p-1">
              <button
                onClick={() => setViewMode("cards")}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5 ${
                  viewMode === "cards"
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <LayoutGrid className="w-4 h-4" />
                Cards
              </button>
              <button
                onClick={() => setViewMode("timeline")}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5 ${
                  viewMode === "timeline"
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <List className="w-4 h-4" />
                Timeline
              </button>
            </div>

            {/* Map Toggle */}
            <button
              onClick={() => setShowMap(!showMap)}
              className={`flex items-center gap-2 p-2 sm:px-3 sm:py-2 rounded-lg text-sm font-medium transition-colors ${
                showMap
                  ? "bg-[var(--primary)] text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
              title={showMap ? "Hide Map" : "Show Map"}
            >
              {showMap ? <MapPinOff className="w-5 h-5 sm:w-4 sm:h-4" /> : <Map className="w-5 h-5 sm:w-4 sm:h-4" />}
              <span className="hidden sm:inline">{showMap ? "Hide Map" : "Show Map"}</span>
            </button>
          </div>
        </div>

        {/* Interactive Map */}
        {showMap && displayItinerary.length > 0 && (
          <div className="mb-8">
            <TripMap
              days={displayItinerary}
              destination={template.destination}
              selectedDay={selectedDay}
              className="h-[400px]"
              disableApiCalls={true}
            />
          </div>
        )}

        {/* Hotel Recommendations - Disabled for preview */}
        <HotelRecommendations
          destination={template.destination}
          itinerary={displayItinerary}
          startDate=""
          endDate=""
          disableApiCalls={true}
        />

        {/* Day Filter Slider */}
        <DaySlider
          days={displayItinerary}
          selectedDay={selectedDay}
          onSelectDay={setSelectedDay}
          className="mb-6"
        />

        {/* Itinerary */}
        {displayItinerary.length > 0 ? (
          <div className="space-y-8">
            {displayItinerary
              .filter((day) => selectedDay === null || day.day_number === selectedDay)
              .map((day) => (
                <div key={day.day_number}>
                  {/* Day Header */}
                  <div className="flex items-center gap-4 mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[var(--primary)] to-[var(--primary)]/80 text-white flex items-center justify-center font-bold text-lg shadow-lg">
                        {day.day_number}
                      </div>
                      <div>
                        <h2 className="font-bold text-xl text-slate-900">
                          {day.title || `Day ${day.day_number}`}
                        </h2>
                        {day.theme && (
                          <p className="text-slate-500 text-sm">{day.theme}</p>
                        )}
                      </div>
                    </div>
                    {day.daily_budget && (
                      <div className="ml-auto text-right">
                        <div className="text-sm text-slate-500">Est. Budget</div>
                        <div className="font-semibold text-slate-900">
                          {formatPrice(day.daily_budget.total, template.budget?.currency || "EUR")}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Activities */}
                  {viewMode === "cards" ? (
                    <>
                      <div className="grid gap-0">
                        {day.activities.map((activity, idx) => {
                          const nextActivity = day.activities[idx + 1];
                          const dayTravelData = travelData.get(day.day_number);
                          const segment = nextActivity && dayTravelData?.segments.find(
                            (s) => s.fromActivityId === activity.id && s.toActivityId === nextActivity.id
                          );

                          return (
                            <div key={activity.id || idx}>
                              <ActivityCard
                                activity={activity}
                                index={idx}
                                currency={template.budget?.currency}
                                showGallery={true}
                                disableAutoFetch={true}
                              />
                              {/* Travel connector */}
                              {idx < day.activities.length - 1 && (
                                <TravelConnector
                                  distanceMeters={segment?.distanceMeters}
                                  durationSeconds={segment?.durationSeconds}
                                  distanceText={segment?.distanceText}
                                  durationText={segment?.durationText}
                                  mode={segment?.mode}
                                  isLoading={travelLoading || dayTravelData?.isLoading}
                                />
                              )}
                            </div>
                          );
                        })}
                      </div>
                      {/* Day travel summary */}
                      {travelData.get(day.day_number)?.segments && travelData.get(day.day_number)!.segments.length > 0 && (
                        <DaySummary
                          dayNumber={day.day_number}
                          segments={travelData.get(day.day_number)!.segments}
                          className="mt-4"
                        />
                      )}
                    </>
                  ) : (
                    /* Timeline View */
                    <>
                      <div className="relative pl-8 border-l-2 border-slate-200 space-y-2">
                        {day.activities.map((activity, idx) => {
                          const nextActivity = day.activities[idx + 1];
                          const dayTravelData = travelData.get(day.day_number);
                          const segment = nextActivity && dayTravelData?.segments.find(
                            (s) => s.fromActivityId === activity.id && s.toActivityId === nextActivity.id
                          );

                          return (
                            <div key={activity.id || idx}>
                              <div className="relative">
                                {/* Timeline dot */}
                                <div className="absolute -left-[25px] w-4 h-4 rounded-full bg-[var(--primary)] border-4 border-white shadow" />

                                <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm hover:shadow-md transition-shadow">
                                  <div className="flex items-start justify-between gap-4">
                                    <div className="flex-1">
                                      <div className="flex items-center gap-2 text-sm text-slate-500 mb-1">
                                        <span className="font-medium">{activity.start_time}</span>
                                        <span>·</span>
                                        <span>{activity.duration_minutes} min</span>
                                      </div>
                                      <h4 className="font-semibold text-slate-900">
                                        {activity.name}
                                      </h4>
                                      <p className="text-sm text-slate-600 mt-1">
                                        {activity.description}
                                      </p>
                                      <div className="flex items-center gap-2 mt-2 text-xs text-slate-500">
                                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                                        </svg>
                                        {activity.address || activity.location}
                                      </div>
                                    </div>
                                    <div className="text-right">
                                      <div className="font-medium text-slate-900">
                                        {formatPrice(
                                          activity.estimated_cost.amount,
                                          activity.estimated_cost.currency || template.budget?.currency || "EUR"
                                        )}
                                      </div>
                                      <span className="text-xs text-slate-500 capitalize">
                                        {activity.type}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              </div>
                              {/* Compact travel connector */}
                              {idx < day.activities.length - 1 && (
                                <TravelConnector
                                  distanceMeters={segment?.distanceMeters}
                                  durationSeconds={segment?.durationSeconds}
                                  distanceText={segment?.distanceText}
                                  durationText={segment?.durationText}
                                  mode={segment?.mode}
                                  isLoading={travelLoading || dayTravelData?.isLoading}
                                  compact={true}
                                />
                              )}
                            </div>
                          );
                        })}
                      </div>
                      {/* Day travel summary */}
                      {travelData.get(day.day_number)?.segments && travelData.get(day.day_number)!.segments.length > 0 && (
                        <DaySummary
                          dayNumber={day.day_number}
                          segments={travelData.get(day.day_number)!.segments}
                          className="mt-4"
                        />
                      )}
                    </>
                  )}
                </div>
              ))}
          </div>
        ) : (
          <div className="text-center py-16 bg-white rounded-2xl border border-slate-200">
            <svg className="w-16 h-16 mx-auto text-slate-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            <h3 className="text-lg font-medium text-slate-900 mb-2">No Itinerary Available</h3>
            <p className="text-slate-600">This template doesn't have any activities yet.</p>
          </div>
        )}

        {/* Packing List */}
        {template.packingList && template.packingList.length > 0 && (
          <TripPackingEssentials
            items={template.packingList}
            destination={template.destination}
          />
        )}

        {/* Info Notice */}
        <div className="mt-12 p-5 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl">
          <div className="flex gap-4">
            <div className="flex-shrink-0">
              <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
                <Sparkles className="w-5 h-5 text-blue-600" />
              </div>
            </div>
            <div>
              <h4 className="font-semibold text-blue-900 mb-1">
                Curated by Travel Experts
              </h4>
              <p className="text-sm text-blue-800">
                This itinerary has been carefully crafted with the best experiences,
                restaurants, and hidden gems. Save it to your account to customize
                dates, swap activities, and make it your own.
              </p>
            </div>
          </div>
        </div>

        {/* Floating Save CTA */}
        <div className="fixed bottom-0 left-0 right-0 z-50 p-4 bg-gradient-to-t from-white via-white to-white/80 border-t border-slate-200 safe-area-pb">
          <div className="max-w-xl mx-auto">
            {/* Main CTA Card */}
            <div className="bg-gradient-to-r from-[var(--primary)] to-[var(--primary)]/90 rounded-xl shadow-xl p-4">
              <div className="flex flex-col sm:flex-row items-center gap-4">
                {/* Value Proposition */}
                <div className="flex-1 text-center sm:text-left">
                  <div className="flex items-center justify-center sm:justify-start gap-2 mb-1">
                    <Sparkles className="w-4 h-4 text-[var(--accent)]" />
                    <span className="text-white/80 text-sm font-medium">
                      Love this itinerary?
                    </span>
                  </div>
                  <p className="text-white text-xs opacity-80">
                    Save it to your account and set your travel dates
                  </p>
                </div>

                {/* CTA Button */}
                <button
                  onClick={() => setShowSaveModal(true)}
                  className="flex items-center justify-center gap-2 px-6 py-3 rounded-lg font-semibold text-base bg-white text-[var(--primary)] hover:bg-white/90 hover:shadow-lg active:scale-[0.98] transition-all min-w-[180px]"
                >
                  <Copy className="w-5 h-5" />
                  <span>Save to My Trips</span>
                </button>
              </div>
            </div>

            {/* Trust badges */}
            <div className="flex items-center justify-center gap-4 mt-3 text-xs text-slate-500">
              <span className="flex items-center gap-1">
                <Check className="w-3.5 h-3.5 text-emerald-500" />
                Free forever
              </span>
              <span className="flex items-center gap-1">
                <Check className="w-3.5 h-3.5 text-emerald-500" />
                Fully editable
              </span>
              <span className="flex items-center gap-1">
                <Check className="w-3.5 h-3.5 text-emerald-500" />
                Share with friends
              </span>
            </div>
          </div>
        </div>

        {/* Spacer for fixed CTA */}
        <div className="h-36 sm:h-32" />
      </main>

      {/* Footer */}
      <footer className="bg-slate-50 border-t border-slate-200">
        <div className="max-w-6xl mx-auto px-4 py-8">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <Link href="/" className="flex items-center gap-2">
              <Image
                src="/images/logo.png"
                alt="MonkeyTravel Logo"
                width={28}
                height={28}
                className="w-7 h-7 object-contain"
              />
              <span className="font-semibold text-slate-900">MonkeyTravel</span>
            </Link>
            <p className="text-sm text-slate-500">
              AI-powered travel planning made simple
            </p>
            <Link
              href="/trips/new"
              className="text-sm text-[var(--primary)] hover:underline font-medium"
            >
              Create Your Own Trip
            </Link>
          </div>
        </div>
      </footer>

      {/* Save Trip Modal */}
      <SaveTripModal
        isOpen={showSaveModal}
        onClose={() => setShowSaveModal(false)}
        templateId={template.id}
        tripTitle={template.title}
        tripDestination={template.destination}
        tripCountryCode={template.countryCode}
        durationDays={template.durationDays}
      />
    </div>
  );
}
