import { cache } from "react";
import { cookies, headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notFound } from "next/navigation";
import { logSharedTripVisit } from "@/lib/analytics/funnel-events";
import { classifySharedVisit } from "@/lib/analytics/share-visit-classifier";
import { captureServerEvent } from "@/lib/posthog/server";
import { formatDateRange } from "@/lib/datetime";
import type { ItineraryDay, TripMeta } from "@/types";
import type { Metadata } from "next";
import SharedTripView from "./SharedTripView";
import { computeTripDayState } from "@/lib/trip/live";
import TripEngagementSection from "@/components/explore/TripEngagementSection";
import { getTripDestination } from "@/lib/trips/destination";
import { refreshTripItinerary } from "@/lib/places/refreshItineraryPhotos";
import {
  generateTripSchema,
  generateBreadcrumbSchema,
  jsonLdScriptProps,
} from "@/lib/seo/structured-data";
import { buildAlternates } from "@/lib/seo/canonical";

interface PageProps {
  params: Promise<{ locale: string; token: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Request-scoped cache for the trip lookup: `generateMetadata` and the page
 * render need the same row, and React's `cache()` memoizes by token for the
 * lifetime of one request, so both share a single query.
 */
const getSharedTrip = cache(async (token: string) => {
  // Service role keyed on the EXACT token, never the anon client: an RLS
  // policy cannot compare a caller-supplied token, so one that opened shared
  // rows would make every shared trip readable with the public key, private
  // ones included (anonymous shares are visibility='private' on purpose, see
  // app/api/trips/anonymous/route.ts). Holding the token is the access check;
  // same pattern as app/api/calendar/trip/[id]/route.ts.
  //
  // `deleted_at IS NULL` is asserted here because the service role bypasses
  // RLS; without it deleted trips would render on a public URL.
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("trips")
    .select("*")
    .eq("share_token", token)
    .is("deleted_at", null)
    .single();
  if (error) return null;
  return data;
});

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale, token } = await params;
  const trip = await getSharedTrip(token);

  if (!trip) {
    return {
      title: "Trip Not Found",
      robots: { index: false, follow: false },
    };
  }

  // Canonical consolidation: /shared/{token} stays NOINDEX, but when the trip
  // is public and has a public_slug, point its canonical at the INDEXABLE
  // public page /trip/{slug} so any link equity /shared accrues (shares,
  // inbound links) flows to the URL we actually want ranked. Non-public trips
  // keep the self-canonical to /shared/{token}.
  const isPublic =
    trip.visibility === "public" &&
    !trip.is_hidden &&
    typeof trip.public_slug === "string" &&
    trip.public_slug;

  const canonical = isPublic
    ? buildAlternates(`/trip/${trip.public_slug}`, { locale }).canonical
    : `https://monkeytravel.app/shared/${token}`;

  return {
    title: trip.title,
    description: trip.description || `Check out this travel itinerary on MonkeyTravel`,
    robots: { index: false, follow: false },
    alternates: {
      canonical,
    },
    // The card is generated from the trip (/api/og/trip): destination, dates,
    // length, activity count and budget, not just a cover photo that is often
    // a stock image. Unconditional on purpose: declaring openGraph replaces the
    // root layout's block, and the route always returns an image (a brand card
    // when the token resolves to nothing), so og:image never goes missing.
    openGraph: {
      title: trip.title,
      description: trip.description || `Check out this travel itinerary on MonkeyTravel`,
      type: "website",
      images: [
        {
          url: `https://monkeytravel.app/api/og/trip?token=${encodeURIComponent(token)}`,
          width: 1200,
          height: 630,
          alt: trip.title ?? "Trip itinerary",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: trip.title,
      description: trip.description || `Check out this travel itinerary on MonkeyTravel`,
      images: [`https://monkeytravel.app/api/og/trip?token=${encodeURIComponent(token)}`],
    },
  };
}

export default async function SharedTripPage({ params, searchParams }: PageProps) {
  const { token } = await params;
  // ?vote=1 is the crew ask (lib/trips/crew-share.ts): the recipient page
  // leads with the vote, and the visit row records the framing it arrived
  // with so recipients can be read per framing.
  const query = (await searchParams) ?? {};
  const crewAsk = query.vote === "1";
  const trip = await getSharedTrip(token);

  if (!trip) {
    notFound();
  }

  // The owner reaches this page through their own share link and must see
  // "Who's going" here, not the recipient bar. getUser() is a local no-op
  // without a session cookie, so anonymous viewers pay nothing. Resolved up
  // here because the visit telemetry below must not count the owner, and the
  // PostHog twin reuses the id instead of a second getUser().
  let isOwner = false;
  let viewerUserId: string | null = null;
  // Owner or collaborator: the shared view offers them the way back to the
  // editor (/trips/[id], which always opens for members).
  let isMember = false;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    viewerUserId = user?.id ?? null;
    isOwner = !!user && user.id === trip.user_id;
    isMember = isOwner;
    if (user && !isOwner) {
      const { data: membership } = await supabase
        .from("trip_collaborators")
        .select("role")
        .eq("trip_id", trip.id as string)
        .eq("user_id", user.id)
        .maybeSingle();
      isMember = !!membership;
    }
  } catch {
    isOwner = false;
    isMember = false;
    viewerUserId = null;
  }

  // Record a recipient visit, the share loop's first measured hop
  // (funnel_events.share_link_visited + the PostHog crew_link_visited twin
  // below). One verdict feeds both sinks so they stay comparable; it skips
  // crawlers, prefetches, non-document renders, the ownerless demo trips and
  // owners. NOT fired in generateMetadata, which runs on the same request and
  // would double-count. Fire-and-forget; never blocks the render.
  const visitHeaders = await headers();
  const visitVerdict = classifySharedVisit({
    userAgent: visitHeaders.get("user-agent"),
    secFetchDest: visitHeaders.get("sec-fetch-dest"),
    purpose: visitHeaders.get("purpose"),
    secPurpose: visitHeaders.get("sec-purpose"),
    isOwner,
    tripHasOwner: !!trip.user_id,
  });
  if (visitVerdict === "counted") {
    void logSharedTripVisit(trip.id as string, { crewAsk });
  }

  // PostHog twin of the funnel event above, gated by the same verdict.
  // Distinct id: the signed-in user id, else the mt_anon_voter cookie (ties
  // the visit to later crew_vote_cast events), else a per-visit random id.
  // Never a shared constant like "anonymous": it merges unrelated strangers
  // into one PostHog person and collapses uniques. The cost is deliberate: a
  // returning visitor without the vote cookie gets a new id each visit, so
  // uniques over-count; visit and funnel-step counts are unaffected.
  //
  // Never mint a stable visitor cookie for this: mt_anon_voter is FUNCTIONAL
  // (one vote per browser), an id set only to watch someone read a page is an
  // analytics cookie, and consent lives in localStorage (lib/consent/storage.ts),
  // which the server cannot read, so it could not honour a refusal.
  //
  // Fire-and-forget like logSharedTripVisit; never blocks or breaks render.
  void (async () => {
    if (visitVerdict !== "counted") return;
    try {
      const cookieStore = await cookies();
      const anonVoterId = cookieStore.get("mt_anon_voter")?.value;
      // `visitor_scope` says how much this row's distinct_id can be trusted,
      // so a funnel can filter to the rows that actually support the question
      // it is asking. Never aggregate uniques across scopes.
      let distinctId = anonVoterId ?? `share-visit-${crypto.randomUUID()}`;
      let visitorScope: "user" | "cookie" | "per-visit" = anonVoterId
        ? "cookie"
        : "per-visit";
      if (viewerUserId) {
        distinctId = viewerUserId;
        visitorScope = "user";
      }
      await captureServerEvent(distinctId, "crew_link_visited", {
        tripId: trip.id,
        shareToken: token,
        visitor_scope: visitorScope,
        crew_ask: crewAsk,
      });
    } catch {
      // never break the render for telemetry
    }
  })();

  // Refresh activity photo URLs from places_v2 at read time: URLs baked into
  // trip.itinerary go stale, and places_v2 holds the current one. See
  // lib/places/refreshItineraryPhotos.ts.
  const rawItinerary = (trip.itinerary as ItineraryDay[]) || [];
  const itinerary = await refreshTripItinerary(rawItinerary);
  const budget = trip.budget as { total: number; currency: string } | null;
  const tripMeta = (trip.trip_meta as TripMeta) || {};
  // An EMPTY packing_list array is truthy, so a bare `||` would never reach the
  // trip_meta fallback. trips/[id] and trip/[slug] use the same fallback.
  const packingColumn = trip.packing_list as string[] | null | undefined;
  const packingList =
    (Array.isArray(packingColumn) && packingColumn.length > 0 ? packingColumn : tripMeta.packing_suggestions) || [];

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

  // The like/save/fork bar renders nothing unless the explore flag is on AND
  // the trip is public, so private trips never expose the engagement UI.
  const isPublic = trip.visibility === "public" && !trip.is_hidden;


  return (
    <>
      {/* Structured Data for SEO */}
      <script {...jsonLdScriptProps(tripSchema)} />
      <script {...jsonLdScriptProps(breadcrumbSchema)} />

      <SharedTripView
        viewSource="shared"
        isOwner={isOwner}
        editorHref={isMember ? `/trips/${trip.id}` : undefined}
        liveState={computeTripDayState({
          startDate: trip.start_date,
          endDate: trip.end_date,
          timeZone: tripMeta.timezone ?? null,
        })}
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
        // The hero makes no Places calls here, so the persisted cover image is
        // its only photo; without it viewers get the gradient fallback.
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
