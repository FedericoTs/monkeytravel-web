import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import { formatDateRange } from "@/lib/datetime";
import type { ItineraryDay, TripMeta, CollaboratorRole } from "@/types";
import type { Metadata } from "next";
import TripDetailClient from "./TripDetailClient";
import TripEngagementSection from "@/components/explore/TripEngagementSection";

export async function generateMetadata(): Promise<Metadata> {
  // Title is intentionally generic — pulling the actual trip title here
  // would (a) require a DB round-trip every page view duplicating the
  // owner/collaborator check in the page render and (b) leak the title
  // to anyone holding the trip ID even when they lack access. The page
  // itself sets a more informative document.title via the hero component
  // once auth resolves. robots: noindex because trip pages are personal
  // data — never want them in search results.
  return {
    title: "Trip Details",
    robots: { index: false, follow: false },
  };
}

export default async function TripDetailPage({
  params,
}: {
  params: Promise<{ id: string; locale: string }>;
}) {
  const { id, locale } = await params;
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

  // **2026-05-25 (/explore Week 3)**: owner-side engagement bar +
  // publish toggle. Server-rendered into a prop slot so the existing
  // TripDetailClient client component doesn't need to know about the
  // explore feature at all.
  const isOwnerView = userRole === "owner";
  const isPublic = trip.visibility === "public" && !trip.is_hidden;
  const ownerName =
    typeof user.user_metadata?.display_name === "string"
      ? (user.user_metadata.display_name as string)
      : (user.email?.split("@")[0] ?? undefined);

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
      dateRange={formatDateRange(trip.start_date, trip.end_date, locale)}
      isCollaborativeTrip={isCollaborativeTrip}
      userRole={userRole}
      collaboratorCount={totalVoters}
      engagementSlot={
        <TripEngagementSection
          tripId={trip.id}
          likeCount={trip.like_count ?? 0}
          saveCount={trip.save_count ?? 0}
          forkCount={trip.fork_count ?? 0}
          isPublic={isPublic}
          isOwner={isOwnerView}
          showPublishToggle={isOwnerView}
          ownerDisplayName={ownerName}
        />
      }
    />
  );
}
