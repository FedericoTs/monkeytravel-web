import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { formatDateRange } from "@/lib/datetime";
import type { ItineraryDay, TripMeta } from "@/types";
import type { Metadata } from "next";
import SharedTripView from "./SharedTripView";
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
      title: "Trip Not Found | MonkeyTravel",
    };
  }

  return {
    title: `${trip.title} | MonkeyTravel`,
    description: trip.description || `Check out this travel itinerary on MonkeyTravel`,
    alternates: {
      canonical: `https://monkeytravel.app/shared/${token}`,
    },
    openGraph: {
      title: `${trip.title} | MonkeyTravel`,
      description: trip.description || `Check out this travel itinerary on MonkeyTravel`,
      type: "website",
      ...(trip.cover_image_url && {
        images: [{ url: trip.cover_image_url, width: 1200, height: 630, alt: trip.title }],
      }),
    },
    twitter: {
      card: "summary_large_image",
      title: `${trip.title} | MonkeyTravel`,
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

  // Extract destination from title (e.g., "Cusco Trip" -> "Cusco")
  // Note: 'destination' is not a column in trips table, it's derived from title
  const destination = trip.title.replace(/ Trip$/i, "");

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
      />
    </>
  );
}
