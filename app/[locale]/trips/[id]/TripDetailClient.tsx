"use client";

import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { useSearchParams, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { Undo2, Redo2 } from "lucide-react";
import type { ItineraryDay, Activity, TripMeta, CachedDayTravelData, CollaboratorRole, VoteType, ProposalVoteType, ProposalWithVotes } from "@/types";
import { ROLE_PERMISSIONS } from "@/types";
import { useActivityVotes } from "@/lib/hooks/useActivityVotes";
import { useProposals } from "@/lib/hooks/useProposals";
import { ProposeActivitySheet, InlineProposalCard, VotingBottomSheet } from "@/components/collaboration/proposals";
import { RouteOptimizationModal } from "@/components/trip/RouteOptimizationModal";
import DestinationHero from "@/components/DestinationHero";
import EditableActivityCard from "@/components/trip/EditableActivityCard";
import ShareButton from "@/components/trip/ShareButton";
import ExportMenu from "@/components/trip/ExportMenu";
import AIAssistant from "@/components/ai/AIAssistant";
import TripBookingLinks from "@/components/trip/TripBookingLinks";
import { BookingPanel, EnhancedBookingPanel, PostConfirmationBanner, BookingDrawer } from "@/components/booking";
import { useFlag } from "@/lib/posthog/hooks";
import { FLAG_ENHANCED_BOOKING } from "@/lib/posthog/flags";
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
  ActivityRatingModal,
} from "@/components/timeline";
import { useChecklist } from "@/lib/hooks/useChecklist";
import { useToast } from "@/components/ui/Toast";
import { trackActivityRegenerated, trackTripViewed } from "@/lib/analytics";
import { useActivityTimeline } from "@/lib/hooks/useActivityTimeline";
import { useTravelDistances } from "@/lib/hooks/useTravelDistances";
import { getCoordinatesForNewActivity, type Coordinates } from "@/lib/utils/geo";
import {
  ensureActivityIds,
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
  reorderActivities,
  recalculateActivityTimes,
} from "@/lib/utils/activity-id";
import AddActivityButton from "@/components/trip/AddActivityButton";
import SortableActivityCard from "@/components/trip/SortableActivityCard";
import { useTranslations } from "next-intl";
import {
  DndContext,
  DragEndEvent,
  closestCenter,
  KeyboardSensor,
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
// Amadeus booking components - kept for future use
// import FlightSearch from "@/components/booking/FlightSearch";
// import HotelSearch from "@/components/booking/HotelSearch";

// Google Places-based hotel recommendations
import HotelRecommendations from "@/components/trip/HotelRecommendations";

// Ongoing trip view with gamification
import OngoingTripView from "@/components/trip/OngoingTripView";

// Dynamic import for TripMap to avoid SSR issues with Google Maps
const TripMap = dynamic(() => import("@/components/TripMap"), {
  ssr: false,
  loading: () => (
    <div className="h-[400px] bg-slate-100 rounded-xl animate-pulse flex items-center justify-center">
      <span className="text-slate-400"></span>
    </div>
  ),
});

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
  };
  dateRange: string;
  // Collaboration props (optional - only passed for collaborative trips)
  isCollaborativeTrip?: boolean;
  userRole?: CollaboratorRole;
  collaboratorCount?: number;
}

export default function TripDetailClient({
  trip,
  dateRange,
  isCollaborativeTrip = false,
  userRole = "owner",
  collaboratorCount = 0,
}: TripDetailClientProps) {
  const t = useTranslations('trips');
  const tTrips = useTranslations('common.trips');
  const tButtons = useTranslations('common.buttons');

  // Check for share query param (used to auto-open share modal after trip save)
  const searchParams = useSearchParams();
  const shareParam = searchParams.get("share");
  const shouldAutoOpenShareModal = shareParam === "invite";

  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [showMap, setShowMap] = useState(true);
  const [viewMode, setViewMode] = useState<"timeline" | "cards">("cards");
  const [isAIAssistantOpen, setIsAIAssistantOpen] = useState(false);

  // Edit mode state
  const [isEditMode, setIsEditMode] = useState(false);
  const [editedItinerary, setEditedItinerary] = useState<ItineraryDay[]>(() =>
    ensureActivityIds(trip.itinerary)
  );
  // Track the last saved state (so we can detect changes and revert without page reload)
  const [savedItinerary, setSavedItinerary] = useState<ItineraryDay[]>(() =>
    ensureActivityIds(trip.itinerary)
  );
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [regeneratingActivityId, setRegeneratingActivityId] = useState<string | null>(null);

  // Status management
  const router = useRouter();
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [currentStatus, setCurrentStatus] = useState(trip.status);

  // Booking drawer state (for collecting flight origin)
  const [isBookingDrawerOpen, setIsBookingDrawerOpen] = useState(false);

  // Feature flag for enhanced booking panel
  const { enabled: useEnhancedBooking } = useFlag(FLAG_ENHANCED_BOOKING);

  // Version counter to force re-render after AI updates
  const [itineraryVersion, setItineraryVersion] = useState(0);

  // Ref to track if we just updated from AI (for animations)
  const aiUpdateRef = useRef<{ dayIndex: number; activityId: string } | null>(null);

  // Track if there are unsaved changes (compare against saved state, not prop)
  const hasChanges = JSON.stringify(editedItinerary) !== JSON.stringify(savedItinerary);

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

  // Extract destination from title (e.g., "Rome Trip" -> "Rome")
  const destination = trip.title.replace(/ Trip$/, "");

  // Trip phase detection for Timeline feature
  const tripStartDate = useMemo(() => new Date(trip.startDate), [trip.startDate]);
  const tripEndDate = useMemo(() => new Date(trip.endDate), [trip.endDate]);
  const now = new Date();

  // Pre-trip: Trip is confirmed and start date is in the future
  const isPreTripPhase = trip.status === "confirmed" && tripStartDate > now;

  // Active trip: Between start and end dates
  const isActiveTripPhase = trip.status === "active" ||
    (tripStartDate <= now && now <= tripEndDate);

  // Calculate trip days and total activities for countdown
  const tripDaysCount = trip.itinerary.length;
  const totalActivities = editedItinerary.reduce((acc, day) => acc + day.activities.length, 0);

  // Pre-trip checklist (only load when in pre-trip phase)
  const checklist = useChecklist(trip.id);

  // Toast notifications
  const { addToast } = useToast();

  // Handle status update
  const handleStatusUpdate = async (newStatus: "confirmed" | "cancelled") => {
    setIsUpdatingStatus(true);
    try {
      const response = await fetch(`/api/trips/${trip.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to update status");
      }

      setCurrentStatus(newStatus);
      addToast(
        newStatus === "confirmed"
          ? tTrips("tripConfirmed")
          : tTrips("tripCancelled"),
        "success"
      );
      router.refresh();
    } catch (error) {
      console.error("Error updating status:", error);
      addToast(
        error instanceof Error ? error.message : "Failed to update status",
        "error"
      );
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip.id]); // Only track once per trip view

  // Calculate day progress for LiveJourneyHeader
  const dayProgress = activityTimeline.getDayProgress(allActivitiesByDay, currentDayNumber);

  // Get current and next activity
  const currentActivity = activityTimeline.getCurrentActivity(currentDayActivities);
  const nextActivity = activityTimeline.getNextActivity(currentDayActivities);

  // Available days for "move to day" feature
  const availableDays = editedItinerary.map((day) => day.day_number);

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

  const handleActivityMoveToDay = useCallback(
    (activityId: string, targetDayIndex: number) => {
      pushUndo(`Move activity to day ${targetDayIndex + 1}`);
      setEditedItinerary((prev) => {
        // Find the source day
        const location = findActivityById(prev, activityId);
        if (!location) return prev;

        // Move the activity
        const moved = moveActivityToDay(prev, activityId, targetDayIndex);
        // Recalculate times for both source and target days
        const withSourceTimes = recalculateActivityTimes(moved, location.dayIndex);
        return recalculateActivityTimes(withSourceTimes, targetDayIndex);
      });
    },
    [pushUndo]
  );

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

  // Handle drag-and-drop reordering of activities within a day
  const handleDragEnd = useCallback(
    (event: DragEndEvent, dayIndex: number) => {
      const { active, over } = event;

      if (!over || active.id === over.id) {
        return;
      }

      const day = editedItinerary[dayIndex];
      if (!day) return;

      // Find indices by activity ID
      const oldIndex = day.activities.findIndex((a) => a.id === active.id);
      const newIndex = day.activities.findIndex((a) => a.id === over.id);

      if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) {
        return;
      }

      pushUndo("Reorder activities");
      // Reorder activities and recalculate times based on new order
      setEditedItinerary((prev) => {
        const reordered = reorderActivities(prev, dayIndex, oldIndex, newIndex);
        return recalculateActivityTimes(reordered, dayIndex);
      });
    },
    [editedItinerary, pushUndo]
  );

  // Handle photo capture from PlaceGallery - persists to database
  const handlePhotoCapture = useCallback(
    async (activityId: string, photoUrl: string) => {
      // Update local state immediately for instant UI feedback
      setEditedItinerary((prev) => updateActivity(prev, activityId, { image_url: photoUrl }));
      setSavedItinerary((prev) => updateActivity(prev, activityId, { image_url: photoUrl }));

      // Persist to database in background (don't await, fire-and-forget)
      fetch(`/api/trips/${trip.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itinerary: updateActivity(editedItinerary, activityId, { image_url: photoUrl }),
        }),
      }).catch((error) => {
        console.error("[Photo Capture] Failed to persist photo:", error);
        // Don't show error to user - photo is still displayed from local state
      });

      console.log(`[Photo Capture] Captured Places photo for activity ${activityId}`);
    },
    [trip.id, editedItinerary]
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

  const handleSaveChanges = useCallback(async () => {
    setIsSaving(true);
    setSaveError(null);
    setSaveSuccess(false);

    try {
      const response = await fetch(`/api/trips/${trip.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itinerary: editedItinerary }),
      });

      if (!response.ok) {
        throw new Error("Failed to save changes");
      }

      // Update saved state to match current edited state (deep clone to avoid reference issues)
      setSavedItinerary(JSON.parse(JSON.stringify(editedItinerary)));
      // Exit edit mode on success
      setIsEditMode(false);
      // Show success feedback
      setSaveSuccess(true);
      // Auto-hide success message after 3 seconds
      setTimeout(() => setSaveSuccess(false), 3000);
      // NO window.location.reload() - seamless update!
    } catch (error) {
      console.error("Error saving changes:", error);
      setSaveError("Failed to save changes. Please try again.");
    } finally {
      setIsSaving(false);
    }
  }, [trip.id, editedItinerary]);

  const handleDiscardChanges = useCallback(() => {
    // Revert to last saved state (not trip.itinerary prop, which may be stale)
    setEditedItinerary(JSON.parse(JSON.stringify(savedItinerary)));
    setIsEditMode(false);
    setSaveError(null);
    clearHistory(); // Clear undo/redo stacks
  }, [savedItinerary, clearHistory]);

  const handleEnterEditMode = useCallback(() => {
    // Start editing from the last saved state
    setEditedItinerary(JSON.parse(JSON.stringify(savedItinerary)));
    setIsEditMode(true);
    clearHistory(); // Start fresh undo/redo stacks
  }, [savedItinerary, clearHistory]);

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
      if (!isEditMode) return;

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
      // Cmd+S = Save
      if (cmd && e.key === 's') {
        e.preventDefault();
        if (hasChanges && !isSaving) {
          handleSaveChanges();
        }
      }
      // Escape = Exit edit mode (only if no changes)
      if (e.key === 'Escape' && !hasChanges) {
        setIsEditMode(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isEditMode, hasChanges, isSaving, undo, redo, handleSaveChanges]);

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

  // Handle AI assistant suggested actions
  const handleAIAction = useCallback(
    (action: string, data?: Record<string, unknown>) => {
      // For actions that were already applied by the AI (replace_activity, add_activity),
      // the refetch has already updated the itinerary - don't overwrite it!
      const actionWasApplied = data?.applied === true;

      // Only enter edit mode and reset itinerary for non-applied actions
      if (!actionWasApplied && !isEditMode) {
        setEditedItinerary(ensureActivityIds(trip.itinerary));
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
    [isEditMode, trip.itinerary, handleActivityDelete, handleActivityMove, handleActivityRegenerate]
  );

  // Handle itinerary updates from AI assistant (autonomous changes)
  const handleItineraryUpdate = useCallback((newItinerary: ItineraryDay[]) => {
    // Deep clone and ensure IDs
    const processedItinerary = ensureActivityIds(
      JSON.parse(JSON.stringify(newItinerary))
    );

    // Find the changed activity for animation
    for (let dayIdx = 0; dayIdx < processedItinerary.length; dayIdx++) {
      const newDay = processedItinerary[dayIdx];
      const oldDay = editedItinerary[dayIdx];
      if (oldDay) {
        for (let actIdx = 0; actIdx < newDay.activities.length; actIdx++) {
          const newAct = newDay.activities[actIdx];
          const oldAct = oldDay.activities[actIdx];
          if (!oldAct || newAct.id !== oldAct.id || newAct.name !== oldAct.name) {
            aiUpdateRef.current = { dayIndex: dayIdx, activityId: newAct.id || "" };
            break;
          }
        }
      }
    }

    // Update state - use functional updates to avoid stale closures
    setEditedItinerary(processedItinerary);
    setIsEditMode(true);
    setItineraryVersion((v) => v + 1);

    // Clear the AI update ref after animation time
    setTimeout(() => {
      aiUpdateRef.current = null;
    }, 2000);
  }, [editedItinerary]);

  // Refetch trip data from the database (called after AI modifications)
  const handleRefetchTrip = useCallback(async () => {
    console.log("[TripDetailClient] Refetching trip data from database...");
    try {
      const response = await fetch(`/api/trips/${trip.id}`, {
        cache: 'no-store', // Ensure we get fresh data
        headers: {
          'Cache-Control': 'no-cache',
        },
      });
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
        // Deep clone to ensure we're working with fresh data
        const freshItinerary = JSON.parse(JSON.stringify(data.trip.itinerary));
        const processedItinerary = ensureActivityIds(freshItinerary);

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
        setEditedItinerary(freshCopy);
        // DO NOT update savedItinerary here - this is called after AI changes are applied
        // We want hasChanges to be true so the user can click "Save Changes" to confirm
        // The AI has already saved to the database, but the user expects to "save" their changes
        // Keeping savedItinerary unchanged means hasChanges will be true and Save button enabled
        setIsEditMode(true);
        setItineraryVersion((v) => {
          const newVersion = v + 1;
          console.log("[TripDetailClient] Itinerary version bumped to:", newVersion);
          return newVersion;
        });

        // Clear the AI update ref after animation time
        setTimeout(() => {
          aiUpdateRef.current = null;
        }, 2000);

        console.log("[TripDetailClient] State update complete - UI should re-render now");
      } else {
        console.error("[TripDetailClient] No itinerary in response:", data);
      }
    } catch (error) {
      console.error("[TripDetailClient] Failed to refetch trip:", error);
      throw error;
    }
  }, [trip.id, editedItinerary]);

  // Memoize ensureActivityIds to prevent generating new UUIDs on every render
  // This is CRITICAL - without memoization, new IDs are generated each render,
  // causing itineraryHash to change, triggering useTravelDistances to refetch,
  // which causes state updates and re-renders = infinite loop
  const memoizedBaseItinerary = useMemo(
    () => ensureActivityIds(trip.itinerary),
    [trip.itinerary]
  );

  // Use edited itinerary in edit mode, memoized base otherwise
  const displayItinerary = isEditMode ? editedItinerary : memoizedBaseItinerary;

  // Fetch travel distances between activities
  // Uses local Haversine calculation - NO external API calls!
  // Cached results from trip_meta are used if available and hash matches
  const { travelData, isLoading: travelLoading } = useTravelDistances(displayItinerary, {
    tripId: trip.id,
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
        coverImageUrl={trip.coverImageUrl}
        disableApiCalls={true}
      >
        {/* Status Badge - Floating */}
        <div className="absolute top-4 right-4">
          <span
            className={`px-3 py-1.5 rounded-full text-sm font-medium shadow-lg ${
              statusColors[currentStatus as keyof typeof statusColors] || statusColors.planning
            }`}
          >
            {getStatusLabel(currentStatus)}
          </span>
        </div>
      </DestinationHero>

      <main className="max-w-6xl mx-auto px-4 py-6 sm:py-8">
        {/* Planning Phase - Confirm Trip Action */}
        {currentStatus === "planning" && (
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
                <button
                  onClick={() => handleStatusUpdate("cancelled")}
                  disabled={isUpdatingStatus}
                  className="flex-1 sm:flex-none px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-medium hover:bg-slate-50 transition-colors disabled:opacity-50"
                >
                  {tButtons("cancel")}
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

        {/* Pre-Trip Phase - Countdown Hero and Checklist */}
        {isPreTripPhase && (
          <div className="space-y-4 mb-6">
            <CountdownHero
              destination={destination}
              startDate={tripStartDate}
              tripDays={tripDaysCount}
              activitiesCount={totalActivities}
            />
            <PreTripChecklist
              items={checklist.items}
              onToggle={checklist.toggleItem}
              onAdd={checklist.addItem}
              onDelete={checklist.deleteItem}
              isLoading={checklist.isLoading}
            />
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
            <div className="hidden sm:flex items-center bg-slate-100 rounded-lg p-1">
              <button
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

            {/* Share Button */}
            {!isEditMode && (
              <ShareButton
                tripId={trip.id}
                tripTitle={trip.title}
                autoOpen={shouldAutoOpenShareModal}
                initialTab={shouldAutoOpenShareModal ? "invite" : "share"}
              />
            )}

            {/* Export Menu */}
            {!isEditMode && (
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
            )}

            {/* Edit Mode Toggle - Acts as both enter and save/exit */}
            {!isEditMode ? (
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
                  disabled={isSaving}
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

        {/* Affiliate Booking Panel - Flights, Hotels, Activities */}
        {useEnhancedBooking ? (
          <EnhancedBookingPanel
            tripId={trip.id}
            destination={destination}
            startDate={trip.startDate}
            endDate={trip.endDate}
            travelers={collaboratorCount || 2}
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
        )}

        {/* Post-Confirmation Banner - eSIM, Flight Compensation */}
        <PostConfirmationBanner
          destination={destination}
          tripId={trip.id}
          tripStatus={currentStatus as "planning" | "confirmed" | "active" | "completed"}
          className="mb-8"
        />

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

        {/* Hotel Recommendations - After Map */}
        {/* DISABLED for saved trips - Hotels API calls are expensive */}
        <HotelRecommendations
          destination={destination}
          itinerary={displayItinerary}
          startDate={trip.startDate}
          endDate={trip.endDate}
          disableApiCalls={true}
        />

        {/* Day Filter Slider - Mobile optimized */}
        <DaySlider
          days={displayItinerary}
          selectedDay={selectedDay}
          onSelectDay={setSelectedDay}
          className="mb-6"
        />

        {/* Itinerary */}
        {displayItinerary.length > 0 ? (
          <div className="space-y-8" key={`itinerary-v${itineraryVersion}`}>
            {displayItinerary
              .filter((day) => selectedDay === null || day.day_number === selectedDay)
              .map((day, dayIndex) => (
                <div key={`day-${day.day_number}-v${itineraryVersion}`}>
                  {/* Day Header */}
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
                      {/* Optimize Route Button - only show in edit mode with 3+ activities */}
                      {isEditMode && day.activities.length >= 3 && (
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
                            {trip.budget?.currency || "USD"} {day.daily_budget.total}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Activities */}
                  {viewMode === "cards" ? (
                    <>
                      {isEditMode ? (
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
                          <DndContext
                            sensors={sensors}
                            collisionDetection={closestCenter}
                            onDragEnd={(event) => handleDragEnd(event, dayIndex)}
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
                                  <div key={`${activity.id || idx}-v${itineraryVersion}`}>
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
                        </DndContext>
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
                                <div key={`activity-${activity.id || idx}-v${itineraryVersion}`}>
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
                      {/* Add Activity Button - Edit Mode Only */}
                      {isEditMode && (
                        <AddActivityButton
                          dayIndex={dayIndex}
                          destination={destination}
                          onAdd={(partialActivity) => handleAddActivity(dayIndex, partialActivity)}
                          className="mt-4 ml-6"
                        />
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
                      {/* Day travel summary */}
                      {travelData.get(day.day_number)?.segments && travelData.get(day.day_number)!.segments.length > 0 && (
                        <DaySummary
                          dayNumber={day.day_number}
                          segments={travelData.get(day.day_number)!.segments}
                          className="mt-4"
                        />
                      )}
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
                                        {activity.estimated_cost.amount === 0
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
                      {/* Day travel summary for timeline */}
                      {travelData.get(day.day_number)?.segments && travelData.get(day.day_number)!.segments.length > 0 && (
                        <DaySummary
                          dayNumber={day.day_number}
                          segments={travelData.get(day.day_number)!.segments}
                          className="mt-4"
                        />
                      )}
                    </>
                  )}
                </div>
              ))}
          </div>
        ) : (
          <div className="text-center py-16 bg-white rounded-2xl border border-slate-200">
            <svg className="w-16 h-16 mx-auto text-slate-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            <h3 className="text-lg font-medium text-slate-900 mb-2">{t('detail.noItinerary')}</h3>
            <p className="text-slate-600">{t('detail.noItineraryMessage')}</p>
          </div>
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
              <div className="hidden sm:flex items-center gap-2 text-xs text-slate-400">
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

      {/* AI Assistant Floating Button - Premium pill design on left */}
      {!isEditMode && (
        <button
          onClick={() => setIsAIAssistantOpen(true)}
          className="fixed bottom-24 sm:bottom-6 left-6 lg:bottom-8 lg:left-8 z-40 group"
          title={t('detail.aiTripAssistant')}
        >
          <div className="flex items-center gap-2.5 px-3 py-2 sm:px-4 sm:py-3 rounded-2xl bg-white/90 backdrop-blur-xl border border-slate-200/80 shadow-lg shadow-slate-900/10 hover:shadow-xl hover:bg-white transition-all duration-300 hover:scale-[1.02]">
            {/* AI Agent Image */}
            <div className="relative w-10 h-10 sm:w-11 sm:h-11 rounded-xl overflow-hidden shadow-md">
              <Image
                src="/images/ai-agent.png"
                alt="AI Assistant"
                fill
                className="object-cover"
              />
            </div>
            {/* Label - hidden on very small screens */}
            <div className="hidden sm:flex flex-col items-start leading-none">
              <span className="text-sm font-semibold text-slate-800">{t('detail.aiAssistant')}</span>
              <span className="text-[11px] text-slate-500">{t('detail.customizeTrip')}</span>
            </div>
            {/* Arrow indicator */}
            <svg className="w-4 h-4 text-slate-400 group-hover:text-[var(--primary)] group-hover:translate-x-0.5 transition-all hidden sm:block" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </div>
        </button>
      )}

      {/* Edit mode AI button - compact version above save bar */}
      {isEditMode && (
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

      {/* AI Assistant Sidebar/Bottom Sheet */}
      <AIAssistant
        tripId={trip.id}
        tripTitle={trip.title}
        itinerary={displayItinerary}
        isOpen={isAIAssistantOpen}
        onClose={() => setIsAIAssistantOpen(false)}
        onAction={handleAIAction}
        onItineraryUpdate={handleItineraryUpdate}
        onRefetchTrip={handleRefetchTrip}
      />

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

      {/* Mobile Bottom Navigation - hidden during edit mode */}
      {!isEditMode && <MobileBottomNav activePage="trip-detail" tripId={trip.id} />}
    </div>
  );
}
