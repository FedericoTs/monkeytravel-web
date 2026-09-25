import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import { isExploreUgcEnabled } from "@/lib/explore/flag";
import { formatDateRange } from "@/lib/datetime";
import type { ItineraryDay, TripMeta, CollaboratorRole } from "@/types";
import type { Metadata } from "next";
import TripDetailClient from "./TripDetailClient";
import { computeTripDayState } from "@/lib/trip/live";
import TripEngagementSection from "@/components/explore/TripEngagementSection";
import { refreshTripItinerary } from "@/lib/places/refreshItineraryPhotos";

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

  // `locale === "en"` → no prefix (next-intl convention for the default locale).
  const localePrefix = locale === "en" ? "" : `/${locale}`;

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Members first: the owner and anyone invited ALWAYS get the editor here,
  // whether or not the trip has a share link.
  //
  // Until 2026-09-25 the share-link redirect below ran before this check, for
  // everyone: once a trip had a share_token (the "Share" button, the share
  // prompt, publishing, a signed-out share that was later claimed), its owner
  // and collaborators were sent to the read-only /shared view on every visit
  // and could never edit it again — nor stop sharing, whose only button lives
  // in this editor. 109 live trips were in that state.
  const owned = user
    ? await supabase.from("trips").select("*").eq("id", id).eq("user_id", user.id).maybeSingle()
    : null;
  let trip = owned?.data ?? null;
  let userRole: CollaboratorRole = "owner";

  if (user && !trip) {
    const { data: collaborator } = await supabase
      .from("trip_collaborators")
      .select("role, trips(*)")
      .eq("trip_id", id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (collaborator?.trips) {
      trip = collaborator.trips as typeof trip;
      userRole = collaborator.role as CollaboratorRole;
    }
  }

  if (!trip || !user) {
    // **2026-06-09 — recovery for Google organic traffic on /trips/[id].**
    // A visitor who is not a member of a trip that has a share link is sent
    // to the /shared/[token] view (search traffic landed here and hit a login
    // wall or a 404). RLS decides who can see the token: since 2026-09-01
    // only members, and anyone for a PUBLIC trip, so a non-member only ever
    // gets here for public trips. Never widen this with a service-role read:
    // the token is the capability to open the trip.
    const { data: publishedTrip } = await supabase
      .from("trips")
      .select("share_token, is_hidden")
      .eq("id", id)
      .maybeSingle();
    if (publishedTrip?.share_token && !publishedTrip.is_hidden) {
      redirect(`${localePrefix}/shared/${publishedTrip.share_token}`);
    }
    if (!user) {
      // Back here after signing in (it used to land on /trips and lose the trip).
      // The language goes on the login page and the destination stays
      // unprefixed: the login page's router adds the language itself, so a
      // prefixed redirect became /it/it/trips/<id>, a 404.
      redirect(`${localePrefix}/auth/login?redirect=${encodeURIComponent(`/trips/${id}`)}`);
    }
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

  // Read-time refresh of activity photo URLs from places_v2. Fixes drift
  // when image_urls baked into trip.itinerary at generation time have
  // since gone stale (truncated photo_resource_name, Google rotation,
  // etc.) — places_v2 is the source of truth. See
  // lib/places/refreshItineraryPhotos.ts for the why.
  const rawItinerary = (trip.itinerary as ItineraryDay[]) || [];
  const itinerary = await refreshTripItinerary(rawItinerary);
  const budget = trip.budget as { total: number; currency: string } | null;
  const tripMeta = (trip.trip_meta as TripMeta) || {};
  // An EMPTY ARRAY is truthy, so `||` never reached the fallback: a trip whose
  // packing_list column is `[]` showed no packing block at all even when
  // trip_meta.packing_suggestions was full. Measured 2026-08-31: 12 live trips.
  const packingColumn = trip.packing_list as string[] | null | undefined;
  const packingList =
    (Array.isArray(packingColumn) && packingColumn.length > 0
      ? packingColumn
      : (tripMeta.packing_suggestions as string[] | undefined)) || [];
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
        // Read in the same SELECT as the itinerary above, so the two agree.
        // The page seeds its save queue with it once (20260924125000).
        itineraryVersion: typeof trip.itinerary_version === "number" ? trip.itinerary_version : null,
      }}
      dateRange={formatDateRange(trip.start_date, trip.end_date, locale)}
      liveState={computeTripDayState({
        startDate: trip.start_date,
        endDate: trip.end_date,
        timeZone: tripMeta.timezone ?? null,
      })}
      // The publish tick on the share prompt: only when /explore is
      // reachable AND the trip is not already public. Resolved here because
      // the flag is a server-only env read.
      canPublish={isExploreUgcEnabled() && isOwnerView && !isPublic}
      ownerDisplayName={ownerName}
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
