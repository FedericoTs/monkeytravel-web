"use client";

import { useState, useMemo, useCallback } from "react";
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
            {/* Full Itinerary */}
            <div className="space-y-6">
              {displayItinerary.map((day) => {
                const isCurrentDay = day.day_number === currentDayNumber;
                const isPastDay = day.day_number < currentDayNumber;
                const dayCompletedCount = day.activities.filter(
                  (a) => a.id && getActivityStatus(a.id) === "completed"
                ).length;
                const dayProgress = day.activities.length > 0
                  ? Math.round((dayCompletedCount / day.activities.length) * 100)
                  : 0;

                return (
                  <div
                    key={day.day_number}
                    className={`rounded-xl border ${
                      isCurrentDay
                        ? "border-blue-200 bg-blue-50/50"
                        : isPastDay
                        ? "border-slate-100 bg-slate-50/50"
                        : "border-slate-200 bg-white"
                    }`}
                  >
                    {/* Day Header */}
                    <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-10 h-10 rounded-full flex items-center justify-center font-bold ${
                            isCurrentDay
                              ? "bg-blue-500 text-white"
                              : isPastDay
                              ? "bg-emerald-100 text-emerald-700"
                              : "bg-slate-100 text-slate-600"
                          }`}
                        >
                          {isPastDay && dayProgress === 100 ? (
                            <span className="text-lg">✓</span>
                          ) : (
                            day.day_number
                          )}
                        </div>
                        <div>
                          <div className="font-semibold text-slate-900">
                            Day {day.day_number}
                            {isCurrentDay && (
                              <span className="ml-2 text-xs bg-blue-500 text-white px-2 py-0.5 rounded-full">
                                TODAY
                              </span>
                            )}
                          </div>
                          {day.theme && (
                            <div className="text-sm text-slate-500">{day.theme}</div>
                          )}
                        </div>
                      </div>

                      {/* Day progress */}
                      <div className="text-right">
                        <div className="text-sm text-slate-500">
                          {dayCompletedCount}/{day.activities.length}
                        </div>
                        <div className="w-20 h-1.5 bg-slate-200 rounded-full mt-1 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${
                              dayProgress === 100 ? "bg-emerald-500" : "bg-blue-500"
                            }`}
                            style={{ width: `${dayProgress}%` }}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Activities Summary */}
                    <div className="p-4 space-y-2">
                      {day.activities.map((activity) => {
                        const status = activity.id ? getActivityStatus(activity.id) : "upcoming";
                        const isCompleted = status === "completed";
                        const isSkipped = status === "skipped";

                        return (
                          <div
                            key={activity.id}
                            className={`flex items-center gap-3 text-sm ${
                              isCompleted || isSkipped ? "opacity-60" : ""
                            }`}
                          >
                            <span className="text-slate-400 w-14">{activity.start_time}</span>
                            <span
                              className={`flex-1 ${
                                isCompleted || isSkipped
                                  ? "line-through text-slate-400"
                                  : "text-slate-700"
                              }`}
                            >
                              {activity.name}
                            </span>
                            {isCompleted && (
                              <span className="text-emerald-500 text-xs">✓ Done</span>
                            )}
                            {isSkipped && (
                              <span className="text-orange-500 text-xs">Skipped</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
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
