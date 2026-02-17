import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import { formatDateRange } from "@/lib/datetime";
import type { ItineraryDay, TripMeta, CollaboratorRole } from "@/types";
import type { Metadata } from "next";
import TripDetailClient from "./TripDetailClient";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createClient();
  const { data: trip } = await supabase
    .from("trips")
    .select("title")
    .eq("id", id)
    .single();

  return {
    title: trip?.title || "Trip Details",
    robots: { index: false, follow: false },
  };
}

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

  // First, try to fetch as owner
  let { data: trip, error } = await supabase
    .from("trips")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  let userRole: CollaboratorRole = "owner";
  let isCollaborator = false;

  // If not found as owner, check if user is a collaborator
  if (error || !trip) {
    const { data: collaborator } = await supabase
      .from("trip_collaborators")
      .select("role, trips(*)")
      .eq("trip_id", id)
      .eq("user_id", user.id)
      .single();

    if (collaborator?.trips) {
      trip = collaborator.trips as typeof trip;
      userRole = collaborator.role as CollaboratorRole;
      isCollaborator = true;
      error = null;
    }
  }

  if (error || !trip) {
    notFound();
  }

  // Fetch collaborator count for voting quorum
  const { count: collaboratorCount } = await supabase
    .from("trip_collaborators")
    .select("*", { count: "exact", head: true })
    .eq("trip_id", id);

  // Total voters = collaborators + owner
  const totalVoters = (collaboratorCount || 0) + 1;
  const isCollaborativeTrip = totalVoters > 1;

  const itinerary = (trip.itinerary as ItineraryDay[]) || [];
  const budget = trip.budget as { total: number; currency: string } | null;
  const tripMeta = (trip.trip_meta as TripMeta) || {};
  const packingList = (trip.packing_list as string[]) || tripMeta.packing_suggestions || [];
  const packingChecked = tripMeta.packing_checked || [];

  // Extract cached travel distances from trip_meta (calculated locally, no API cost)
  const cachedTravelDistances = tripMeta.travel_distances;
  const cachedTravelHash = tripMeta.travel_distances_hash;

  return (
    <TripDetailClient
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
        meta: tripMeta,
        packingList,
        packingChecked,
        coverImageUrl: trip.cover_image_url,
        cachedTravelDistances,
        cachedTravelHash,
      }}
      dateRange={formatDateRange(trip.start_date, trip.end_date)}
      isCollaborativeTrip={isCollaborativeTrip}
      userRole={userRole}
      collaboratorCount={totalVoters}
    />
  );
}
