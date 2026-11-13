"use client";

import { useState, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { Link } from "@/lib/i18n/routing";
import Image from "next/image";
import dynamic from "next/dynamic";
import type { ItineraryDay, TripMeta, CachedDayTravelData } from "@/types";
import { getTripDestination } from "@/lib/trips/destination";
import { hasCoordinates } from "@/lib/trips/has-coordinates";
import { likeThisDays, planOwnHref, reportPlanOwnClicked, type PlanOwnSurface } from "@/lib/trips/plan-own";
import BackpackerHostelCta from "@/components/trip/BackpackerHostelCta";
import { SharedTripEndAsk, SharedTripTopAsk } from "@/components/trip/SharedTripAsks";
import TodayView from "@/components/trip/TodayView";
import TodayPacking from "@/components/trip/TodayPacking";
import { useLiveTripState } from "@/lib/trip/useLiveTripState";
import { computeTripDayState, type TripDayState } from "@/lib/trip/live";
import { dayBudgetLabel } from "@/lib/trip/day-budget";
import { inPlanCurrency, planCosts } from "@/lib/ai/assistant/plan-costs";
import ReadOnlyItinerary from "@/components/trip/ReadOnlyItinerary";
import AiDisclaimer from "@/components/trip/AiDisclaimer";
import { isLiveTripParticipantsEnabled } from "@/lib/participants/flag";
import DestinationHero from "@/components/DestinationHero";
import TripPackingEssentials from "@/components/trip/TripPackingEssentials";
import { tripNights } from "@/lib/dates/iso-date";
import { MapToggle, ViewModeToggle } from "@/components/trip/ViewControls";
import SaveTripModal from "@/components/ui/SaveTripModal";
import { saveCopyShown } from "@/lib/trips/save-copy";
import { useAuth } from "@/components/auth/AuthProvider";
import MobileBottomNav from "@/components/ui/MobileBottomNav";
import { AnonymousActivityVoteBar } from "@/components/trip/AnonymousActivityVoteBar";
import { useSharedVotes } from "@/hooks/useSharedVotes";
import { useOwnerClaim, useSharedTripSave, useSharedTripVisit } from "@/hooks/useSharedTripVisit";
import { useTravelDistances } from "@/hooks/useTravelDistances";
import { ensureActivityIds } from "@/lib/utils/activity-id";
import { useCurrency } from "@/lib/locale";
import { useTranslations } from "next-intl";

function MapLoading() {
  const t = useTranslations("common");
  return (
    <div className="h-[400px] bg-slate-100 rounded-xl animate-pulse flex items-center justify-center">
      <span className="text-slate-500">{t("map.loading")}</span>
    </div>
  );
}

// Dynamic import for TripMap to avoid SSR issues with Google Maps
const TripMap = dynamic(() => import("@/components/TripMap"), {
  ssr: false,
  loading: () => <MapLoading />,
});

// ExportMenu only matters once the user opens its dropdown — defer to keep its
// PDF/iCal generation libs out of the initial /shared/[token] bundle.
const ExportMenu = dynamic(() => import("@/components/trip/ExportMenu"), { ssr: false });

/** The trip as the view shows it (see view-trip.ts for a stored row's). */
export type SharedTrip = SharedTripViewProps["trip"];

interface SharedTripViewProps {
  trip: {
    id: string;
    title: string;
    description?: string;
    status: string;
    startDate: string;
    endDate: string;
    tags?: string[];
    budget: { total: number; currency: string } | null;
    itinerary: ItineraryDay[];
    sharedAt?: string;
    meta?: TripMeta;
    packingList?: string[];
    /** Cached travel distances from trip_meta - eliminates recalculation */
    cachedTravelDistances?: CachedDayTravelData[];
    /** Hash of itinerary when travel distances were calculated */
    cachedTravelHash?: string;
  };
  /**
   * The share link's token: holding it is access to the group (joining,
   * votes, Today's actions, expenses). The public /trip/[slug] page passes
   * `publicPage` instead, and the view is read-only.
   */
  shareToken?: string;
  /** The public page's slug and canonical URL, which sharing and saving use there. */
  publicPage?: { slug: string; url: string };
  dateRange: string;
  /**
   * Persisted cover image URL (column `trips.cover_image_url`). The hero runs
   * with disableApiCalls (no Google Places calls from anonymous viewers), so
   * this is its only photo source; without it the hero shows the gradient.
   */
  coverImageUrl?: string | null;
  /**
   * Optional server-rendered engagement bar (like + save + fork), passed in by
   * the page so auth, flag and counts resolve server-side instead of drilling
   * DB state into this client component. Renders above the map, and only when
   * the participants flag is off.
   */
  engagementSlot?: React.ReactNode;
  /**
   * Which surface this render is, for the trip_views beacon. Undefined means
   * do not record: the only callers that should count are /shared/[token]
   * and /trip/[slug].
   */
  viewSource?: "shared" | "public";
  /**
   * True when the signed-in viewer owns this trip. Resolved server-side in
   * both page.tsx callers. Here the owner is shown "Who's going", and the
   * recipient's "I'm going" bar must NOT appear.
   */
  isOwner?: boolean;
  /**
   * Set when the viewer is the owner or a collaborator: the link back to the
   * editor, since members also reach this view through their own share link.
   */
  editorHref?: string;
  /** Server-computed live day-state. Refined on the client with the viewer tz. */
  liveState?: TripDayState;
}

export default function SharedTripView({ trip, shareToken, publicPage, dateRange, coverImageUrl, engagementSlot, viewSource, isOwner = false, editorHref, liveState }: SharedTripViewProps) {
  const t = useTranslations('common');
  // A live trip opens on Today, for every viewer.
  const fallbackDayState = useMemo<TripDayState>(
    () => liveState ?? computeTripDayState({ startDate: trip.startDate, endDate: trip.endDate, timeZone: null }),
    [liveState, trip.startDate, trip.endDate],
  );
  const dayState = useLiveTripState(fallbackDayState, trip.startDate, trip.endDate);
  const searchParams = useSearchParams();
  // ?day=K, from the owner's "send to the group": opens on that day, unless
  // it is today, which Today mode already shows.
  const linkedDay = Number(searchParams?.get("day"));
  const opensOnLinkedDay =
    Number.isInteger(linkedDay) &&
    trip.itinerary.some((d) => d.day_number === linkedDay) &&
    !(fallbackDayState.isLive && fallbackDayState.dayNumber === linkedDay);
  const [todayMode, setTodayMode] = useState(!opensOnLinkedDay);
  const showToday = dayState.isLive && todayMode;

  // The share API appends the owner's referral code to the link as
  // ?ref=OWNERCODE. Capture it so we can (a) persist it for a later
  // nav-driven signup and (b) carry it on the "Plan your own trip" CTA below.
  const referralCode = searchParams?.get("ref")?.trim() || null;

  // ?vote=1 means the planner sent this specifically to ask for votes (the
  // crew-mode share). Everyone gets the vote invitation; this makes it read
  // as the personal ask it actually was.
  const crewAsk = searchParams?.get("vote") === "1";
  // The recipient page is built around "I'm going". Off
  // (NEXT_PUBLIC_LIVE_TRIP_PARTICIPANTS=off) returns the browse layout. The
  // public page keeps the layout, but every group control needs the token.
  const participantsEnabled = isLiveTripParticipantsEnabled();
  const publicSlug = publicPage?.slug;

  // With participants on, a recipient lands on title · dates · going → Day 1:
  // the map is one tap away ("Show map") rather than 400px above the first
  // activity.
  const [showMap, setShowMap] = useState(!participantsEnabled);
  const [viewMode, setViewMode] = useState<"timeline" | "cards">("cards");
  const [selectedDay, setSelectedDay] = useState<number | null>(opensOnLinkedDay ? linkedDay : null);
  // Who is reading decides what the page asks of them.
  const { user: viewer, loading: viewerLoading } = useAuth();
  useSharedTripVisit({ tripId: trip.id, viewSource, referralCode, shareToken, viewer, viewerLoading });
  const { showSaveModal, setShowSaveModal, resumedStartDate } = useSharedTripSave({ shareToken, publicSlug, viewer, viewerLoading });
  // Saving a copy into the reader's own account, while it's switched on.
  const onSave = saveCopyShown() ? () => setShowSaveModal(true) : undefined;
  const ownerPending = useOwnerClaim({ shareToken, tripId: trip.id, signedIn: !viewerLoading && !!viewer });

  // Votes go through the share link, so the public page shows none.
  const canVote = !!shareToken;
  const { voteTallies, myVotes, pendingVoteId, hasDisplayName, afterVoteId, dismissAfterVote, handleVote } = useSharedVotes({
    shareToken,
    isOwner,
  });

  // Currency conversion hook - converts to user's preferred currency
  const { convert: convertCurrency, format: formatCurrency, exchangeRates } = useCurrency();

  const formatDayBudget = (day: ItineraryDay): string =>
    dayBudgetLabel(day, { convert: convertCurrency, format: formatCurrency }, t('activity.free'), trip.budget?.currency || "USD");

  // Prefer trip_meta.destination (canonical) over title-strip — see
  // lib/trips/destination.ts. Matters for non-English / renamed trips.
  const destination = getTripDestination(trip);

  const likeThis = likeThisDays(shareToken, destination, trip.itinerary.length);
  const planOwn = planOwnHref({ destination, days: likeThis, referralCode });
  const firePlanOwnClicked = (surface: PlanOwnSurface) =>
    reportPlanOwnClicked({ tripId: trip.id, destination, referralCode, surface });

  const afterVoteNudge = (
    <div
      data-testid="after-vote-plan-own"
      className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-[var(--background-warm)] px-3 py-2"
    >
      <p className="text-xs text-slate-700">{t("shared.vote.afterVote.text")}</p>
      <div className="flex shrink-0 items-center gap-1">
        <Link
          href={planOwn}
          onClick={() => firePlanOwnClicked("after_vote")}
          className="text-xs font-semibold text-slate-900 underline underline-offset-2"
        >
          {t("shared.vote.afterVote.cta")}
        </Link>
        <button
          type="button"
          onClick={dismissAfterVote}
          aria-label={t("buttons.close")}
          className="px-1 text-sm leading-none text-slate-500 hover:text-slate-700"
        >
          ×
        </button>
      </div>
    </div>
  );

  // Memoize ensureActivityIds to prevent generating new UUIDs on every render
  const displayItinerary = useMemo(
    () => ensureActivityIds(trip.itinerary),
    [trip.itinerary]
  );

  // Fetch travel distances between activities
  // Uses local Haversine calculation - NO external API calls!
  // For shared trips, we use cached data from trip_meta if available (no tripId to save new calculations)
  const { travelData, isLoading: travelLoading } = useTravelDistances(displayItinerary, {
    cachedTravelData: trip.cachedTravelDistances,
    cachedHash: trip.cachedTravelHash,
  });

  const nights = tripNights(trip.startDate, trip.endDate);

  // Calculate total activities
  const activitiesCount = useMemo(
    () => displayItinerary.reduce((acc, day) => acc + day.activities.length, 0),
    [displayItinerary]
  );
  // What the plan's own stops cost, per person, as the trip page shows it:
  // each stop in the plan's currency first, at the page's rates.
  const planTotal = useMemo(() => {
    const days = inPlanCurrency(displayItinerary, exchangeRates, trip.budget?.currency || "USD");
    return days ? planCosts(days) : null;
  }, [displayItinerary, exchangeRates, trip.budget?.currency]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-white">
      {/* Hero with Cover Image - Enhanced with weather and stats. The page's header
          landmark: the trip's title, dates and badges. */}
      <header>
        <DestinationHero
          destination={destination}
          title={trip.title}
          subtitle={trip.description}
          dateRange={dateRange}
          budget={planTotal ? { total: planTotal.total, currency: planTotal.currency } : undefined}
          budgetNote={t("tripTotal.perPerson")}
          budgetHint={t("tripTotal.hint")}
          days={trip.itinerary.length}
          nights={nights}
          activitiesCount={activitiesCount}
          weatherNote={trip.meta?.weather_note}
          highlights={trip.meta?.highlights}
          tags={trip.tags}
          showBackButton={true}
          onBack={() => window.history.back()}
          coverImageUrl={coverImageUrl}
          disableApiCalls={true}
        >
          {/* Shared + Backpacker badge stack — top-right of hero. Trips
              generated in Backpacker Mode get a "Backpacker route" pill. */}
          <div className="absolute top-4 right-4 flex flex-col items-end gap-2">
            <span className="px-3 py-1.5 rounded-full text-sm font-medium shadow-lg bg-purple-100 text-purple-700">
              {t('shared.sharedTrip')}
            </span>
            {trip.meta?.travel_style === "backpacker" && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium shadow-lg bg-emerald-700 text-white">
                <span aria-hidden>🎒</span>
                {t('shared.backpackerRoute')}
              </span>
            )}
          </div>
        </DestinationHero>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 sm:py-8">
        {editorHref && (
          <div
            data-testid="member-edit-bar"
            className="mb-6 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <p className="text-sm text-slate-700">{t("share.memberEdit.note")}</p>
            <Link
              href={editorHref}
              data-testid="member-edit-link"
              className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-slate-900 px-5 text-sm font-semibold text-white transition-colors hover:bg-slate-800"
            >
              {t("share.memberEdit.cta")}
            </Link>
          </div>
        )}
        <SharedTripTopAsk
          participantsEnabled={participantsEnabled}
          isOwner={isOwner}
          shareToken={shareToken}
          crewAsk={crewAsk}
          planOwnHref={planOwn}
          onPlanOwn={firePlanOwnClicked}
          onSave={onSave}
          tripId={trip.id}
          tripTitle={trip.title}
          publicUrl={publicPage?.url}
        />

        {/* Backpacker Mode — Hostelworld CTA. Only renders when the
            trip was generated in Backpacker Mode (trip_meta.travel_style).
            Its logged clicks are the evidence for a Hostelworld partnership. */}
        {trip.meta?.travel_style === "backpacker" && (
          <BackpackerHostelCta
            tripId={trip.id}
            destination={destination}
            startDate={trip.startDate}
            endDate={trip.endDate}
            className="mb-6"
          />
        )}

        {showToday && (
          <TodayView
            itinerary={displayItinerary}
            dayState={dayState}
            currency={trip.budget?.currency}
            weatherNote={trip.meta?.weather_note}
            onViewFullItinerary={() => setTodayMode(false)}
            tripId={trip.id}
            apiBase={shareToken ? `/api/shared/${shareToken}` : undefined}
            packingItems={trip.packingList}
            className="mb-6"
          />
        )}

        {/* "Packed?" the day before the trip — Today mode isn't shown yet
            (the trip isn't live), so surface the checklist on its own. */}
        {!showToday &&
          dayState.phase === "upcoming" &&
          dayState.daysUntilStart !== null &&
          dayState.daysUntilStart <= 1 &&
          (trip.packingList?.length ?? 0) > 0 && (
            <TodayPacking items={trip.packingList!} tripId={trip.id} defaultOpen className="mb-6" />
          )}

        {!showToday && (
        <>
        {dayState.isLive && !todayMode && (
          <button
            type="button"
            onClick={() => setTodayMode(true)}
            data-testid="back-to-today"
            className="mb-4 inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)]/10 px-3 py-2 text-sm font-medium text-[var(--foreground)] hover:bg-[var(--primary)]/15"
          >
            <span aria-hidden>←</span> {t("today.backToToday")}
          </button>
        )}
        {/* Controls Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 sm:gap-4 mb-6">
          {/* Left side - Back to home */}
          <div className="flex items-center gap-2">
            <Link
              href="/"
              className="flex items-center gap-1 sm:gap-2 text-slate-600 hover:text-slate-900 px-2 sm:px-3 py-2 rounded-lg hover:bg-slate-100 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              <span className="hidden sm:inline">{t('buttons.back')}</span>
            </Link>
          </div>

          {/* Right side - Controls */}
          <div className="flex items-center gap-2 sm:gap-3">
            <ViewModeToggle value={viewMode} onChange={setViewMode} labels={{ cards: t('trip.cards'), timeline: t('trip.timeline') }} />
            <MapToggle shown={showMap} onToggle={() => setShowMap(!showMap)} labels={{ show: t('trip.showMap'), hide: t('trip.hideMap') }} />

            {/* Export Menu */}
            <ExportMenu
              trip={{
                title: trip.title,
                description: trip.description,
                startDate: trip.startDate,
                endDate: trip.endDate,
                budget: trip.budget,
                itinerary: displayItinerary,
              }}
              surface={publicPage ? "public_trip" : "shared_view"}
            />
          </div>
        </div>

        {/* Like / save / fork action bar. Server-rendered slot — empty when
            the explore flag is off or the trip isn't public. Sits right above
            the map so it's reachable without scrolling on mobile. Flag-off
            layout only: with participants on, ParticipantsBar replaces it and
            Save for later lives under More. */}
        {!participantsEnabled && engagementSlot && (
          <div className="mb-6 flex items-center justify-start">
            {engagementSlot}
          </div>
        )}

        {/* Interactive Map */}
        {showMap && hasCoordinates(displayItinerary) && (
          <div className="mb-8">
            {/* TripMap contains its own throw (a null map ref on iOS Safari):
                the itinerary still renders. */}
            <TripMap
              days={displayItinerary}
              destination={destination}
              selectedDay={selectedDay}
              className="h-[400px]"
              disableApiCalls={true}
            />
          </div>
        )}

        <ReadOnlyItinerary
          days={displayItinerary}
          selectedDay={selectedDay}
          onSelectDay={setSelectedDay}
          viewMode={viewMode}
          travelData={travelData}
          travelLoading={travelLoading}
          currency={trip.budget?.currency}
          fallbackCurrency="USD"
          pace={trip.meta?.pace}
          dayTitle={(day) => t("trip.dayLabel", { number: day.day_number })}
          budgetLabel={t("shared.estBudget")}
          formatDayBudget={formatDayBudget}
          emptyTitle={t("shared.noItinerary")}
          emptyMessage={t("shared.noItineraryDesc")}
          activityExtra={
            canVote
              ? (activity) =>
                  activity.id && (
                    <>
                      <AnonymousActivityVoteBar
                        activityId={activity.id}
                        tally={voteTallies[activity.id] ?? { up: 0, down: 0 }}
                        myVote={myVotes[activity.id] ?? null}
                        hasDisplayName={hasDisplayName}
                        pending={pendingVoteId === activity.id}
                        onVote={handleVote}
                      />
                      {afterVoteId === activity.id && afterVoteNudge}
                    </>
                  )
              : undefined
          }
        />

        </>
        )}

        {/* Journey Essentials - Premium Packing List */}
        {trip.packingList && trip.packingList.length > 0 && (
          <TripPackingEssentials
            items={trip.packingList}
            destination={destination}
          />
        )}

        <AiDisclaimer title={t("share.savedHero.aiTitle")}>{t("share.savedHero.aiDescription")}</AiDisclaimer>

        {/* The mid-page Save hero shows only in the flag-off layout. */}
        {!participantsEnabled && (
          <div className="mt-6 p-5 bg-gradient-to-r from-purple-50 to-indigo-50 border border-purple-200 rounded-xl">
            <div className="flex gap-4">
              <div className="flex-shrink-0">
                <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center">
                  <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                  </svg>
                </div>
              </div>
              <div>
                <h4 className="font-semibold text-purple-900 mb-1">
                  {t("share.savedHero.loveTitle")}
                </h4>
                <p className="text-sm text-purple-800">
                  {t("share.savedHero.loveDescription")}
                </p>
              </div>
            </div>
          </div>
        )}

        <SharedTripEndAsk
          participantsEnabled={participantsEnabled}
          isOwner={isOwner}
          shareToken={shareToken}
          crewAsk={crewAsk}
          planOwnHref={planOwn}
          onPlanOwn={firePlanOwnClicked}
          onSave={onSave}
          ownerPending={ownerPending}
          tripOver={dayState.phase === "past"}
          viewerEmail={viewer?.email}
          destination={destination}
          likeThisDays={likeThis}
        />

        {/* Save Trip Modal */}
        <SaveTripModal
          isOpen={showSaveModal}
          onClose={() => setShowSaveModal(false)}
          shareToken={shareToken}
          publicSlug={publicSlug}
          tripTitle={trip.title}
          tripDestination={destination}
          durationDays={nights + 1}
          initialStartDate={resumedStartDate}
        />
      </main>

      {/* Footer */}
      <footer className="bg-slate-50 border-t border-slate-200 mt-16">
        <div className="max-w-6xl mx-auto px-4 py-8">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <Link href="/" className="flex items-center gap-2">
              <Image
                src="/images/logo.png"
                alt="MonkeyTravel Logo"
                width={28}
                height={28}
                className="w-7 h-7 object-contain"
              />
              <span className="font-semibold text-slate-900">MonkeyTravel</span>
            </Link>
            <p className="text-sm text-slate-500">
              {t('shared.footerTagline')}
            </p>
            <Link
              href={planOwn}
              onClick={() => firePlanOwnClicked("page_footer")}
              className="text-sm text-[var(--foreground)] underline decoration-[var(--primary)] decoration-2 underline-offset-4 hover:decoration-[var(--primary-dark)] font-semibold"
            >
              {t("share.savedHero.planOwnButtonGeneric")}
            </Link>
          </div>
        </div>
      </footer>

      {/* Mobile Bottom Navigation */}
      <MobileBottomNav activePage="shared-trip" />
    </div>
  );
}
