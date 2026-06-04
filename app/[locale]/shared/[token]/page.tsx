import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { formatDateRange } from "@/lib/datetime";
import type { ItineraryDay, TripMeta } from "@/types";
import type { Metadata } from "next";
import SharedTripView from "./SharedTripView";
import TripEngagementSection from "@/components/explore/TripEngagementSection";
import { getTripDestination } from "@/lib/trips/destination";
import { refreshTripItinerary } from "@/lib/places/refreshItineraryPhotos";
import {
  generateTripSchema,
  generateBreadcrumbSchema,
  jsonLdScriptProps,
} from "@/lib/seo/structured-data";
import { getNonce } from "@/lib/security/nonce";

interface PageProps {
  params: Promise<{ token: string }>;
}

/**
 * Request-scoped cache for the trip lookup. Both `generateMetadata` and
 * the page render need the same row; without the cache wrapper Next.js
 * runs them as two separate Supabase queries per request. React's
 * `cache()` memoizes by the token argument for the lifetime of a single
 * request, so the second call resolves from the cached promise.
 *
 * 2026-05-30 perf pass: previously was generateMetadata SELECT (3 cols) +
 * page SELECT * (all cols), now one SELECT * shared. Net: -1 DB RTT per
 * shared-trip view (a top-traffic surface).
 */
const getSharedTrip = cache(async (token: string) => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("trips")
    .select("*")
    .eq("share_token", token)
    .single();
  if (error) return null;
  return data;
});

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { token } = await params;
  const trip = await getSharedTrip(token);

  if (!trip) {
    return {
      title: "Trip Not Found",
      robots: { index: false, follow: false },
    };
  }

  return {
    title: trip.title,
    description: trip.description || `Check out this travel itinerary on MonkeyTravel`,
    robots: { index: false, follow: false },
    alternates: {
      canonical: `https://monkeytravel.app/shared/${token}`,
    },
    openGraph: {
      title: trip.title,
      description: trip.description || `Check out this travel itinerary on MonkeyTravel`,
      type: "website",
      ...(trip.cover_image_url && {
        images: [{ url: trip.cover_image_url, width: 1200, height: 630, alt: trip.title }],
      }),
    },
    twitter: {
      card: "summary_large_image",
      title: trip.title,
      description: trip.description || `Check out this travel itinerary on MonkeyTravel`,
      ...(trip.cover_image_url && { images: [trip.cover_image_url] }),
    },
  };
}

export default async function SharedTripPage({ params }: PageProps) {
  const { token } = await params;
  const trip = await getSharedTrip(token);

  if (!trip) {
    notFound();
  }

  // Read-time refresh of activity photo URLs from places_v2. Public
  // /shared/* surfaces had broken activity-card images when URLs baked
  // into trip.itinerary went stale — places_v2 has the canonical URL.
  // See lib/places/refreshItineraryPhotos.ts.
  const rawItinerary = (trip.itinerary as ItineraryDay[]) || [];
  const itinerary = await refreshTripItinerary(rawItinerary);
  const budget = trip.budget as { total: number; currency: string } | null;
  const tripMeta = (trip.trip_meta as TripMeta) || {};
  const packingList = (trip.packing_list as string[]) || tripMeta.packing_suggestions || [];

  // Extract cached travel distances from trip_meta (calculated locally, no API cost)
  const cachedTravelDistances = tripMeta.travel_distances;
  const cachedTravelHash = tripMeta.travel_distances_hash;

  // Prefer trip_meta.destination (canonical, set by wizard) — falls back
  // to title-strip. Matters for SEO: this string feeds the JSON-LD
  // tripSchema below, so a wrong value gets indexed by Google.
  const destination = getTripDestination(trip);

  // Generate structured data for SEO
  const tripUrl = `https://monkeytravel.app/shared/${token}`;
  const tripSchema = generateTripSchema({
    name: trip.title,
    description: trip.description,
    url: tripUrl,
    startDate: trip.start_date,
    endDate: trip.end_date,
    destination,
  });

  const breadcrumbSchema = generateBreadcrumbSchema([
    { name: "Home", url: "https://monkeytravel.app" },
    { name: "Shared Trips", url: "https://monkeytravel.app/shared" },
    { name: trip.title, url: tripUrl },
  ]);

  // **2026-05-25 (/explore Week 3)**: render the engagement bar above
  // the trip view so anon visitors can like/save/fork without scrolling.
  // The component no-ops if the explore flag is off OR the trip isn't
  // public yet (private trips don't get the engagement UI exposed).
  const isPublic = trip.visibility === "public" && !trip.is_hidden;

  const nonce = await getNonce();

  return (
    <>
      {/* Structured Data for SEO */}
      <script {...jsonLdScriptProps(tripSchema, nonce)} />
      <script {...jsonLdScriptProps(breadcrumbSchema, nonce)} />

      <SharedTripView
        trip={{
          id: trip.id,
          title: trip.title,
          description: trip.description,
          status: trip.status,
          startDate: trip.start_date,
          endDate: trip.end_date,
          tags: trip.tags,
          budget,
          itinerary,
          sharedAt: trip.shared_at,
          meta: tripMeta,
          packingList,
          cachedTravelDistances,
          cachedTravelHash,
        }}
        shareToken={token}
        dateRange={formatDateRange(trip.start_date, trip.end_date)}
        // Forward the persisted cover image so the hero renders the
        // actual photo for anon viewers instead of the gradient fallback.
        // The OpenGraph tag above already reads this — it's been in the
        // DB the whole time, just never threaded down to the client.
        coverImageUrl={trip.cover_image_url ?? null}
        engagementSlot={
          <TripEngagementSection
            tripId={trip.id}
            likeCount={trip.like_count ?? 0}
            saveCount={trip.save_count ?? 0}
            forkCount={trip.fork_count ?? 0}
            isPublic={isPublic}
          />
        }
      />
    </>
  );
}
