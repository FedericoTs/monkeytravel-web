import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { formatDateRange } from "@/lib/utils";

export default async function TripsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  // Fetch user's trips
  const { data: trips } = await supabase
    .from("trips")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  // Fetch user profile
  const { data: profile } = await supabase
    .from("users")
    .select("display_name, avatar_url")
    .eq("id", user.id)
    .single();

  const displayName = profile?.display_name || user.email?.split("@")[0] || "Traveler";

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-white overflow-x-hidden">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-lg border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-4 py-3 sm:py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <Image
              src="/images/logo.png"
              alt="MonkeyTravel"
              width={36}
              height={36}
              className="rounded-lg sm:w-10 sm:h-10"
            />
            <span className="font-bold text-lg sm:text-xl text-[var(--primary)]">
              MonkeyTravel
            </span>
          </Link>

          <div className="flex items-center gap-2 sm:gap-4">
            <span className="text-slate-600 text-sm sm:text-base hidden xs:inline">Hi, {displayName}</span>
            <form action="/auth/signout" method="post">
              <button
                type="submit"
                className="text-slate-500 hover:text-slate-700 text-xs sm:text-sm px-2 py-1 rounded-lg hover:bg-slate-100 transition-colors"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-4 py-6 sm:py-8">
        {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 sm:mb-8">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">Your Trips</h1>
            <p className="text-slate-600 text-sm sm:text-base mt-1">
              Plan and manage your AI-powered itineraries
            </p>
          </div>
          <Link
            href="/trips/new"
            className="bg-[var(--primary)] text-white px-4 sm:px-6 py-2.5 sm:py-3 rounded-xl font-medium hover:bg-[var(--primary)]/90 transition-colors flex items-center justify-center gap-2 w-full sm:w-auto"
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
                d="M12 4v16m8-8H4"
              />
            </svg>
            Plan New Trip
          </Link>
        </div>

        {/* Trips Grid */}
        {trips && trips.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
            {trips.map((trip) => (
              <Link
                key={trip.id}
                href={`/trips/${trip.id}`}
                className="group bg-white rounded-xl sm:rounded-2xl border border-slate-200 overflow-hidden hover:shadow-lg transition-all hover:border-slate-300 active:scale-[0.98]"
              >
                {/* Cover Image */}
                <div className="h-32 sm:h-40 bg-gradient-to-br from-[var(--primary)] to-[var(--primary)]/70 relative">
                  {trip.cover_image_url && (
                    <Image
                      src={trip.cover_image_url}
                      alt={trip.title}
                      fill
                      className="object-cover"
                    />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                  <div className="absolute bottom-3 sm:bottom-4 left-3 sm:left-4 right-3 sm:right-4">
                    <h3 className="text-lg sm:text-xl font-bold text-white line-clamp-2">
                      {trip.title}
                    </h3>
                  </div>
                </div>

                {/* Trip Info */}
                <div className="p-3 sm:p-4">
                  <div className="flex items-center gap-2 text-slate-600 text-xs sm:text-sm mb-2">
                    <svg
                      className="w-4 h-4 flex-shrink-0"
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
                    <span className="truncate">{formatDateRange(trip.start_date, trip.end_date)}</span>
                  </div>

                  {trip.description && (
                    <p className="text-slate-600 text-xs sm:text-sm line-clamp-2">
                      {trip.description}
                    </p>
                  )}

                  {/* Status Badge */}
                  <div className="mt-2 sm:mt-3 flex items-center gap-2">
                    <span
                      className={`px-2 py-0.5 sm:py-1 rounded-full text-xs font-medium ${
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
              </Link>
            ))}
          </div>
        ) : (
          /* Empty State */
          <div className="text-center py-12 sm:py-16 px-4">
            <div className="w-20 h-20 sm:w-24 sm:h-24 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4 sm:mb-6">
              <svg
                className="w-10 h-10 sm:w-12 sm:h-12 text-slate-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            <h2 className="text-xl sm:text-2xl font-bold text-slate-900 mb-2">
              No trips yet
            </h2>
            <p className="text-slate-600 text-sm sm:text-base mb-6 sm:mb-8 max-w-md mx-auto">
              Create your first AI-powered trip and let MonkeyTravel plan the
              perfect itinerary for you.
            </p>
            <Link
              href="/trips/new"
              className="inline-flex items-center justify-center gap-2 bg-[var(--primary)] text-white px-6 sm:px-8 py-3 sm:py-4 rounded-xl font-medium hover:bg-[var(--primary)]/90 transition-colors w-full sm:w-auto max-w-xs"
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
                  d="M12 4v16m8-8H4"
                />
              </svg>
              Plan Your First Trip
            </Link>
          </div>
        )}
      </main>
    </div>
  );
}
