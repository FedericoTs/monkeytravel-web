"use client";

import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import type { ItineraryDay, Activity, TripMeta, CachedDayTravelData } from "@/types";
import DestinationHero from "@/components/DestinationHero";
import ActivityCard from "@/components/ActivityCard";
import EditableActivityCard from "@/components/trip/EditableActivityCard";
import ShareButton from "@/components/trip/ShareButton";
import ExportMenu from "@/components/trip/ExportMenu";
import AIAssistant from "@/components/ai/AIAssistant";
import TripBookingLinks from "@/components/trip/TripBookingLinks";
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
import { useActivityTimeline } from "@/lib/hooks/useActivityTimeline";
import { useTravelDistances } from "@/lib/hooks/useTravelDistances";
import {
  ensureActivityIds,
  moveActivityInDay,
  moveActivityToDay,
  deleteActivity,
  updateActivity,
  replaceActivity,
  generateActivityId,
} from "@/lib/utils/activity-id";
// Amadeus booking components - kept for future use
// import FlightSearch from "@/components/booking/FlightSearch";
// import HotelSearch from "@/components/booking/HotelSearch";

// Google Places-based hotel recommendations
import HotelRecommendations from "@/components/trip/HotelRecommendations";

// Dynamic import for TripMap to avoid SSR issues with Google Maps
const TripMap = dynamic(() => import("@/components/TripMap"), {
  ssr: false,
  loading: () => (
    <div className="h-[400px] bg-slate-100 rounded-xl animate-pulse flex items-center justify-center">
      <span className="text-slate-400">Loading map...</span>
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
    /** Pre-saved cover image URL - eliminates Places API call on load */
    coverImageUrl?: string | null;
    /** Cached travel distances from trip_meta - eliminates recalculation */
    cachedTravelDistances?: CachedDayTravelData[];
    /** Hash of itinerary when travel distances were calculated */
    cachedTravelHash?: string;
  };
  dateRange: string;
}

export default function TripDetailClient({ trip, dateRange }: TripDetailClientProps) {
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

  // Version counter to force re-render after AI updates
  const [itineraryVersion, setItineraryVersion] = useState(0);

  // Ref to track if we just updated from AI (for animations)
  const aiUpdateRef = useRef<{ dayIndex: number; activityId: string } | null>(null);

  // Track if there are unsaved changes (compare against saved state, not prop)
  const hasChanges = JSON.stringify(editedItinerary) !== JSON.stringify(savedItinerary);

  // Auto-backfill coordinates for legacy trips missing them
  // This runs once on mount and persists coordinates to the database
  const backfillAttemptedRef = useRef(false);
  useEffect(() => {
    // Only run once per trip load
    if (backfillAttemptedRef.current) return;

    // Check if any activities are missing coordinates
    const hasMissingCoords = trip.itinerary.some((day) =>
      day.activities.some(
        (activity) => !activity.coordinates?.lat || !activity.coordinates?.lng
      )
    );

    if (!hasMissingCoords) return;

    backfillAttemptedRef.current = true;

    // Fire-and-forget backfill request (runs in background)
    fetch(`/api/trips/${trip.id}/backfill-coordinates`, {
      method: "POST",
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.success && data.updated > 0) {
          console.log(`[TripDetail] Backfilled ${data.updated} activity coordinates`);
          // Note: We don't update state here to avoid re-render loops.
          // The TripMap component will geocode addresses on its own for this session.
          // Next page load will have the persisted coordinates.
        }
      })
      .catch((err) => {
        console.warn("[TripDetail] Coordinate backfill failed:", err);
      });
  }, [trip.id, trip.itinerary]);

  // Callback to persist cover image when fetched for the first time
  // This ensures subsequent visits don't require a Places API call
  const handleCoverImageFetched = useCallback(
    async (imageUrl: string) => {
      // Only save if trip doesn't already have a cover image
      if (trip.coverImageUrl) return;

      try {
        await fetch(`/api/trips/${trip.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cover_image_url: imageUrl }),
        });
        console.log("[TripDetail] Saved cover image for future visits");
      } catch (err) {
        console.warn("[TripDetail] Failed to save cover image:", err);
      }
    },
    [trip.id, trip.coverImageUrl]
  );

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

  // Activity timeline for live journey mode
  const activityTimeline = useActivityTimeline(trip.id);

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

  // Calculate day progress for LiveJourneyHeader
  const dayProgress = activityTimeline.getDayProgress(allActivitiesByDay, currentDayNumber);

  // Get current and next activity
  const currentActivity = activityTimeline.getCurrentActivity(currentDayActivities);
  const nextActivity = activityTimeline.getNextActivity(currentDayActivities);

  // Available days for "move to day" feature
  const availableDays = editedItinerary.map((day) => day.day_number);

  // Edit handlers
  const handleActivityMove = useCallback(
    (activityId: string, direction: "up" | "down") => {
      setEditedItinerary((prev) => moveActivityInDay(prev, activityId, direction));
    },
    []
  );

  const handleActivityMoveToDay = useCallback(
    (activityId: string, targetDayIndex: number) => {
      setEditedItinerary((prev) => moveActivityToDay(prev, activityId, targetDayIndex));
    },
    []
  );

  const handleActivityDelete = useCallback((activityId: string) => {
    setEditedItinerary((prev) => deleteActivity(prev, activityId));
  }, []);

  const handleActivityUpdate = useCallback(
    (activityId: string, updates: Partial<Activity>) => {
      setEditedItinerary((prev) => updateActivity(prev, activityId, updates));
    },
    []
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
        }
      } catch (error) {
        console.error("Error regenerating activity:", error);
        setSaveError("Failed to regenerate activity. Please try again.");
      } finally {
        setRegeneratingActivityId(null);
      }
    },
    [trip.id, destination, editedItinerary]
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
  }, [savedItinerary]);

  const handleEnterEditMode = useCallback(() => {
    // Start editing from the last saved state
    setEditedItinerary(JSON.parse(JSON.stringify(savedItinerary)));
    setIsEditMode(true);
  }, [savedItinerary]);

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
        // Also update saved state since this is fresh data from database
        setSavedItinerary(JSON.parse(JSON.stringify(freshCopy)));
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
    completed: "bg-slate-100 text-slate-700",
    cancelled: "bg-red-100 text-red-700",
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
        onCoverImageFetched={handleCoverImageFetched}
      >
        {/* Status Badge - Floating */}
        <div className="absolute top-4 right-4">
          <span
            className={`px-3 py-1.5 rounded-full text-sm font-medium shadow-lg ${
              statusColors[trip.status as keyof typeof statusColors] || statusColors.planning
            }`}
          >
            {trip.status.charAt(0).toUpperCase() + trip.status.slice(1)}
          </span>
        </div>
      </DestinationHero>

      <main className="max-w-6xl mx-auto px-4 py-6 sm:py-8">
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

        {/* Active Trip Phase - Live Journey Mode */}
        {isActiveTripPhase && (
          <div className="space-y-4 mb-6">
            {/* Live Journey Header */}
            <LiveJourneyHeader
              tripTitle={trip.title}
              currentDay={currentDayNumber}
              totalDays={tripDaysCount}
              dayProgress={dayProgress}
              currentActivity={currentActivity && currentActivity.id ? {
                id: currentActivity.id,
                name: currentActivity.name,
                start_time: currentActivity.start_time,
                location: currentActivity.address || currentActivity.location,
                status: activityTimeline.getActivityStatus(currentActivity.id),
              } : undefined}
              nextActivity={nextActivity && nextActivity.id ? {
                id: nextActivity.id,
                name: nextActivity.name,
                start_time: nextActivity.start_time,
                location: nextActivity.address || nextActivity.location,
                status: "upcoming",
              } : undefined}
              destination={destination}
            />

            {/* Today's Activities as Live Cards */}
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-slate-500 uppercase tracking-wide">
                Today&apos;s Activities
              </h3>
              {currentDayActivities
                .filter((activity) => activity.id)
                .map((activity) => (
                <LiveActivityCard
                  key={activity.id}
                  activity={{
                    id: activity.id!,
                    name: activity.name,
                    description: activity.description,
                    start_time: activity.start_time,
                    duration_minutes: activity.duration_minutes,
                    address: activity.address,
                    location: activity.location,
                    type: activity.type,
                    image_url: activity.image_url,
                    estimated_cost: activity.estimated_cost,
                  }}
                  status={activityTimeline.getActivityStatus(activity.id!)}
                  rating={activityTimeline.getActivityRating(activity.id!)}
                  onComplete={() => {
                    activityTimeline.completeActivity(activity.id!, currentDayNumber);
                    // Show rating modal after completion
                    setRatingModalActivity({
                      id: activity.id!,
                      name: activity.name,
                      dayNumber: currentDayNumber,
                      image_url: activity.image_url,
                    });
                  }}
                  onSkip={() => {
                    activityTimeline.skipActivity(activity.id!, currentDayNumber);
                  }}
                  onAddPhoto={() => {
                    // TODO: Implement photo capture
                    console.log("Add photo for activity:", activity.id);
                  }}
                  onAddNote={() => {
                    // TODO: Implement note modal
                    console.log("Add note for activity:", activity.id);
                  }}
                  onRate={(rating) => {
                    activityTimeline.rateActivity(activity.id!, currentDayNumber, rating);
                  }}
                />
              ))}
            </div>
          </div>
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
              <span className="hidden sm:inline">Back to Trips</span>
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
                Cards
              </button>
              <button
                onClick={() => setViewMode("timeline")}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  viewMode === "timeline"
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Timeline
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
              title={showMap ? "Hide Map" : "Show Map"}
            >
              <svg className="w-5 h-5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
              </svg>
              <span className="hidden sm:inline">{showMap ? "Hide Map" : "Show Map"}</span>
            </button>

            {/* Share Button */}
            {!isEditMode && (
              <ShareButton tripId={trip.id} tripTitle={trip.title} />
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

            {/* Edit Mode Toggle */}
            {!isEditMode ? (
              <button
                onClick={handleEnterEditMode}
                className="flex items-center gap-2 p-2 sm:px-3 sm:py-2 rounded-lg text-sm font-medium bg-[var(--accent)] text-slate-900 hover:bg-[var(--accent)]/90 transition-colors"
                title="Edit Trip"
              >
                <svg className="w-5 h-5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
                <span className="hidden sm:inline">Edit Trip</span>
              </button>
            ) : (
              <div className="flex items-center gap-2 px-2 sm:px-3 py-1.5 rounded-lg bg-amber-100 text-amber-800 text-sm font-medium">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
                <span className="hidden sm:inline">Editing Mode</span>
                <span className="sm:hidden">Editing</span>
              </div>
            )}
          </div>
        </div>

        {/* Booking Links - Flights & Hotels (commented out for now) */}
        {/* {trip.meta?.booking_links && (
          <TripBookingLinks bookingLinks={trip.meta.booking_links} />
        )} */}

        {/* Interactive Map - First */}
        {showMap && displayItinerary.length > 0 && (
          <div className="mb-8">
            <TripMap
              days={displayItinerary}
              destination={destination}
              selectedDay={selectedDay}
              className="h-[400px]"
            />
          </div>
        )}

        {/* Hotel Recommendations - After Map */}
        <HotelRecommendations
          destination={destination}
          itinerary={displayItinerary}
          startDate={trip.startDate}
          endDate={trip.endDate}
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
                          Day {day.day_number}
                        </h2>
                        {day.theme && (
                          <p className="text-slate-500 text-sm">{day.theme}</p>
                        )}
                      </div>
                    </div>
                    {day.daily_budget && (
                      <div className="ml-auto text-right">
                        <div className="text-sm text-slate-500">Est. Budget</div>
                        <div className="font-semibold text-slate-900">
                          {trip.budget?.currency || "USD"} {day.daily_budget.total}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Activities */}
                  {viewMode === "cards" ? (
                    <>
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
                                {isEditMode ? (
                                  <EditableActivityCard
                                    activity={activity}
                                    index={idx}
                                    currency={trip.budget?.currency}
                                    showGallery={true}
                                    isEditMode={true}
                                    onMove={(direction) => handleActivityMove(activity.id!, direction)}
                                    onDelete={() => handleActivityDelete(activity.id!)}
                                    onUpdate={(updates) => handleActivityUpdate(activity.id!, updates)}
                                    onMoveToDay={(targetDayIdx) => handleActivityMoveToDay(activity.id!, targetDayIdx)}
                                    onRegenerate={() => handleActivityRegenerate(activity.id!, dayIndex)}
                                    canMoveUp={idx > 0}
                                    canMoveDown={idx < day.activities.length - 1}
                                    availableDays={availableDays}
                                    currentDayIndex={dayIndex}
                                    isRegenerating={regeneratingActivityId === activity.id}
                                  />
                                ) : (
                                  <ActivityCard
                                    activity={activity}
                                    index={idx}
                                    currency={trip.budget?.currency}
                                    showGallery={true}
                                  />
                                )}
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
                                          ? "Free"
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
            <h3 className="text-lg font-medium text-slate-900 mb-2">No Itinerary Yet</h3>
            <p className="text-slate-600">This trip doesn't have any activities planned yet.</p>
          </div>
        )}

        {/* Journey Essentials - Premium Packing List */}
        {trip.packingList && trip.packingList.length > 0 && (
          <TripPackingEssentials
            items={trip.packingList}
            destination={destination}
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
                  AI-Generated Itinerary with Verified Data
                </h4>
                <p className="text-sm text-amber-800">
                  This itinerary was created by AI and enriched with real-time data from Google Places.
                  Photos, ratings, and price levels are verified, but we recommend double-checking opening hours
                  and availability before your trip. Click "More" on any activity to see verified details and photos.
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
                  Edit Mode Active
                </h4>
                <p className="text-sm text-blue-800">
                  You can now edit, move, delete, or regenerate activities. Use the buttons on each activity card
                  to make changes. Click "Save Changes" when you're done, or "Discard" to cancel your edits.
                </p>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Edit Mode Save/Discard Bar */}
      {isEditMode && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 shadow-lg z-50">
          <div className="max-w-6xl mx-auto px-4 py-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                {hasChanges && (
                  <span className="px-2.5 py-1 bg-amber-100 text-amber-800 text-xs font-medium rounded-full">
                    Unsaved changes
                  </span>
                )}
                {saveError && (
                  <span className="text-sm text-red-600">{saveError}</span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={handleDiscardChanges}
                  disabled={isSaving}
                  className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors disabled:opacity-50"
                >
                  Discard Changes
                </button>
                <button
                  onClick={handleSaveChanges}
                  disabled={isSaving || !hasChanges}
                  className="px-4 py-2 text-sm font-medium text-white bg-[var(--primary)] hover:bg-[var(--primary)]/90 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
                >
                  {isSaving ? (
                    <>
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      Saving...
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      Save Changes
                    </>
                  )}
                </button>
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
          title="AI Trip Assistant"
        >
          <div className="flex items-center gap-2.5 px-4 py-3 rounded-2xl bg-white/90 backdrop-blur-xl border border-slate-200/80 shadow-lg shadow-slate-900/10 hover:shadow-xl hover:bg-white transition-all duration-300 hover:scale-[1.02]">
            {/* AI Icon with gradient background */}
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[var(--primary)] to-[var(--primary)]/70 flex items-center justify-center shadow-md shadow-[var(--primary)]/20">
              <svg
                className="w-5 h-5 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                />
              </svg>
            </div>
            {/* Label - hidden on very small screens */}
            <div className="hidden sm:flex flex-col items-start leading-none">
              <span className="text-sm font-semibold text-slate-800">AI Assistant</span>
              <span className="text-[11px] text-slate-500">Customize your trip</span>
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
          title="AI Trip Assistant"
        >
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-white/95 backdrop-blur-xl border border-slate-200/80 shadow-lg shadow-slate-900/10 hover:shadow-xl hover:bg-white transition-all duration-300">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[var(--primary)] to-[var(--primary)]/70 flex items-center justify-center shadow-sm">
              <svg
                className="w-4.5 h-4.5 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                />
              </svg>
            </div>
            <span className="text-sm font-medium text-slate-700 hidden sm:inline">AI Help</span>
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
              <p className="font-medium text-green-800">Changes saved!</p>
              <p className="text-sm text-green-600">Your trip has been updated successfully.</p>
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

      {/* Mobile Bottom Navigation - hidden during edit mode */}
      {!isEditMode && <MobileBottomNav activePage="trip-detail" tripId={trip.id} />}
    </div>
  );
}
