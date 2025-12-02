"use client";

import { useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import type { ItineraryDay } from "@/types";
import DestinationHero from "@/components/DestinationHero";
import ActivityCard from "@/components/ActivityCard";

// Dynamic import for TripMap to avoid SSR issues with Google Maps
const TripMap = dynamic(() => import("@/components/TripMap"), {
  ssr: false,
  loading: () => (
    <div className="h-[400px] bg-slate-100 rounded-xl animate-pulse flex items-center justify-center">
      <span className="text-slate-400">Loading map...</span>
    </div>
  ),
});

interface TripDetailClientProps {
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
  };
  dateRange: string;
}

export default function TripDetailClient({ trip, dateRange }: TripDetailClientProps) {
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [showMap, setShowMap] = useState(true);
  const [viewMode, setViewMode] = useState<"timeline" | "cards">("cards");

  // Extract destination from title (e.g., "Rome Trip" -> "Rome")
  const destination = trip.title.replace(/ Trip$/, "");

  const statusColors = {
    planning: "bg-amber-100 text-amber-700",
    confirmed: "bg-green-100 text-green-700",
    active: "bg-blue-100 text-blue-700",
    completed: "bg-slate-100 text-slate-700",
    cancelled: "bg-red-100 text-red-700",
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-white">
      {/* Hero with Cover Image */}
      <DestinationHero
        destination={destination}
        title={trip.title}
        subtitle={trip.description}
        dateRange={dateRange}
        budget={trip.budget || undefined}
        days={trip.itinerary.length}
        tags={trip.tags}
        showBackButton={true}
        onBack={() => window.history.back()}
      >
        {/* Status Badge - Floating */}
        <div className="absolute top-4 right-4">
          <span
            className={`px-3 py-1.5 rounded-full text-sm font-medium shadow-lg ${
              statusColors[trip.status as keyof typeof statusColors] || statusColors.planning
            }`}
          >
            {trip.status.charAt(0).toUpperCase() + trip.status.slice(1)}
          </span>
        </div>
      </DestinationHero>

      <main className="max-w-6xl mx-auto px-4 py-8">
        {/* Controls Bar */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-2">
            <Link
              href="/trips"
              className="flex items-center gap-2 text-slate-600 hover:text-slate-900 px-3 py-2 rounded-lg hover:bg-slate-100 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back to Trips
            </Link>
          </div>

          <div className="flex items-center gap-3">
            {/* View Mode Toggle */}
            <div className="flex items-center bg-slate-100 rounded-lg p-1">
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

            {/* Map Toggle */}
            <button
              onClick={() => setShowMap(!showMap)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                showMap
                  ? "bg-[var(--primary)] text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
              </svg>
              {showMap ? "Hide Map" : "Show Map"}
            </button>
          </div>
        </div>

        {/* Interactive Map */}
        {showMap && trip.itinerary.length > 0 && (
          <div className="mb-8">
            <TripMap
              days={trip.itinerary}
              destination={destination}
              selectedDay={selectedDay}
              className="h-[400px]"
            />
          </div>
        )}

        {/* Day Filter Pills */}
        <div className="flex items-center gap-2 mb-6 overflow-x-auto pb-2">
          <button
            onClick={() => setSelectedDay(null)}
            className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
              selectedDay === null
                ? "bg-[var(--primary)] text-white"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            All Days
          </button>
          {trip.itinerary.map((day) => (
            <button
              key={day.day_number}
              onClick={() => setSelectedDay(day.day_number)}
              className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
                selectedDay === day.day_number
                  ? "bg-[var(--primary)] text-white"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              Day {day.day_number}
              {day.theme && <span className="ml-1 opacity-70">· {day.theme}</span>}
            </button>
          ))}
        </div>

        {/* Itinerary */}
        {trip.itinerary.length > 0 ? (
          <div className="space-y-8">
            {trip.itinerary
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
                          {trip.budget?.currency || "USD"} {day.daily_budget.total}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Activities */}
                  {viewMode === "cards" ? (
                    <div className="grid gap-4">
                      {day.activities.map((activity, idx) => (
                        <ActivityCard
                          key={idx}
                          activity={activity}
                          index={idx}
                          currency={trip.budget?.currency}
                          showGallery={true}
                        />
                      ))}
                    </div>
                  ) : (
                    /* Timeline View */
                    <div className="relative pl-8 border-l-2 border-slate-200 space-y-6">
                      {day.activities.map((activity, idx) => (
                        <div key={idx} className="relative">
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
                                  {activity.estimated_cost.amount === 0
                                    ? "Free"
                                    : `${activity.estimated_cost.currency || trip.budget?.currency || "USD"} ${activity.estimated_cost.amount}`}
                                </div>
                                <span className="text-xs text-slate-500 capitalize">
                                  {activity.type}
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
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
      </main>
    </div>
  );
}
