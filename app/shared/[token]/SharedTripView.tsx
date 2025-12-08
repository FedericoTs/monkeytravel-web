"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import Image from "next/image";
import dynamic from "next/dynamic";
import type { ItineraryDay, TripMeta, CachedDayTravelData } from "@/types";
import DestinationHero from "@/components/DestinationHero";
import ActivityCard from "@/components/ActivityCard";
import ExportMenu from "@/components/trip/ExportMenu";
import TripPackingEssentials from "@/components/trip/TripPackingEssentials";
import DaySlider from "@/components/ui/DaySlider";
import TravelConnector from "@/components/trip/TravelConnector";
import DaySummary from "@/components/trip/DaySummary";
import HotelRecommendations from "@/components/trip/HotelRecommendations";
import SaveTripModal from "@/components/ui/SaveTripModal";
import MobileBottomNav from "@/components/ui/MobileBottomNav";
import { useTravelDistances } from "@/lib/hooks/useTravelDistances";
import { ensureActivityIds } from "@/lib/utils/activity-id";
import { useCurrency } from "@/lib/locale";
import { Copy, Check, Sparkles } from "lucide-react";

// Dynamic import for TripMap to avoid SSR issues with Google Maps
const TripMap = dynamic(() => import("@/components/TripMap"), {
  ssr: false,
  loading: () => (
    <div className="h-[400px] bg-slate-100 rounded-xl animate-pulse flex items-center justify-center">
      <span className="text-slate-400">Loading map...</span>
    </div>
  ),
});

interface SharedTripViewProps {
  trip: {
    id: string;
    title: string;
    description?: string;
    status: string;
    startDate: string;
    endDate: string;
    tags?: string[];
    budget: { total: number; currency: string } | null;
    itinerary: ItineraryDay[];
    sharedAt?: string;
    meta?: TripMeta;
    packingList?: string[];
    /** Cached travel distances from trip_meta - eliminates recalculation */
    cachedTravelDistances?: CachedDayTravelData[];
    /** Hash of itinerary when travel distances were calculated */
    cachedTravelHash?: string;
  };
  shareToken: string;
  dateRange: string;
}

export default function SharedTripView({ trip, shareToken, dateRange }: SharedTripViewProps) {
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [showMap, setShowMap] = useState(true);
  const [viewMode, setViewMode] = useState<"timeline" | "cards">("cards");
  const [showSaveModal, setShowSaveModal] = useState(false);

  // Currency conversion hook - converts to user's preferred currency
  const { convert: convertCurrency } = useCurrency();

  // Format price with currency conversion
  const formatPrice = (amount: number, fromCurrency: string): string => {
    if (amount === 0) return "Free";
    const converted = convertCurrency(amount, fromCurrency);
    return converted.formatted;
  };

  // Extract destination from title (e.g., "Rome Trip" -> "Rome")
  const destination = trip.title.replace(/ Trip$/, "");

  // Memoize ensureActivityIds to prevent generating new UUIDs on every render
  const displayItinerary = useMemo(
    () => ensureActivityIds(trip.itinerary),
    [trip.itinerary]
  );

  // Fetch travel distances between activities
  // Uses local Haversine calculation - NO external API calls!
  // For shared trips, we use cached data from trip_meta if available (no tripId to save new calculations)
  const { travelData, isLoading: travelLoading } = useTravelDistances(displayItinerary, {
    cachedTravelData: trip.cachedTravelDistances,
    cachedHash: trip.cachedTravelHash,
  });

  // Calculate nights
  const nights = useMemo(() => {
    const start = new Date(trip.startDate);
    const end = new Date(trip.endDate);
    return Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  }, [trip.startDate, trip.endDate]);

  // Calculate total activities
  const activitiesCount = useMemo(
    () => displayItinerary.reduce((acc, day) => acc + day.activities.length, 0),
    [displayItinerary]
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-white">
      {/* Hero with Cover Image - Enhanced with weather and stats */}
      <DestinationHero
        destination={destination}
        title={trip.title}
        subtitle={trip.description}
        dateRange={dateRange}
        budget={trip.budget || undefined}
        days={trip.itinerary.length}
        nights={nights}
        activitiesCount={activitiesCount}
        weatherNote={trip.meta?.weather_note}
        highlights={trip.meta?.highlights}
        tags={trip.tags}
        showBackButton={true}
        onBack={() => window.history.back()}
        disableApiCalls={true}
      >
        {/* Shared Badge - Floating */}
        <div className="absolute top-4 right-4">
          <span className="px-3 py-1.5 rounded-full text-sm font-medium shadow-lg bg-purple-100 text-purple-700">
            Shared Trip
          </span>
        </div>
      </DestinationHero>

      <main className="max-w-6xl mx-auto px-4 py-6 sm:py-8">
        {/* Controls Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 sm:gap-4 mb-6">
          {/* Left side - Back to trips */}
          <div className="flex items-center gap-2">
            <Link
              href="/trips"
              className="flex items-center gap-1 sm:gap-2 text-slate-600 hover:text-slate-900 px-2 sm:px-3 py-2 rounded-lg hover:bg-slate-100 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              <span className="hidden sm:inline">Back to My Trips</span>
            </Link>
          </div>

          {/* Right side - Controls */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* View Mode Toggle - Hidden on mobile */}
            <div className="hidden sm:flex items-center bg-slate-100 rounded-lg p-1">
              <button
                onClick={() => setViewMode("cards")}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  viewMode === "cards"
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Cards
              </button>
              <button
                onClick={() => setViewMode("timeline")}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  viewMode === "timeline"
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Timeline
              </button>
            </div>

            {/* Map Toggle - Icon only on mobile */}
            <button
              onClick={() => setShowMap(!showMap)}
              className={`flex items-center gap-2 p-2 sm:px-3 sm:py-2 rounded-lg text-sm font-medium transition-colors ${
                showMap
                  ? "bg-[var(--primary)] text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
              title={showMap ? "Hide Map" : "Show Map"}
            >
              <svg className="w-5 h-5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
              </svg>
              <span className="hidden sm:inline">{showMap ? "Hide Map" : "Show Map"}</span>
            </button>

            {/* Export Menu */}
            <ExportMenu
              trip={{
                title: trip.title,
                description: trip.description,
                startDate: trip.startDate,
                endDate: trip.endDate,
                budget: trip.budget,
                itinerary: displayItinerary,
              }}
              destination={destination}
              meta={trip.meta}
            />
          </div>
        </div>

        {/* Interactive Map */}
        {showMap && displayItinerary.length > 0 && (
          <div className="mb-8">
            <TripMap
              days={displayItinerary}
              destination={destination}
              selectedDay={selectedDay}
              className="h-[400px]"
              disableApiCalls={true}
            />
          </div>
        )}

        {/* Hotel Recommendations - DISABLED for shared trips - No external API costs */}
        <HotelRecommendations
          destination={destination}
          itinerary={displayItinerary}
          startDate={trip.startDate}
          endDate={trip.endDate}
          disableApiCalls={true}
        />

        {/* Day Filter Slider - Mobile optimized */}
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
                          Day {day.day_number}
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
                          {formatPrice(day.daily_budget.total, trip.budget?.currency || "USD")}
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
                                currency={trip.budget?.currency}
                                showGallery={true}
                                disableAutoFetch={true}
                              />
                              {/* Travel connector to next activity */}
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
                                          activity.estimated_cost.currency || trip.budget?.currency || "USD"
                                        )}
                                      </div>
                                      <span className="text-xs text-slate-500 capitalize">
                                        {activity.type}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              </div>
                              {/* Compact travel connector in timeline */}
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
                      {/* Day travel summary for timeline */}
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
            <h3 className="text-lg font-medium text-slate-900 mb-2">No Itinerary Yet</h3>
            <p className="text-slate-600">This trip doesn't have any activities planned yet.</p>
          </div>
        )}

        {/* Journey Essentials - Premium Packing List */}
        {trip.packingList && trip.packingList.length > 0 && (
          <TripPackingEssentials
            items={trip.packingList}
            destination={destination}
          />
        )}

        {/* AI Disclaimer */}
        <div className="mt-12 p-5 bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-xl">
          <div className="flex gap-4">
            <div className="flex-shrink-0">
              <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
                <svg className="w-5 h-5 text-amber-600" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                </svg>
              </div>
            </div>
            <div>
              <h4 className="font-semibold text-amber-900 mb-1">
                AI-Generated Itinerary with Verified Data
              </h4>
              <p className="text-sm text-amber-800">
                This itinerary was created by AI and enriched with real-time data from Google Places.
                Photos, ratings, and price levels are verified, but we recommend double-checking opening hours
                and availability before your trip. Click "More" on any activity to see verified details and photos.
              </p>
            </div>
          </div>
        </div>

        {/* Shared Notice - Updated messaging for duplication */}
        <div className="mt-6 p-5 bg-gradient-to-r from-purple-50 to-indigo-50 border border-purple-200 rounded-xl">
          <div className="flex gap-4">
            <div className="flex-shrink-0">
              <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center">
                <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                </svg>
              </div>
            </div>
            <div>
              <h4 className="font-semibold text-purple-900 mb-1">
                Love this itinerary?
              </h4>
              <p className="text-sm text-purple-800">
                Save it to your account and make it your own. Edit times, swap activities,
                add notes, and share with your travel companions.
              </p>
            </div>
          </div>
        </div>

        {/* Floating Save CTA - Sticky at bottom for easy access */}
        <div className="fixed bottom-0 left-0 right-0 z-40 p-4 bg-gradient-to-t from-white via-white to-white/80 border-t border-slate-100">
          <div className="max-w-md mx-auto">
            <button
              onClick={() => setShowSaveModal(true)}
              className="w-full flex items-center justify-center gap-2 px-6 py-4 bg-gradient-to-r from-[var(--primary)] to-[var(--primary)]/90 text-white font-semibold rounded-xl shadow-lg hover:shadow-xl transform hover:scale-[1.02] transition-all duration-200"
            >
              <Sparkles className="w-5 h-5" />
              Save to My Trips
            </button>
            <p className="text-center text-xs text-slate-500 mt-2">
              Save this itinerary and customize it for your dates
            </p>
          </div>
        </div>

        {/* Save Trip Modal */}
        <SaveTripModal
          isOpen={showSaveModal}
          onClose={() => setShowSaveModal(false)}
          shareToken={shareToken}
          tripTitle={trip.title}
          tripDestination={destination}
          durationDays={nights + 1}
        />
      </main>

      {/* Footer */}
      <footer className="bg-slate-50 border-t border-slate-200 mt-16">
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
              href="/"
              className="text-sm text-[var(--primary)] hover:underline font-medium"
            >
              Create Your Trip
            </Link>
          </div>
        </div>
      </footer>

      {/* Mobile Bottom Navigation */}
      <MobileBottomNav activePage="trips" />
    </div>
  );
}
