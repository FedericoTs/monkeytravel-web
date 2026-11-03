"use client";

import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { RefreshCw } from "lucide-react";
import { CrewShareNudge, CrewVotesSummary, useCrewVotes } from "@/components/trip/CrewVotes";
import type { ItineraryDay, Activity, TripMeta, CachedDayTravelData, CollaboratorRole, VoteType } from "@/types";
import { ROLE_PERMISSIONS } from "@/types";
import { getTripDestination } from "@/lib/trips/destination";
import { hasCoordinates } from "@/lib/trips/has-coordinates";
import { isRealPoint } from "@/lib/trip/placeholder-point";
import { withFoundPhotos } from "@/lib/trips/keep-place-photos";
import { useKeptTripPhotos } from "@/hooks/useKeptTripPhotos";
import { useEditShortcuts } from "@/hooks/useEditShortcuts";
import { useDayFocus } from "@/hooks/useDayFocus";
import BackpackerHostelCta from "@/components/trip/BackpackerHostelCta";
import WhoIsGoingCard from "@/components/trip/WhoIsGoingCard";
import TodayView from "@/components/trip/TodayView";
import { useLiveTripState } from "@/lib/trip/useLiveTripState";
import { computeTripDayState, type TripDayState } from "@/lib/trip/live";
import { dayBudgetLabel, showsDayBudget } from "@/lib/trip/day-budget";
import DayHeader, { DayBudget } from "@/components/trip/DayHeader";
import AiDisclaimer from "@/components/trip/AiDisclaimer";
import { isLiveTripParticipantsEnabled } from "@/lib/participants/flag";
// TravelAdvisoryBanner / ExpenseLedger / TripConciergeChat are loaded with
// next/dynamic further down, which keeps the initial trip-page chunk lean.
import { useActivityVotes } from "@/hooks/useActivityVotes";
import { useProposals } from "@/hooks/useProposals";
import { useProposalApprovals } from "@/hooks/useProposalApprovals";
import { dayTimeline } from "@/lib/proposals/timeline";
import { InlineProposalCard } from "@/components/collaboration/proposals";
import DestinationHero from "@/components/DestinationHero";
import EditableActivityCard from "@/components/trip/EditableActivityCard";
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
import ActivityRow from "@/components/trip/ActivityRow";
import DaySummary from "@/components/trip/DaySummary";
import { DayTimeline } from "@/components/trip/DayTimeline";
import { tripNights } from "@/lib/dates/iso-date";
import {
  CountdownHero,
  PreTripChecklist,
} from "@/components/timeline";
import { useChecklist } from "@/hooks/useChecklist";
import { useToast } from "@/components/ui/Toast";
import { useCurrency } from "@/lib/locale";
import { trackActivityRegenerated, trackTripViewed } from "@/lib/analytics";
import { segmentBetween, useTravelDistances } from "@/hooks/useTravelDistances";
import { getCoordinatesForNewActivity, type Coordinates } from "@/lib/utils/geo";
import {
  ensureActivityIds,
  ensureActivityIdsStable,
  deleteActivity,
  updateActivity,
  replaceActivity,
  generateActivityId,
  addActivity,
  calculateNextTimeSlot,
  determineTimeSlot,
} from "@/lib/utils/activity-id";
import AddActivityButton from "@/components/trip/AddActivityButton";
import SortableActivityCard from "@/components/trip/SortableActivityCard";
import { useTranslations, useLocale } from "next-intl";
import { JourneyRibbon } from "@/components/trips/JourneyRibbon";
import { buildJourneyStops } from "@/lib/ai/transfer-legs";
import {
  DndContext,
  DragOverlay,
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
import { useItineraryMoves } from "@/hooks/useItineraryMoves";
import { useItineraryHistory } from "@/hooks/useItineraryHistory";
import { CancelTripDialog, CancelledTripNote, ConfirmTripCard, TripStatusBadge, useTripStatus } from "@/components/trip/TripStatus";
import {
  ActivityDragGhost,
  DayDropHeader,
  DayDropList,
  dayOptionsOf,
  makeItineraryCollisionDetection,
} from "@/components/trip/ItineraryDnd";

import { useAssistantFirstVisit } from "@/hooks/useAssistantFirstVisit";
import { readItineraryVersion } from "@/lib/trips/itinerary-sync";
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

  // Currency conversion hook — converts source-currency activity costs into
  // the user's preferred currency. Backs formatDayBudget below.
  const { convert: convertCurrency, format: formatCurrency } = useCurrency();

  const formatDayBudget = (day: ItineraryDay): string =>
    dayBudgetLabel(day, { convert: convertCurrency, format: formatCurrency }, tCommon('activity.free'), trip.budget?.currency || "USD");

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
  // Persist a freshly-resolved cover image back to the trip row so later
  // visits skip the Google Places fetch (cost and reliability). Only the
  // owner persists it. Fire-and-forget — if the PATCH fails the in-memory
  // state still keeps the hero visible for this session.
  const isOwner = userRole === "owner";
  // The trip assistant changes the trip, so it is for the people who can:
  // the owner and editors (the API answers 403 to anyone else).
  const canUseAssistant = ROLE_PERMISSIONS[userRole]?.canEdit ?? false;
  // The owner sees who said they're going.
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
  // One copy for both states, with ids derived from the stored trip for any
  // activity stored without one. Random ids would differ between the two
  // states and between mounts, so the page would look edited on its first
  // render (a phantom autosave, or a false conflict on a router-cache
  // restore). For solo owners the effect after ambientEdit stores them once.
  const [initialItinerary] = useState(() => ensureActivityIdsStable(trip.itinerary, trip.id));
  const [editedItinerary, setEditedItinerary] = useState<ItineraryDay[]>(() =>
    JSON.parse(JSON.stringify(initialItinerary))
  );

  const [regeneratingActivityId, setRegeneratingActivityId] = useState<string | null>(null);
  // Per-day regeneration: tracks which day_number is currently being replaced.
  const [regeneratingDayNumber, setRegeneratingDayNumber] = useState<number | null>(null);
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

  const collisionDetection = useMemo(() => makeItineraryCollisionDetection(), []);
  // Re-measure every droppable on each move. dnd-kit measures droppables once
  // when a drag starts and only re-measures sortable ITEMS when a list
  // changes — the day headers and lists are not sortable items, so anything
  // that shifts the page mid-drag (the preview moving a card between days,
  // the map or an image loading) would leave their rects stale and a drop over
  // a header would land somewhere else. ~15 rects per move is negligible.
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
  }, [pushUndo, addToast, ambientEdit, t]);

  // Edit handlers (with undo support). Moves between days come from
  // useItineraryMoves further down, after handleFocusDayCard, which it uses to
  // scroll to the destination day.

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
        if (isRealPoint(activity.coordinates)) {
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
    [setSavedItinerary, canEdit, trip.id]
  );

  const handleActivityRegenerate = useCallback(
    async (activityId: string, dayIndex: number) => {
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

        const data = response.ok ? await response.json() : null;
        if (!data?.activity) {
          throw Object.assign(new Error("Failed to regenerate activity"), { status: response.status });
        }
        // Undo is offered for a change that happened: a failed attempt leaves
        // nothing to undo, and the redo stack as it was.
        pushUndo("Regenerate activity");
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
      } catch (error) {
        console.error("Error regenerating activity:", error);
        const status = (error as { status?: number } | null)?.status;
        const msg = status === 429 ? t("detail.activityRegenerateLimit") : t("detail.activityRegenerateFailed");
        setSaveError(msg);
        addToast(msg, "error");
      } finally {
        setRegeneratingActivityId(null);
      }
    },
    [trip.id, destination, editedItinerary, pushUndo, t, setSaveError, addToast]
  );

  // Per-day regeneration: replaces all activities of a single day with a
  // fresh generation that takes the surrounding days as context, steered by
  // what the traveller wrote in the dialog (sent as `instructions`). Confirmed
  // in the dialog; once the new day arrives, pushed to the undo stack and
  // swapped in.
  const handleDayRegenerate = useCallback(
    async (dayNumber: number, instructions?: string) => {
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
          // Undo is offered once there is a new day: a refused or failed
          // attempt leaves nothing to undo, and the redo stack as it was.
          // The step holds the plan as it was when the day was asked for.
          pushUndo(`Regenerate Day ${dayNumber}`);
          await adoptDayWrite(splice, from, to);
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
    [pushUndo, runItineraryWrite, addToast, t, trip.id, adoptDayWrite, setSaveError]
  );


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
          <TripStatusBadge status={currentStatus} />
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
        {currentStatus === "planning" && isOwner && (
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

        {/* Itinerary */}
        {displayItinerary.length > 0 ? (
          // One drag context for the whole plan, so a card can be dragged from
          // any day to any other (with one context per day, a drag past the
          // day boundary snaps back). Inert when nothing is sortable (view
          // mode / read-only), so it wraps unconditionally.
          <DndContext
            sensors={sensors}
            collisionDetection={collisionDetection}
            measuring={dndMeasuring}
            onDragStart={moves.onDragStart}
            onDragOver={moves.onDragOver}
            onDragEnd={moves.onDragEnd}
            onDragCancel={moves.onDragCancel}
          >
          <div className="space-y-8" key={`itinerary-v${renderEpoch}`}>
            {(moves.preview ?? displayItinerary)
              // dayIndex is the day's place in the whole trip, which the edit
              // handlers index by; with a day selected it's the only one shown.
              .map((day, dayIndex) => ({ day, dayIndex }))
              .filter(({ day }) => selectedDay === null || day.day_number === selectedDay)
              .map(({ day, dayIndex }, shownIndex) => (
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
                  <DayDropHeader dayNumber={day.day_number} dragging={moves.dragging}>
                  <DayHeader
                    dayNumber={day.day_number}
                    title={t('day.label', { number: day.day_number })}
                    theme={day.theme}
                    editing={isEditMode}
                  >
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
                      {showsDayBudget(day) && (
                        <DayBudget label={t('detail.estBudget')} value={formatDayBudget(day)} className="text-right" />
                      )}
                    </div>
                  </DayHeader>
                  </DayDropHeader>

                  {/* Activities */}
                  {viewMode === "cards" ? (
                    <>
                      {editingActive ? (
                        /* Edit Mode with Drag-and-Drop */
                        <>
                          {/* Edit mode reorder hint - only on the first day shown */}
                          {shownIndex === 0 && (
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
                            dragging={moves.dragging}
                            isEmpty={day.activities.length === 0}
                          >
                            <SortableContext
                              items={day.activities.map((a) => a.id || `activity-${day.activities.indexOf(a)}`)}
                              strategy={verticalListSortingStrategy}
                            >
                              <div className="grid gap-0">
                              {day.activities.map((activity, idx) => {
                                const isAIUpdated = aiUpdatedActivityId === activity.id;
                                const nextActivity = day.activities[idx + 1];
                                const dayTravelData = travelData.get(day.day_number);
                                const segment = segmentBetween(dayTravelData, activity, nextActivity);

                                return (
                                  <ActivityRow
                                    key={`${activity.id || idx}-v${renderEpoch}`}
                                    crewVotes={crewVotes}
                                    activityId={activity.id}
                                    aiUpdated={isAIUpdated}
                                    travelTo={
                                      idx < day.activities.length - 1
                                        ? { segment, isLoading: travelLoading || dayTravelData?.isLoading }
                                        : null
                                    }
                                  >
                                    <SortableActivityCard
                                      activity={activity}
                                      index={idx}
                                      currency={trip.budget?.currency}
                                      showGallery={true}
                                      isEditMode={true}
                                      onDelete={() => handleActivityDelete(activity.id!)}
                                      onUpdate={(updates) => handleActivityUpdate(activity.id!, updates)}
                                      onMoveToDay={(targetDayIdx) => moves.moveToDay(activity.id!, targetDayIdx)}
                                      onRegenerate={() => handleActivityRegenerate(activity.id!, dayIndex)}
                                      availableDays={availableDays}
                                      dayOptions={dayOptions}
                                      currentDayIndex={dayIndex}
                                      isRegenerating={regeneratingActivityId === activity.id}
                                      disableAutoFetch={true}
                                      onPhotoCapture={handlePhotoCapture}
                                      {...activityVotingProps(activity.id)}
                                    />
                                  </ActivityRow>
                                );
                              })}
                            </div>
                          </SortableContext>
                          </DayDropList>
                        </>
                      ) : (
                        /* View Mode - Merged Timeline with Activities and Inline Proposals */
                        <div className="grid gap-0">
                          {getMergedTimeline(day.day_number).map((item) => {
                            if (item.type === 'activity') {
                              const activity = item.data;
                              const idx = item.index;
                              const isAIUpdated = aiUpdatedActivityId === activity.id;
                              const nextActivity = day.activities[idx + 1];
                              const dayTravelData = travelData.get(day.day_number);
                              const segment = segmentBetween(dayTravelData, activity, nextActivity);

                              return (
                                <ActivityRow
                                  key={`activity-${activity.id || idx}-v${renderEpoch}`}
                                  crewVotes={crewVotes}
                                  activityId={activity.id}
                                  aiUpdated={isAIUpdated}
                                  travelTo={
                                    idx < day.activities.length - 1
                                      ? { segment, isLoading: travelLoading || dayTravelData?.isLoading }
                                      : null
                                  }
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
                                    {...activityVotingProps(activity.id)}
                                  />
                                </ActivityRow>
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
                        // ml-6 plus its w-full makes the page wider than a
                        // phone screen (it scrolls sideways).
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
                    <DayTimeline
                      day={day}
                      travel={travelData.get(day.day_number)}
                      travelLoading={travelLoading}
                      pace={trip.meta?.pace}
                      currency={trip.budget?.currency || "USD"}
                    />
                  )}
                </div>
              ))}
          </div>
          {/* The card that follows the pointer; the source card stays as a faded placeholder. */}
          <DragOverlay dropAnimation={{ duration: 200, easing: "cubic-bezier(0.18, 0.67, 0.6, 1.22)" }}>
            <ActivityDragGhost activity={moves.draggedActivity} />
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

        {!isEditMode && (
          <AiDisclaimer title={t('detail.aiGenerated')}>
            {t('detail.aiGeneratedDescription')} {t('detail.clickMoreInfo')}
          </AiDisclaimer>
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
            addToast(tCommon("proposals.toasts.voteRecorded"), "success");
          }
        }}
        onRemoveVote={async () => {
          if (votingSheetState.proposal) {
            await removeProposalVote(votingSheetState.proposal.id);
            addToast(tCommon("proposals.toasts.voteRemoved"), "success");
          }
        }}
        totalVoters={voterCount}
        isOwner={userRole === 'owner'}
        onForceResolve={async (action) => {
          if (votingSheetState.proposal) {
            try {
              await forceResolve(votingSheetState.proposal.id, action);
            } catch (err) {
              addToast(t('detail.proposalActionFailed'), "error");
              throw err;
            }
            // An approval is confirmed by handleProposalChange, with the day.
            if (action === 'reject') addToast(tCommon("proposals.toasts.rejected"), "success");
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
