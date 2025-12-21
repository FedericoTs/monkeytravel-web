"use client";

/**
 * ChatGPT Import Client Component
 * Interactive welcome page for users coming from ChatGPT
 */

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

interface MCPActivity {
  name: string;
  time: string;
  type: string;
  description: string;
  location?: string;
  tip?: string;
}

interface MCPDay {
  day: number;
  theme: string;
  activities: MCPActivity[];
}

interface MCPItinerary {
  id: string;
  ref_id: string;
  destination: string;
  days: number;
  travel_style: string | null;
  interests: string[] | null;
  budget: string | null;
  itinerary: MCPDay[];
  summary: string | null;
  created_at: string;
  claimed_by: string | null;
}

interface Props {
  itinerary: MCPItinerary;
}

export default function ChatGPTImportClient({ itinerary }: Props) {
  const router = useRouter();
  const supabase = createClient();
  const [expandedDay, setExpandedDay] = useState<number>(1);
  const [isImporting, setIsImporting] = useState(false);

  // Count total activities
  const totalActivities = itinerary.itinerary.reduce(
    (sum, day) => sum + day.activities.length,
    0
  );

  // Handle import - redirect to auth with return URL
  const handleImport = async () => {
    setIsImporting(true);

    // Check if user is already logged in
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      // User is logged in - claim the itinerary and redirect
      await claimItinerary(user.id);
    } else {
      // Redirect to login with return URL
      const returnUrl = `/from-chatgpt/${itinerary.ref_id}/claim`;
      router.push(`/auth?redirect=${encodeURIComponent(returnUrl)}`);
    }
  };

  // Claim the itinerary for the current user
  const claimItinerary = async (userId: string) => {
    try {
      // Update the itinerary to mark it as claimed
      const { error } = await supabase
        .from("mcp_itineraries")
        .update({
          claimed_by: userId,
          claimed_at: new Date().toISOString(),
        })
        .eq("ref_id", itinerary.ref_id)
        .is("claimed_by", null);

      if (error) {
        console.error("Failed to claim itinerary:", error);
        return;
      }

      // Redirect to create trip with pre-filled data
      const params = new URLSearchParams({
        source: "chatgpt",
        destination: itinerary.destination,
        days: String(itinerary.days),
        import: itinerary.ref_id,
      });

      router.push(`/trip/new?${params.toString()}`);
    } catch (err) {
      console.error("Error claiming itinerary:", err);
      setIsImporting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#f8fafc] to-white">
      {/* Header */}
      <header className="border-b border-gray-100 bg-white/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <Image
              src="/images/logo.png"
              alt="MonkeyTravel"
              width={32}
              height={32}
              className="rounded-lg"
            />
            <span className="font-semibold text-[var(--primary)]">
              MonkeyTravel
            </span>
          </Link>
          <span className="text-xs bg-[var(--accent)]/20 text-[var(--primary)] px-2 py-1 rounded-full font-medium">
            From ChatGPT
          </span>
        </div>
      </header>

      {/* Hero Section */}
      <section className="max-w-4xl mx-auto px-4 pt-8 pb-6 text-center">
        <div className="inline-flex items-center gap-2 bg-green-50 text-green-700 px-3 py-1.5 rounded-full text-sm font-medium mb-4">
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 13l4 4L19 7"
            />
          </svg>
          Your itinerary is ready!
        </div>

        <h1 className="text-3xl md:text-4xl font-bold text-gray-900 mb-3">
          {itinerary.days}-Day {itinerary.destination} Trip
        </h1>

        <p className="text-gray-600 max-w-xl mx-auto mb-6">
          ChatGPT created this personalized itinerary for you. Save it to
          MonkeyTravel to edit, share with friends, and access on the go.
        </p>

        {/* Stats */}
        <div className="flex justify-center gap-6 mb-8">
          <div className="text-center">
            <div className="text-2xl font-bold text-[var(--primary)]">
              {itinerary.days}
            </div>
            <div className="text-sm text-gray-500">Days</div>
          </div>
          <div className="w-px bg-gray-200" />
          <div className="text-center">
            <div className="text-2xl font-bold text-[var(--primary)]">
              {totalActivities}
            </div>
            <div className="text-sm text-gray-500">Activities</div>
          </div>
          {itinerary.travel_style && (
            <>
              <div className="w-px bg-gray-200" />
              <div className="text-center">
                <div className="text-2xl font-bold text-[var(--primary)] capitalize">
                  {itinerary.travel_style}
                </div>
                <div className="text-sm text-gray-500">Style</div>
              </div>
            </>
          )}
        </div>
      </section>

      {/* Itinerary Preview */}
      <section className="max-w-4xl mx-auto px-4 pb-8">
        <div className="bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden">
          {/* Day Tabs */}
          <div className="flex overflow-x-auto border-b border-gray-100 bg-gray-50/50">
            {itinerary.itinerary.map((day) => (
              <button
                key={day.day}
                onClick={() => setExpandedDay(day.day)}
                className={`flex-shrink-0 px-4 py-3 text-sm font-medium transition-colors ${
                  expandedDay === day.day
                    ? "bg-white text-[var(--primary)] border-b-2 border-[var(--primary)]"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                Day {day.day}
              </button>
            ))}
          </div>

          {/* Day Content */}
          {itinerary.itinerary.map((day) => (
            <div
              key={day.day}
              className={expandedDay === day.day ? "block" : "hidden"}
            >
              <div className="p-4 border-b border-gray-100 bg-[var(--primary)]/5">
                <h3 className="font-semibold text-[var(--primary)]">
                  {day.theme}
                </h3>
              </div>

              <div className="divide-y divide-gray-100">
                {day.activities.map((activity, idx) => (
                  <div key={idx} className="p-4 hover:bg-gray-50/50">
                    <div className="flex items-start gap-3">
                      <div className="flex-shrink-0 w-16 text-xs font-medium text-gray-500">
                        {activity.time.split("-")[0]}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="font-medium text-gray-900">
                          {activity.name}
                        </h4>
                        <p className="text-sm text-gray-600 mt-0.5">
                          {activity.description}
                        </p>
                        {activity.tip && (
                          <p className="text-xs text-[var(--accent)] mt-1 flex items-center gap-1">
                            <svg
                              className="w-3 h-3"
                              fill="currentColor"
                              viewBox="0 0 20 20"
                            >
                              <path
                                fillRule="evenodd"
                                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                                clipRule="evenodd"
                              />
                            </svg>
                            {activity.tip}
                          </p>
                        )}
                      </div>
                      <div className="flex-shrink-0">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600 capitalize">
                          {activity.type}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA Section */}
      <section className="max-w-4xl mx-auto px-4 pb-12">
        <div className="bg-gradient-to-r from-[var(--primary)] to-[#0d5a8a] rounded-2xl p-6 md:p-8 text-white text-center">
          <h2 className="text-xl md:text-2xl font-bold mb-2">
            Ready to make it yours?
          </h2>
          <p className="text-white/80 mb-6 max-w-md mx-auto">
            Save this itinerary to your MonkeyTravel account to customize it,
            add notes, and share with travel companions.
          </p>

          <button
            onClick={handleImport}
            disabled={isImporting}
            className="inline-flex items-center justify-center gap-2 bg-[var(--accent)] hover:bg-[var(--accent)]/90 text-[var(--primary)] font-semibold px-8 py-3 rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isImporting ? (
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
                Saving...
              </>
            ) : (
              <>
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"
                  />
                </svg>
                Save to MonkeyTravel
              </>
            )}
          </button>

          <p className="text-white/60 text-sm mt-4">
            Free to use. No credit card required.
          </p>
        </div>
      </section>

      {/* Features */}
      <section className="max-w-4xl mx-auto px-4 pb-16">
        <h3 className="text-lg font-semibold text-gray-900 mb-4 text-center">
          What you can do with MonkeyTravel
        </h3>
        <div className="grid md:grid-cols-3 gap-4">
          <div className="bg-white rounded-xl p-4 border border-gray-100">
            <div className="w-10 h-10 bg-[var(--primary)]/10 rounded-lg flex items-center justify-center mb-3">
              <svg
                className="w-5 h-5 text-[var(--primary)]"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                />
              </svg>
            </div>
            <h4 className="font-medium text-gray-900 mb-1">Edit & Customize</h4>
            <p className="text-sm text-gray-600">
              Rearrange activities, add notes, and adjust timings to fit your
              style.
            </p>
          </div>

          <div className="bg-white rounded-xl p-4 border border-gray-100">
            <div className="w-10 h-10 bg-[var(--primary)]/10 rounded-lg flex items-center justify-center mb-3">
              <svg
                className="w-5 h-5 text-[var(--primary)]"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                />
              </svg>
            </div>
            <h4 className="font-medium text-gray-900 mb-1">Share with Friends</h4>
            <p className="text-sm text-gray-600">
              Invite travel companions to view and collaborate on your trip.
            </p>
          </div>

          <div className="bg-white rounded-xl p-4 border border-gray-100">
            <div className="w-10 h-10 bg-[var(--primary)]/10 rounded-lg flex items-center justify-center mb-3">
              <svg
                className="w-5 h-5 text-[var(--primary)]"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"
                />
              </svg>
            </div>
            <h4 className="font-medium text-gray-900 mb-1">Access Anywhere</h4>
            <p className="text-sm text-gray-600">
              Your itinerary syncs across devices. Access it offline while
              traveling.
            </p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-100 py-6 text-center text-sm text-gray-500">
        <p>
          Powered by{" "}
          <Link href="/" className="text-[var(--primary)] hover:underline">
            MonkeyTravel
          </Link>{" "}
          AI
        </p>
      </footer>
    </div>
  );
}
