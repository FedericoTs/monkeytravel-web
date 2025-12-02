import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { formatDateRange } from "@/lib/utils";
import type { ItineraryDay } from "@/types";

export default async function TripDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  // Fetch trip
  const { data: trip, error } = await supabase
    .from("trips")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (error || !trip) {
    notFound();
  }

  const itinerary = (trip.itinerary as ItineraryDay[]) || [];
  const budget = trip.budget as { total: number; currency: string } | null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-white">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-lg border-b border-slate-200">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link
            href="/trips"
            className="flex items-center gap-2 text-slate-600 hover:text-slate-900"
          >
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
                d="M15 19l-7-7 7-7"
              />
            </svg>
            Back to Trips
          </Link>
          <div className="flex items-center gap-2">
            <span
              className={`px-2 py-1 rounded-full text-xs font-medium ${
                trip.status === "planning"
                  ? "bg-amber-100 text-amber-700"
                  : trip.status === "confirmed"
                  ? "bg-green-100 text-green-700"
                  : trip.status === "active"
                  ? "bg-blue-100 text-blue-700"
                  : trip.status === "completed"
                  ? "bg-slate-100 text-slate-700"
                  : "bg-red-100 text-red-700"
              }`}
            >
              {trip.status.charAt(0).toUpperCase() + trip.status.slice(1)}
            </span>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">
        {/* Trip Header */}
        <div className="bg-gradient-to-br from-[var(--primary)] to-[var(--primary)]/80 rounded-2xl p-8 text-white mb-8">
          <h1 className="text-3xl font-bold mb-2">{trip.title}</h1>
          {trip.description && (
            <p className="text-white/80 mb-4">{trip.description}</p>
          )}
          <div className="flex flex-wrap gap-4 text-sm">
            <div className="flex items-center gap-2">
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
                  d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
              {formatDateRange(trip.start_date, trip.end_date)}
            </div>
            {budget && (
              <div className="flex items-center gap-2">
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
                    d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                Est. {budget.currency} {budget.total}
              </div>
            )}
            <div className="flex items-center gap-2">
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
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              {itinerary.length} days
            </div>
          </div>
        </div>

        {/* Tags */}
        {trip.tags && trip.tags.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-8">
            {trip.tags.map((tag: string) => (
              <span
                key={tag}
                className="px-3 py-1 bg-slate-100 text-slate-700 rounded-full text-sm"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Itinerary */}
        {itinerary.length > 0 ? (
          <div className="space-y-6">
            {itinerary.map((day) => (
              <div
                key={day.day_number}
                className="bg-white rounded-xl border border-slate-200 overflow-hidden"
              >
                {/* Day Header */}
                <div className="bg-slate-50 px-6 py-4 border-b border-slate-200">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-[var(--primary)] text-white flex items-center justify-center font-bold">
                      {day.day_number}
                    </div>
                    <div>
                      <div className="font-semibold text-slate-900">
                        Day {day.day_number}
                      </div>
                      {day.theme && (
                        <div className="text-sm text-slate-500">{day.theme}</div>
                      )}
                    </div>
                    {day.daily_budget && (
                      <div className="ml-auto text-right">
                        <div className="text-sm text-slate-500">Est. Cost</div>
                        <div className="font-medium text-slate-900">
                          ${day.daily_budget.total}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Activities */}
                <div className="p-6 space-y-4">
                  {day.activities.map((activity, idx) => {
                    // Generate Google Maps search URL
                    const mapSearchQuery = encodeURIComponent(
                      `${activity.name} ${activity.address || activity.location}`
                    );
                    const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${mapSearchQuery}`;
                    const googleSearchUrl = `https://www.google.com/search?q=${mapSearchQuery}`;

                    return (
                    <div key={idx} className="flex gap-4">
                      <div className="flex-shrink-0 text-center">
                        <div className="text-sm font-medium text-slate-900">
                          {activity.start_time}
                        </div>
                        <div className="text-xs text-slate-500">
                          {activity.duration_minutes}min
                        </div>
                      </div>
                      <div className="flex-1 border-l-2 border-slate-200 pl-4 pb-4">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <h4 className="font-medium text-slate-900">
                              {activity.name}
                            </h4>
                            <p className="text-sm text-slate-600 mt-1">
                              {activity.description}
                            </p>

                            {/* Location with address */}
                            <div className="flex items-start gap-2 mt-2 text-sm text-slate-500">
                              <svg
                                className="w-4 h-4 mt-0.5 flex-shrink-0"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
                                />
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
                                />
                              </svg>
                              <span>
                                {activity.address || activity.location}
                              </span>
                            </div>

                            {/* Action Links */}
                            <div className="flex flex-wrap gap-2 mt-3">
                              <a
                                href={googleMapsUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium rounded-lg transition-colors"
                              >
                                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                                  <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
                                </svg>
                                View on Maps
                              </a>
                              <a
                                href={googleSearchUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium rounded-lg transition-colors"
                              >
                                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                                  <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
                                </svg>
                                Verify
                              </a>
                              {activity.official_website && (
                                <a
                                  href={activity.official_website}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[var(--primary)]/10 hover:bg-[var(--primary)]/20 text-[var(--primary)] text-xs font-medium rounded-lg transition-colors"
                                >
                                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                  </svg>
                                  Official Site
                                </a>
                              )}
                              {activity.booking_required && (
                                <span className="inline-flex items-center gap-1 px-2 py-1 bg-amber-50 text-amber-700 text-xs rounded-lg">
                                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                                  </svg>
                                  Booking required
                                </span>
                              )}
                            </div>

                            {activity.tips && activity.tips.length > 0 && (
                              <div className="mt-3 p-2 bg-blue-50 rounded-lg">
                                <div className="text-xs font-medium text-blue-700">
                                  Tips:
                                </div>
                                <ul className="text-xs text-blue-600 mt-1">
                                  {activity.tips.map((tip, i) => (
                                    <li key={i}>• {tip}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>
                          <div className="text-right flex-shrink-0 ml-4">
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
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-12 bg-white rounded-xl border border-slate-200">
            <p className="text-slate-600">No itinerary details available.</p>
          </div>
        )}

        {/* AI Disclaimer */}
        <div className="mt-8 p-4 bg-amber-50 border border-amber-200 rounded-lg">
          <div className="flex gap-3">
            <svg className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <div>
              <p className="text-sm font-medium text-amber-800">
                AI-Generated Itinerary
              </p>
              <p className="text-sm text-amber-700 mt-1">
                This itinerary was created by AI using real places. We recommend using the &quot;View on Maps&quot; and &quot;Verify&quot; links to confirm each location exists, check current opening hours, and read recent reviews before your trip.
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
