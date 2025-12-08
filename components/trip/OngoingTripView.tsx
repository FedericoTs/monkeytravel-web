"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import dynamic from "next/dynamic";
import { motion, AnimatePresence } from "framer-motion";
import { Calendar, List, MapPin, ChevronLeft, ChevronRight } from "lucide-react";
import type { ItineraryDay, Activity, TripMeta, CachedDayTravelData } from "@/types";
import type { ActivityTimeline, AchievementId, XpGainEvent } from "@/types/timeline";
import { useGamification } from "@/lib/hooks/useGamification";
import { useActivityTimeline } from "@/lib/hooks/useActivityTimeline";
import { ensureActivityIds } from "@/lib/utils/activity-id";
import SwipeableActivityCard from "./SwipeableActivityCard";
import XPProgressBar, { AchievementToast } from "./XPProgressBar";
import TravelConnector from "./TravelConnector";
import DaySummary from "./DaySummary";
import ActivityCard from "@/components/ActivityCard";
import DaySlider from "@/components/ui/DaySlider";
import { useTravelDistances } from "@/lib/hooks/useTravelDistances";

// Dynamic import for TripMap
const TripMap = dynamic(() => import("@/components/TripMap"), {
  ssr: false,
  loading: () => (
    <div className="h-[300px] bg-slate-100 rounded-xl animate-pulse flex items-center justify-center">
      <span className="text-slate-400">Loading map...</span>
    </div>
  ),
});

interface OngoingTripViewProps {
  tripId: string;
  destination: string;
  startDate: string;
  endDate: string;
  itinerary: ItineraryDay[];
  meta?: TripMeta;
  budget?: { total: number; currency: string } | null;
  cachedTravelDistances?: CachedDayTravelData[];
  cachedTravelHash?: string;
}

type ViewTab = "today" | "full";

export default function OngoingTripView({
  tripId,
  destination,
  startDate,
  endDate,
  itinerary,
  meta,
  budget,
  cachedTravelDistances,
  cachedTravelHash,
}: OngoingTripViewProps) {
  const [activeTab, setActiveTab] = useState<ViewTab>("today");
  const [recentXpGain, setRecentXpGain] = useState<XpGainEvent | null>(null);
  const [achievementQueue, setAchievementQueue] = useState<AchievementId[]>([]);
  // For Full Plan tab - auto-select today's day initially
  const [fullPlanSelectedDay, setFullPlanSelectedDay] = useState<number | null>(null);

  // Ensure activity IDs
  const displayItinerary = useMemo(() => ensureActivityIds(itinerary), [itinerary]);

  // Calculate current day based on trip dates
  const currentDayNumber = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);

    const diffTime = today.getTime() - start.getTime();
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24)) + 1;

    // Clamp to valid day range
    return Math.max(1, Math.min(diffDays, displayItinerary.length));
  }, [startDate, displayItinerary.length]);

  // Auto-select today's day in Full Plan tab on first switch
  useEffect(() => {
    if (activeTab === "full" && fullPlanSelectedDay === null) {
      setFullPlanSelectedDay(currentDayNumber);
    }
  }, [activeTab, fullPlanSelectedDay, currentDayNumber]);

  // Get today's activities
  const todayActivities = useMemo(() => {
    const day = displayItinerary.find((d) => d.day_number === currentDayNumber);
    return day?.activities || [];
  }, [displayItinerary, currentDayNumber]);

  // Activity timeline management
  const {
    timelines,
    isLoading: timelinesLoading,
    completeActivity,
    skipActivity,
    getActivityStatus,
  } = useActivityTimeline(tripId);

  // Gamification
  const {
    gamification,
    recordCompletion,
    recordSkip,
    calculateActivityXp,
    getStreakMultiplier,
    getTotalPossibleXp,
    getTodayProgress,
  } = useGamification({
    tripId,
    itinerary: displayItinerary,
    activityTimelines: timelines,
  });

  // Travel distances for connectors
  const { travelData, isLoading: travelLoading } = useTravelDistances(displayItinerary, {
    cachedTravelData: cachedTravelDistances,
    cachedHash: cachedTravelHash,
  });

  // Handle activity completion
  const handleCompleteActivity = useCallback(
    async (activity: Activity) => {
      if (!activity.id) return;

      try {
        await completeActivity(activity.id, currentDayNumber);
        const xpEvent = recordCompletion(activity, currentDayNumber);

        setRecentXpGain(xpEvent);

        // Queue achievements for display
        if (xpEvent.newAchievements.length > 0) {
          setAchievementQueue((prev) => [...prev, ...xpEvent.newAchievements]);
        }

        // Clear XP animation after delay
        setTimeout(() => setRecentXpGain(null), 2500);
      } catch (error) {
        console.error("Failed to complete activity:", error);
      }
    },
    [completeActivity, currentDayNumber, recordCompletion]
  );

  // Handle activity skip
  const handleSkipActivity = useCallback(
    async (activity: Activity) => {
      if (!activity.id) return;

      try {
        await skipActivity(activity.id, currentDayNumber);
        recordSkip(activity.id);
      } catch (error) {
        console.error("Failed to skip activity:", error);
      }
    },
    [skipActivity, currentDayNumber, recordSkip]
  );

  // Dismiss achievement toast
  const dismissAchievement = useCallback(() => {
    setAchievementQueue((prev) => prev.slice(1));
  }, []);

  const todayProgress = getTodayProgress(currentDayNumber);
  const todayDate = displayItinerary.find((d) => d.day_number === currentDayNumber)?.date;
  const todayTheme = displayItinerary.find((d) => d.day_number === currentDayNumber)?.theme;

  // Format date for display
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", {
      weekday: "long",
      month: "short",
      day: "numeric",
    });
  };

  // Check which tab to highlight
  const isTodayTab = activeTab === "today";

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      {/* Hero Map (only shown on Today tab) */}
      {isTodayTab && (
        <div className="relative">
          <div className="h-[300px] overflow-hidden">
            <TripMap
              days={[displayItinerary.find((d) => d.day_number === currentDayNumber)!].filter(
                Boolean
              )}
              destination={destination}
              selectedDay={currentDayNumber}
              className="h-full"
              disableApiCalls={false}
            />
          </div>

          {/* Gradient overlay at bottom */}
          <div className="absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-slate-50 to-transparent" />

          {/* Day indicator badge */}
          <div className="absolute top-4 left-4 bg-white/95 backdrop-blur-sm px-4 py-2 rounded-xl shadow-lg">
            <div className="text-sm text-slate-500">Day {currentDayNumber}</div>
            <div className="font-semibold text-slate-900">
              {todayDate && formatDate(todayDate)}
            </div>
            {todayTheme && <div className="text-sm text-[var(--primary)]">{todayTheme}</div>}
          </div>

          {/* View Full Plan button */}
          <div className="absolute top-4 right-4">
            <button
              onClick={() => setActiveTab("full")}
              className="px-3 py-2 bg-white/95 backdrop-blur-sm rounded-lg shadow-lg text-sm font-medium text-slate-700 hover:text-slate-900 flex items-center gap-1.5"
            >
              <List className="w-4 h-4" />
              Full Plan
            </button>
          </div>
        </div>
      )}

      {/* XP Progress Bar (only shown on Today tab) */}
      {isTodayTab && (
        <div className="px-4 -mt-8 relative z-10">
          <XPProgressBar
            totalXp={gamification.totalXp}
            maxXp={getTotalPossibleXp()}
            currentStreak={gamification.currentStreak}
            todayProgress={todayProgress}
            recentXpGain={recentXpGain}
          />
        </div>
      )}

      {/* Tab Switcher - Always visible */}
      <div className="px-4 mt-4">
        <div className="bg-slate-100 rounded-xl p-1 flex">
          <button
            onClick={() => setActiveTab("today")}
            className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-2 ${
              isTodayTab
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <Calendar className="w-4 h-4" />
            Today
          </button>
          <button
            onClick={() => setActiveTab("full")}
            className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-2 ${
              !isTodayTab
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <List className="w-4 h-4" />
            Full Plan
          </button>
        </div>
      </div>

      {/* Tab Content */}
      <AnimatePresence mode="wait">
        {isTodayTab && (
          <motion.div
            key="today"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
          >
            {/* Today's Activities */}
            <div className="px-4 py-6 space-y-3">
              <div className="flex items-center justify-between mb-2">
                <h2 className="font-semibold text-slate-900">Today&apos;s Activities</h2>
                <span className="text-sm text-slate-500">
                  {todayProgress.completed}/{todayProgress.total} completed
                </span>
              </div>

              {todayActivities.length === 0 ? (
                <div className="text-center py-12 text-slate-500">
                  <MapPin className="w-12 h-12 mx-auto mb-3 opacity-50" />
                  <p>No activities planned for today</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {todayActivities.map((activity, idx) => {
                    const status = activity.id ? getActivityStatus(activity.id) : "upcoming";
                    const xpValue = calculateActivityXp(activity);
                    const nextActivity = todayActivities[idx + 1];
                    const dayTravelData = travelData.get(currentDayNumber);
                    const segment =
                      nextActivity &&
                      dayTravelData?.segments.find(
                        (s) => s.fromActivityId === activity.id && s.toActivityId === nextActivity.id
                      );

                    return (
                      <div key={activity.id || idx}>
                        <SwipeableActivityCard
                          activity={activity}
                          status={status}
                          xpValue={xpValue}
                          streakMultiplier={getStreakMultiplier()}
                          onComplete={() => handleCompleteActivity(activity)}
                          onSkip={() => handleSkipActivity(activity)}
                          currency={budget?.currency}
                        />

                        {/* Travel connector to next activity */}
                        {idx < todayActivities.length - 1 &&
                          status !== "completed" &&
                          status !== "skipped" && (
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
              )}

              {/* All done message */}
              {todayProgress.completed === todayProgress.total && todayProgress.total > 0 && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="text-center py-8 bg-gradient-to-br from-emerald-50 to-green-50 rounded-2xl border border-emerald-100"
                >
                  <motion.div
                    animate={{ rotate: [0, -10, 10, 0] }}
                    transition={{ duration: 0.5, delay: 0.2 }}
                    className="text-5xl mb-3"
                  >
                    🎉
                  </motion.div>
                  <h3 className="font-semibold text-emerald-800 text-lg">Day Complete!</h3>
                  <p className="text-emerald-600 text-sm mt-1">
                    You&apos;ve completed all activities for today
                  </p>
                </motion.div>
              )}
            </div>
          </motion.div>
        )}

        {!isTodayTab && (
          <motion.div
            key="full"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ duration: 0.2 }}
            className="px-4 py-6"
          >
            {/* Day Filter Slider - Auto-selects today */}
            <DaySlider
              days={displayItinerary}
              selectedDay={fullPlanSelectedDay}
              onSelectDay={setFullPlanSelectedDay}
              className="mb-6"
            />

            {/* Full Itinerary - Same as normal trip detail view */}
            <div className="space-y-8">
              {displayItinerary
                .filter((day) => fullPlanSelectedDay === null || day.day_number === fullPlanSelectedDay)
                .map((day) => {
                  const isCurrentDay = day.day_number === currentDayNumber;
                  const isPastDay = day.day_number < currentDayNumber;
                  const dayCompletedCount = day.activities.filter(
                    (a) => a.id && getActivityStatus(a.id) === "completed"
                  ).length;
                  const dayProgress = day.activities.length > 0
                    ? Math.round((dayCompletedCount / day.activities.length) * 100)
                    : 0;

                  return (
                    <div key={day.day_number}>
                      {/* Day Header */}
                      <div className="flex items-center gap-4 mb-4">
                        <div className="flex items-center gap-3">
                          <div
                            className={`w-12 h-12 rounded-full text-white flex items-center justify-center font-bold text-lg shadow-lg ${
                              isCurrentDay
                                ? "bg-gradient-to-br from-blue-500 to-blue-600"
                                : isPastDay && dayProgress === 100
                                ? "bg-gradient-to-br from-emerald-500 to-emerald-600"
                                : "bg-gradient-to-br from-[var(--primary)] to-[var(--primary)]/80"
                            }`}
                          >
                            {isPastDay && dayProgress === 100 ? "✓" : day.day_number}
                          </div>
                          <div>
                            <h2 className="font-bold text-xl text-slate-900">
                              Day {day.day_number}
                              {isCurrentDay && (
                                <span className="ml-2 text-xs bg-blue-500 text-white px-2 py-0.5 rounded-full align-middle">
                                  TODAY
                                </span>
                              )}
                            </h2>
                            {day.theme && (
                              <p className="text-slate-500 text-sm">{day.theme}</p>
                            )}
                          </div>
                        </div>
                        {/* Day progress indicator */}
                        <div className="ml-auto text-right">
                          <div className="text-sm text-slate-500">
                            {dayCompletedCount}/{day.activities.length} completed
                          </div>
                          <div className="w-24 h-1.5 bg-slate-200 rounded-full mt-1 overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${
                                dayProgress === 100 ? "bg-emerald-500" : "bg-blue-500"
                              }`}
                              style={{ width: `${dayProgress}%` }}
                            />
                          </div>
                        </div>
                      </div>

                      {/* Activities with full cards */}
                      <div className="grid gap-0">
                        {day.activities.map((activity, idx) => {
                          const status = activity.id ? getActivityStatus(activity.id) : "upcoming";
                          const isCompleted = status === "completed";
                          const isSkipped = status === "skipped";
                          const nextActivity = day.activities[idx + 1];
                          const dayTravelData = travelData.get(day.day_number);
                          const segment =
                            nextActivity &&
                            dayTravelData?.segments.find(
                              (s) => s.fromActivityId === activity.id && s.toActivityId === nextActivity.id
                            );

                          return (
                            <div key={activity.id || idx}>
                              {/* Activity Card with completion status overlay */}
                              <div className={`relative ${isCompleted || isSkipped ? "opacity-75" : ""}`}>
                                <ActivityCard
                                  activity={activity}
                                  index={idx}
                                  currency={budget?.currency}
                                  showGallery={true}
                                  disableAutoFetch={true}
                                />
                                {/* Completion badge overlay */}
                                {(isCompleted || isSkipped) && (
                                  <div className="absolute top-3 right-3 z-10">
                                    <span
                                      className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                                        isCompleted
                                          ? "bg-emerald-100 text-emerald-700"
                                          : "bg-orange-100 text-orange-700"
                                      }`}
                                    >
                                      {isCompleted ? "✓ Done" : "Skipped"}
                                    </span>
                                  </div>
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
                      {travelData.get(day.day_number)?.segments &&
                        travelData.get(day.day_number)!.segments.length > 0 && (
                          <DaySummary
                            dayNumber={day.day_number}
                            segments={travelData.get(day.day_number)!.segments}
                            className="mt-4"
                          />
                        )}
                    </div>
                  );
                })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Achievement Toasts */}
      <AnimatePresence>
        {achievementQueue.length > 0 && (
          <AchievementToast
            achievementId={achievementQueue[0]}
            onDismiss={dismissAchievement}
          />
        )}
      </AnimatePresence>

      {/* Bottom padding for mobile nav */}
      <div className="h-24" />
    </div>
  );
}
