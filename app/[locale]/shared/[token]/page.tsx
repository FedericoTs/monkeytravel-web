import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { formatDateRange } from "@/lib/datetime";
import type { ItineraryDay, TripMeta } from "@/types";
import type { Metadata } from "next";
import SharedTripView from "./SharedTripView";
import TripEngagementSection from "@/components/explore/TripEngagementSection";
import { getTripDestination } from "@/lib/trips/destination";
import {
  generateTripSchema,
  generateBreadcrumbSchema,
  jsonLdScriptProps,
} from "@/lib/seo/structured-data";

interface PageProps {
  params: Promise<{ token: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { token } = await params;
  const supabase = await createClient();

  const { data: trip } = await supabase
    .from("trips")
    .select("title, description, cover_image_url")
    .eq("share_token", token)
    .single();

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
  const supabase = await createClient();

  // Fetch trip by share token
  const { data: trip, error } = await supabase
    .from("trips")
    .select("*")
    .eq("share_token", token)
    .single();

  if (error || !trip) {
    notFound();
  }

  const itinerary = (trip.itinerary as ItineraryDay[]) || [];
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

  return (
    <>
      {/* Structured Data for SEO */}
      <script {...jsonLdScriptProps(tripSchema)} />
      <script {...jsonLdScriptProps(breadcrumbSchema)} />

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
