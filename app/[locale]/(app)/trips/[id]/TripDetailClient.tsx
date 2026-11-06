"use client";

import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { CrewShareNudge, CrewVotesSummary, useCrewVotes } from "@/components/trip/CrewVotes";
import type { ItineraryDay, Activity, TripMeta, CachedDayTravelData, CollaboratorRole, VoteType } from "@/types";
import { ROLE_PERMISSIONS } from "@/types";
import { getTripDestination } from "@/lib/trips/destination";
import { shownTripStatus } from "@/lib/trips/status";
import { toLocalISODate } from "@/lib/utils/date-local";
import { hasCoordinates } from "@/lib/trips/has-coordinates";
import { withFoundPhotos } from "@/lib/trips/keep-place-photos";
import { useItineraryCopies } from "@/hooks/useItineraryCopies";
import { useKeptTripPhotos } from "@/hooks/useKeptTripPhotos";
import { useKeptTripPlacesToEat } from "@/hooks/useKeptTripPlacesToEat";
import { PlacesCheckedNote } from "@/components/trip/PlacesCheckedNote";
import { placesToEatNote } from "@/lib/places/kept-trip";
import { useEditShortcuts } from "@/hooks/useEditShortcuts";
import { useDayFocus } from "@/hooks/useDayFocus";
import BackpackerHostelCta from "@/components/trip/BackpackerHostelCta";
import WhoIsGoingCard from "@/components/trip/WhoIsGoingCard";
import TodayView from "@/components/trip/TodayView";
import { useLiveTripState } from "@/lib/trip/useLiveTripState";
import { computeTripDayState, type TripDayState } from "@/lib/trip/live";
import { EditModeNotice, SaveSuccessToast } from "@/components/trip/TripNotices";
import AiDisclaimer from "@/components/trip/AiDisclaimer";
import { isLiveTripParticipantsEnabled } from "@/lib/participants/flag";
// TravelAdvisoryBanner / ExpenseLedger / TripConciergeChat are loaded with
// next/dynamic further down, which keeps the initial trip-page chunk lean.
import { useActivityVotes } from "@/hooks/useActivityVotes";
import { useProposals } from "@/hooks/useProposals";
import { useProposalApprovals } from "@/hooks/useProposalApprovals";
import { useVotingSheetActions } from "@/hooks/useVotingSheetActions";
import { useActivityRegeneration } from "@/hooks/useActivityRegeneration";
import { useDayRegeneration } from "@/hooks/useDayRegeneration";
import { dayTimeline } from "@/lib/proposals/timeline";
import DestinationHero from "@/components/DestinationHero";
import ShareButton from "@/components/trip/ShareButton";
import { BookingPanel, EnhancedBookingPanel, PostConfirmationBanner } from "@/components/booking";
import { useFlag } from "@/lib/posthog/hooks";
import { FLAG_ENHANCED_BOOKING } from "@/lib/posthog/flags";
import TripEditControls from "@/components/trip/TripEditControls";
import TripControlsBar from "@/components/trip/TripControlsBar";
import TripEditBar from "@/components/trip/TripEditBar";
import TripAssistantButton from "@/components/trip/TripAssistantButton";
import RegenerateDayDialog, { type DayRegenerationPrompt } from "@/components/trip/RegenerateDayDialog";

// Affiliate booking surfaces stay hidden behind a default-off env gate; they
// are not the current focus. NEXT_PUBLIC_BOOKINGS_ENABLED=true shows them.
const BOOKINGS_ENABLED = process.env.NEXT_PUBLIC_BOOKINGS_ENABLED === "true";
import {
} from "@/lib/posthog/events";
import TripPackingEssentials from "@/components/trip/TripPackingEssentials";
import MobileBottomNav from "@/components/ui/MobileBottomNav";
import DaySlider from "@/components/ui/DaySlider";
import { tripNights } from "@/lib/dates/iso-date";
import {
  CountdownHero,
  PreTripChecklist,
} from "@/components/timeline";
import { useChecklist } from "@/hooks/useChecklist";
import { useToast } from "@/components/ui/Toast";
import { trackTripViewed } from "@/lib/analytics";
import { useTravelDistances } from "@/hooks/useTravelDistances";
import {
  deleteActivity,
  updateActivity,
  addActivity,
} from "@/lib/utils/activity-id";
import { firstRealPoint, newActivity } from "@/lib/trips/new-activity";
import TripDayList from "@/components/trip/TripDayList";
import { useTranslations, useLocale } from "next-intl";
import { JourneyRibbon } from "@/components/trips/JourneyRibbon";
import { buildJourneyStops } from "@/lib/ai/transfer-legs";
import { useItineraryMoves } from "@/hooks/useItineraryMoves";
import { useItineraryHistory } from "@/hooks/useItineraryHistory";
import { CancelTripDialog, CancelledTripNote, ConfirmTripCard, TripStatusBadge, useTripStatus } from "@/components/trip/TripStatus";
import { dayOptionsOf } from "@/components/trip/ItineraryDnd";

import { useAssistantFirstVisit } from "@/hooks/useAssistantFirstVisit";
import { useTripCover } from "@/hooks/useTripCover";
import { useItinerarySync } from "@/hooks/useItinerarySync";
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

// Lazy-load components that are hidden behind state/conditions on first paint.
// Modals (BookingDrawer, AIAssistant, RouteOptimizationModal, VotingBottomSheet,
// ProposeActivitySheet) are closed by default — no SSR
// benefit, defer to interaction. OngoingTripView only renders for active trips,
// CollaboratorOnboarding only for collaborative ones, and ExportMenu only
// matters once the user opens its dropdown.
const BookingDrawer = dynamic(() => import("@/components/booking/BookingDrawer"), { ssr: false });
// Confirm-first assistant: AIAssistantEnhanced previews each edit in a
// PreviewChangeCard and changes the plan only when the user applies it (with
// undo).
const AIAssistant = dynamic(() => import("@/components/ai/AIAssistantEnhanced"), { ssr: false });
const OngoingTripView = dynamic(() => import("@/components/trip/OngoingTripView"), { ssr: false });
const CollaboratorOnboarding = dynamic(() => import("@/components/collaboration/CollaboratorOnboarding"), { ssr: false });
// Share ask, gated on engagement — self-contained, renders null until it fires.
const SharePromptOnTrip = dynamic(() => import("@/components/trip/SharePromptOnTrip"), { ssr: false });
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
// Hidden by default — only mounts once the user clicks "Add from email", so
// its chunk loads on that click and is never in the initial server payload.
// Also flag-gated internally.
const PasteBookingModal = dynamic(() => import("@/components/trip/PasteBookingModal"), {
  ssr: false,
});

// Travel advisory banner — async-fetches the FCDO data on mount. No reason
// to ship the component JS in the initial chunk; it self-hides when there
// is no advisory anyway, so a brief tick-after-hydrate is invisible to the
// user.
const TravelAdvisoryBanner = dynamic(
  () => import("@/components/trip/TravelAdvisoryBanner"),
  { ssr: false }
);

// Expense ledger — flag-gated (renders null when off) and renders below
// the booking panel, well below the fold for first paint.
const ExpenseLedger = dynamic(
  () => import("@/components/trip/ExpenseLedger"),
  { ssr: false }
);
// Opened from Today's expense panel; loaded only when someone opens it.
const SettleUpView = dynamic(() => import("@/components/trip/SettleUpView"), { ssr: false });
const expenseLedgerEnabled = process.env.NEXT_PUBLIC_EXPENSE_LEDGER_ENABLED === "true";

// Concierge chat — flag-gated, its own chunk. Server-rendered: the trigger
// pill sits above the plan, and arriving after hydration it pushed the
// whole page down.
const TripConciergeChat = dynamic(
  () => import("@/components/trip/TripConciergeChat")
);

// Concierge conversation history: a collapsible list of past Q+A pairs for
// this trip. Server-rendered like the launcher, for the same reason; the
// history fetch still waits for the expand click.
const ConciergeHistory = dynamic(
  () => import("@/components/trip/ConciergeHistory")
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
     * trips.itinerary_version the itinerary above was read at. Seeds the save
     * queue; a newer one is adopted only together with its itinerary (see
     * sync below).
     */
    itineraryVersion?: number | null;
    /** The owner's first open of a kept trip: its places to eat are due a check (lib/places/kept-trip.ts). */
    placesToEatDue?: boolean;
  };
  dateRange: string;
  // Collaboration props (optional - only passed for collaborative trips)
  isCollaborativeTrip?: boolean;
  userRole?: CollaboratorRole;
  collaboratorCount?: number;
  /**
   * Server-rendered /explore EngagementBar + PublishToggle. The server
   * component computes auth + flag state + counts; this only renders the
   * ReactNode in the action toolbar.
   */
  engagementSlot?: React.ReactNode;
  /** Server-resolved: explore on, viewer is owner, trip not already public. */
  canPublish?: boolean;
  /** Prefills the /explore author byline on the share prompt's publish tick. */
  ownerDisplayName?: string | null;
  /** Server-computed live day-state. */
  liveState?: TripDayState;
  /** Server-read: this browser has opened the assistant before (lib/trip/assistant-seen). */
  assistantSeen?: boolean;
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
  assistantSeen = false,
}: TripDetailClientProps) {
  const t = useTranslations('trips');
  // A live trip opens on Today, for the owner too.
  const fallbackDayState = useMemo<TripDayState>(
    () => liveState ?? computeTripDayState({ startDate: trip.startDate, endDate: trip.endDate, timeZone: null }),
    [liveState, trip.startDate, trip.endDate],
  );
  const dayState = useLiveTripState(fallbackDayState, trip.startDate, trip.endDate);
  const [todayMode, setTodayMode] = useState(true);
  // Settle Up from Today's expense panel: the ledger with it sits in the
  // planning view, which a live trip hides.
  const [settleFromToday, setSettleFromToday] = useState(false);
  // A separate translator for the 'common' namespace (activity.*,
  // addFromEmail.*, today.*).
  const tCommon = useTranslations('common');

  // Check for share query param (used to auto-open share modal after trip save)
  const searchParams = useSearchParams();
  const shareParam = searchParams.get("share");
  const shouldAutoOpenShareModal = shareParam === "invite";

  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [showMap, setShowMap] = useState(true);
  const [viewMode, setViewMode] = useState<"timeline" | "cards">("cards");
  const [isAIAssistantOpen, setIsAIAssistantOpen] = useState(false);
  const isOwner = userRole === "owner";
  // The trip assistant changes the trip, so it is for the people who can:
  // the owner and editors (the API answers 403 to anyone else).
  const canUseAssistant = ROLE_PERMISSIONS[userRole]?.canEdit ?? false;
  // The owner sees who said they're going.
  const participantsEnabled = isLiveTripParticipantsEnabled();
  // The hero's cover: the stored one, else one the hero looks up, which the
  // owner's visit stores on the trip.
  const { coverImageUrl, handleCoverImageFetched } = useTripCover({
    tripId: trip.id,
    storedUrl: trip.coverImageUrl,
    isOwner,
  });

  // Crew Loop: for the owner, whether the trip is shared and the votes
  // friends cast through the link with no account.
  const { sharingEnabled: crewSharingEnabled, votes: crewVotes } = useCrewVotes(trip.id, isOwner);
  // Each increment remounts ShareButton (via key) with autoOpen on the SHARE
  // tab — the same autoOpen/initialTab prop mechanism the ?share=invite deep
  // link uses, without modifying ShareButton itself.
  const [crewShareRequest, setCrewShareRequest] = useState(0);
  const openCrewShareModal = useCallback(() => {
    setCrewShareRequest((c) => c + 1);
  }, []);
  // The assistant on a first visit: it opens by itself, its trigger pulses
  // until it has been opened once, and its docked column is kept from the
  // first paint.
  const { hasSeenAssistant, assistantDockReserved } = useAssistantFirstVisit({
    canUseAssistant,
    assistantSeen,
    isAIAssistantOpen,
    setIsAIAssistantOpen,
  });

  // Edit mode state
  const [isEditMode, setIsEditMode] = useState(false);
  // Today mode shows only outside the editor, on a live trip.
  const showToday = dayState.isLive && todayMode && !isEditMode;
  const { initialItinerary, editedItinerary, setEditedItinerary } = useItineraryCopies(trip);

  // The day-regeneration dialog: which day, and what the traveller wants it to
  // be about, so a regeneration can be steered instead of rerolled blind.
  const [dayRegenPrompt, setDayRegenPrompt] = useState<DayRegenerationPrompt | null>(null);
  // "Cancel Trip" asks first: it turns off the countdown, checklist and
  // reminders.
  const [confirmCancelTrip, setConfirmCancelTrip] = useState(false);

  // Status management
  const { status: currentStatus, updating: isUpdatingStatus, update: handleStatusUpdate } = useTripStatus(trip.id, trip.status);

  // Booking drawer state (for collecting flight origin)
  const [isBookingDrawerOpen, setIsBookingDrawerOpen] = useState(false);

  // "Add from email" modal — flag-gated paste-confirmation flow.
  // PasteBookingModal returns null when NEXT_PUBLIC_EMAIL_PARSE_ENABLED !==
  // "true", and the trigger is not rendered either when the flag is off, so
  // the action bar stays tidy. The flag is inlined at build time, so toggling
  // it takes a redeploy.
  const emailParseEnabled = process.env.NEXT_PUBLIC_EMAIL_PARSE_ENABLED === "true";
  const [isPasteBookingOpen, setIsPasteBookingOpen] = useState(false);

  // Feature flag for enhanced booking panel
  const { enabled: useEnhancedBooking } = useFlag(FLAG_ENHANCED_BOOKING);

  // Version counter to force re-render after AI updates
  const [renderEpoch, setRenderEpoch] = useState(0);

  // The activity an AI change just added or replaced, highlighted for a moment
  const [aiUpdatedActivityId, setAiUpdatedActivityId] = useState<string | null>(null);


  // Guard against auto-save retry storms: when a PATCH fails we record the
  // exact payload that failed so the debounced effect doesn't hammer the
  // server with the identical body. A NEW edit changes the payload and clears
  // the guard, so a real change always re-attempts.
  const lastFailedSaveRef = useRef<string | null>(null);
  // Undo/redo for the itinerary being edited. History navigation always
  // re-attempts an auto-save, even back to a payload that previously failed —
  // otherwise the failed-payload guard could strand the trip in an un-saved
  // state after an undo/redo round-trip.
  const forgetFailedSave = useCallback(() => {
    lastFailedSaveRef.current = null;
  }, []);
  const {
    push: pushUndo,
    undo,
    redo,
    clear: clearHistory,
    canUndo,
    canRedo,
  } = useItineraryHistory(editedItinerary, setEditedItinerary, forgetFailedSave);

  // Trip phase detection for Timeline feature.
  // trip.startDate / trip.endDate come from the DB as YYYY-MM-DD strings, and
  // `new Date("YYYY-MM-DD")` parses that as UTC midnight, which in any
  // negative-UTC zone (the Americas) is the PREVIOUS DAY local time. So they
  // are parsed as local dates, like parseLocal in components/ui/SaveTripModal.tsx.
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
  const shownStatus = shownTripStatus(currentStatus, trip.startDate, trip.endDate, toLocalISODate(now));

  // Pre-trip: the trip simply has not started yet. Confirmed status is not
  // required: most people with an upcoming trip never press Confirm, and the
  // countdown and checklist are for them too. Cancelled trips are excluded:
  // counting down to a trip someone called off is worse than showing nothing.
  const isPreTripPhase = trip.status !== "cancelled" && tripStartDate > now;

  // Active trip: Between start and end dates
  const isActiveTripPhase = trip.status === "active" ||
    (tripStartDate <= now && now <= tripEndDate);

  // Activity voting for collaborative trips
  const votingEnabled = isCollaborativeTrip && collaboratorCount > 1;

  // **Ambient editing.** A solo owner has no edit mode: the editable cards
  // (drag, delete, move-to-day, add, regenerate, undo/redo) are ALWAYS live
  // and changes auto-save (see the debounced effect + saveStatus pill), so the
  // manual editor needs no toggle to be found. Collaborative/voting trips keep
  // the isEditMode flow (proposals interleave by time and would break under a
  // drag context); the active-trip phase renders OngoingTripView, not the
  // itinerary. Owner only: editors use edit mode and the explicit Save.
  const ambientEdit = isOwner && !votingEnabled && !isActiveTripPhase;

  // The itinerary's saves: the saved copy and its version, auto-save, the
  // explicit Save, conflicts, and server writes this tab starts.
  const {
    savedItinerary,
    setSavedItinerary,
    hasChanges,
    saveStatus,
    isSaving,
    saveError,
    setSaveError,
    saveSuccess,
    setSaveSuccess,
    conflict,
    itineraryWritesInFlight,
    runItineraryWrite,
    handleSaveChanges,
    handleLoadLatest,
    handleKeepMine,
    handleDiscardChanges,
    handleEnterEditMode,
    handleRefetchTrip,
    refetchQueued,
    adoptDayWrite,
    adoptStoredItinerary,
  } = useItinerarySync({
    trip,
    initialItinerary,
    editedItinerary,
    setEditedItinerary,
    isEditMode,
    setIsEditMode,
    ambientEdit,
    lastFailedSaveRef,
    clearHistory,
    setRenderEpoch,
    setAiUpdatedActivityId,
  });
  // A kept trip's stand-in photos become real ones when its owner opens it.
  // The server already stored them; both copies change, so nothing looks edited.
  useKeptTripPhotos({
    enabled: isOwner,
    tripId: trip.id,
    itinerary: initialItinerary,
    lastRun: (trip.meta as Record<string, unknown> | undefined)?.photos_enriched_at,
    onPhotos: (photos) => {
      setEditedItinerary((prev) => withFoundPhotos(prev, photos));
      setSavedItinerary((prev) => withFoundPhotos(prev, photos));
    },
  });

  // A kept trip's places to eat, looked up on its owner's first open: the
  // server stores what changed and this copy takes the same changes.
  const placesJustChecked = useKeptTripPlacesToEat({
    due: !!trip.placesToEatDue,
    tripId: trip.id,
    runItineraryWrite,
    adoptDayWrite,
  });

  // Viewing a trip never pays for an external API to backfill coordinates:
  // only activities that already have coordinates get a map marker.

  // Prefer trip_meta.destination (canonical) over stripping the title, which
  // fails for non-English or renamed trips (see lib/trips/destination.ts).
  const destination = getTripDestination(trip);

  // Multi-city route stops for the Journey ribbon, as in the wizard and the
  // ongoing view. The ribbon renders only with two or more stops.
  const locale = useLocale();
  const journeyStops = buildJourneyStops(editedItinerary, locale);


  // Calculate trip days and total activities for countdown
  const tripDaysCount = trip.itinerary.length;
  const totalActivities = editedItinerary.reduce((acc, day) => acc + day.activities.length, 0);

  // Pre-trip checklist. Owner only: the checklist routes and their RLS admit
  // only the owner, so loading it for a collaborator would always 404. Loaded
  // only before the trip, the one phase that shows it.
  const checklist = useChecklist(trip.id, { enabled: isOwner && isPreTripPhase });

  // Toast notifications
  const { addToast } = useToast();


  const {
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

  // Activity proposals for collaborative trips. An approval brings in the
  // stored trip and animates for a moment (useProposalApprovals).
  const { recentlyApproved, handleProposalChange } = useProposalApprovals(refetchQueued);

  const {
    proposals,
    createProposal,
    voteOnProposal,
    removeVote: removeProposalVote,
    forceResolve,
  } = useProposals({
    tripId: trip.id,
    enabled: votingEnabled,
    statusFilter: 'active',
    onProposalChange: handleProposalChange,
  });

  // Permission checks for current user
  const canVote = ROLE_PERMISSIONS[userRole]?.canVote ?? false;
  // The voting props every activity card takes, editing or viewing.
  const activityVotingProps = (activityId: string | undefined) => {
    const id = activityId || "";
    return {
      votingEnabled,
      votes: getActivityVotes(id),
      consensus: getActivityConsensus(id),
      activityStatus: getActivityStatus(id),
      currentUserVote: getCurrentUserVote(id),
      canVote,
      totalVoters: voterCount,
      onVote: (voteType: VoteType, comment?: string) => castVote(id, voteType, comment),
      onRemoveVote: () => removeVote(id),
    };
  };
  const canEdit = ROLE_PERMISSIONS[userRole]?.canEdit ?? false;
  const canPropose = ROLE_PERMISSIONS[userRole]?.canSuggest ?? false; // canSuggest = canPropose

  // Affordances/rendering are "on" whenever we're ambient OR isEditMode is
  // toggled (the flow collaborative trips use).
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
  // The sheet's vote, taking it back, and the owner's approve or reject.
  const votingSheetActions = useVotingSheetActions({
    proposal: votingSheetState.proposal,
    voteOnProposal,
    removeVote: removeProposalVote,
    forceResolve,
  });

  // Open route optimization modal for a day
  const openRouteOptimization = useCallback((dayNumber: number, activities: Activity[]) => {
    setRouteOptimizationState({ isOpen: true, dayNumber, activities });
  }, []);

  // Close route optimization modal
  const closeRouteOptimization = useCallback(() => {
    setRouteOptimizationState({ isOpen: false, dayNumber: 1, activities: [] });
  }, []);

  // Track trip view for retention analytics (runs once on mount)
  useEffect(() => {
    const daysSinceCreation = tripStartDate
      ? Math.floor((Date.now() - tripStartDate.getTime()) / (1000 * 60 * 60 * 24))
      : 0;

    trackTripViewed({
      tripId: trip.id,
      isOwnTrip: true, // sent for collaborators too; the view row below tells them apart
      tripStatus: trip.status,
      daysSinceCreation: Math.abs(daysSinceCreation),
      activitiesCount: totalActivities,
    });

    // The trip_views row the North Star counts (docs/LIVE_TRIP_MASTER_PLAN.md).
    // Collaborators reach this page too (userRole), so the source says which.
    // Fire-and-forget, keepalive.
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

  // Available days for "move to day" feature
  const availableDays = editedItinerary.map((day) => day.day_number);
  // What the "Move to another day" sheet shows per day (date, city, count).
  // Memoized on the itinerary so the memoized cards re-render only when a
  // day's contents actually change.
  const dayOptions = useMemo(() => dayOptionsOf(editedItinerary), [editedItinerary]);

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
    // A solo owner's edits save themselves; edit mode has a Save button.
    addToast(t(ambientEdit ? "detail.routeOptimized" : "detail.routeOptimizedSave"), "success");
  }, [pushUndo, addToast, ambientEdit, t, setEditedItinerary]);

  // Edit handlers (with undo support). Moves between days come from
  // useItineraryMoves further down, after handleFocusDayCard, which it uses to
  // scroll to the destination day.

  const handleActivityDelete = useCallback((activityId: string) => {
    pushUndo("Delete activity");
    setEditedItinerary((prev) => deleteActivity(prev, activityId));
  }, [pushUndo, setEditedItinerary]);

  const handleActivityUpdate = useCallback(
    (activityId: string, updates: Partial<Activity>) => {
      pushUndo("Update activity");
      setEditedItinerary((prev) => updateActivity(prev, activityId, updates));
    },
    [pushUndo, setEditedItinerary]
  );

  // The plan's first real map point, near which an added activity without
  // coordinates is placed when its day has none either.
  const destinationCoords = useMemo(() => firstRealPoint(editedItinerary), [editedItinerary]);

  // Handle adding a new activity to a day
  const handleAddActivity = useCallback(
    (dayIndex: number, partialActivity: Partial<Activity>) => {
      const day = editedItinerary[dayIndex];
      if (!day) return;

      pushUndo("Add activity");
      const added = newActivity(day, partialActivity, {
        destination,
        nearPoint: destinationCoords,
        currency: trip.budget?.currency || "USD",
      });
      setEditedItinerary((prev) => addActivity(prev, dayIndex, added));
    },
    [editedItinerary, destination, trip.budget?.currency, pushUndo, destinationCoords, setEditedItinerary]
  );

  // Drag-and-drop (within a day and across days) is useItineraryMoves, below
  // handleFocusDayCard.

  // Handle photo capture from PlaceGallery - persists to database
  const handlePhotoCapture = useCallback(
    async (activityId: string, photoUrl: string) => {
      // Update local state immediately for instant UI feedback
      setEditedItinerary((prev) => updateActivity(prev, activityId, { image_url: photoUrl }));
      setSavedItinerary((prev) => updateActivity(prev, activityId, { image_url: photoUrl }));

      // Persist in the background (fire-and-forget) for those who may edit.
      // Only this one photo is sent; the server sets it on the CURRENT stored
      // itinerary. Sending this tab's whole copy would silently revert whatever
      // someone else saved since the page loaded.
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
    [setSavedItinerary, canEdit, trip.id, setEditedItinerary]
  );

  const { regeneratingActivityId, handleActivityRegenerate } = useActivityRegeneration({
    tripId: trip.id,
    destination,
    itinerary: editedItinerary,
    setItinerary: setEditedItinerary,
    pushUndo,
    setSaveError,
  });

  // Per-day regeneration, steered by what the traveller wrote in the dialog.
  const { regeneratingDayNumber, handleDayRegenerate } = useDayRegeneration({
    tripId: trip.id,
    pushUndo,
    runItineraryWrite,
    adoptDayWrite,
    setRenderEpoch,
    setSaveError,
  });


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

  // A day's activities with the crew's open proposals among them, outside edit mode.
  const getMergedTimeline = useCallback(
    (dayNumber: number) =>
      dayTimeline(editedItinerary[dayNumber - 1]?.activities || [], proposals, dayNumber, recentlyApproved),
    [editedItinerary, proposals, recentlyApproved]
  );

  // Keyboard shortcuts for edit mode (Cmd+Z, Cmd+Shift+Z, Cmd+S, Escape)
  useEditShortcuts({
    editingActive,
    ambientEdit,
    hasChanges,
    isSaving,
    conflict: conflict !== null,
    itineraryWritesInFlight,
    undo,
    redo,
    save: handleSaveChanges,
    setIsEditMode,
  });


  // APPLY → SEE loop: after the AI assistant applies a change — or when the
  // user taps the action badge in the chat — scroll the affected day card into
  // view and flash-highlight it for ~2s so the change has a visible anchor in
  // the plan.
  const { focusedDay: aiFocusDay, focusDay: handleFocusDayCard } = useDayFocus({
    setSelectedDay,
    setIsAIAssistantOpen,
  });

  // Moving activities between days, by drag or by the card's sheet.
  const moves = useItineraryMoves({
    tripId: trip.id,
    itinerary: editedItinerary,
    setItinerary: setEditedItinerary,
    pushUndo,
    undo,
    focusDay: handleFocusDayCard,
  });

  // Render from state, not trip.itinerary: the prop is the server-rendered
  // copy and goes stale after any save, so an applied edit would vanish the
  // moment edit mode exits. State is also a stable reference, which this needs:
  // a fresh array each render (e.g. new ids from ensureActivityIds) changes
  // itineraryHash, makes useTravelDistances refetch, and loops re-rendering.
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


  // A live trip opens on Today, in either phase. The active phase used to show
  // only OngoingTripView, so its crew chips, feed and Who paid? never appeared here.
  const todayView = showToday ? (
    <TodayView
      itinerary={displayItinerary}
      dayState={dayState}
      currency={trip.budget?.currency}
      weatherNote={trip.meta?.weather_note}
      onViewFullItinerary={() => setTodayMode(false)}
      tripId={trip.id}
      apiBase={`/api/trips/${trip.id}/today`}
      onSettleUp={expenseLedgerEnabled ? () => setSettleFromToday(true) : undefined}
      className="mb-6"
    />
  ) : null;
  const backToToday =
    dayState.isLive && !todayMode && !isEditMode ? (
      <button
        type="button"
        onClick={() => setTodayMode(true)}
        data-testid="back-to-today"
        className="mb-4 inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)]/10 px-3 py-2 text-sm font-medium text-[var(--primary-ink)] hover:bg-[var(--primary)]/15"
      >
        <span aria-hidden>←</span> {tCommon("today.backToToday")}
      </button>
    ) : null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-white">
      {/* Hero with Cover Image - Enhanced with weather and stats */}
      <DestinationHero
        destination={destination}
        title={trip.title}
        subtitle={trip.description}
        dateRange={dateRange}
        budget={trip.budget?.total ? trip.budget : undefined}
        days={trip.itinerary.length}
        nights={tripNights(trip.startDate, trip.endDate)}
        activitiesCount={displayItinerary.reduce((acc, day) => acc + day.activities.length, 0)}
        weatherNote={trip.meta?.weather_note}
        highlights={trip.meta?.highlights}
        tags={trip.tags}
        showBackButton={true}
        onBack={() => window.history.back()}
        coverImageUrl={coverImageUrl}
        // When the trip has a persisted cover URL, skip the Places API
        // entirely. Without one, allow ONE fetch + persist it via the
        // callback below (owner only) so later visits read straight from
        // the DB. Disabling the API unconditionally would leave trips with
        // no stored cover on the gradient fallback forever.
        disableApiCalls={!!coverImageUrl}
        onCoverImageFetched={handleCoverImageFetched}
      >
        {/* Status Badge + Backpacker badge stack — top-right of hero.
            The Backpacker badge renders for trips generated in Backpacker
            Mode: a visible cue of what backpacker mode looks like. */}
        <div className="absolute top-4 right-4 flex flex-col items-end gap-2">
          <TripStatusBadge status={shownStatus} />
          {trip.meta?.travel_style === "backpacker" && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium shadow-lg bg-emerald-500 text-white">
              <span aria-hidden>🎒</span>
              {tCommon("shared.backpackerRoute")}
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
          isAIAssistantOpen || assistantDockReserved ? "lg:mr-[420px]" : ""
        }`}
        // Reserved, not open: globals.css drops the column when <html> says
        // this browser has already met the assistant.
        data-assistant-dock={assistantDockReserved && !isAIAssistantOpen ? "reserved" : undefined}
      >
        {/* Who said they're going — count, names, join times, remove.
            The share ask is "send it to the people coming", not "get
            votes". */}
        {isOwner && participantsEnabled && !isEditMode && (
          <WhoIsGoingCard tripId={trip.id} onShare={openCrewShareModal} className="mb-6" />
        )}
        {/* Backpacker Mode — Hostelworld CTA. Renders only when the
            trip was generated as backpacker (trip_meta.travel_style).
            Placed above the engagement bar, near the top of the page,
            because that's the surface we want CTR on for the
            Hostelworld partnership signal. */}
        {trip.meta?.travel_style === "backpacker" && (
          <BackpackerHostelCta
            tripId={trip.id}
            destination={destination}
            startDate={trip.startDate}
            endDate={trip.endDate}
            className="mb-6"
          />
        )}

        {/* Owner-side /explore engagement bar + Publish-to-Explore
            toggle. Null when the explore flag is off. Sits near the top
            of <main> so the owner sees their counts + publish state
            immediately on page load. */}
        {engagementSlot && (
          <div className="mb-6 flex items-center gap-3">
            {engagementSlot}
          </div>
        )}

        {/* Planning Phase - Confirm Trip Action. Owner only: confirming or
            cancelling is the trip's lifecycle, and PATCH /status admits only
            the owner, so a collaborator's click would be a silent 404. */}
        {shownStatus === "planning" && isOwner && (
          <ConfirmTripCard
            updating={isUpdatingStatus}
            onConfirm={() => handleStatusUpdate("confirmed")}
            onCancel={() => setConfirmCancelTrip(true)}
          />
        )}

        {/* A cancelled trip can be restored to planning. */}
        {currentStatus === "cancelled" && isOwner && (
          <CancelledTripNote updating={isUpdatingStatus} onRestore={() => handleStatusUpdate("planning")} />
        )}

        {/* In-trip Concierge. Rendered in EVERY phase, outside the
            !isActiveTripPhase branch, so the chat is there while the user
            is ON the trip. Flag-gated; renders null when the env flag is
            off. Apply is offered to the owner only; canEdit gates just the
            UI (the /apply route checks access itself). */}
        <div className="mb-4 space-y-2">
          <TripConciergeChat
            tripId={trip.id}
            canEdit={isOwner}
            runItineraryWrite={runItineraryWrite}
            onItineraryChange={adoptStoredItinerary}
          />
          {/* Past Q+A pairs for THIS trip. Lazy expand-to-fetch; renders
              nothing when the Concierge env-flag is off. */}
          <ConciergeHistory tripId={trip.id} />
        </div>

        {/* Pre-Trip Phase - Countdown Hero and Checklist */}
        {isPreTripPhase && (
          <div className="space-y-4 mb-6">
            {/* coverImageUrl is passed deliberately: CountdownHero renders a
                full-bleed photo when it has one and a flat gradient when it
                does not.

                weatherForecast is NOT passed. The component wants
                {temp, condition, icon}, but /api/weather returns HISTORICAL
                weather (the same dates in a past year), not a forecast, and
                labelling it as the forecast would mislead on the surface
                people are most likely to screenshot. Needs a real forecast
                source. */}
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

        {/* Active Trip Phase - Today, else the Ongoing Trip View */}
        {isActiveTripPhase && (todayView ?? (
          <>
            {backToToday}
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
          </>
        ))}
        {/* The live view has no share button, so a share request (the crew
            CTAs, ?share=invite) mounts just its modal. */}
        {isActiveTripPhase && (crewShareRequest > 0 || shouldAutoOpenShareModal) && (
          <ShareButton
            key={`share-${crewShareRequest}`}
            variant="modal"
            tripId={trip.id}
            tripTitle={trip.title}
            tripIntent={trip.meta?.trip_intent}
            canManageSharing={isOwner}
            autoOpen
            initialTab={crewShareRequest > 0 ? "share" : "invite"}
          />
        )}

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
              addToast(tCommon("proposals.toasts.submitted"), "success", 4000);
            }}
          />
        )}

        {/* Planning/Confirmed Phase - Full Itinerary View */}
        {!isActiveTripPhase && (
          <>
        {/* Travel advisory banner — sourced from UK FCDO.
            Hides itself entirely when the destination has no active alert,
            so it never adds visual noise to safe-destination trips. */}
        <TravelAdvisoryBanner country={destination} className="mb-4" />

        {/* Multi-city Journey ribbon with transit labels ("TRENO · 4h") */}
        {journeyStops.length > 1 && (
          <JourneyRibbon stops={journeyStops} className="mb-4" />
        )}

        {/* Controls Bar */}
        <TripControlsBar
          trip={trip}
          viewMode={viewMode}
          setViewMode={setViewMode}
          showMap={showMap}
          setShowMap={setShowMap}
          isEditMode={isEditMode}
          crewShareRequest={crewShareRequest}
          isOwner={isOwner}
          shouldAutoOpenShareModal={shouldAutoOpenShareModal}
          canUseAssistant={canUseAssistant}
          onOpenAssistant={() => setIsAIAssistantOpen(true)}
          displayItinerary={displayItinerary}
          emailParseEnabled={emailParseEnabled}
          onPasteBooking={() => setIsPasteBookingOpen(true)}
        >
          {/* Editing controls. Ambient (solo) owners edit inline with
              auto-save — no mode toggle, just undo/redo + a status pill.
              Other editors use the explicit edit mode. */}
          <TripEditControls
            ambientEdit={ambientEdit}
            undo={undo}
            redo={redo}
            canUndo={canUndo}
            canRedo={canRedo}
            saveStatus={saveStatus}
            onRetrySave={() => {
              lastFailedSaveRef.current = null;
              setEditedItinerary((prev) => [...prev]);
            }}
            isEditMode={isEditMode}
            canEdit={canEdit}
            handleEnterEditMode={handleEnterEditMode}
            handleDiscardChanges={handleDiscardChanges}
            handleSaveChanges={handleSaveChanges}
            isSaving={isSaving}
            itineraryWritesInFlight={itineraryWritesInFlight}
            hasChanges={hasChanges}
          />
        </TripControlsBar>

        {/* Ambient-edit hint — one subtle line telling solo owners the plan
            is directly editable and saves itself, so the manual editor is
            discoverable. */}
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
        {showMap && hasCoordinates(displayItinerary) && (
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

        {/* Post-booking expense tracking. Behind the
            NEXT_PUBLIC_EXPENSE_LEDGER_ENABLED flag — renders null when off,
            so the layout is unchanged where it isn't enabled. */}
        <ExpenseLedger
          tripId={trip.id}
          defaultCurrency={trip.budget?.currency || "EUR"}
          className="mb-8"
        />

        {/* Crew Loop: the crew's votes once the share link has some, or for a
            trip never shared, a nudge to send it. Hidden during edit mode
            (ShareButton unmounts there, so the buttons would have nothing to
            open). */}
        {!isEditMode && isOwner && crewVotes !== null && crewVotes.total > 0 && (
          <CrewVotesSummary votes={crewVotes} onShare={openCrewShareModal} />
        )}
        {!isEditMode && isOwner && crewSharingEnabled === false && trip.itinerary.length >= 2 && (
          <CrewShareNudge tripId={trip.id} onShare={openCrewShareModal} />
        )}

        {todayView}

        {!showToday && (
        <>
        {backToToday}
        {/* Day Filter Slider - Mobile optimized */}
        <DaySlider
          days={displayItinerary}
          selectedDay={selectedDay}
          onSelectDay={setSelectedDay}
          className="mb-6"
        />

        <PlacesCheckedNote note={placesJustChecked ?? placesToEatNote(trip.meta)} className="mb-4" />

        <TripDayList
          days={displayItinerary}
          selectedDay={selectedDay}
          renderEpoch={renderEpoch}
          viewMode={viewMode}
          isEditMode={isEditMode}
          editingActive={editingActive}
          destination={destination}
          currency={trip.budget?.currency}
          pace={trip.meta?.pace}
          moves={moves}
          focusedDay={aiFocusDay}
          aiUpdatedActivityId={aiUpdatedActivityId}
          regeneratingDayNumber={regeneratingDayNumber}
          regeneratingActivityId={regeneratingActivityId}
          travelData={travelData}
          travelLoading={travelLoading}
          crewVotes={crewVotes}
          availableDays={availableDays}
          dayOptions={dayOptions}
          votingProps={activityVotingProps}
          timelineOf={getMergedTimeline}
          canVote={canVote}
          voterCount={voterCount}
          onOpenProposal={openVotingSheet}
          onRegenerateDay={userRole === "owner" ? (dayNumber) => setDayRegenPrompt({ dayNumber, text: "" }) : null}
          onOptimizeRoute={openRouteOptimization}
          onSuggestActivity={votingEnabled && canPropose ? handleOpenProposeModal : null}
          onActivityDelete={handleActivityDelete}
          onActivityUpdate={handleActivityUpdate}
          onActivityRegenerate={handleActivityRegenerate}
          onAddActivity={handleAddActivity}
          onPhotoCapture={handlePhotoCapture}
        />
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

        {!isEditMode && (
          <AiDisclaimer title={t('detail.aiGenerated')}>
            {t('detail.aiGeneratedDescription')} {t('detail.clickMoreInfo')}
          </AiDisclaimer>
        )}

        {/* Edit Mode Instructions */}
        {isEditMode && <EditModeNotice />}
          </>
        )}
        {/* Outside both phases: Today shows during the trip and before it. */}
        {settleFromToday && <SettleUpView tripId={trip.id} isOpen onClose={() => setSettleFromToday(false)} />}
      </main>

      {/* Edit Mode Undo/Redo Bar - Minimal, with status indicator */}
      {isEditMode && (
        <TripEditBar undo={undo} redo={redo} canUndo={canUndo} canRedo={canRedo} hasChanges={hasChanges} saveError={saveError} />
      )}

      {/* Bottom padding when edit bar is showing */}
      {isEditMode && <div className="h-20" />}

      {/* AI Assistant Floating Button — primary CTA. Bigger + accented +
          pulses for first-time visitors so the assistant is hard to miss. */}
      {canUseAssistant && (
        <TripAssistantButton
          isEditMode={isEditMode}
          hasSeenAssistant={hasSeenAssistant}
          onOpen={() => setIsAIAssistantOpen(true)}
        />
      )}

      <CancelTripDialog
        isOpen={confirmCancelTrip}
        onClose={() => setConfirmCancelTrip(false)}
        onConfirm={() => {
          setConfirmCancelTrip(false);
          void handleStatusUpdate("cancelled");
        }}
      />

      {/* Regenerate one day, optionally steered ("boarding the cruise"). */}
      <RegenerateDayDialog
        prompt={dayRegenPrompt}
        onChange={setDayRegenPrompt}
        onRegenerate={(dayNumber, text) => void handleDayRegenerate(dayNumber, text)}
      />

      {/* AI Assistant Sidebar/Bottom Sheet */}
      {canUseAssistant && (
        <AIAssistant
          tripId={trip.id}
          tripTitle={trip.title}
          itinerary={displayItinerary}
          isOpen={isAIAssistantOpen}
          onClose={() => setIsAIAssistantOpen(false)}
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
      {saveSuccess && <SaveSuccessToast onDismiss={() => setSaveSuccess(false)} />}

      {/* Voting Bottom Sheet - for inline proposal voting */}
      <VotingBottomSheet
        isOpen={votingSheetState.isOpen}
        onClose={closeVotingSheet}
        proposal={votingSheetState.proposal}
        currentUserId={undefined}
        {...votingSheetActions}
        totalVoters={voterCount}
        isOwner={userRole === 'owner'}
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

      {/* The share ask. Renders null until the owner has actually engaged
          with the trip (so they have read what they are asked to send), and
          only when no link exists yet. Deliberately OUTSIDE the
          isCollaborativeTrip gate: it exists to reach owners of trips that
          have no collaborators yet. */}
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
