"use client";

import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { useSearchParams, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { Undo2, Redo2, RefreshCw, Sparkles } from "lucide-react";
import TripActionsMenu, { TripActionsMenuItem, TripActionsMenuSlot } from "@/components/trip/TripActionsMenu";
import type { ItineraryDay, Activity, TripMeta, CachedDayTravelData, CollaboratorRole, VoteType, ProposalVoteType, ProposalWithVotes } from "@/types";
import { ROLE_PERMISSIONS } from "@/types";
import { getTripDestination } from "@/lib/trips/destination";
import BackpackerHostelCta from "@/components/trip/BackpackerHostelCta";
import WhoIsGoingCard from "@/components/trip/WhoIsGoingCard";
import TodayView from "@/components/trip/TodayView";
import { useLiveTripState } from "@/lib/trip/useLiveTripState";
import { computeTripDayState, type TripDayState } from "@/lib/trip/live";
import { isLiveTripParticipantsEnabled } from "@/lib/participants/flag";
import DownloadIcsButton from "@/components/calendar/DownloadIcsButton";
// TravelAdvisoryBanner / ExpenseLedger / TripConciergeChat are pulled in
// dynamically below — see the next/dynamic block. They were imported
// eagerly when first wired (commit dd6ff90); moving them here keeps
// the initial trip-page chunk lean (perf task #244, follows the same
// pattern as #180 for the other deferred components).
import { useActivityVotes } from "@/lib/hooks/useActivityVotes";
import { useProposals } from "@/lib/hooks/useProposals";
import { InlineProposalCard } from "@/components/collaboration/proposals";
import DestinationHero from "@/components/DestinationHero";
import EditableActivityCard from "@/components/trip/EditableActivityCard";
import ShareButton from "@/components/trip/ShareButton";
import TripBookingLinks from "@/components/trip/TripBookingLinks";
import { BookingPanel, EnhancedBookingPanel, PostConfirmationBanner } from "@/components/booking";
import { useFlag } from "@/lib/posthog/hooks";
import { FLAG_ENHANCED_BOOKING } from "@/lib/posthog/flags";

// Bookings/flights monetization surfaces are HIDDEN for now (2026-07-03,
// founder decision): the Amadeus flight search hangs to a 300s Vercel
// FUNCTION_INVOCATION_TIMEOUT in prod (sandbox env / no app timeout), and
// affiliate bookings are the future monetization — not the current focus.
// Default-off env gate: flip NEXT_PUBLIC_BOOKINGS_ENABLED=true to bring the
// whole surface back once flights work and monetization is on.
const BOOKINGS_ENABLED = process.env.NEXT_PUBLIC_BOOKINGS_ENABLED === "true";
import {
  captureEditModeEntered,
  captureEditModeSaved,
  captureEditModeDiscarded,
  captureActivityModified,
} from "@/lib/posthog/events";
import TripPackingEssentials from "@/components/trip/TripPackingEssentials";
import MobileBottomNav from "@/components/ui/MobileBottomNav";
import DaySlider from "@/components/ui/DaySlider";
import TravelConnector from "@/components/trip/TravelConnector";
import DaySummary from "@/components/trip/DaySummary";
import {
  CountdownHero,
  PreTripChecklist,
  LiveJourneyHeader,
  LiveActivityCard,
} from "@/components/timeline";
import { useChecklist } from "@/lib/hooks/useChecklist";
import { useToast } from "@/components/ui/Toast";
import { useCurrency } from "@/lib/locale";
import { trackActivityRegenerated, trackTripViewed } from "@/lib/analytics";
import { useActivityTimeline } from "@/lib/hooks/useActivityTimeline";
import { useTravelDistances } from "@/lib/hooks/useTravelDistances";
import { getCoordinatesForNewActivity, type Coordinates } from "@/lib/utils/geo";
import {
  ensureActivityIds,
  ensureActivityIdsStable,
  findActivityById,
  moveActivityInDay,
  moveActivityToDay,
  deleteActivity,
  updateActivity,
  replaceActivity,
  generateActivityId,
  addActivity,
  calculateNextTimeSlot,
  determineTimeSlot,
  recalculateActivityTimes,
} from "@/lib/utils/activity-id";
import AddActivityButton from "@/components/trip/AddActivityButton";
import SortableActivityCard from "@/components/trip/SortableActivityCard";
import { hapticSelection } from "@/lib/native/haptics";
import { useTranslations, useLocale } from "next-intl";
import { JourneyRibbon } from "@/components/trips/JourneyRibbon";
import { buildJourneyStops } from "@/lib/ai/transfer-legs";
import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragOverlay,
  DragStartEvent,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { applyMove, describeMove, isSameDayTarget, locateActivity } from "@/lib/trip/itinerary-dnd";
import {
  ActivityDragGhost,
  DayDropHeader,
  DayDropList,
  dayOptionsOf,
  makeItineraryCollisionDetection,
} from "@/components/trip/ItineraryDnd";
// Amadeus booking components - kept for future use
// import FlightSearch from "@/components/booking/FlightSearch";
// import HotelSearch from "@/components/booking/HotelSearch";

// Google Places-based hotel recommendations
import HotelRecommendations from "@/components/trip/HotelRecommendations";
import { safeGet, safeSet } from "@/lib/safe-storage";
import {
  createItinerarySync,
  ItineraryWriteBlockedError,
  latestKnownVersion,
  readItineraryVersion,
  type ServerItinerary,
} from "@/lib/trips/itinerary-sync";
import ItineraryConflictBanner from "@/components/trip/ItineraryConflictBanner";

// Dynamic import for TripMap to avoid SSR issues with Google Maps
const TripMap = dynamic(() => import("@/components/TripMap"), {
  ssr: false,
  loading: () => (
    <div className="h-[400px] bg-slate-100 rounded-xl animate-pulse flex items-center justify-center">
      <span className="text-slate-500"></span>
    </div>
  ),
});

// Lazy-load 8 components that are hidden behind state/conditions on first paint.
// Modals (BookingDrawer, AIAssistant, RouteOptimizationModal, VotingBottomSheet,
// ProposeActivitySheet, ActivityRatingModal) are closed by default — no SSR
// benefit, defer to interaction. OngoingTripView only renders for active trips
// (a small subset). CollaboratorOnboarding only renders for collaborative trips.
// ExportMenu ships heavy PDF/iCal libraries and only matters once the user opens
// its dropdown — defer.
const BookingDrawer = dynamic(() => import("@/components/booking/BookingDrawer"), { ssr: false });
// Confirm-first assistant (Phase 2 "living workspace"): AIAssistantEnhanced is
// prop-compatible with the old direct-apply AIAssistant but previews each edit
// in a PreviewChangeCard and waits for the user to Apply (+ undo), instead of
// silently mutating the plan. Kept the `AIAssistant` local name so the render
// site is unchanged.
const AIAssistant = dynamic(() => import("@/components/ai/AIAssistantEnhanced"), { ssr: false });
const BaseModal = dynamic(() => import("@/components/ui/BaseModal"), { ssr: false });
const ExportMenu = dynamic(() => import("@/components/trip/ExportMenu"), { ssr: false });
const OngoingTripView = dynamic(() => import("@/components/trip/OngoingTripView"), { ssr: false });
const CollaboratorOnboarding = dynamic(() => import("@/components/collaboration/CollaboratorOnboarding"), { ssr: false });
// Share ask, gated on engagement — self-contained, renders null until it fires.
const SharePromptOnTrip = dynamic(() => import("@/components/trip/SharePromptOnTrip"), { ssr: false });
const ActivityRatingModal = dynamic(() => import("@/components/timeline/ActivityRatingModal"), { ssr: false });
const RouteOptimizationModal = dynamic(
  () => import("@/components/trip/RouteOptimizationModal").then((m) => ({ default: m.RouteOptimizationModal })),
  { ssr: false }
);
const VotingBottomSheet = dynamic(
  () => import("@/components/collaboration/proposals/VotingBottomSheet").then((m) => ({ default: m.VotingBottomSheet })),
  { ssr: false }
);
const ProposeActivitySheet = dynamic(
  () => import("@/components/collaboration/proposals/ProposeActivitySheet").then((m) => ({ default: m.ProposeActivitySheet })),
  { ssr: false }
);
// Hidden by default — only mounts once the user clicks "Add from email".
// Flag-gated internally; the dynamic import still happens on chunk load
// when the trigger button is rendered, but next/dynamic + ssr:false means
// it's never in the initial server payload.
const PasteBookingModal = dynamic(() => import("@/components/trip/PasteBookingModal"), {
  ssr: false,
});

// Travel advisory banner — async-fetches the FCDO data on mount. No reason
// to ship the component JS in the initial chunk; it self-hides when there
// is no advisory anyway, so a brief tick-after-hydrate is invisible to the
// user. (perf task #244)
const TravelAdvisoryBanner = dynamic(
  () => import("@/components/trip/TravelAdvisoryBanner"),
  { ssr: false }
);

// Expense ledger — flag-gated (renders null when off) and renders below
// the booking panel, well below the fold for first paint. (perf task #244)
const ExpenseLedger = dynamic(
  () => import("@/components/trip/ExpenseLedger"),
  { ssr: false }
);

// Concierge chat — flag-gated + only useful after the user clicks the
// trigger pill. Same lazy pattern as AIAssistant above. (perf task #244)
const TripConciergeChat = dynamic(
  () => import("@/components/trip/TripConciergeChat"),
  { ssr: false }
);

// Concierge conversation history (post-david-cassoni). Renders a
// collapsible list of past Q+A pairs for this trip. Same lazy / no-SSR
// pattern as the launcher — the history fetch is gated on the expand
// click so this dynamic-import is a near-free add to the trip-detail
// bundle for users who never expand it.
const ConciergeHistory = dynamic(
  () => import("@/components/trip/ConciergeHistory"),
  { ssr: false }
);

interface TripDetailClientProps {
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
    meta?: TripMeta;
    packingList?: string[];
    packingChecked?: string[];
    /** Pre-saved cover image URL - eliminates Places API call on load */
    coverImageUrl?: string | null;
    /** Cached travel distances from trip_meta - eliminates recalculation */
    cachedTravelDistances?: CachedDayTravelData[];
    /** Hash of itinerary when travel distances were calculated */
    cachedTravelHash?: string;
    /**
     * trips.itinerary_version the itinerary above was read at (20260924125000).
     * Read ONCE, into the save queue; never again from props (see sync below).
     */
    itineraryVersion?: number | null;
  };
  dateRange: string;
  // Collaboration props (optional - only passed for collaborative trips)
  isCollaborativeTrip?: boolean;
  userRole?: CollaboratorRole;
  collaboratorCount?: number;
  /**
   * /explore Week 3 (2026-05-25): server-rendered EngagementBar +
   * PublishToggle. Server component computes auth + flag state + counts;
   * we just render the ReactNode in the action toolbar.
   */
  engagementSlot?: React.ReactNode;
  /** Server-resolved: explore on, viewer is owner, trip not already public. */
  canPublish?: boolean;
  /** Prefills the /explore author byline on the share prompt's publish tick. */
  ownerDisplayName?: string | null;
  /** Server-computed live day-state (Phase 3.2). */
  liveState?: TripDayState;
}

export default function TripDetailClient({
  trip,
  dateRange,
  isCollaborativeTrip = false,
  canPublish = false,
  ownerDisplayName,
  userRole = "owner",
  collaboratorCount = 0,
  engagementSlot,
  liveState,
}: TripDetailClientProps) {
  const t = useTranslations('trips');
  const tTrips = useTranslations('common.trips');
  // Live Trip Phase 3.2: a live trip opens on Today for the owner too.
  const fallbackDayState = useMemo<TripDayState>(
    () => liveState ?? computeTripDayState({ startDate: trip.startDate, endDate: trip.endDate, timeZone: null }),
    [liveState, trip.startDate, trip.endDate],
  );
  const dayState = useLiveTripState(fallbackDayState, trip.startDate, trip.endDate);
  const [todayMode, setTodayMode] = useState(true);
  // 'common' is the namespace that holds calendar.* and addFromEmail.*
  // — added with the calendar-export + email-parse rollout. We don't
  // want to re-namespace the existing tTrips translator
  // because that would force a sweep through every existing call site.
  const tCommon = useTranslations('common');

  // Currency conversion hook — converts source-currency activity costs into
  // the user's preferred currency. Backs formatDayBudget below.
  const { convert: convertCurrency, format: formatCurrency, preferredCurrency } = useCurrency();

  // P1 bug fix (currency conversion): compute the day's "Est. Budget" by
  // summing the FX-converted activity costs. Mirrors the Day-6 fix already
  // shipped in SharedTripView.tsx — the persisted `day.daily_budget.total`
  // is denominated in the activities' source currency (e.g. JPY) but the
  // legacy code treated it as `trip.budget?.currency || "USD"`, producing
  // 100x+ inflated values whenever the AI generated the trip in a different
  // currency. Summing the converted per-activity amounts is the single
  // source of truth — eliminates the entire bug class.
  // Day-9 SSR-null fix: on initial server-render exchangeRates is null
  // (loaded in a client useEffect). convertCurrency() then returns the
  // unconverted source-currency value but the OLD code formatted that
  // raw integer in `preferredCurrency` — producing €27,600 (raw JPY
  // with EUR symbol) for a Tokyo trip. Track the currency the converter
  // ACTUALLY returns and format in that, so SSR shows ¥27,600 (correct
  // source currency) and client-after-hydration shows €178 (converted).
  // First activity's returned currency wins for consistency.
  const formatDayBudget = (day: ItineraryDay): string => {
    let total = 0;
    let displayCurrency = preferredCurrency;
    let displaySet = false;
    for (const activity of day.activities) {
      const amount = activity.estimated_cost?.amount;
      const currency = activity.estimated_cost?.currency;
      if (!amount || !currency) continue;
      const converted = convertCurrency(amount, currency);
      total += converted.value;
      if (!displaySet) {
        displayCurrency = converted.currency;
        displaySet = true;
      }
    }
    if (total === 0) return tCommon('activity.free');
    return formatCurrency(total, displayCurrency);
  };

  // Check for share query param (used to auto-open share modal after trip save)
  const searchParams = useSearchParams();
  const shareParam = searchParams.get("share");
  const shouldAutoOpenShareModal = shareParam === "invite";

  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [showMap, setShowMap] = useState(true);
  const [viewMode, setViewMode] = useState<"timeline" | "cards">("cards");
  const [isAIAssistantOpen, setIsAIAssistantOpen] = useState(false);
  // Cache the resolved cover URL across re-renders so the hero
  // doesn't re-fetch after the first PATCH lands. We seed from props
  // (DB value) and overwrite on the persist callback fire-and-forget.
  const [coverImageUrl, setCoverImageUrl] = useState<string | null | undefined>(
    trip.coverImageUrl
  );
  // Re-seed whenever the inbound trip changes (route param flip etc.).
  useEffect(() => {
    setCoverImageUrl(trip.coverImageUrl);
  }, [trip.coverImageUrl, trip.id]);
  // Persist a freshly-resolved cover image back to the trip row so we
  // never re-fetch Google Places on subsequent visits — cost + reliability
  // win (task #252). Owner-only to respect the PATCH /api/trips/[id] RLS.
  // Fire-and-forget — if the PATCH fails the in-memory state still keeps
  // the hero visible for this session.
  const isOwner = userRole === "owner";
  // The trip assistant changes the trip, so it is for the people who can:
  // the owner and editors (the API answers 403 to anyone else). Voters and
  // viewers used to see it, have it open by itself on a first visit, and get
  // "Trip not found" for their first message.
  const canUseAssistant = ROLE_PERMISSIONS[userRole]?.canEdit ?? false;
  // Live Trip Phase 2.4: the owner sees who said they're going.
  const participantsEnabled = isLiveTripParticipantsEnabled();
  const handleCoverImageFetched = useCallback(
    (fetchedUrl: string) => {
      if (!isOwner) return;
      if (!fetchedUrl) return;
      // Optimistically update local state so the hero stops flickering
      // through future re-renders.
      setCoverImageUrl(fetchedUrl);
      // Fire-and-forget PATCH — failure here is a non-event (next visit
      // will just re-fetch). Don't await; don't toast on error.
      fetch(`/api/trips/${trip.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cover_image_url: fetchedUrl }),
      }).catch((err) => {
        console.warn("[trip-cover] persist failed", err);
      });
    },
    [isOwner, trip.id]
  );

  // ---- Crew Loop (2026-07): owner-side visibility of anonymous crew votes ----
  // The share link lets friends vote with NO account (POST
  // /api/shared/[token]/vote → anonymous_activity_votes), but those votes were
  // invisible on this page. For the owner we fetch share status once on mount
  // and, when sharing is on, the aggregated crew votes.
  const [crewVotes, setCrewVotes] = useState<{
    total: number;
    voters: string[];
    byActivity: Record<string, { up: number; down: number }>;
  } | null>(null);
  // null = still resolving / not owner. `=== false` drives the "never shared
  // yet" CTA so it can't flash while the share status is in flight.
  const [crewSharingEnabled, setCrewSharingEnabled] = useState<boolean | null>(null);
  // Assume dismissed until localStorage says otherwise — avoids a flash of
  // the CTA for owners who already dismissed it.
  const [crewCtaDismissed, setCrewCtaDismissed] = useState(true);
  // Each increment remounts ShareButton (via key) with autoOpen on the SHARE
  // tab — the same autoOpen/initialTab prop mechanism the ?share=invite deep
  // link uses, without modifying ShareButton itself.
  const [crewShareRequest, setCrewShareRequest] = useState(0);

  useEffect(() => {
    if (!isOwner) return;
    let cancelled = false;
    (async () => {
      try {
        const shareRes = await fetch(`/api/trips/${trip.id}/share`);
        if (!shareRes.ok || cancelled) return;
        const shareData = await shareRes.json();
        if (cancelled) return;
        setCrewSharingEnabled(!!shareData.isShared);
        if (!shareData.isShared) return;
        const votesRes = await fetch(`/api/trips/${trip.id}/crew-votes`);
        if (!votesRes.ok || cancelled) return;
        const votesData = await votesRes.json();
        if (!cancelled) setCrewVotes(votesData);
      } catch (err) {
        // Non-fatal — the page works fine without the crew strip.
        console.warn("[crew-votes] fetch failed (non-fatal):", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOwner, trip.id]);

  // CTA dismissal persists per trip (key: crewCtaDismissed:{tripId}).
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      setCrewCtaDismissed(
        safeGet(`crewCtaDismissed:${trip.id}`) === "1"
      );
    } catch {
      // storage unavailable (private mode) — leave the CTA hidden
    }
  }, [trip.id]);

  const dismissCrewCta = useCallback(() => {
    setCrewCtaDismissed(true);
    try {
      safeSet(`crewCtaDismissed:${trip.id}`, "1");
    } catch {
      // best-effort — session-only dismissal is fine
    }
  }, [trip.id]);

  const openCrewShareModal = useCallback(() => {
    setCrewShareRequest((c) => c + 1);
  }, []);

  // Per-activity crew tally pill ("👍2 👎1"). Rendered in the card wrapper —
  // threading new props through Sortable/EditableActivityCard would touch far
  // more surface for the same pixel result.
  const renderCrewVotePill = (activityId: string | undefined) => {
    if (!activityId || !crewVotes) return null;
    const tally = crewVotes.byActivity[activityId];
    if (!tally || (tally.up === 0 && tally.down === 0)) return null;
    return (
      <div className="flex justify-end mb-1">
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-violet-50 border border-violet-200 text-[11px] font-medium text-violet-700">
          <span>👍{tally.up}</span>
          <span>👎{tally.down}</span>
        </span>
      </div>
    );
  };
  // ---- end Crew Loop ----
  // **2026-05-23**: Foreground the AI assistant — it's the killer feature
  // (the "make Day 2 cheaper" loop) and was previously hidden behind a small
  // floating pill that most users never noticed. We now auto-open it on
  // first visit to a trip, and visually pulse the trigger until the user
  // has interacted with it at least once. After that, no nags.
  const [hasSeenAssistant, setHasSeenAssistant] = useState<boolean>(true);
  useEffect(() => {
    if (typeof window === "undefined" || !canUseAssistant) return;
    const seenAt = safeGet("mt_ai_assistant_seen");
    if (!seenAt) {
      // First-time visitor to any trip — surface the assistant after a brief
      // delay so they've had a moment to scan the itinerary first.
      setHasSeenAssistant(false);
      const t = setTimeout(() => setIsAIAssistantOpen(true), 2500);
      return () => clearTimeout(t);
    }
  }, [canUseAssistant]);
  // Mark as seen whenever the assistant opens — both auto-open and manual.
  useEffect(() => {
    if (isAIAssistantOpen && typeof window !== "undefined") {
      safeSet("mt_ai_assistant_seen", String(Date.now()));
      setHasSeenAssistant(true);
    }
  }, [isAIAssistantOpen]);

  // Edit mode state
  const [isEditMode, setIsEditMode] = useState(false);
  // Today mode (Phase 3.2) shows only outside the editor, on a live trip.
  const showToday = dayState.isLive && todayMode && !isEditMode;
  // One copy for both states, with ids derived from the stored trip for any
  // activity stored without one. Two random-id calls made the page look
  // edited on its first render (a phantom autosave, and on a router-cache
  // restore a false conflict), and every mount minted different ids. New
  // trips are stored with ids; older ones are stored once by the effect after
  // ambientEdit.
  const [initialItinerary] = useState(() => ensureActivityIdsStable(trip.itinerary, trip.id));
  const [editedItinerary, setEditedItinerary] = useState<ItineraryDay[]>(() =>
    JSON.parse(JSON.stringify(initialItinerary))
  );
  // Track the last saved state (so we can detect changes and revert without page reload)
  const [savedItinerary, setSavedItinerary] = useState<ItineraryDay[]>(initialItinerary);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  // Ambient-edit auto-save status ('idle' | 'saving' | 'saved' | 'error' |
  // 'conflict'). Drives the small status pill that replaces the
  // Modifica/Save/Discard cluster for solo owners (see ambientEdit below).
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error" | "conflict">("idle");

  // Itinerary save queue + base version (lib/trips/itinerary-sync.ts,
  // 20260924125000). Every itinerary PATCH, and every server write this tab
  // starts, goes through it one at a time, so the tab never 409s on itself.
  // INVARIANT: savedItinerary and sync.baseVersion() only ever change
  // together. The version is read from props only here: router.refresh()
  // re-renders props with a newer version while this state keeps the older
  // content, and a base taken from props alone would then pass the check
  // while reverting someone else's work. (Newer props are adopted as a pair,
  // content and version together: see the router-cache effect below.)
  const propsVersion = readItineraryVersion(trip.itineraryVersion);
  const [sync] = useState(() => createItinerarySync({ tripId: trip.id, initialVersion: propsVersion }));
  // A save refused because the trip changed elsewhere (a trip mate, another
  // tab). The ref mirrors the state for code running inside the queue.
  const [conflict, setConflictState] = useState<{ server: ServerItinerary; source: "save" | "autosave" } | null>(null);
  const conflictRef = useRef<typeof conflict>(null);
  const setConflict = useCallback((next: typeof conflict) => {
    conflictRef.current = next;
    setConflictState(next);
  }, []);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  // Guard against auto-save retry storms: when a PATCH fails we record the
  // exact payload that failed so the debounced effect doesn't hammer the
  // server with the identical body. A NEW edit changes the payload and clears
  // the guard, so a real change always re-attempts.
  const lastFailedSaveRef = useRef<string | null>(null);
  // The itinerary JSON that still needs persisting (set when a save is
  // scheduled, cleared on success). Read by the unmount-flush effect so an
  // edit made within the debounce window isn't lost to a client-side
  // navigation (beforeunload doesn't fire on SPA route changes).
  const pendingSaveRef = useRef<string | null>(null);
  // sync.epoch() when that pending payload was built (see sendPendingInline).
  const pendingEpochRef = useRef(0);
  // Server itinerary writes this tab started and that have not finished
  // (regenerate a day, assistant, concierge, add from email). The explicit
  // Save waits for them: a Save clicked mid-write would send a copy without
  // the write's result.
  const [itineraryWritesInFlight, setItineraryWritesInFlight] = useState(0);
  // (Auto-saves used to abort the previous in-flight PATCH. They are now
  // queued instead: an aborted fetch does not stop a PATCH the server already
  // received, and the next save would then carry an outdated base version.)
  // Fire the manual-edit adoption metric (captureEditModeSaved) at most once
  // per page-view, not once per debounced flush — otherwise the ambient cohort
  // inflates edit_mode_saved relative to the AI-agent comparison metric.
  const editCapturedRef = useRef(false);
  const [regeneratingActivityId, setRegeneratingActivityId] = useState<string | null>(null);
  // Per-day regeneration: tracks which day_number is currently being replaced.
  const [regeneratingDayNumber, setRegeneratingDayNumber] = useState<number | null>(null);
  // The day-regeneration dialog: which day, and what the traveller wants it to
  // be about. The button used to regenerate blind (an English window.confirm,
  // no way to say what you wanted), so a cruise planner pressed it four times
  // for "Day 5 = boarding the cruise" and got Rome sightseeing each time.
  const [dayRegenPrompt, setDayRegenPrompt] = useState<{ dayNumber: number; text: string } | null>(null);
  // "Cancel Trip" asks first: it turns off the countdown, checklist and
  // reminders (31 trips were cancelled, 17 in the last 60 days, one click each).
  const [confirmCancelTrip, setConfirmCancelTrip] = useState(false);

  // Status management
  const router = useRouter();
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [currentStatus, setCurrentStatus] = useState(trip.status);

  // Booking drawer state (for collecting flight origin)
  const [isBookingDrawerOpen, setIsBookingDrawerOpen] = useState(false);

  // "Add from email" modal — flag-gated paste-confirmation flow.
  // The PasteBookingModal early-returns null when
  // NEXT_PUBLIC_EMAIL_PARSE_ENABLED !== "true", but we also avoid
  // rendering the trigger button (and therefore the dynamic chunk
  // load) when the flag is off so the action bar stays tidy. The
  // flag is inlined at build time on Vercel — toggling it is a
  // 60-second redeploy.
  const emailParseEnabled = process.env.NEXT_PUBLIC_EMAIL_PARSE_ENABLED === "true";
  const [isPasteBookingOpen, setIsPasteBookingOpen] = useState(false);

  // Feature flag for enhanced booking panel
  const { enabled: useEnhancedBooking } = useFlag(FLAG_ENHANCED_BOOKING);

  // Version counter to force re-render after AI updates
  const [renderEpoch, setRenderEpoch] = useState(0);

  // Ref to track if we just updated from AI (for animations)
  const aiUpdateRef = useRef<{ dayIndex: number; activityId: string } | null>(null);

  // Track if there are unsaved changes (compare against saved state, not prop)
  const hasChanges = JSON.stringify(editedItinerary) !== JSON.stringify(savedItinerary);
  // For code running inside the save queue. (ambientEdit is computed further
  // down; its ref is kept in step right after it.)
  const hasChangesRef = useRef(hasChanges);
  useEffect(() => {
    hasChangesRef.current = hasChanges;
  }, [hasChanges]);
  const isEditModeRef = useRef(isEditMode);
  useEffect(() => {
    isEditModeRef.current = isEditMode;
  }, [isEditMode]);
  const ambientEditRef = useRef(false);
  // handleRefetchTrip is declared further down; callbacks above reach it here.
  const refetchTripRef = useRef<((options?: { onlyIfUnedited?: boolean }) => Promise<boolean>) | null>(null);

  // A save landed: the payload is the saved copy at `version` (null from an
  // older server). Replies arrive in queue order, so an older version can only
  // show up after a reset (Load latest); ignore it then.
  const adoptSaved = useCallback(
    (payload: string, version: number | null) => {
      const base = sync.baseVersion();
      if (version !== null && base !== null && version < base) return;
      if (version !== null) sync.adopt(version);
      setSavedItinerary(JSON.parse(payload));
    },
    [sync]
  );

  // Send the pending ambient auto-save, if any. Runs INSIDE the queue only
  // (flushPendingSave / runItineraryWrite); never enqueue from in here.
  const sendPendingInline = useCallback(async () => {
    const payload = pendingSaveRef.current;
    if (!payload || payload === lastFailedSaveRef.current || conflictRef.current) return;
    // Built before the base moved to content this edit does not contain (a
    // day regeneration this tab started landed while the save waited in the
    // queue, or a server copy was loaded) and React has not re-rendered the
    // edit on top of it yet. Sent now it would revert that content; the effect
    // re-builds it from the new state. (A base moved by this tab's own earlier
    // autosave keeps the epoch: the pending edit is built on top of it.)
    if (pendingEpochRef.current !== sync.epoch()) return;
    const base = sync.baseVersion();
    const result = await sync.send(payload, base);
    if (result.kind === "saved") {
      if (pendingSaveRef.current === payload) pendingSaveRef.current = null;
      adoptSaved(payload, result.version);
      lastFailedSaveRef.current = null;
      if (!pendingSaveRef.current) setSaveStatus("saved");
      // Manual-edit adoption metric: ONCE per page-view, not per debounced
      // flush, so the ambient cohort stays comparable to ai_assistant_used.
      if (!editCapturedRef.current) {
        editCapturedRef.current = true;
        const snapshot = JSON.parse(payload) as ItineraryDay[];
        void captureEditModeSaved({
          trip_id: trip.id,
          days_count: snapshot.length,
          activities_count: snapshot.reduce((acc, day) => acc + day.activities.length, 0),
        });
      }
    } else if (result.kind === "conflict") {
      setConflict({ server: result.server, source: "autosave" });
      setSaveStatus("conflict");
      if (!mountedRef.current) {
        console.warn("[trip-autosave] an edit was not saved: the trip was changed elsewhere");
      }
    } else {
      console.warn("[trip-autosave] failed", result.status);
      lastFailedSaveRef.current = payload;
      setSaveStatus("error");
    }
  }, [sync, adoptSaved, setConflict, trip.id]);

  const flushPendingSave = useCallback(() => sync.enqueue(sendPendingInline), [sync, sendPendingInline]);

  // A server-side itinerary write started from this tab (regenerate a day,
  // assistant apply/undo, concierge apply, add from email). Pending edits are
  // saved first and the task runs alone, so the version it returns is the one
  // this tab can adopt.
  // Most of these writes start from the server's copy and the page then takes
  // the result as its own copy, so they must not start over unsaved edits.
  // `keepsLocalEdits`: the result is merged into the page's copy instead
  // (regenerate a day splices one day in), so unsaved edits elsewhere survive.
  const runItineraryWrite = useCallback(
    <T,>(task: () => Promise<T>, options?: { keepsLocalEdits?: boolean }): Promise<T> => {
      setItineraryWritesInFlight((n) => n + 1);
      return sync
        .enqueue(async () => {
          // One more try for an autosave that failed: this write starts from
          // the stored copy (and a retry adopts a save whose reply was lost).
          lastFailedSaveRef.current = null;
          await sendPendingInline();
          // Edits held by a conflict: the write and the refetch after it would
          // silently replace them and dismiss the choice. The user picks first.
          if (conflictRef.current) throw new ItineraryWriteBlockedError(t("detail.writeBlockedConflict"));
          // Still unsaved: the autosave failed, or is being re-built on a copy
          // that just changed, or an editor in edit mode has not saved yet.
          // (Only real editing counts: outside edit mode there is nothing the
          // person could save, so it must never block.)
          const unsavedEdit =
            pendingSaveRef.current !== null ||
            (!ambientEditRef.current && isEditModeRef.current && hasChangesRef.current);
          if (!options?.keepsLocalEdits && unsavedEdit) {
            throw new ItineraryWriteBlockedError(t("detail.writeBlockedUnsaved"));
          }
          return task();
        })
        .finally(() => setItineraryWritesInFlight((n) => n - 1));
    },
    [sync, sendPendingInline, t]
  );

  // Undo/Redo history for edit mode
  interface HistoryEntry {
    itinerary: ItineraryDay[];
    action: string;
    timestamp: number;
  }
  const MAX_HISTORY = 20;
  const [undoStack, setUndoStack] = useState<HistoryEntry[]>([]);
  const [redoStack, setRedoStack] = useState<HistoryEntry[]>([]);

  // REMOVED: Auto-backfill coordinates for legacy trips
  // Saved trips should NEVER call any external API.
  // Legacy trips without coordinates will simply show markers only for
  // activities that already have coordinates. No API calls on view.

  // REMOVED: handleCoverImageFetched callback
  // Saved trips should use existing cover image or show gradient fallback.
  // No Places API calls allowed when viewing saved trips.

  // Prefer trip_meta.destination (canonical) over title-strip — see
  // lib/trips/destination.ts. Fixes non-English / renamed trips.
  const destination = getTripDestination(trip);

  // P4 transport spine: multi-city route stops for the Journey ribbon —
  // trip detail is the LAST surface to get it (wizard + ongoing view had it
  // since the wedge; the plan flagged the gap). Empty on single-city trips.
  const locale = useLocale();
  const journeyStops = buildJourneyStops(editedItinerary, locale);

  // Trip phase detection for Timeline feature.
  //
  // **2026-05-31 P0 fix**: trip.startDate / trip.endDate come from the DB as
  // YYYY-MM-DD strings. `new Date("2026-05-31")` parses that as UTC midnight
  // — which in any negative-UTC zone (Americas) resolves to the PREVIOUS DAY
  // local time. User reported: trip set for May 31–Jun 1 in San Antonio
  // (CDT = UTC-5) displayed as "planning starts May 30" AND was treated as
  // already in-progress on May 31, so OngoingTripView rendered and the
  // share button vanished.
  //
  // Mirrors the parseLocal helper in components/ui/SaveTripModal.tsx
  // (added 2026-05-24 for the same root cause on the save side).
  const tripStartDate = useMemo(() => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(trip.startDate);
    return m
      ? new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10))
      : new Date(trip.startDate);
  }, [trip.startDate]);
  const tripEndDate = useMemo(() => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(trip.endDate);
    return m
      ? new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10), 23, 59, 59)
      : new Date(trip.endDate);
  }, [trip.endDate]);
  const now = new Date();

  // Pre-trip: the trip simply has not started yet.
  //
  // This used to also require status === "confirmed", which limited the
  // countdown and the pre-trip checklist to 25 of 443 trips (5.6%) - Confirm
  // is a 17% action, so the gate was hiding the surface from the 183 people
  // who have an upcoming trip and never pressed it. Measured 2026-09-01:
  // 25 trips qualified before, 208 after.
  //
  // Cancelled trips are still excluded: counting down to a trip someone
  // called off is worse than showing nothing.
  const isPreTripPhase = trip.status !== "cancelled" && tripStartDate > now;

  // Active trip: Between start and end dates
  const isActiveTripPhase = trip.status === "active" ||
    (tripStartDate <= now && now <= tripEndDate);

  // Calculate trip days and total activities for countdown
  const tripDaysCount = trip.itinerary.length;
  const totalActivities = editedItinerary.reduce((acc, day) => acc + day.activities.length, 0);

  // Pre-trip checklist (only load when in pre-trip phase). Owner only: the
  // checklist routes and their RLS admit only the owner, so loading it for a
  // collaborator was a guaranteed 404 on every visit.
  const checklist = useChecklist(trip.id, { enabled: isOwner });

  // Toast notifications
  const { addToast } = useToast();

  // Google Calendar OAuth sync was removed in cleanup #224 (callback
  // route at app/api/calendar/google/callback was deleted along with
  // the whole F1 OAuth workflow). The toast handler that read
  // ?gcal_sync= here was orphaned and is gone too. If we ever bring
  // back a calendar-subscription feature, restore the effect + the
  // gcalSync* translation keys at the same time.

  // Handle status update
  const handleStatusUpdate = async (newStatus: "confirmed" | "cancelled" | "planning") => {
    setIsUpdatingStatus(true);
    try {
      const response = await fetch(`/api/trips/${trip.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });

      if (!response.ok) {
        throw new Error(`status ${response.status}`);
      }

      setCurrentStatus(newStatus);
      addToast(
        newStatus === "confirmed"
          ? tTrips("tripConfirmed")
          : newStatus === "planning"
            ? tTrips("tripRestored")
            : tTrips("tripCancelled"),
        "success"
      );
      router.refresh();
    } catch (error) {
      console.error("Error updating status:", error);
      // The server's text is English (and sometimes an object).
      addToast(t('detail.cancelTrip.failed'), "error");
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  // Activity timeline for live journey mode
  const activityTimeline = useActivityTimeline(trip.id);

  // Activity voting for collaborative trips
  const votingEnabled = isCollaborativeTrip && collaboratorCount > 1;
  const {
    votes: allVotes,
    consensus: allConsensus,
    currentUserVotes,
    voterCount,
    castVote,
    removeVote,
    getActivityVotes,
    getActivityConsensus,
    getActivityStatus,
    getCurrentUserVote,
  } = useActivityVotes({
    tripId: trip.id,
    enabled: votingEnabled,
  });

  // Activity proposals for collaborative trips
  // Track recently approved proposals to show transition animation
  const [recentlyApproved, setRecentlyApproved] = useState<Set<string>>(new Set());

  // Handle proposal status changes (especially approvals)
  const handleProposalChange = useCallback((proposal: ProposalWithVotes) => {
    if (proposal.status === 'approved' && proposal.activity_data) {
      // Mark as recently approved for animation
      setRecentlyApproved(prev => new Set([...prev, proposal.id]));

      // Add the approved activity to the local itinerary
      const activityData = proposal.activity_data as Activity;
      const targetDayIndex = proposal.target_day; // 0-indexed

      if (targetDayIndex >= 0 && targetDayIndex < editedItinerary.length) {
        const newActivity: Activity = {
          ...activityData,
          id: activityData.id || `act_${proposal.id.slice(0, 12)}`,
        };

        setEditedItinerary(prev => {
          return prev.map((day, index) => {
            if (index === targetDayIndex) {
              // Check if activity already exists (avoid duplicates)
              const exists = day.activities.some(a => a.id === newActivity.id);
              if (exists) return day;

              // Insert and sort by time
              const activities = [...day.activities, newActivity].sort((a, b) => {
                const timeA = a.start_time || "00:00";
                const timeB = b.start_time || "00:00";
                return timeA.localeCompare(timeB);
              });
              return { ...day, activities };
            }
            return day;
          });
        });

        // Show success toast
        addToast(`"${newActivity.name}" has been approved and added to your itinerary!`, "success");
      }

      // Remove from recently approved after animation completes
      setTimeout(() => {
        setRecentlyApproved(prev => {
          const next = new Set(prev);
          next.delete(proposal.id);
          return next;
        });
      }, 3000);
    }
  }, [editedItinerary.length, addToast]);

  const {
    proposals,
    isLoading: proposalsLoading,
    createProposal,
    voteOnProposal,
    removeVote: removeProposalVote,
    withdrawProposal,
    forceResolve,
    getProposalsForSlot,
  } = useProposals({
    tripId: trip.id,
    enabled: votingEnabled,
    statusFilter: 'active',
    onProposalChange: handleProposalChange,
  });

  // Permission checks for current user
  const canVote = ROLE_PERMISSIONS[userRole]?.canVote ?? false;
  const canEdit = ROLE_PERMISSIONS[userRole]?.canEdit ?? false;
  const canPropose = ROLE_PERMISSIONS[userRole]?.canSuggest ?? false; // canSuggest = canPropose

  // **Ambient editing (2026-07-03 moat).** The full manual editor (drag,
  // delete, move-to-day, add, regenerate, undo/redo) already existed but was
  // trapped behind an `isEditMode` toggle most users never found — so people
  // never realised they could edit the plan by hand. For a solo owner we drop
  // the mode entirely: the editable cards are ALWAYS live and changes
  // auto-save (see the debounced effect + saveStatus pill). We keep the exact
  // old mode-based flow for collaborative/voting trips (proposals interleave
  // by time and would break under a drag context) and for the active-trip
  // phase (that renders OngoingTripView, not the itinerary). Gated on isOwner
  // because auto-save PATCHes /api/trips/[id] which is owner-only (user_id eq).
  const ambientEdit = isOwner && !votingEnabled && !isActiveTripPhase;
  useEffect(() => {
    ambientEditRef.current = ambientEdit;
  }, [ambientEdit]);
  // Activities stored without an id (trips from before ids were stamped at
  // creation) got derived ids on this load. Solo owners store them once, as
  // the phantom first-render autosave used to: photos, crew asks and votes
  // refer to activities by id. Safe on every mount: the ids are the same for
  // the same stored copy, so a sibling mount's save that landed first counts
  // as this one (409 with equal content = saved), and a stale copy (router
  // cache) gets a 409 and takes the stored copy when nothing is edited.
  useEffect(() => {
    if (!ambientEdit || propsVersion === null) return;
    const payload = JSON.stringify(initialItinerary);
    if (payload === JSON.stringify(trip.itinerary)) return; // nothing minted
    const base = sync.baseVersion();
    void sync.enqueue(async () => {
      if (sync.baseVersion() !== base || conflictRef.current) return;
      const result = await sync.send(payload, base);
      if (result.kind === "saved") {
        adoptSaved(payload, result.version);
      } else if (result.kind === "conflict" && !pendingSaveRef.current && !hasChangesRef.current) {
        // Changed since this page loaded, and nothing is edited here yet: no
        // choice to make, take the stored copy.
        const fresh = ensureActivityIdsStable(result.server.itinerary, trip.id);
        sync.reset(result.server.version);
        setSavedItinerary(fresh);
        setEditedItinerary(JSON.parse(JSON.stringify(fresh)));
        clearHistory();
        setRenderEpoch((v) => v + 1);
      }
    });
    // Mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Affordances/rendering are "on" whenever we're ambient OR the legacy mode
  // is toggled (collaborative trips still use isEditMode).
  const editingActive = ambientEdit || isEditMode;

  // Proposal modal state
  const [proposeModalState, setProposeModalState] = useState<{
    isOpen: boolean;
    targetDay: number;
    targetTimeSlot?: 'morning' | 'afternoon' | 'evening';
    targetActivityId?: string;
    targetActivityName?: string;
  }>({
    isOpen: false,
    targetDay: 1,
  });

  // Voting bottom sheet state (for inline proposal voting)
  const [votingSheetState, setVotingSheetState] = useState<{
    isOpen: boolean;
    proposal: typeof proposals[number] | null;
  }>({
    isOpen: false,
    proposal: null,
  });

  // Route optimization modal state
  const [routeOptimizationState, setRouteOptimizationState] = useState<{
    isOpen: boolean;
    dayNumber: number;
    activities: Activity[];
  }>({
    isOpen: false,
    dayNumber: 1,
    activities: [],
  });

  // Open voting sheet for a proposal
  const openVotingSheet = useCallback((proposal: typeof proposals[number]) => {
    setVotingSheetState({ isOpen: true, proposal });
  }, []);

  // Close voting sheet
  const closeVotingSheet = useCallback(() => {
    setVotingSheetState({ isOpen: false, proposal: null });
  }, []);

  // Open route optimization modal for a day
  const openRouteOptimization = useCallback((dayNumber: number, activities: Activity[]) => {
    setRouteOptimizationState({ isOpen: true, dayNumber, activities });
  }, []);

  // Close route optimization modal
  const closeRouteOptimization = useCallback(() => {
    setRouteOptimizationState({ isOpen: false, dayNumber: 1, activities: [] });
  }, []);

  // Rating modal state
  const [ratingModalActivity, setRatingModalActivity] = useState<{
    id: string;
    name: string;
    dayNumber: number;
    image_url?: string;
  } | null>(null);

  // Calculate current day number for active trip phase
  const currentDayNumber = useMemo(() => {
    if (!isActiveTripPhase) return 1;
    const daysDiff = Math.floor(
      (now.getTime() - tripStartDate.getTime()) / (1000 * 60 * 60 * 24)
    );
    return Math.min(Math.max(1, daysDiff + 1), tripDaysCount);
  }, [isActiveTripPhase, now, tripStartDate, tripDaysCount]);

  // Get current day's activities
  const currentDayActivities = useMemo(() => {
    const dayData = editedItinerary.find((d) => d.day_number === currentDayNumber);
    return dayData?.activities || [];
  }, [editedItinerary, currentDayNumber]);

  // Get all activities grouped by day for progress calculation
  const allActivitiesByDay = useMemo(() => {
    return editedItinerary.map((day) => day.activities);
  }, [editedItinerary]);

  // Track trip view for retention analytics (runs once on mount)
  useEffect(() => {
    const daysSinceCreation = tripStartDate
      ? Math.floor((Date.now() - tripStartDate.getTime()) / (1000 * 60 * 60 * 24))
      : 0;

    trackTripViewed({
      tripId: trip.id,
      isOwnTrip: true, // This page is only accessible by the trip owner
      tripStatus: trip.status,
      daysSinceCreation: Math.abs(daysSinceCreation),
      activitiesCount: totalActivities,
    });

    // Phase 0.1 (docs/LIVE_TRIP_MASTER_PLAN.md): the North Star's row.
    // Collaborators reach this page too (userRole), whatever the comment
    // above says, so the source says which. Fire-and-forget, keepalive.
    try {
      void fetch(`/api/trips/${trip.id}/view`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: userRole === "owner" ? "owner" : "collaborator" }),
        keepalive: true,
      });
    } catch {
      // analytics must never affect the page
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip.id]); // Only track once per trip view

  // Calculate day progress for LiveJourneyHeader
  const dayProgress = activityTimeline.getDayProgress(allActivitiesByDay, currentDayNumber);

  // Get current and next activity
  const currentActivity = activityTimeline.getCurrentActivity(currentDayActivities);
  const nextActivity = activityTimeline.getNextActivity(currentDayActivities);

  // Available days for "move to day" feature
  const availableDays = editedItinerary.map((day) => day.day_number);
  // What the "Move to another day" sheet shows per day (date, city, count).
  // Memoized on the itinerary so the memoized cards re-render only when a
  // day's contents actually change.
  const dayOptions = useMemo(() => dayOptionsOf(editedItinerary), [editedItinerary]);

  // Cross-day drag: while a card is being dragged, the days render from
  // `dragPreview` (the itinerary with the card already moved to wherever it
  // is hovering) instead of the saved state, so the plan reflows live and
  // what you see is what gets committed on drop. Nothing is written — no
  // undo entry, no auto-save — until the drop.
  const [dragPreview, setDragPreview] = useState<ItineraryDay[] | null>(null);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const dragStartRef = useRef<ItineraryDay[] | null>(null);
  const collisionDetection = useMemo(() => makeItineraryCollisionDetection(), []);
  // Re-measure every droppable on each move. dnd-kit measures droppables once
  // when a drag starts and only re-measures sortable ITEMS when a list
  // changes — the day headers and lists are not sortable items, so anything
  // that shifts the page mid-drag (the preview moving a card between days,
  // the map or an image loading) left their rects stale and a drop over a
  // header landed somewhere else. ~15 rects per move is negligible.
  const dndMeasuring = useMemo(() => ({ droppable: { strategy: MeasuringStrategy.Always } }), []);

  // Drag-and-drop sensors for reordering activities
  // Optimized for premium iOS-like touch experience
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5, // Reduced for more responsive feel
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 150, // Quick but intentional press (iOS-like)
        tolerance: 8, // Allow slight movement during press
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Undo/Redo callbacks
  const pushUndo = useCallback((action: string) => {
    setUndoStack(prev => [...prev.slice(-MAX_HISTORY + 1), {
      itinerary: JSON.parse(JSON.stringify(editedItinerary)),
      action,
      timestamp: Date.now()
    }]);
    setRedoStack([]); // Clear redo stack on new action
  }, [editedItinerary]);

  const undo = useCallback(() => {
    if (undoStack.length === 0) return;
    const last = undoStack[undoStack.length - 1];
    setRedoStack(prev => [...prev, {
      itinerary: JSON.parse(JSON.stringify(editedItinerary)),
      action: `Redo: ${last.action}`,
      timestamp: Date.now()
    }]);
    setEditedItinerary(last.itinerary);
    setUndoStack(prev => prev.slice(0, -1));
    // History navigation should always re-attempt an auto-save, even back to a
    // payload that previously failed — otherwise the failed-payload guard could
    // strand the trip in an un-saved state after an undo/redo round-trip.
    lastFailedSaveRef.current = null;
  }, [undoStack, editedItinerary]);

  const redo = useCallback(() => {
    if (redoStack.length === 0) return;
    const last = redoStack[redoStack.length - 1];
    setUndoStack(prev => [...prev, {
      itinerary: JSON.parse(JSON.stringify(editedItinerary)),
      action: `Undo: ${last.action}`,
      timestamp: Date.now()
    }]);
    setEditedItinerary(last.itinerary);
    setRedoStack(prev => prev.slice(0, -1));
    lastFailedSaveRef.current = null;
  }, [redoStack, editedItinerary]);

  // Clear undo/redo stacks when entering/exiting edit mode
  const clearHistory = useCallback(() => {
    setUndoStack([]);
    setRedoStack([]);
  }, []);

  // Apply optimized route to a day (with undo support)
  const applyOptimizedRoute = useCallback((dayNumber: number, optimizedActivities: Activity[]) => {
    pushUndo("Optimize route");
    setEditedItinerary((prev) => {
      const newItinerary = [...prev];
      const dayIndex = newItinerary.findIndex((d) => d.day_number === dayNumber);
      if (dayIndex >= 0) {
        newItinerary[dayIndex] = {
          ...newItinerary[dayIndex],
          activities: optimizedActivities,
        };
      }
      return newItinerary;
    });
    addToast("Route optimized! Save changes to apply.", "success");
  }, [pushUndo, addToast]);

  // Edit handlers (with undo support)
  const handleActivityMove = useCallback(
    (activityId: string, direction: "up" | "down") => {
      pushUndo(`Move activity ${direction}`);
      setEditedItinerary((prev) => {
        // Find which day the activity is in
        const location = findActivityById(prev, activityId);
        if (!location) return prev;

        // Move the activity and recalculate times
        const moved = moveActivityInDay(prev, activityId, direction);
        return recalculateActivityTimes(moved, location.dayIndex);
      });
    },
    [pushUndo]
  );

  // handleActivityMoveToDay and the drag handlers live further down, after
  // handleFocusDayCard, which they use to scroll to the destination day.

  const handleActivityDelete = useCallback((activityId: string) => {
    pushUndo("Delete activity");
    setEditedItinerary((prev) => deleteActivity(prev, activityId));
  }, [pushUndo]);

  const handleActivityUpdate = useCallback(
    (activityId: string, updates: Partial<Activity>) => {
      pushUndo("Update activity");
      setEditedItinerary((prev) => updateActivity(prev, activityId, updates));
    },
    [pushUndo]
  );

  // Get destination coordinates from existing trip activities (memoized)
  const destinationCoords = useMemo((): Coordinates | undefined => {
    // Try to find coordinates from any existing activity in the itinerary
    for (const day of editedItinerary) {
      for (const activity of day.activities) {
        if (activity.coordinates?.lat && activity.coordinates?.lng) {
          return activity.coordinates;
        }
      }
    }
    return undefined;
  }, [editedItinerary]);

  // Handle adding a new activity to a day
  const handleAddActivity = useCallback(
    (dayIndex: number, partialActivity: Partial<Activity>) => {
      const day = editedItinerary[dayIndex];
      if (!day) return;

      const nextTime = calculateNextTimeSlot(day);
      pushUndo("Add activity");

      // Generate coordinates if not provided
      // Priority: 1) Use provided coordinates, 2) Generate from existing activities
      let activityCoords = partialActivity.coordinates;
      if (!activityCoords?.lat || !activityCoords?.lng) {
        // Generate coordinates based on existing activities on this day or destination
        activityCoords = getCoordinatesForNewActivity(day.activities, destinationCoords);
        if (activityCoords) {
          console.log(`[TripDetail] Generated coordinates for new activity: ${activityCoords.lat.toFixed(5)}, ${activityCoords.lng.toFixed(5)}`);
        }
      }

      const newActivity: Activity = {
        id: generateActivityId(),
        name: partialActivity.name || "New Activity",
        type: partialActivity.type || "activity",
        description: partialActivity.description || "",
        location: destination,
        address: partialActivity.address || "",
        coordinates: activityCoords,
        start_time: nextTime,
        duration_minutes: partialActivity.duration_minutes || 90,
        time_slot: determineTimeSlot(nextTime),
        estimated_cost: partialActivity.estimated_cost || {
          amount: 0,
          currency: trip.budget?.currency || "USD",
          tier: "moderate",
        },
        tips: [],
        booking_required: false,
        image_url: partialActivity.image_url,
      };

      setEditedItinerary((prev) => addActivity(prev, dayIndex, newActivity));
    },
    [editedItinerary, destination, trip.budget?.currency, pushUndo, destinationCoords]
  );

  // Drag-and-drop (within a day and across days) is handled by
  // handleDragStart/Over/End/Cancel below handleFocusDayCard.

  // Handle photo capture from PlaceGallery - persists to database
  const handlePhotoCapture = useCallback(
    async (activityId: string, photoUrl: string) => {
      // Update local state immediately for instant UI feedback
      setEditedItinerary((prev) => updateActivity(prev, activityId, { image_url: photoUrl }));
      setSavedItinerary((prev) => updateActivity(prev, activityId, { image_url: photoUrl }));

      // Persist in the background (fire-and-forget) for those who may edit.
      // Only this one photo is sent; the server sets it on the CURRENT stored
      // itinerary. This used to send the whole itinerary from this tab's copy,
      // with no user action, so on a shared trip it silently reverted whatever
      // someone else had saved since the page loaded.
      if (!canEdit) return;
      fetch(`/api/trips/${trip.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activityPhoto: { activityId, imageUrl: photoUrl } }),
      }).catch((error) => {
        console.error("[Photo Capture] Failed to persist photo:", error);
        // Don't show error to user - photo is still displayed from local state
      });

      console.log(`[Photo Capture] Captured Places photo for activity ${activityId}`);
    },
    [trip.id, canEdit]
  );

  const handleActivityRegenerate = useCallback(
    async (activityId: string, dayIndex: number) => {
      pushUndo("Regenerate activity");
      setRegeneratingActivityId(activityId);
      try {
        const response = await fetch("/api/ai/regenerate-activity", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tripId: trip.id,
            activityId,
            dayIndex,
            destination,
            itinerary: editedItinerary,
          }),
        });

        if (!response.ok) {
          throw new Error("Failed to regenerate activity");
        }

        const data = await response.json();
        if (data.activity) {
          setEditedItinerary((prev) =>
            replaceActivity(prev, activityId, {
              ...data.activity,
              id: activityId,
            })
          );
          // Track activity regeneration for retention analytics
          trackActivityRegenerated({
            tripId: trip.id,
            activityType: data.activity.type || "unknown",
          });
        }
      } catch (error) {
        console.error("Error regenerating activity:", error);
        setSaveError("Failed to regenerate activity. Please try again.");
      } finally {
        setRegeneratingActivityId(null);
      }
    },
    [trip.id, destination, editedItinerary, pushUndo]
  );

  // Per-day regeneration: replaces all activities of a single day with a
  // fresh generation that takes the surrounding days as context, steered by
  // what the traveller wrote in the dialog (the API has always accepted
  // `instructions`; nothing sent them). Confirmed in the dialog, pushed to
  // the undo stack, then swapped in.
  const handleDayRegenerate = useCallback(
    async (dayNumber: number, instructions?: string) => {
      pushUndo(`Regenerate Day ${dayNumber}`);
      setRegeneratingDayNumber(dayNumber);
      try {
        // In the queue: pending edits are saved first, and the version the
        // server returns is adoptable only if nothing else wrote in between.
        await runItineraryWrite(async () => {
          const response = await fetch("/api/ai/regenerate-day", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              tripId: trip.id,
              dayNumber,
              ...(instructions?.trim() ? { instructions: instructions.trim().slice(0, 500) } : {}),
            }),
          });

          if (!response.ok) {
            let msg = "Failed to regenerate day";
            try {
              const errBody = await response.json();
              if (errBody?.error?.message) msg = errBody.error.message;
              else if (typeof errBody?.error === "string") msg = errBody.error;
            } catch {
              /* ignore parse error */
            }
            // The server's text is English; the status picks the message shown.
            throw Object.assign(new Error(msg), { status: response.status });
          }

          const data = await response.json();
          // apiSuccess wraps payloads as { data: {...} } in some helpers; tolerate both.
          const payload = data?.day ? data : data?.data ?? {};
          const newDay = payload.day as ItineraryDay | undefined;
          if (!newDay) throw new Error("Empty response from server");

          const day = ensureActivityIds([newDay])[0];
          const splice = (it: ItineraryDay[]) => it.map((d) => (d.day_number === dayNumber ? day : d));
          const from = readItineraryVersion(payload.fromVersion);
          const to = readItineraryVersion(payload.itineraryVersion);
          // The day is already stored. When the server wrote it on top of the
          // version this tab holds, it is part of the saved copy too; if
          // someone else wrote in between, the next save correctly gets a 409.
          if (from !== null && to !== null && from === sync.baseVersion()) {
            const epoch = sync.epoch();
            sync.adoptWrite(to);
            setSavedItinerary(splice);
            // Move an edit pending since before this write onto it now (the
            // same string the effect will build), so it is still sent if the
            // page unmounts before React re-renders.
            if (pendingSaveRef.current && pendingEpochRef.current === epoch) {
              pendingSaveRef.current = JSON.stringify(splice(JSON.parse(pendingSaveRef.current) as ItineraryDay[]));
              pendingEpochRef.current = sync.epoch();
            }
          } else if (
            (!ambientEditRef.current && !isEditModeRef.current) ||
            (pendingSaveRef.current === null && !hasChangesRef.current)
          ) {
            // Someone else wrote first and this page has no edits of its own
            // (or is only viewing): show the stored copy, the new day and what
            // changed since the page loaded, instead of a local splice whose
            // next save is sure to be refused. The day is stored either way:
            // if the read fails, fall back to a server refresh of the props.
            let tookStored = false;
            try {
              tookStored = (await refetchTripRef.current?.({ onlyIfUnedited: true })) ?? false;
            } catch (err) {
              console.warn("[regenerate-day] stored, but the page could not re-read the trip", err);
              router.refresh();
              return;
            }
            if (tookStored) return;
            // An edit arrived while re-reading: keep it, with the day spliced
            // in; its save gets the conflict choice (below).
            hasChangesRef.current = true;
          } else {
            // Kept on top of this page's own edits; the next save carries the
            // older base and gets the conflict choice. Marked now, before
            // React renders, so a queued adoption of newer props does not
            // replace it.
            hasChangesRef.current = true;
          }
          setEditedItinerary(splice);
        }, { keepsLocalEdits: true });
        // Bump the version counter so the day's children re-mount cleanly.
        setRenderEpoch((v) => v + 1);
        addToast(t('detail.regenerateDay.done', { number: dayNumber }), "success");
      } catch (error) {
        console.error("Error regenerating day:", error);
        const status = (error as { status?: number } | null)?.status;
        const msg =
          status === 429
            ? t('detail.regenerateDay.limit')
            : status === 409
              ? t('detail.regenerateDay.busy')
              : t('detail.regenerateDay.failed', { number: dayNumber });
        setSaveError(msg);
        addToast(msg, "error");
      } finally {
        setRegeneratingDayNumber(null);
      }
    },
    [trip.id, pushUndo, addToast, runItineraryWrite, sync, router, t]
  );

  // The explicit Save (editors, and owners of trips with collaborators),
  // through the queue with the base version. A stale save stays in edit mode
  // and shows the conflict choice instead of overwriting.
  const saveExplicit = useCallback(
    async (payload: string, snapshot: ItineraryDay[], base: number | null) => {
      setIsSaving(true);
      setSaveError(null);
      setSaveSuccess(false);
      try {
        const result = await sync.enqueue(() => sync.send(payload, base));
        if (result.kind === "conflict") {
          setConflict({ server: result.server, source: "save" });
          return;
        }
        if (result.kind === "failed") throw new Error(`Failed to save changes (${result.status ?? "network"})`);

        adoptSaved(payload, result.version);
        // Exit edit mode on success. The ref now too: a write queued behind
        // this save runs before React re-renders and must not see "editing
        // with unsaved changes" from the render before.
        isEditModeRef.current = false;
        setIsEditMode(false);
        // Instrument a completed manual edit — the head-to-head counterpart to
        // ai_assistant_used, so we can compare who edits via the drag-and-drop
        // editor vs the AI agent.
        void captureEditModeSaved({
          trip_id: trip.id,
          days_count: snapshot.length,
          activities_count: snapshot.reduce((acc, day) => acc + day.activities.length, 0),
        });
        // Show success feedback, auto-hidden after 3 seconds
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 3000);
      } catch (error) {
        console.error("Error saving changes:", error);
        setSaveError("Failed to save changes. Please try again.");
      } finally {
        setIsSaving(false);
      }
    },
    [sync, adoptSaved, setConflict, trip.id]
  );

  const handleSaveChanges = useCallback(async () => {
    if (conflictRef.current || itineraryWritesInFlight > 0) return;
    // "Done" with nothing changed: nothing to send. (It used to PATCH the
    // unchanged itinerary, which on a stale tab would now be a false 409.)
    if (!hasChanges) {
      setIsEditMode(false);
      return;
    }
    // The base is taken with the content it belongs to.
    await saveExplicit(JSON.stringify(editedItinerary), editedItinerary, sync.baseVersion());
  }, [hasChanges, editedItinerary, saveExplicit, itineraryWritesInFlight, sync]);

  // Conflict choice 1: take the version saved elsewhere, drop local changes.
  const handleLoadLatest = useCallback(() => {
    const c = conflictRef.current;
    if (!c) return;
    const fresh = ensureActivityIdsStable(c.server.itinerary, trip.id);
    sync.reset(c.server.version);
    setSavedItinerary(fresh);
    setEditedItinerary(JSON.parse(JSON.stringify(fresh)));
    pendingSaveRef.current = null;
    lastFailedSaveRef.current = null;
    // Undo snapshots predate the adopted version; replaying one would
    // silently revert the changes just loaded.
    clearHistory();
    setConflict(null);
    if (!ambientEdit) setIsEditMode(false);
    setSaveStatus("saved");
    setRenderEpoch((v) => v + 1);
    addToast(t("detail.conflictLoadedLatest"), "success");
  }, [sync, clearHistory, setConflict, ambientEdit, addToast, t]);

  // Conflict choice 2: keep my version, saved on top of the newer one (a
  // rebase: the base becomes the server's version, the content stays mine).
  const handleKeepMine = useCallback(() => {
    const c = conflictRef.current;
    if (!c) return;
    sync.reset(c.server.version);
    setSavedItinerary(ensureActivityIdsStable(c.server.itinerary, trip.id));
    setConflict(null);
    lastFailedSaveRef.current = null;
    const payload = JSON.stringify(editedItinerary);
    if (c.source === "autosave") {
      pendingSaveRef.current = payload;
      pendingEpochRef.current = sync.epoch();
      setSaveStatus("saving");
      void flushPendingSave();
    } else {
      void saveExplicit(payload, editedItinerary, c.server.version);
    }
  }, [sync, setConflict, editedItinerary, flushPendingSave, saveExplicit]);

  const handleDiscardChanges = useCallback(() => {
    // With a conflict pending, "discard" means the version saved elsewhere,
    // not this tab's stale copy.
    if (conflictRef.current) {
      handleLoadLatest();
      void captureEditModeDiscarded({ trip_id: trip.id });
      return;
    }
    // Revert to last saved state (not trip.itinerary prop, which may be stale)
    setEditedItinerary(JSON.parse(JSON.stringify(savedItinerary)));
    setIsEditMode(false);
    setSaveError(null);
    clearHistory(); // Clear undo/redo stacks
    void captureEditModeDiscarded({ trip_id: trip.id });
  }, [savedItinerary, clearHistory, trip.id, handleLoadLatest]);

  const handleEnterEditMode = useCallback(() => {
    // Start editing from the last saved state
    setEditedItinerary(JSON.parse(JSON.stringify(savedItinerary)));
    setIsEditMode(true);
    clearHistory(); // Start fresh undo/redo stacks
    // Instrument manual-editor adoption (was previously invisible in PostHog).
    void captureEditModeEntered({ trip_id: trip.id, days_count: savedItinerary.length });
  }, [savedItinerary, clearHistory, trip.id]);

  // Open propose activity modal
  const handleOpenProposeModal = useCallback((
    day: number,
    timeSlot?: 'morning' | 'afternoon' | 'evening',
    targetActivityId?: string,
    targetActivityName?: string
  ) => {
    setProposeModalState({
      isOpen: true,
      targetDay: day,
      targetTimeSlot: timeSlot,
      targetActivityId,
      targetActivityName,
    });
  }, []);

  // Close propose activity modal
  const handleCloseProposeModal = useCallback(() => {
    setProposeModalState(prev => ({ ...prev, isOpen: false }));
  }, []);

  // Get proposals for a specific day (1-indexed day number)
  const getProposalsForDay = useCallback((dayNumber: number) => {
    return proposals.filter(p => p.target_day === dayNumber - 1);
  }, [proposals]);

  // Get merged timeline of activities and proposals for a day
  // Returns items sorted chronologically, with proposals inserted at their target time slots
  type TimelineItem =
    | { type: 'activity'; data: Activity; index: number }
    | { type: 'proposal'; data: typeof proposals[number] };

  const getMergedTimeline = useCallback((dayNumber: number): TimelineItem[] => {
    const dayIndex = dayNumber - 1;
    const dayActivities = editedItinerary[dayIndex]?.activities || [];
    // Show pending, voting, AND recently approved proposals (for animation)
    const dayProposals = getProposalsForDay(dayNumber)
      .filter(p =>
        p.status === 'pending' ||
        p.status === 'voting' ||
        (p.status === 'approved' && recentlyApproved.has(p.id))
      );

    const timeline: TimelineItem[] = [];

    // Add all activities first
    dayActivities.forEach((activity, index) => {
      timeline.push({ type: 'activity', data: activity, index });
    });

    // Insert proposals at their target positions based on time slot
    dayProposals.forEach(proposal => {
      const proposedActivity = proposal.activity_data as Activity;
      const proposedTime = proposedActivity.start_time;

      // Find insert position based on time
      let insertIndex = timeline.length;
      for (let i = 0; i < timeline.length; i++) {
        const item = timeline[i];
        if (item.type === 'activity') {
          if (item.data.start_time > proposedTime) {
            insertIndex = i;
            break;
          }
        } else if (item.type === 'proposal') {
          const propActivity = item.data.activity_data as Activity;
          if (propActivity.start_time > proposedTime) {
            insertIndex = i;
            break;
          }
        }
      }

      timeline.splice(insertIndex, 0, { type: 'proposal', data: proposal });
    });

    return timeline;
  }, [editedItinerary, getProposalsForDay, proposals, recentlyApproved]);

  // Keyboard shortcuts for edit mode (Cmd+Z, Cmd+Shift+Z, Cmd+S, Escape)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!editingActive) return;

      // Don't intercept when user is typing in an input/textarea
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      const cmd = e.metaKey || e.ctrlKey;

      // Cmd+Z = Undo
      if (cmd && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      }
      // Cmd+Shift+Z = Redo
      if (cmd && e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        redo();
      }
      // Cmd+S = Save. Ambient trips auto-save, so just swallow the browser's
      // Save dialog and let the debounced auto-save own persistence — running
      // handleSaveChanges here would double-PATCH, double-count the edit metric,
      // and pop a redundant success toast next to the status pill.
      if (cmd && e.key === 's') {
        e.preventDefault();
        if (!ambientEdit && hasChanges && !isSaving && !conflict && itineraryWritesInFlight === 0) {
          handleSaveChanges();
        }
      }
      // Escape = Exit edit mode (only if no changes; no-op for ambient)
      if (e.key === 'Escape' && !hasChanges) {
        setIsEditMode(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [editingActive, ambientEdit, hasChanges, isSaving, conflict, itineraryWritesInFlight, undo, redo, handleSaveChanges]);

  // Warn user about unsaved changes when navigating away
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasChanges) {
        e.preventDefault();
        e.returnValue = ''; // Required for Chrome
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasChanges]);

  // A page restored from the client router cache (browser Back/Forward)
  // starts from the props it was first rendered with, which can be older than
  // this tab's own later saves; its first save would then be refused against
  // this person's own work. Ask the server for fresh props...
  useEffect(() => {
    const known = latestKnownVersion(trip.id);
    if (known !== null && propsVersion !== null && known > propsVersion) router.refresh();
    // Mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // ...and take newer props (content and version together, in the queue) as
  // long as nothing on the page is edited, waiting to save, or in conflict.
  useEffect(() => {
    if (propsVersion === null) return;
    const itinerary = trip.itinerary;
    void sync.enqueue(async () => {
      const base = sync.baseVersion();
      if (base === null || propsVersion <= base) return;
      if (pendingSaveRef.current || hasChangesRef.current || conflictRef.current) return;
      const fresh = ensureActivityIdsStable(itinerary, trip.id);
      sync.reset(propsVersion);
      setSavedItinerary(fresh);
      setEditedItinerary(JSON.parse(JSON.stringify(fresh)));
      clearHistory();
      setRenderEpoch((v) => v + 1);
    });
  }, [propsVersion, trip.itinerary, sync, clearHistory]);

  // Ambient auto-save (2026-07-03 moat). For solo owners there's no Save
  // button — every drag/delete/edit/add persists in the background after a
  // short debounce. Collaborative trips (ambientEdit=false) keep their
  // explicit Save via handleSaveChanges and never enter this effect.
  useEffect(() => {
    if (!ambientEdit) return;
    // In sync with the server (a save just landed, OR the user undid back to
    // the saved baseline). Nothing to persist: drop the pending marker, clear
    // any stale failed-payload guard, and reconcile the pill so it never
    // falsely lingers on "error"/"saving" once we're back in sync.
    if (!hasChanges) {
      pendingSaveRef.current = null;
      lastFailedSaveRef.current = null;
      setSaveStatus(conflictRef.current ? "conflict" : "saved");
      return;
    }
    const payload = JSON.stringify(editedItinerary);
    // Don't auto-retry a payload we already know fails — wait for a real new
    // edit (undo/redo also clears the guard so history navigation retries).
    if (payload === lastFailedSaveRef.current) return;
    pendingSaveRef.current = payload;
    // Effects run after a commit, and every epoch change is made together
    // with the content it belongs to, so this is the payload's own epoch.
    pendingEpochRef.current = sync.epoch();
    // The trip changed elsewhere: hold every save until the user chooses
    // (Load latest / Keep mine), or each would 409 again.
    if (conflictRef.current) {
      setSaveStatus("conflict");
      return;
    }
    setSaveStatus("saving");
    // Queued, never aborted: see flushPendingSave / lib/trips/itinerary-sync.ts.
    const timer = setTimeout(() => {
      void flushPendingSave();
    }, 1000);
    return () => clearTimeout(timer);
  }, [ambientEdit, hasChanges, editedItinerary, conflict, flushPendingSave, sync]);

  // Flush a pending ambient auto-save on unmount. Client-side (SPA) navigation
  // — the back-to-trips <Link>, the bottom-nav tabs — does NOT fire the
  // beforeunload guard above, so an edit made inside the 1s debounce window
  // would otherwise be silently dropped. The JS realm survives an SPA nav, so
  // the queued save completes in the background; hard document unloads are
  // still covered by the beforeunload warning. Queued behind any save in
  // flight, so the same payload is never sent twice.
  const flushRef = useRef(flushPendingSave);
  useEffect(() => {
    flushRef.current = flushPendingSave;
  }, [flushPendingSave]);
  useEffect(() => {
    return () => {
      void flushRef.current();
    };
  }, []);

  // Handle AI assistant suggested actions
  const handleAIAction = useCallback(
    (action: string, data?: Record<string, unknown>) => {
      // A proposal still waiting for Apply changes nothing here. Acting on it
      // deleted a proposed removal before it was confirmed: an ambient owner's
      // autosave stored it at once, and an editor's page went into edit mode
      // with an unsaved deletion that then blocked Apply. The confirmed change
      // arrives through handleRefetchTrip.
      if (data?.pending === true) return;

      // For actions that were already applied by the AI (replace_activity, add_activity),
      // the refetch has already updated the itinerary - don't overwrite it!
      const actionWasApplied = data?.applied === true;

      // Only enter edit mode and reset itinerary for non-applied actions.
      // Ambient trips are ALWAYS editing (no mode) and their editedItinerary
      // is the live source of truth — resetting it to the SSR prop would wipe
      // unsaved local edits, so skip this branch entirely for them.
      if (!actionWasApplied && !isEditMode && !ambientEdit) {
        // From the last SAVED copy, not the page's first render: that one is
        // stale after any save, and editing from it silently reverted them.
        setEditedItinerary(JSON.parse(JSON.stringify(savedItinerary)));
        setIsEditMode(true);
      }

      // Handle different action types
      switch (action) {
        case "replace_activity":
        case "add_activity":
          // These are already handled by onRefetchTrip - just log for debugging
          console.log("AI action (already applied via refetch):", action, data);
          break;
        case "remove_activity":
          if (data?.activityId) {
            handleActivityDelete(data.activityId as string);
          }
          break;
        case "move_activity":
          if (data?.activityId && data?.direction) {
            handleActivityMove(data.activityId as string, data.direction as "up" | "down");
          }
          break;
        case "reorder_day":
          // Suggest reordering - user can then manually reorder
          console.log("AI suggested reordering day:", data);
          break;
        case "optimize_budget":
          // Show budget optimization suggestions
          console.log("AI suggested budget optimization:", data);
          break;
        case "regenerate_activity":
          if (data?.activityId && data?.dayIndex !== undefined) {
            handleActivityRegenerate(data.activityId as string, data.dayIndex as number);
          }
          break;
        case "suggest_activity":
        default:
          // General suggestion - user can act on it manually
          console.log("AI suggestion:", action, data);
          break;
      }
    },
    [isEditMode, ambientEdit, savedItinerary, handleActivityDelete, handleActivityMove, handleActivityRegenerate]
  );

  // (handleItineraryUpdate was removed 2026-09-24: it adopted an itinerary
  // with no version, and nothing called it. Changes from the assistant reach
  // the page through handleRefetchTrip, inside the save queue.)

  // Refetch trip data from the database (called after AI modifications)
  // Resolves true when the stored copy was taken. With onlyIfUnedited it is
  // not taken if an edit arrived while reading (a regenerate's re-read must
  // not drop it).
  const handleRefetchTrip = useCallback(async (options?: { onlyIfUnedited?: boolean }): Promise<boolean> => {
    console.log("[TripDetailClient] Refetching trip data from database...");
    try {
      // The write before this already landed: without this read the page
      // keeps an older copy and version, and its next save is refused against
      // this person's own change. One retry for a blip.
      const read = () =>
        fetch(`/api/trips/${trip.id}`, {
          cache: 'no-store', // Ensure we get fresh data
          headers: {
            'Cache-Control': 'no-cache',
          },
        });
      let response = await read().catch(() => null);
      if (!response?.ok) {
        await new Promise((resolve) => setTimeout(resolve, 800));
        response = await read();
      }
      if (!response.ok) {
        throw new Error(`Failed to fetch trip: ${response.status}`);
      }
      const data = await response.json();
      console.log("[TripDetailClient] Trip data fetched successfully:", {
        tripId: data.trip?.id,
        itineraryDays: data.trip?.itinerary?.length,
        firstDayActivities: data.trip?.itinerary?.[0]?.activities?.map((a: Activity) => a.name),
      });

      if (data.trip?.itinerary) {
        if (options?.onlyIfUnedited && (pendingSaveRef.current !== null || hasChangesRef.current)) return false;
        // Deep clone to ensure we're working with fresh data
        const freshItinerary = JSON.parse(JSON.stringify(data.trip.itinerary));
        const processedItinerary = ensureActivityIdsStable(freshItinerary, trip.id);

        console.log("[TripDetailClient] Processed itinerary:", {
          days: processedItinerary.length,
          day1Activities: processedItinerary[0]?.activities?.map((a: Activity) => a.name),
        });

        // Find changed activities for animation
        for (let dayIdx = 0; dayIdx < processedItinerary.length; dayIdx++) {
          const newDay = processedItinerary[dayIdx];
          const oldDay = editedItinerary[dayIdx];
          if (newDay && oldDay) {
            // Check if activity count changed (added activity)
            if (newDay.activities.length !== oldDay.activities.length) {
              // Find the new activity
              for (const act of newDay.activities) {
                const exists = oldDay.activities.some((a: Activity) => a.id === act.id || a.name === act.name);
                if (!exists) {
                  console.log("[TripDetailClient] Found new activity:", act.name);
                  aiUpdateRef.current = { dayIndex: dayIdx, activityId: act.id || "" };
                  break;
                }
              }
            } else {
              // Check for replaced activity
              for (let actIdx = 0; actIdx < newDay.activities.length; actIdx++) {
                const newAct = newDay.activities[actIdx];
                const oldAct = oldDay.activities[actIdx];
                if (oldAct && newAct.name !== oldAct.name) {
                  console.log("[TripDetailClient] Found replaced activity:", oldAct.name, "->", newAct.name);
                  aiUpdateRef.current = { dayIndex: dayIdx, activityId: newAct.id || "" };
                  break;
                }
              }
            }
          }
        }

        // Force update by creating new array reference
        console.log("[TripDetailClient] Updating state with new itinerary...");
        const freshCopy = [...processedItinerary];
        // The change is already stored (assistant apply/undo, add from email):
        // this copy IS the saved one, at the version it was read with, in both
        // modes. (Legacy mode used to keep savedItinerary stale and reopen the
        // editor so the user "confirmed" a change that was already saved.)
        // Runs only inside runItineraryWrite, so nothing else writes between
        // the server write and this read.
        const version = readItineraryVersion(data.trip?.itinerary_version);
        if (version !== null) sync.reset(version);
        setEditedItinerary(freshCopy);
        setSavedItinerary(JSON.parse(JSON.stringify(freshCopy)));
        pendingSaveRef.current = null;
        lastFailedSaveRef.current = null;
        if (conflictRef.current) setConflict(null);
        // Undo snapshots predate this copy (which may hold a trip mate's
        // changes too): replaying one would pass the version check and revert them.
        clearHistory();
        setRenderEpoch((v) => {
          const newVersion = v + 1;
          console.log("[TripDetailClient] Itinerary version bumped to:", newVersion);
          return newVersion;
        });

        // Clear the AI update ref after animation time
        setTimeout(() => {
          aiUpdateRef.current = null;
        }, 2000);

        console.log("[TripDetailClient] State update complete - UI should re-render now");
        return true;
      } else {
        console.error("[TripDetailClient] No itinerary in response:", data);
        return false;
      }
    } catch (error) {
      console.error("[TripDetailClient] Failed to refetch trip:", error);
      throw error;
    }
  }, [trip.id, editedItinerary, sync, setConflict, clearHistory]);
  useEffect(() => {
    refetchTripRef.current = handleRefetchTrip;
  }, [handleRefetchTrip]);

  // APPLY → SEE loop (transcripts: "I don't see the updates on the webpage" /
  // "where to see the updated version?"): after the AI assistant applies a
  // change — or when the user taps the action badge in the chat — scroll the
  // affected day card into view and flash-highlight it for ~2s so the change
  // has a visible anchor in the plan.
  const [aiFocusDay, setAiFocusDay] = useState<{ day: number; pulse: boolean } | null>(null);
  const aiFocusTimerRef = useRef<number | null>(null);
  const handleFocusDayCard = useCallback((dayNumber: number) => {
    if (typeof window === "undefined") return;
    // A day filter would hide the target card entirely — clear it first.
    setSelectedDay((prev) => (prev !== null && prev !== dayNumber ? null : prev));
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Below lg the assistant is an 85vh bottom sheet that fully covers the
    // plan — close it, otherwise "scroll into view" is invisible (the exact
    // mobile complaint in the transcripts). On lg+ it's a 420px side panel,
    // so the plan stays visible and the chat stays open.
    if (window.innerWidth < 1024) {
      setIsAIAssistantOpen(false);
    }
    setAiFocusDay({ day: dayNumber, pulse: !reduceMotion });
    window.setTimeout(() => {
      document.getElementById(`trip-day-${dayNumber}`)?.scrollIntoView({
        // prefers-reduced-motion: jump without animation, keep the highlight.
        behavior: reduceMotion ? "auto" : "smooth",
        block: "start",
      });
    }, 100); // let a just-refetched itinerary (version-keyed remount) commit first
    if (aiFocusTimerRef.current !== null) window.clearTimeout(aiFocusTimerRef.current);
    aiFocusTimerRef.current = window.setTimeout(() => setAiFocusDay(null), 2200);
  }, []);

  // ── Moving activities between days ──────────────────────────────────────
  // Two ways in, one commit: drag a card across days (live preview, committed
  // on drop) or pick a day in the card's "Move to another day" sheet. Both
  // recalculate the times of the source and destination days, push a single
  // undo entry, scroll to and flash the destination day, and confirm with a
  // toast that offers Undo — the visible undo mobile never had.
  const firstModificationRef = useRef(true);

  // The toast's Undo fires seconds after the move, from a callback created
  // BEFORE pushUndo/setEditedItinerary landed — so a captured `undo` would
  // close over the stack without the move and undo nothing. Always call the
  // latest one.
  const undoRef = useRef(undo);
  useEffect(() => {
    undoRef.current = undo;
  }, [undo]);

  const commitMove = useCallback(
    (
      next: ItineraryDay[],
      activityId: string,
      sourceDayIndex: number,
      targetDayIndex: number,
      method: "drag" | "menu",
    ) => {
      const targetDayNumber = next[targetDayIndex]?.day_number ?? targetDayIndex + 1;
      const sourceDayNumber = next[sourceDayIndex]?.day_number ?? sourceDayIndex + 1;
      pushUndo(`Move activity to day ${targetDayNumber}`);
      const withSourceTimes = recalculateActivityTimes(next, sourceDayIndex);
      setEditedItinerary(recalculateActivityTimes(withSourceTimes, targetDayIndex));
      hapticSelection();
      handleFocusDayCard(targetDayNumber);
      addToast(t("editActivity.movedToDay", { day: targetDayNumber }), "success", 6000, {
        label: t("detail.undo"),
        onClick: () => undoRef.current(),
      });
      captureActivityModified({
        trip_id: trip.id,
        activity_id: activityId,
        modification_type: "move_day",
        is_first_modification: firstModificationRef.current,
        day_number: targetDayNumber,
        from_day_number: sourceDayNumber,
        method,
      });
      firstModificationRef.current = false;
    },
    [pushUndo, handleFocusDayCard, addToast, t, trip.id],
  );

  // The sheet path: land in the chronological slot of the chosen day, so a
  // morning activity stays a morning activity.
  const handleActivityMoveToDay = useCallback(
    (activityId: string, targetDayIndex: number) => {
      const location = findActivityById(editedItinerary, activityId);
      if (!location || location.dayIndex === targetDayIndex) return;
      const moved = moveActivityToDay(editedItinerary, activityId, targetDayIndex, "auto");
      if (moved === editedItinerary) return;
      commitMove(moved, activityId, location.dayIndex, targetDayIndex, "menu");
    },
    [editedItinerary, commitMove],
  );

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      dragStartRef.current = editedItinerary;
      setDragPreview(editedItinerary);
      setActiveDragId(String(event.active.id));
      hapticSelection();
    },
    [editedItinerary],
  );

  // Cross-day steps are applied to the preview as the card is dragged over
  // another day, so its cards part to make room. Within the card's own day,
  // dnd-kit's sortable strategy already animates the reorder; the final
  // order is committed once, on drop.
  const handleDragOver = useCallback((event: DragOverEvent) => {
    const { active, over } = event;
    if (!over) return;
    const activeId = String(active.id);
    const activeTop = active.rect.current.translated?.top;
    const after = activeTop !== undefined && over.rect ? activeTop > over.rect.top + over.rect.height / 2 : false;
    setDragPreview((prev) => {
      if (!prev || isSameDayTarget(prev, activeId, over.id)) return prev;
      return applyMove(prev, activeId, over.id, { after });
    });
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      const start = dragStartRef.current;
      const preview = dragPreview;
      dragStartRef.current = null;
      setDragPreview(null);
      setActiveDragId(null);
      if (!start || !preview) return;

      const activeId = String(active.id);
      const settled = over ? applyMove(preview, activeId, over.id) : preview;
      const move = describeMove(start, settled, activeId);
      const from = locateActivity(start, activeId);
      const to = locateActivity(settled, activeId);
      if (!move || !from || !to) return;

      if (move.crossedDays) {
        commitMove(settled, activeId, move.sourceDayIndex, move.targetDayIndex, "drag");
        return;
      }
      if (from.index === to.index) return; // dropped where it started

      pushUndo("Reorder activities");
      setEditedItinerary(recalculateActivityTimes(settled, move.targetDayIndex));
      hapticSelection();
    },
    [dragPreview, commitMove, pushUndo],
  );

  const handleDragCancel = useCallback(() => {
    dragStartRef.current = null;
    setDragPreview(null);
    setActiveDragId(null);
  }, []);

  // The card the DragOverlay ghost shows while dragging.
  const activeDragActivity = useMemo(() => {
    if (!activeDragId) return null;
    const source = dragPreview ?? editedItinerary;
    const loc = locateActivity(source, activeDragId);
    return loc ? source[loc.dayIndex].activities[loc.index] : null;
  }, [activeDragId, dragPreview, editedItinerary]);

  // Memoize ensureActivityIds to prevent generating new UUIDs on every render
  // This is CRITICAL - without memoization, new IDs are generated each render,
  // causing itineraryHash to change, triggering useTravelDistances to refetch,
  // which causes state updates and re-renders = infinite loop
  //
  // Trust-loop fix (transcripts: "I don't see the updates on the webpage"):
  // outside edit mode this previously rendered ensureActivityIds(trip.itinerary)
  // — the SSR-time prop — so an AI-applied edit VANISHED from the page the
  // moment the user hit Save/Done (edit mode exits but the server prop never
  // updates client-side). savedItinerary is seeded from that same prop, is a
  // stable state reference (so the memo concern above still holds), and is
  // updated on every successful save — render that instead.
  const displayItinerary = editingActive ? editedItinerary : savedItinerary;

  // Fetch travel distances between activities
  // Uses local Haversine calculation - NO external API calls!
  // Cached results from trip_meta are used if available and hash matches
  const { travelData, isLoading: travelLoading } = useTravelDistances(displayItinerary, {
    // tripId turns on persisting the cache, which /travel-cache allows only
    // for the owner. Distances are computed locally either way; a
    // collaborator's reorder is cached on the owner's next visit.
    tripId: isOwner ? trip.id : undefined,
    cachedTravelData: trip.cachedTravelDistances,
    cachedHash: trip.cachedTravelHash,
  });

  const statusColors = {
    planning: "bg-amber-100 text-amber-700",
    confirmed: "bg-green-100 text-green-700",
    active: "bg-blue-100 text-blue-700",
    completed: "bg-purple-100 text-purple-700",
    cancelled: "bg-red-100 text-red-700",
  };

  // Get translated status label
  const getStatusLabel = (status: string) => {
    if (status === "completed") return tTrips("memories");
    if (status === "active") return tTrips("active"); // "Ongoing"
    return tTrips(status as "planning" | "confirmed" | "cancelled");
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-white">
      {/* Hero with Cover Image - Enhanced with weather and stats */}
      <DestinationHero
        destination={destination}
        title={trip.title}
        subtitle={trip.description}
        dateRange={dateRange}
        budget={trip.budget || undefined}
        days={trip.itinerary.length}
        nights={(() => {
          const start = new Date(trip.startDate);
          const end = new Date(trip.endDate);
          return Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
        })()}
        activitiesCount={displayItinerary.reduce((acc, day) => acc + day.activities.length, 0)}
        weatherNote={trip.meta?.weather_note}
        highlights={trip.meta?.highlights}
        tags={trip.tags}
        showBackButton={true}
        onBack={() => window.history.back()}
        coverImageUrl={coverImageUrl}
        // When the trip has a persisted cover URL, skip the Places API
        // entirely. Without one, allow ONE fetch + persist it via the
        // callback below so subsequent visits read straight from the DB.
        // This was the gradient-on-old-trips bug — pre-#188 trips had
        // null cover_image_url and the previous unconditional
        // disableApiCalls=true left them looking forever broken.
        disableApiCalls={!!coverImageUrl}
        onCoverImageFetched={handleCoverImageFetched}
      >
        {/* Status Badge + Backpacker badge stack — top-right of hero.
            Phase B2 (2026-05-28): Backpacker badge renders for trips
            generated in Backpacker Mode. Visible signal for partner
            demos + a self-evident "this is what backpacker mode looks
            like" cue for the trip owner. */}
        <div className="absolute top-4 right-4 flex flex-col items-end gap-2">
          <span
            className={`px-3 py-1.5 rounded-full text-sm font-medium shadow-lg ${
              statusColors[currentStatus as keyof typeof statusColors] || statusColors.planning
            }`}
          >
            {getStatusLabel(currentStatus)}
          </span>
          {trip.meta?.travel_style === "backpacker" && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium shadow-lg bg-emerald-500 text-white">
              <span aria-hidden>🎒</span>
              Backpacker route
            </span>
          )}
        </div>
      </DestinationHero>

      {/*
        On lg+ the assistant is a 420px panel docked to the right. Make room
        for it instead of letting it cover the plan: a right margin equal to
        the panel width lets the content column shrink (or slide left on wide
        screens) so the cards' actions, prices and drag handles stay reachable
        while the chat is open.
      */}
      <main
        className={`max-w-6xl mx-auto px-4 py-6 sm:py-8 transition-[margin] duration-300 ease-out ${
          isAIAssistantOpen ? "lg:mr-[420px]" : ""
        }`}
      >
        {/* Live Trip Phase 2.4: who said they're going — count, names, join
            times, remove. The share ask is "send it to the people coming",
            not "get votes". */}
        {isOwner && participantsEnabled && !isEditMode && (
          <WhoIsGoingCard tripId={trip.id} onShare={openCrewShareModal} className="mb-6" />
        )}
        {/* Backpacker Mode — Hostelworld CTA. Renders only when the
            trip was generated as backpacker (trip_meta.travel_style).
            Placed above the engagement bar so it's the first thing
            the owner sees on a backpacker trip — that's the surface
            we want CTR on for the Hostelworld partnership signal. */}
        {trip.meta?.travel_style === "backpacker" && (
          <BackpackerHostelCta
            tripId={trip.id}
            destination={destination}
            startDate={trip.startDate}
            endDate={trip.endDate}
            className="mb-6"
          />
        )}

        {/* /explore Week 3 (2026-05-25): owner-side engagement bar +
            Publish-to-Explore toggle. Null when the explore flag is
            off. Sits at the top of <main> so the owner sees their
            counts + publish state immediately on page load. */}
        {engagementSlot && (
          <div className="mb-6 flex items-center gap-3">
            {engagementSlot}
          </div>
        )}

        {/* Planning Phase - Confirm Trip Action. Owner only: confirming or
            cancelling is the trip's lifecycle, and PATCH /status admits only
            the owner, so a collaborator's click was a silent 404. */}
        {currentStatus === "planning" && isOwner && (
          <div className="mb-6 bg-gradient-to-r from-amber-50 to-orange-50 rounded-2xl p-6 border border-amber-200">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
                  <svg className="w-6 h-6 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <h3 className="font-bold text-slate-900">{tTrips("readyToConfirm")}</h3>
                  <p className="text-sm text-slate-600 mt-1">
                    {tTrips("confirmTripDescription")}
                  </p>
                </div>
              </div>
              <div className="flex gap-3 w-full sm:w-auto">
                {/* Said "Cancel" and cancelled the trip in one click (it read
                    like "dismiss"), with no way back in the app. */}
                <button
                  onClick={() => setConfirmCancelTrip(true)}
                  disabled={isUpdatingStatus}
                  className="flex-1 sm:flex-none px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-medium hover:bg-slate-50 transition-colors disabled:opacity-50"
                >
                  {tTrips("cancelTrip")}
                </button>
                <button
                  onClick={() => handleStatusUpdate("confirmed")}
                  disabled={isUpdatingStatus}
                  className="flex-1 sm:flex-none px-6 py-2.5 rounded-xl bg-green-600 text-white font-medium hover:bg-green-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isUpdatingStatus ? (
                    <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                  ) : (
                    <>
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      {tTrips("confirmTrip")}
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* A cancelled trip can come back (the API always allowed it; the
            page had no control for it). */}
        {currentStatus === "cancelled" && isOwner && (
          <div className="mb-6 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-slate-700">{t('detail.cancelTrip.cancelledNote')}</p>
            <button
              type="button"
              onClick={() => handleStatusUpdate("planning")}
              disabled={isUpdatingStatus}
              className="flex-shrink-0 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-100 disabled:opacity-50"
            >
              {tTrips("restoreTrip")}
            </button>
          </div>
        )}

        {/* In-trip Concierge (F4 / task #242, edit channel P2 2026-08-16).
            Rendered in EVERY phase — before P2 it lived inside the
            !isActiveTripPhase branch, i.e. the one chat that vanished
            exactly while the user was ON the trip. Flag-gated; renders
            null when the env flag is off. Owner-only apply: /apply is
            owner-scoped server-side, canEdit only gates the UI. */}
        <div className="mb-4 space-y-2">
          <TripConciergeChat
            tripId={trip.id}
            canEdit={isOwner}
            runItineraryWrite={runItineraryWrite}
            onItineraryChange={(next, serverVersion) => {
              // The /apply endpoint already persisted this itinerary —
              // adopt it as BOTH edited and saved state, with the version it
              // was written at (runs inside the save queue), so the ambient
              // auto-save doesn't immediately re-PATCH an identical body.
              const withIds = ensureActivityIdsStable(next, trip.id);
              if (serverVersion != null) sync.reset(serverVersion);
              setEditedItinerary(withIds);
              setSavedItinerary(JSON.parse(JSON.stringify(withIds)));
              if (conflictRef.current) setConflict(null);
              // As in handleRefetchTrip: older undo snapshots would revert it.
              clearHistory();
              setRenderEpoch((v) => v + 1);
            }}
          />
          {/* Past Q+A pairs for THIS trip (david-cassoni follow-up).
              Lazy expand-to-fetch; renders nothing when the Concierge
              env-flag is off. */}
          <ConciergeHistory tripId={trip.id} />
        </div>

        {/* Pre-Trip Phase - Countdown Hero and Checklist */}
        {isPreTripPhase && (
          <div className="space-y-4 mb-6">
            {/* coverImageUrl is passed deliberately: CountdownHero renders a
                full-bleed photo when it has one and a flat gradient when it
                does not, and this call site was omitting it - so the most
                screenshot-shaped surface in the product was shipping as a
                coral rectangle while 184 of the 208 trips that reach it have
                a cover photo.

                weatherForecast is still NOT passed. The component wants
                {temp, condition, icon}, but /api/weather returns HISTORICAL
                seasonal averages (30-day cache, "historical weather data
                doesn't change"), not a forecast. Labelling a 20-year average
                as the forecast for someone's trip would be a lie in the one
                place they are most likely to screenshot. Needs a real
                forecast source before it can be wired. */}
            <CountdownHero
              destination={destination}
              startDate={tripStartDate}
              tripDays={tripDaysCount}
              activitiesCount={totalActivities}
              coverImageUrl={coverImageUrl ?? undefined}
            />
            {isOwner && (
              <PreTripChecklist
                items={checklist.items}
                onToggle={checklist.toggleItem}
                onAdd={checklist.addItem}
                onDelete={checklist.deleteItem}
                isLoading={checklist.isLoading}
              />
            )}
          </div>
        )}

        {/* Active Trip Phase - Ongoing Trip View with Gamification */}
        {isActiveTripPhase && (
          <OngoingTripView
            tripId={trip.id}
            destination={destination}
            startDate={trip.startDate}
            endDate={trip.endDate}
            itinerary={editedItinerary}
            meta={trip.meta}
            budget={trip.budget}
            cachedTravelDistances={trip.cachedTravelDistances}
            cachedTravelHash={trip.cachedTravelHash}
          />
        )}

        {/* Activity Rating Modal */}
        <ActivityRatingModal
          isOpen={!!ratingModalActivity}
          onClose={() => setRatingModalActivity(null)}
          activityName={ratingModalActivity?.name || ""}
          activityImage={ratingModalActivity?.image_url}
          onSubmit={async (data) => {
            if (ratingModalActivity) {
              await activityTimeline.rateActivity(
                ratingModalActivity.id,
                ratingModalActivity.dayNumber,
                data.rating,
                data.notes,
                data.quickTags
              );
            }
          }}
        />

        {/* Propose Activity Modal - Collaborative Trips */}
        {votingEnabled && (
          <ProposeActivitySheet
            isOpen={proposeModalState.isOpen}
            onClose={handleCloseProposeModal}
            tripId={trip.id}
            destination={destination}
            targetDay={proposeModalState.targetDay}
            targetTimeSlot={proposeModalState.targetTimeSlot}
            targetActivityId={proposeModalState.targetActivityId}
            targetActivityName={proposeModalState.targetActivityName}
            onPropose={async (input) => {
              await createProposal(input);
              addToast(
                "🗳️ Proposal submitted! Other travelers will vote on it.",
                "success",
                4000
              );
            }}
          />
        )}

        {/* Planning/Confirmed Phase - Full Itinerary View */}
        {!isActiveTripPhase && (
          <>
        {/* Travel advisory banner — sourced from UK FCDO (task #222).
            Hides itself entirely when the destination has no active alert,
            so it never adds visual noise to safe-destination trips. */}
        <TravelAdvisoryBanner country={destination} className="mb-4" />

        {/* Multi-city Journey ribbon with P4 transit labels ("TRENO · 4h") */}
        {journeyStops.length > 1 && (
          <JourneyRibbon stops={journeyStops} className="mb-4" />
        )}

        {/* Controls Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 sm:gap-4 mb-6">
          {/* Left side - Back button */}
          <div className="flex items-center gap-2">
            <Link
              href="/trips"
              className="flex items-center gap-1 sm:gap-2 text-slate-600 hover:text-slate-900 px-2 sm:px-3 py-2 rounded-lg hover:bg-slate-100 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              <span className="hidden sm:inline">{t('detail.backToTrips')}</span>
            </Link>
          </div>

          {/* Right side - Controls */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* View Mode Toggle - Hidden on mobile */}
            <div
              className="hidden sm:flex items-center bg-slate-100 rounded-lg p-1"
              role="tablist"
              aria-label={t('detail.viewToggle')}
            >
              <button
                type="button"
                role="tab"
                aria-selected={viewMode === "cards"}
                tabIndex={viewMode === "cards" ? 0 : -1}
                onClick={() => setViewMode("cards")}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  viewMode === "cards"
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {t('detail.cards')}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={viewMode === "timeline"}
                tabIndex={viewMode === "timeline" ? 0 : -1}
                onClick={() => setViewMode("timeline")}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  viewMode === "timeline"
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {t('detail.timeline')}
              </button>
            </div>

            {/* Map Toggle - Icon only on mobile */}
            <button
              onClick={() => setShowMap(!showMap)}
              className={`flex items-center gap-2 p-2 sm:px-3 sm:py-2 rounded-lg text-sm font-medium transition-colors ${
                showMap
                  ? "bg-[var(--primary)] text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
              title={showMap ? t('detail.hideMap') : t('detail.showMap')}
            >
              <svg className="w-5 h-5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
              </svg>
              <span className="hidden sm:inline">{showMap ? t('detail.hideMap') : t('detail.showMap')}</span>
            </button>

            {/* Share Button.
                Crew Loop: the key remounts ShareButton whenever a crew
                banner button fires (crewShareRequest++), so its mount-time
                autoOpen/initialTab props — the exact mechanism the
                ?share=invite deep link uses — re-trigger with the SHARE tab,
                without modifying ShareButton itself. */}
            {!isEditMode && (
              <ShareButton
                key={`share-${crewShareRequest}`}
                tripId={trip.id}
                tripTitle={trip.title}
                tripIntent={trip.meta?.trip_intent}
                canManageSharing={isOwner}
                autoOpen={shouldAutoOpenShareModal || crewShareRequest > 0}
                initialTab={
                  crewShareRequest > 0
                    ? "share"
                    : shouldAutoOpenShareModal
                      ? "invite"
                      : "share"
                }
              />
            )}

            {/* Edit with AI — the primary edit path surfaced (the assistant is
                the killer feature). Opens the same AIAssistant the floating
                trigger does. Phase 5.4. */}
            {!isEditMode && canUseAssistant && (
              <button
                onClick={() => setIsAIAssistantOpen(true)}
                className="flex items-center gap-2 p-2 sm:px-3 sm:py-2 rounded-lg text-sm font-medium bg-[var(--accent)] text-slate-900 hover:bg-[var(--accent)]/90 transition-colors"
                title={t('detail.editWithAi')}
              >
                <Sparkles className="w-5 h-5 sm:w-4 sm:h-4" aria-hidden="true" />
                <span className="hidden sm:inline">{t('detail.editWithAi')}</span>
              </button>
            )}

            {/* More — the trip-detail diet (Phase 5.4): the secondary export
                utilities collapse into one ⋯ menu so the bar reads
                Share · Edit with AI · More. Each keeps its own component. */}
            {!isEditMode && (
              <TripActionsMenu label={t('detail.more')}>
                <TripActionsMenuSlot>
                  <ExportMenu
                    trip={{
                      title: trip.title,
                      description: trip.description,
                      startDate: trip.startDate,
                      endDate: trip.endDate,
                      budget: trip.budget,
                      itinerary: displayItinerary,
                    }}
                    destination={destination}
                    meta={trip.meta}
                  />
                </TripActionsMenuSlot>

                {/* Add to Calendar (.ics). Self-gates on the calendar flag —
                    renders nothing when off, so the slot is safe unconditionally. */}
                <TripActionsMenuSlot>
                  <DownloadIcsButton tripId={trip.id} showSubtext={false} />
                </TripActionsMenuSlot>

                {/* Add from email (paste booking → Gemini parse). Flag-gated. */}
                {emailParseEnabled && (
                  <TripActionsMenuItem
                    onClick={() => setIsPasteBookingOpen(true)}
                    icon={
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                      </svg>
                    }
                  >
                    {tCommon('addFromEmail.button')}
                  </TripActionsMenuItem>
                )}
              </TripActionsMenu>
            )}

            {/* Editing controls. Ambient (solo) owners edit inline with
                auto-save — no mode toggle, just undo/redo + a status pill.
                Collaborative/active trips keep the classic Modifica flow. */}
            {ambientEdit ? (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={undo}
                  disabled={undoStack.length === 0}
                  aria-label={t('detail.undo')}
                  title={t('detail.undo')}
                  className="p-2 rounded-lg text-slate-600 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <Undo2 className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={redo}
                  disabled={redoStack.length === 0}
                  aria-label={t('detail.redo')}
                  title={t('detail.redo')}
                  className="p-2 rounded-lg text-slate-600 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <Redo2 className="w-4 h-4" />
                </button>
                {/* Auto-save status pill. On error it becomes a retry button —
                    clearing the failed-payload guard and nudging editedItinerary
                    re-triggers the debounced save effect. */}
                <button
                  type="button"
                  onClick={
                    saveStatus === "error"
                      ? () => {
                          lastFailedSaveRef.current = null;
                          setEditedItinerary((prev) => [...prev]);
                        }
                      : undefined
                  }
                  disabled={saveStatus !== "error"}
                  aria-live="polite"
                  title={saveStatus === "error" ? t('detail.saveFailed') : undefined}
                  className={`hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    saveStatus === "error"
                      ? "bg-red-50 text-red-700 hover:bg-red-100 cursor-pointer"
                      : saveStatus === "conflict"
                        ? "bg-amber-50 text-amber-800"
                        : saveStatus === "saving"
                          ? "bg-slate-100 text-slate-500"
                          : "bg-emerald-50 text-emerald-700"
                  }`}
                >
                  {saveStatus === "conflict" ? (
                    // The choice itself is in the conflict banner.
                    <>
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M5.07 19h13.86a2 2 0 001.71-3l-6.93-12a2 2 0 00-3.42 0l-6.93 12a2 2 0 001.71 3z" />
                      </svg>
                      <span>{t('detail.conflictPill')}</span>
                    </>
                  ) : saveStatus === "saving" ? (
                    <>
                      <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      <span>{t('detail.saving')}</span>
                    </>
                  ) : saveStatus === "error" ? (
                    <>
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M5.07 19h13.86a2 2 0 001.71-3l-6.93-12a2 2 0 00-3.42 0l-6.93 12a2 2 0 001.71 3z" />
                      </svg>
                      <span>{t('detail.saveFailed')}</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      <span>{t('detail.allChangesSaved')}</span>
                    </>
                  )}
                </button>
              </div>
            ) : !isEditMode && !canEdit ? (
              // Voters and viewers get no edit entry point: PATCH admits the
              // owner and editors only, so their Save would be refused.
              null
            ) : !isEditMode ? (
              <button
                onClick={handleEnterEditMode}
                className="flex items-center gap-2 p-2 sm:px-3 sm:py-2 rounded-lg text-sm font-medium bg-[var(--accent)] text-slate-900 hover:bg-[var(--accent)]/90 transition-colors"
                title={t('detail.editTrip')}
              >
                <svg className="w-5 h-5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
                <span className="hidden sm:inline">{t('detail.editTrip')}</span>
              </button>
            ) : (
              <div className="flex items-center gap-2">
                {/* Cancel/Discard button */}
                <button
                  onClick={handleDiscardChanges}
                  disabled={isSaving}
                  className="flex items-center gap-1.5 p-2 sm:px-3 sm:py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-50"
                  title={t('detail.discardChanges')}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  <span className="hidden sm:inline">{t('detail.cancel')}</span>
                </button>
                {/* Save & Close button - Primary action */}
                <button
                  onClick={handleSaveChanges}
                  disabled={isSaving || itineraryWritesInFlight > 0}
                  className={`flex items-center gap-2 p-2 sm:px-4 sm:py-2 rounded-lg text-sm font-medium transition-all ${
                    hasChanges
                      ? 'bg-green-600 text-white hover:bg-green-700 shadow-lg shadow-green-600/25 animate-pulse-subtle'
                      : 'bg-green-600 text-white hover:bg-green-700'
                  } disabled:opacity-50`}
                  title={hasChanges ? t('detail.saveChanges') : t('detail.doneEditing')}
                >
                  {isSaving ? (
                    <>
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      <span className="hidden sm:inline">{t('detail.saving')}</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      <span className="hidden sm:inline">
                        {hasChanges ? t('detail.saveChanges') : t('detail.doneEditing')}
                      </span>
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Ambient-edit hint — one subtle line telling solo owners the plan
            is directly editable and saves itself. This is the whole point of
            the moat: making the (previously hidden) manual editor discoverable. */}
        {ambientEdit && displayItinerary.length > 0 && (
          <p className="-mt-2 mb-6 flex items-center gap-1.5 text-xs text-slate-500">
            <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
            </svg>
            {t('detail.ambientEditHint')}
          </p>
        )}

        {/* Post-Confirmation Banner - eSIM, Flight Compensation */}
        {BOOKINGS_ENABLED && (
          <PostConfirmationBanner
            destination={destination}
            tripId={trip.id}
            tripStatus={currentStatus as "planning" | "confirmed" | "active" | "completed"}
            className="mb-8"
          />
        )}

        {/* Booking Drawer - Flight origin collection */}
        <BookingDrawer
          isOpen={isBookingDrawerOpen}
          onClose={() => setIsBookingDrawerOpen(false)}
          destination={destination}
          startDate={trip.startDate}
          endDate={trip.endDate}
          travelers={collaboratorCount || 2}
          tripId={trip.id}
        />

        {/* Paste Booking Modal — "Add from email" flow. Mount only
            when the flag is on AND the user has opened it (lazy chunk
            already deferred via next/dynamic + ssr:false). Refresh
            on success so the new activity shows up in the itinerary. */}
        {emailParseEnabled && isPasteBookingOpen && (
          <PasteBookingModal
            tripId={trip.id}
            isOpen={isPasteBookingOpen}
            onClose={() => setIsPasteBookingOpen(false)}
            runItineraryWrite={runItineraryWrite}
            onBookingAdded={() => {
              // Re-pull the trip from the server — same hook the AI
              // assistant uses after autonomous edits. Keeps the
              // itinerary state in sync without a hard page reload.
              // Returned so the modal awaits it inside the save queue.
              return handleRefetchTrip().then(
                () => undefined,
                (err) => {
                  console.error("[PasteBookingModal] Refetch failed:", err);
                }
              );
            }}
          />
        )}

        {/* Interactive Map - First */}
        {showMap && displayItinerary.length > 0 && (
          <div className="mb-8">
            <TripMap
              days={displayItinerary}
              destination={destination}
              selectedDay={selectedDay}
              className="h-[400px]"
              disableApiCalls={true}
            />
          </div>
        )}

        {/* Affiliate Booking Panel - After Map (hidden behind BOOKINGS_ENABLED) */}
        {BOOKINGS_ENABLED &&
          (useEnhancedBooking ? (
            <EnhancedBookingPanel
              tripId={trip.id}
              destination={destination}
              startDate={trip.startDate}
              endDate={trip.endDate}
              travelers={collaboratorCount || 2}
              onSetOrigin={() => setIsBookingDrawerOpen(true)}
              className="mb-8"
            />
          ) : (
            <BookingPanel
              tripId={trip.id}
              destination={destination}
              startDate={trip.startDate}
              endDate={trip.endDate}
              travelers={collaboratorCount || 2}
              className="mb-8"
            />
          ))}

        {/* Post-booking expense tracking (task #220). Behind
            NEXT_PUBLIC_EXPENSE_LEDGER_ENABLED flag — renders null when off,
            so the existing layout is unchanged for environments that
            haven't opted in yet. */}
        <ExpenseLedger
          tripId={trip.id}
          defaultCurrency={trip.budget?.currency || "EUR"}
          className="mb-8"
        />

        {/* Hotel Recommendations - After Map */}
        {/* DISABLED for saved trips - Hotels API calls are expensive */}
        <HotelRecommendations
          destination={destination}
          itinerary={displayItinerary}
          startDate={trip.startDate}
          endDate={trip.endDate}
          disableApiCalls={true}
        />

        {/* Crew Loop: owner-side crew-votes summary strip. Appears once the
            share link has collected anonymous votes — shows voter names when
            they gave one, and jumps back into the share tab to rally more
            voters. Hidden during legacy edit mode (ShareButton unmounts
            there, so the button would have nothing to open). */}
        {!isEditMode && isOwner && crewVotes !== null && crewVotes.total > 0 && (
          <div className="mb-6 p-4 bg-gradient-to-r from-violet-50 to-blue-50 border border-violet-200 rounded-xl">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">
                  {t('detail.crewVotesSummary', { count: crewVotes.total })}
                </p>
                {crewVotes.voters.length > 0 && (
                  <p className="text-xs text-slate-600 mt-0.5">
                    {t('detail.crewVotesVoters', { names: crewVotes.voters.join(', ') })}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={openCrewShareModal}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-[var(--primary)] text-white hover:bg-[var(--primary)]/90 transition-colors"
              >
                {t('detail.crewVotesShare')}
              </button>
            </div>
          </div>
        )}

        {/* Crew Loop CTA: owner + sharing never enabled + ≥2 days — nudge
            toward the no-account crew voting link. Dismissal persists per
            trip in localStorage (crewCtaDismissed:{tripId}). */}
        {!isEditMode &&
          isOwner &&
          crewSharingEnabled === false &&
          !crewCtaDismissed &&
          trip.itinerary.length >= 2 && (
            <div className="relative mb-6 p-4 bg-gradient-to-r from-violet-50 to-blue-50 border border-violet-200 rounded-xl">
              <button
                type="button"
                onClick={dismissCrewCta}
                aria-label={t('detail.crewCtaDismiss')}
                title={t('detail.crewCtaDismiss')}
                className="absolute top-3 right-3 text-slate-500 hover:text-slate-600 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
              <div className="flex flex-wrap items-center justify-between gap-3 pr-8">
                <p className="text-sm font-medium text-slate-900">
                  {t('detail.crewCtaText')}
                </p>
                <button
                  type="button"
                  onClick={openCrewShareModal}
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-[var(--primary)] text-white hover:bg-[var(--primary)]/90 transition-colors"
                >
                  {t('detail.crewCtaButton')}
                </button>
              </div>
            </div>
          )}

        {showToday && (
          <TodayView
            itinerary={displayItinerary}
            dayState={dayState}
            currency={trip.budget?.currency}
            weatherNote={trip.meta?.weather_note}
            onViewFullItinerary={() => setTodayMode(false)}
            className="mb-6"
          />
        )}

        {!showToday && (
        <>
        {dayState.isLive && !todayMode && !isEditMode && (
          <button
            type="button"
            onClick={() => setTodayMode(true)}
            data-testid="back-to-today"
            className="mb-4 inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)]/10 px-3 py-2 text-sm font-medium text-[var(--primary-ink)] hover:bg-[var(--primary)]/15"
          >
            <span aria-hidden>←</span> {tCommon("today.backToToday")}
          </button>
        )}
        {/* Day Filter Slider - Mobile optimized */}
        <DaySlider
          days={displayItinerary}
          selectedDay={selectedDay}
          onSelectDay={setSelectedDay}
          className="mb-6"
        />

        {/* Itinerary */}
        {displayItinerary.length > 0 ? (
          // One drag context for the whole plan, so a card can be dragged from
          // any day to any other (before: one context per day, and a drag past
          // the day boundary silently snapped back). Inert when nothing is
          // sortable (view mode / read-only), so it wraps unconditionally.
          <DndContext
            sensors={sensors}
            collisionDetection={collisionDetection}
            measuring={dndMeasuring}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
          <div className="space-y-8" key={`itinerary-v${renderEpoch}`}>
            {(dragPreview ?? displayItinerary)
              .filter((day) => selectedDay === null || day.day_number === selectedDay)
              .map((day, dayIndex) => (
                <div
                  key={`day-${day.day_number}-v${renderEpoch}`}
                  // Stable per-day anchor for the assistant's APPLY → SEE loop
                  // (scroll target + flash highlight, see handleFocusDayCard).
                  id={`trip-day-${day.day_number}`}
                  className={`relative scroll-mt-6 ${
                    aiFocusDay?.day === day.day_number
                      ? `rounded-2xl ring-2 ring-[var(--primary)] ring-offset-4 transition-all duration-500 ${
                          aiFocusDay.pulse ? "animate-pulse-once" : ""
                        }`
                      : ""
                  }`}
                >
                  {/* Loading overlay during per-day regeneration */}
                  {regeneratingDayNumber === day.day_number && (
                    <div className="absolute inset-0 z-20 flex items-center justify-center
                                    bg-white/70 backdrop-blur-sm rounded-2xl pointer-events-auto"
                         aria-live="polite">
                      <div className="flex items-center gap-3 px-4 py-2 rounded-full bg-white shadow border border-slate-200">
                        <RefreshCw className="w-4 h-4 animate-spin text-[var(--primary-ink)]" />
                        <span className="text-sm font-medium text-slate-700">
                          {t("detail.regeneratingDay", { number: day.day_number })}
                        </span>
                      </div>
                    </div>
                  )}
                  {/* Day Header — a drop target while a card is being dragged (lands at the start of this day) */}
                  <DayDropHeader dayNumber={day.day_number} dragging={activeDragId !== null}>
                  <div className="flex items-center gap-4 mb-4">
                    <div className="flex items-center gap-3">
                      <div className={`w-12 h-12 rounded-full text-white flex items-center justify-center font-bold text-lg shadow-lg ${
                        isEditMode
                          ? "bg-gradient-to-br from-amber-500 to-amber-600"
                          : "bg-gradient-to-br from-[var(--primary)] to-[var(--primary)]/80"
                      }`}>
                        {day.day_number}
                      </div>
                      <div>
                        <h2 className="font-bold text-xl text-slate-900">
                          {t('day.label', { number: day.day_number })}
                        </h2>
                        {day.theme && (
                          <p className="text-slate-500 text-sm">{day.theme}</p>
                        )}
                      </div>
                    </div>
                    <div className="ml-auto flex items-center gap-3">
                      {/* Regenerate Day Button - icon-only; owner only; subtle */}
                      {userRole === "owner" && (
                        <button
                          type="button"
                          onClick={() => setDayRegenPrompt({ dayNumber: day.day_number, text: "" })}
                          disabled={regeneratingDayNumber !== null}
                          className="flex items-center justify-center w-8 h-8 rounded-lg
                                     text-slate-500 hover:text-[var(--primary-ink)] hover:bg-slate-100
                                     disabled:opacity-50 disabled:cursor-not-allowed
                                     transition-colors"
                          title={t('detail.regenerateDay.button', { number: day.day_number })}
                          aria-label={t('detail.regenerateDay.button', { number: day.day_number })}
                        >
                          <RefreshCw
                            className={`w-4 h-4 ${regeneratingDayNumber === day.day_number ? "animate-spin" : ""}`}
                          />
                        </button>
                      )}
                      {/* Optimize Route Button - only show while editing with 3+ activities */}
                      {editingActive && day.activities.length >= 3 && (
                        <button
                          onClick={() => openRouteOptimization(day.day_number, day.activities)}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium
                                     text-emerald-700 bg-emerald-50 hover:bg-emerald-100
                                     rounded-lg transition-colors border border-emerald-200"
                          title={t('detail.optimizeRoute')}
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                              d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                          </svg>
                          <span className="hidden sm:inline">{t('detail.optimizeRoute')}</span>
                          <span className="sm:hidden">{t('detail.optimize')}</span>
                        </button>
                      )}
                      {day.daily_budget && (
                        <div className="text-right">
                          <div className="text-sm text-slate-500">{t('detail.estBudget')}</div>
                          <div className="font-semibold text-slate-900">
                            {formatDayBudget(day)}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                  </DayDropHeader>

                  {/* Activities */}
                  {viewMode === "cards" ? (
                    <>
                      {editingActive ? (
                        /* Edit Mode with Drag-and-Drop */
                        <>
                          {/* Edit mode reorder hint - only show on first day */}
                          {dayIndex === 0 && (
                            <div className="mb-4 px-1">
                              <div className="flex items-center gap-2 px-3 py-2 bg-gradient-to-r from-slate-50 to-slate-100/50 rounded-lg border border-slate-200/60">
                                <div className="w-6 h-6 rounded bg-slate-200/80 flex items-center justify-center">
                                  <svg className="w-3.5 h-3.5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                                  </svg>
                                </div>
                                <span className="text-sm text-slate-600">
                                  <span className="font-medium">{t('detail.reorderActivities')}</span>
                                </span>
                              </div>
                            </div>
                          )}
                          <DayDropList
                            dayNumber={day.day_number}
                            dragging={activeDragId !== null}
                            isEmpty={day.activities.length === 0}
                          >
                            <SortableContext
                              items={day.activities.map((a) => a.id || `activity-${day.activities.indexOf(a)}`)}
                              strategy={verticalListSortingStrategy}
                            >
                              <div className="grid gap-0">
                              {day.activities.map((activity, idx) => {
                                const isAIUpdated = aiUpdateRef.current?.activityId === activity.id;
                                const nextActivity = day.activities[idx + 1];
                                const dayTravelData = travelData.get(day.day_number);
                                const segment = nextActivity && dayTravelData?.segments.find(
                                  (s) => s.fromActivityId === activity.id && s.toActivityId === nextActivity.id
                                );

                                return (
                                  <div key={`${activity.id || idx}-v${renderEpoch}`}>
                                    {/* Crew Loop: anon share-link tally */}
                                    {renderCrewVotePill(activity.id)}
                                    <div
                                      className={isAIUpdated ? "animate-pulse-once ring-2 ring-[var(--primary)] ring-offset-2 rounded-xl transition-all duration-500" : ""}
                                    >
                                      <SortableActivityCard
                                        activity={activity}
                                        index={idx}
                                        currency={trip.budget?.currency}
                                        showGallery={true}
                                        isEditMode={true}
                                        onDelete={() => handleActivityDelete(activity.id!)}
                                        onUpdate={(updates) => handleActivityUpdate(activity.id!, updates)}
                                        onMoveToDay={(targetDayIdx) => handleActivityMoveToDay(activity.id!, targetDayIdx)}
                                        onRegenerate={() => handleActivityRegenerate(activity.id!, dayIndex)}
                                        availableDays={availableDays}
                                        dayOptions={dayOptions}
                                        currentDayIndex={dayIndex}
                                        isRegenerating={regeneratingActivityId === activity.id}
                                        disableAutoFetch={true}
                                        onPhotoCapture={handlePhotoCapture}
                                        // Voting props
                                        votingEnabled={votingEnabled}
                                        votes={getActivityVotes(activity.id || "")}
                                        consensus={getActivityConsensus(activity.id || "")}
                                        activityStatus={getActivityStatus(activity.id || "")}
                                        currentUserVote={getCurrentUserVote(activity.id || "")}
                                        canVote={canVote}
                                        totalVoters={voterCount}
                                        onVote={(voteType, comment) => castVote(activity.id || "", voteType, comment)}
                                        onRemoveVote={() => removeVote(activity.id || "")}
                                      />
                                    </div>
                                    {/* Travel connector to next activity */}
                                    {idx < day.activities.length - 1 && (
                                      <TravelConnector
                                        distanceMeters={segment?.distanceMeters}
                                        durationSeconds={segment?.durationSeconds}
                                        distanceText={segment?.distanceText}
                                        durationText={segment?.durationText}
                                        mode={segment?.mode}
                                        isLoading={travelLoading || dayTravelData?.isLoading}
                                      />
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </SortableContext>
                          </DayDropList>
                        </>
                      ) : (
                        /* View Mode - Merged Timeline with Activities and Inline Proposals */
                        <div className="grid gap-0">
                          {getMergedTimeline(day.day_number).map((item, timelineIdx) => {
                            if (item.type === 'activity') {
                              const activity = item.data;
                              const idx = item.index;
                              const isAIUpdated = aiUpdateRef.current?.activityId === activity.id;
                              const nextActivity = day.activities[idx + 1];
                              const dayTravelData = travelData.get(day.day_number);
                              const segment = nextActivity && dayTravelData?.segments.find(
                                (s) => s.fromActivityId === activity.id && s.toActivityId === nextActivity.id
                              );

                              return (
                                <div key={`activity-${activity.id || idx}-v${renderEpoch}`}>
                                  {/* Crew Loop: anon share-link tally */}
                                  {renderCrewVotePill(activity.id)}
                                  <div
                                    className={isAIUpdated ? "animate-pulse-once ring-2 ring-[var(--primary)] ring-offset-2 rounded-xl transition-all duration-500" : ""}
                                  >
                                    <EditableActivityCard
                                      activity={activity}
                                      index={idx}
                                      currency={trip.budget?.currency}
                                      showGallery={true}
                                      isEditMode={false}
                                      onDelete={() => {}}
                                      onUpdate={() => {}}
                                      onMoveToDay={() => {}}
                                      onRegenerate={() => {}}
                                      availableDays={[]}
                                      currentDayIndex={dayIndex}
                                      disableAutoFetch={true}
                                      onPhotoCapture={handlePhotoCapture}
                                      // Voting props - enabled in view mode
                                      votingEnabled={votingEnabled}
                                      votes={getActivityVotes(activity.id || "")}
                                      consensus={getActivityConsensus(activity.id || "")}
                                      activityStatus={getActivityStatus(activity.id || "")}
                                      currentUserVote={getCurrentUserVote(activity.id || "")}
                                      canVote={canVote}
                                      totalVoters={voterCount}
                                      onVote={(voteType, comment) => castVote(activity.id || "", voteType, comment)}
                                      onRemoveVote={() => removeVote(activity.id || "")}
                                    />
                                  </div>
                                  {/* Travel connector to next activity */}
                                  {idx < day.activities.length - 1 && (
                                    <TravelConnector
                                      distanceMeters={segment?.distanceMeters}
                                      durationSeconds={segment?.durationSeconds}
                                      distanceText={segment?.distanceText}
                                      durationText={segment?.durationText}
                                      mode={segment?.mode}
                                      isLoading={travelLoading || dayTravelData?.isLoading}
                                    />
                                  )}
                                </div>
                              );
                            } else {
                              // Inline Proposal Card
                              const proposal = item.data;
                              return (
                                <div key={`proposal-${proposal.id}`} className="my-2">
                                  <InlineProposalCard
                                    proposal={proposal}
                                    currentUserId={undefined}
                                    canVote={canVote}
                                    onTapToVote={() => openVotingSheet(proposal)}
                                    totalVoters={voterCount}
                                  />
                                </div>
                              );
                            }
                          })}
                        </div>
                      )}
                      {/* Add Activity Button - shown whenever editing is active */}
                      {editingActive && (
                        // The indent lives on a wrapper: on the button itself,
                        // ml-6 plus its w-full made every trip page 8px wider
                        // than a phone screen (it scrolled sideways).
                        <div className="mt-4 ml-6">
                          <AddActivityButton
                            dayIndex={dayIndex}
                            destination={destination}
                            onAdd={(partialActivity) => handleAddActivity(dayIndex, partialActivity)}
                          />
                        </div>
                      )}
                      {/* Suggest Activity Button - View Mode Only, Collaborative Trips */}
                      {!isEditMode && votingEnabled && canPropose && (
                        <button
                          onClick={() => handleOpenProposeModal(day.day_number)}
                          className="w-full mt-4 py-3 border-2 border-dashed border-gray-200
                                     rounded-xl text-gray-400 hover:border-blue-300
                                     hover:text-blue-500 transition-colors text-sm font-medium"
                        >
                          {t('detail.suggestActivity')}
                        </button>
                      )}
                      {/* Day travel + feasibility summary */}
                      <DaySummary
                        dayNumber={day.day_number}
                        segments={travelData.get(day.day_number)?.segments ?? []}
                        activities={day.activities}
                        pace={trip.meta?.pace}
                        className="mt-4"
                      />
                    </>
                  ) : (
                    /* Timeline View */
                    <>
                      <div className="relative pl-8 border-l-2 border-slate-200 space-y-2">
                        {day.activities.map((activity, idx) => {
                          const nextActivity = day.activities[idx + 1];
                          const dayTravelData = travelData.get(day.day_number);
                          const segment = nextActivity && dayTravelData?.segments.find(
                            (s) => s.fromActivityId === activity.id && s.toActivityId === nextActivity.id
                          );

                          return (
                            <div key={idx}>
                              <div className="relative">
                                {/* Timeline dot */}
                                <div className="absolute -left-[25px] w-4 h-4 rounded-full bg-[var(--primary)] border-4 border-white shadow" />

                                <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm hover:shadow-md transition-shadow">
                                  <div className="flex items-start justify-between gap-4">
                                    <div className="flex-1">
                                      <div className="flex items-center gap-2 text-sm text-slate-500 mb-1">
                                        <span className="font-medium">{activity.start_time}</span>
                                        <span>·</span>
                                        <span>{activity.duration_minutes} min</span>
                                      </div>
                                      <h4 className="font-semibold text-slate-900">
                                        {activity.name}
                                      </h4>
                                      <p className="text-sm text-slate-600 mt-1">
                                        {activity.description}
                                      </p>
                                      <div className="flex items-center gap-2 mt-2 text-xs text-slate-500">
                                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                                        </svg>
                                        {activity.address || activity.location}
                                      </div>
                                    </div>
                                    <div className="text-right">
                                      <div className="font-medium text-slate-900">
                                        {/* THE crash site for Sentry JAVASCRIPT-NEXTJS-12
                                            (17 occurrences): estimated_cost is model-generated
                                            and frequently absent. Only "Free" when the model
                                            actually said 0 — a missing block means unknown,
                                            not free. */}
                                        {!activity.estimated_cost
                                          ? null
                                          : activity.estimated_cost.amount === 0
                                          ? t('activity.free')
                                          : `${activity.estimated_cost.currency || trip.budget?.currency || "USD"} ${activity.estimated_cost.amount}`}
                                      </div>
                                      <span className="text-xs text-slate-500 capitalize">
                                        {activity.type}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              </div>
                              {/* Compact travel connector in timeline */}
                              {idx < day.activities.length - 1 && (
                                <TravelConnector
                                  distanceMeters={segment?.distanceMeters}
                                  durationSeconds={segment?.durationSeconds}
                                  distanceText={segment?.distanceText}
                                  durationText={segment?.durationText}
                                  mode={segment?.mode}
                                  isLoading={travelLoading || dayTravelData?.isLoading}
                                  compact={true}
                                />
                              )}
                            </div>
                          );
                        })}
                      </div>
                      {/* Day travel + feasibility summary for timeline */}
                      <DaySummary
                        dayNumber={day.day_number}
                        segments={travelData.get(day.day_number)?.segments ?? []}
                        activities={day.activities}
                        pace={trip.meta?.pace}
                        className="mt-4"
                      />
                    </>
                  )}
                </div>
              ))}
          </div>
          {/* The card that follows the pointer; the source card stays as a faded placeholder. */}
          <DragOverlay dropAnimation={{ duration: 200, easing: "cubic-bezier(0.18, 0.67, 0.6, 1.22)" }}>
            <ActivityDragGhost activity={activeDragActivity} />
          </DragOverlay>
          </DndContext>
        ) : (
          <div className="text-center py-16 bg-white rounded-2xl border border-slate-200">
            <svg className="w-16 h-16 mx-auto text-slate-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            <h3 className="text-lg font-medium text-slate-900 mb-2">{t('detail.noItinerary')}</h3>
            <p className="text-slate-600">{t('detail.noItineraryMessage')}</p>
          </div>
        )}

        </>
        )}

        {/* Journey Essentials - Premium Packing List */}
        {trip.packingList && trip.packingList.length > 0 && (
          <TripPackingEssentials
            items={trip.packingList}
            destination={destination}
            tripId={trip.id}
            initialChecked={trip.packingChecked}
          />
        )}

        {/* AI Disclaimer */}
        {!isEditMode && (
          <div className="mt-12 p-5 bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-xl">
            <div className="flex gap-4">
              <div className="flex-shrink-0">
                <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
                  <svg className="w-5 h-5 text-amber-600" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                  </svg>
                </div>
              </div>
              <div>
                <h4 className="font-semibold text-amber-900 mb-1">
                  {t('detail.aiGenerated')}
                </h4>
                <p className="text-sm text-amber-800">
                  {t('detail.aiGeneratedDescription')} {t('detail.clickMoreInfo')}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Edit Mode Instructions */}
        {isEditMode && (
          <div className="mt-12 p-5 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl">
            <div className="flex gap-4">
              <div className="flex-shrink-0">
                <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
                  <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </div>
              </div>
              <div>
                <h4 className="font-semibold text-blue-900 mb-1">
                  {t('detail.editModeActive')}
                </h4>
                <p className="text-sm text-blue-800">
                  {t('detail.editModeInstructions')}
                </p>
              </div>
            </div>
          </div>
        )}
          </>
        )}
      </main>

      {/* Edit Mode Undo/Redo Bar - Minimal, with status indicator */}
      {isEditMode && (
        <div className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-sm border-t border-slate-200 z-50">
          <div className="max-w-6xl mx-auto px-4 py-3">
            <div className="flex items-center justify-between">
              {/* Left: Undo/Redo and status */}
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1">
                  <button
                    onClick={undo}
                    disabled={undoStack.length === 0}
                    className="p-2 rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    title="Undo (Cmd+Z)"
                  >
                    <Undo2 className="w-4 h-4 text-slate-600" />
                  </button>
                  <button
                    onClick={redo}
                    disabled={redoStack.length === 0}
                    className="p-2 rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    title="Redo (Cmd+Shift+Z)"
                  >
                    <Redo2 className="w-4 h-4 text-slate-600" />
                  </button>
                </div>
                {hasChanges && (
                  <span className="px-2.5 py-1 bg-amber-100 text-amber-800 text-xs font-medium rounded-full animate-pulse">
                    {t('detail.unsavedChanges')}
                  </span>
                )}
                {saveError && (
                  <span className="text-sm text-red-600">{saveError}</span>
                )}
              </div>
              {/* Right: Keyboard hint */}
              <div className="hidden sm:flex items-center gap-2 text-xs text-slate-500">
                <kbd className="px-1.5 py-0.5 bg-slate-100 rounded text-slate-500">⌘Z</kbd>
                <span>undo</span>
                <span className="mx-1">•</span>
                <kbd className="px-1.5 py-0.5 bg-slate-100 rounded text-slate-500">⌘⇧Z</kbd>
                <span>redo</span>
                <span className="mx-1">•</span>
                <kbd className="px-1.5 py-0.5 bg-slate-100 rounded text-slate-500">Esc</kbd>
                <span>exit</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Bottom padding when edit bar is showing */}
      {isEditMode && <div className="h-20" />}

      {/* AI Assistant Floating Button — primary CTA. Bigger + accented +
          pulses for first-time visitors so the killer feature is impossible
          to miss. Previously: muted white pill that 95% of users ignored. */}
      {!isEditMode && canUseAssistant && (
        <button
          onClick={() => setIsAIAssistantOpen(true)}
          className={`fixed bottom-24 sm:bottom-6 left-6 lg:bottom-8 lg:left-8 z-40 group ${!hasSeenAssistant ? "animate-pulse" : ""}`}
          title={t('detail.aiTripAssistant')}
        >
          <div className="flex items-center gap-3 px-4 py-3 sm:px-5 sm:py-3.5 rounded-2xl bg-gradient-to-br from-[var(--primary)] to-[var(--primary-dark)] text-white shadow-xl shadow-[var(--primary)]/30 hover:shadow-2xl hover:scale-[1.04] transition-all duration-300 ring-2 ring-white">
            {/* AI Agent Image with ring on white background for contrast */}
            <div className="relative w-11 h-11 sm:w-12 sm:h-12 rounded-xl overflow-hidden shadow-md bg-white">
              <Image
                src="/images/ai-agent.png"
                alt="AI Assistant"
                fill
                className="object-cover"
              />
            </div>
            {/* Label - hidden on very small screens */}
            <div className="hidden sm:flex flex-col items-start leading-none">
              <span className="text-sm font-bold text-white">{t('detail.aiAssistant')}</span>
              <span className="text-[12px] text-white/85">{t('detail.customizeTrip')}</span>
            </div>
            {/* Arrow indicator */}
            <svg className="w-4 h-4 text-white/80 group-hover:translate-x-0.5 transition-all hidden sm:block" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
            </svg>
          </div>
          {/* First-time visual nudge — small dot like a notification badge */}
          {!hasSeenAssistant && (
            <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[var(--accent)] ring-2 ring-white animate-ping" />
          )}
        </button>
      )}

      {/* Edit mode AI button - compact version above save bar */}
      {isEditMode && canUseAssistant && (
        <button
          onClick={() => setIsAIAssistantOpen(true)}
          className="fixed bottom-24 left-6 z-40 group"
          title={t('detail.aiTripAssistant')}
        >
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/95 backdrop-blur-xl border border-slate-200/80 shadow-lg shadow-slate-900/10 hover:shadow-xl hover:bg-white transition-all duration-300">
            <div className="relative w-9 h-9 rounded-lg overflow-hidden shadow-sm">
              <Image
                src="/images/ai-agent.png"
                alt="AI Assistant"
                fill
                className="object-cover"
              />
            </div>
            <span className="text-sm font-medium text-slate-700 hidden sm:inline">{t('detail.aiHelp')}</span>
          </div>
        </button>
      )}

      <BaseModal
        isOpen={confirmCancelTrip}
        onClose={() => setConfirmCancelTrip(false)}
        title={t('detail.cancelTrip.title')}
      >
        <p className="text-sm text-slate-600">{t('detail.cancelTrip.body')}</p>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={() => setConfirmCancelTrip(false)}
            className="rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100"
          >
            {t('detail.cancelTrip.keep')}
          </button>
          <button
            type="button"
            onClick={() => {
              setConfirmCancelTrip(false);
              void handleStatusUpdate("cancelled");
            }}
            className="rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700"
          >
            {t('detail.cancelTrip.confirm')}
          </button>
        </div>
      </BaseModal>

      {/* Regenerate one day, optionally steered ("boarding the cruise"). */}
      <BaseModal
        isOpen={dayRegenPrompt !== null}
        onClose={() => setDayRegenPrompt(null)}
        title={dayRegenPrompt ? t('detail.regenerateDay.title', { number: dayRegenPrompt.dayNumber }) : ""}
      >
        {dayRegenPrompt && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const { dayNumber, text } = dayRegenPrompt;
              setDayRegenPrompt(null);
              void handleDayRegenerate(dayNumber, text);
            }}
          >
            <p className="text-sm text-slate-600">{t('detail.regenerateDay.body')}</p>
            <label htmlFor="day-regen-instructions" className="mt-4 block text-sm font-medium text-slate-800">
              {t('detail.regenerateDay.label')}
            </label>
            <textarea
              id="day-regen-instructions"
              value={dayRegenPrompt.text}
              onChange={(e) => setDayRegenPrompt({ ...dayRegenPrompt, text: e.target.value })}
              maxLength={500}
              rows={3}
              placeholder={t('detail.regenerateDay.placeholder')}
              className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-[var(--primary)] focus:outline-none"
            />
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setDayRegenPrompt(null)}
                className="rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100"
              >
                {t('detail.regenerateDay.cancel')}
              </button>
              <button
                type="submit"
                className="rounded-xl bg-[var(--primary)] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[var(--primary-light)]"
              >
                {t('detail.regenerateDay.confirm')}
              </button>
            </div>
          </form>
        )}
      </BaseModal>

      {/* AI Assistant Sidebar/Bottom Sheet */}
      {canUseAssistant && (
        <AIAssistant
          tripId={trip.id}
          tripTitle={trip.title}
          itinerary={displayItinerary}
          isOpen={isAIAssistantOpen}
          onClose={() => setIsAIAssistantOpen(false)}
          onAction={handleAIAction}
          onRefetchTrip={async () => {
            await handleRefetchTrip();
          }}
          onFocusDay={handleFocusDayCard}
          runItineraryWrite={runItineraryWrite}
        />
      )}

      {/* The trip was changed elsewhere (a trip mate, another tab) after this
          page loaded: the save was refused rather than overwrite it. */}
      {conflict && (
        <ItineraryConflictBanner
          canKeepMine={hasChanges}
          onLoadLatest={handleLoadLatest}
          onKeepMine={handleKeepMine}
          busy={isSaving}
        />
      )}

      {/* Success Toast Notification */}
      {saveSuccess && (
        <div className="fixed top-4 right-4 z-50 animate-fade-in-up">
          <div className="flex items-center gap-3 px-4 py-3 bg-green-50 border border-green-200 rounded-lg shadow-lg">
            <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <p className="font-medium text-green-800">{t('detail.changesSaved')}</p>
              <p className="text-sm text-green-600">{t('detail.tripUpdated')}</p>
            </div>
            <button
              onClick={() => setSaveSuccess(false)}
              className="text-green-500 hover:text-green-700 ml-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Voting Bottom Sheet - for inline proposal voting */}
      <VotingBottomSheet
        isOpen={votingSheetState.isOpen}
        onClose={closeVotingSheet}
        proposal={votingSheetState.proposal}
        currentUserId={undefined}
        onVote={async (voteType, comment) => {
          if (votingSheetState.proposal) {
            await voteOnProposal(votingSheetState.proposal.id, voteType, comment);
            addToast("Vote recorded!", "success");
          }
        }}
        onRemoveVote={async () => {
          if (votingSheetState.proposal) {
            await removeProposalVote(votingSheetState.proposal.id);
            addToast("Vote removed", "success");
          }
        }}
        totalVoters={voterCount}
        isOwner={userRole === 'owner'}
        onForceResolve={async (action) => {
          if (votingSheetState.proposal) {
            await forceResolve(votingSheetState.proposal.id, action);
            addToast(`Proposal ${action}d`, "success");
          }
        }}
      />

      {/* Route Optimization Modal */}
      <RouteOptimizationModal
        isOpen={routeOptimizationState.isOpen}
        onClose={closeRouteOptimization}
        dayNumber={routeOptimizationState.dayNumber}
        activities={routeOptimizationState.activities}
        onApplyOptimization={(optimizedActivities) => {
          applyOptimizedRoute(routeOptimizationState.dayNumber, optimizedActivities);
          closeRouteOptimization();
        }}
      />

      {/* Collaborator onboarding for new non-owner users */}
      {isCollaborativeTrip && (
        <CollaboratorOnboarding isOwner={userRole === "owner"} />
      )}

      {/* The share ask (spec C1). Renders null until the owner has actually
          engaged with the trip, and only when no link exists yet — it used to
          fire in the wizard the moment the row was inserted, before the user
          had read what they were being asked to send.

          Deliberately OUTSIDE the isCollaborativeTrip gate: the whole point is
          to reach owners of trips that have no collaborators yet. Gating it on
          "already collaborative" would only ever ask people who had already
          done the thing being asked for. */}
      <SharePromptOnTrip
        tripId={trip.id}
        tripTitle={trip.title}
        tripDays={trip.itinerary?.length ?? 0}
        destination={getTripDestination(trip)}
        isOwner={isOwner}
        tripIntent={trip.meta?.trip_intent}
        canPublish={canPublish}
        authorDisplayName={ownerDisplayName}
        isAnchored={(trip.meta?.anchors?.length ?? 0) > 0}
        onManageCollaborators={openCrewShareModal}
        paused={dayRegenPrompt !== null || confirmCancelTrip || isBookingDrawerOpen || isPasteBookingOpen}
      />

      {/* Mobile Bottom Navigation - hidden during edit mode */}
      {!isEditMode && <MobileBottomNav activePage="trip-detail" tripId={trip.id} />}
    </div>
  );
}
