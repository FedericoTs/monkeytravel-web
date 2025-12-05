"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import type { ActivityStatus, QuickTag, ActivityTimeline, DayProgress } from "@/types/timeline";

interface Activity {
  id?: string;
  name: string;
  description?: string;
  start_time: string;
  duration_minutes: number;
  address?: string;
  location?: string;
  type: string;
  image_url?: string;
  estimated_cost?: {
    amount: number;
    currency: string;
    tier: "free" | "budget" | "moderate" | "expensive";
  };
}

interface UseActivityTimelineReturn {
  timelines: Record<string, ActivityTimeline>;
  isLoading: boolean;
  error: string | null;

  // Activity actions
  startActivity: (activityId: string, dayNumber: number) => Promise<void>;
  completeActivity: (activityId: string, dayNumber: number) => Promise<void>;
  skipActivity: (activityId: string, dayNumber: number, reason?: string) => Promise<void>;
  rateActivity: (
    activityId: string,
    dayNumber: number,
    rating: number,
    notes?: string,
    quickTags?: QuickTag[]
  ) => Promise<void>;

  // Status helpers
  getActivityStatus: (activityId: string) => ActivityStatus;
  getActivityRating: (activityId: string) => number | undefined;
  getCurrentActivity: (dayActivities: Activity[]) => Activity | undefined;
  getNextActivity: (dayActivities: Activity[]) => Activity | undefined;

  // Day progress
  getDayProgress: (activities: Activity[][], currentDay: number) => DayProgress[];

  // Refresh
  refresh: () => Promise<void>;
}

export function useActivityTimeline(tripId: string): UseActivityTimelineReturn {
  const [timelines, setTimelines] = useState<Record<string, ActivityTimeline>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTimelines = useCallback(async () => {
    try {
      setError(null);
      const response = await fetch(`/api/trips/${tripId}/activities`);

      if (!response.ok) {
        throw new Error("Failed to fetch activity timelines");
      }

      const data = await response.json();
      const timelinesMap: Record<string, ActivityTimeline> = {};

      (data.timelines || []).forEach((t: ActivityTimeline) => {
        timelinesMap[t.activity_id] = t;
      });

      setTimelines(timelinesMap);
    } catch (err) {
      console.error("Error fetching activity timelines:", err);
      setError(err instanceof Error ? err.message : "Failed to load timelines");
    } finally {
      setIsLoading(false);
    }
  }, [tripId]);

  useEffect(() => {
    fetchTimelines();
  }, [fetchTimelines]);

  const updateActivity = useCallback(
    async (
      activityId: string,
      dayNumber: number,
      updates: Record<string, unknown>
    ) => {
      try {
        const response = await fetch(`/api/trips/${tripId}/activities/${activityId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dayNumber, ...updates }),
        });

        if (!response.ok) {
          throw new Error("Failed to update activity");
        }

        const data = await response.json();

        // Update local state
        setTimelines((prev) => ({
          ...prev,
          [activityId]: data.timeline,
        }));

        return data.timeline;
      } catch (err) {
        console.error("Error updating activity:", err);
        setError("Failed to update activity");
        throw err;
      }
    },
    [tripId]
  );

  const startActivity = useCallback(
    async (activityId: string, dayNumber: number) => {
      // Optimistic update
      setTimelines((prev) => ({
        ...prev,
        [activityId]: {
          ...prev[activityId],
          activity_id: activityId,
          trip_id: tripId,
          user_id: "",
          status: "in_progress" as ActivityStatus,
          started_at: new Date().toISOString(),
          created_at: prev[activityId]?.created_at || new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      }));

      await updateActivity(activityId, dayNumber, { status: "in_progress" });
    },
    [tripId, updateActivity]
  );

  const completeActivity = useCallback(
    async (activityId: string, dayNumber: number) => {
      // Optimistic update
      setTimelines((prev) => ({
        ...prev,
        [activityId]: {
          ...prev[activityId],
          activity_id: activityId,
          trip_id: tripId,
          user_id: "",
          status: "completed" as ActivityStatus,
          completed_at: new Date().toISOString(),
          created_at: prev[activityId]?.created_at || new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      }));

      await updateActivity(activityId, dayNumber, { status: "completed" });
    },
    [tripId, updateActivity]
  );

  const skipActivity = useCallback(
    async (activityId: string, dayNumber: number, reason?: string) => {
      // Optimistic update
      setTimelines((prev) => ({
        ...prev,
        [activityId]: {
          ...prev[activityId],
          activity_id: activityId,
          trip_id: tripId,
          user_id: "",
          status: "skipped" as ActivityStatus,
          created_at: prev[activityId]?.created_at || new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      }));

      await updateActivity(activityId, dayNumber, {
        status: "skipped",
        skipReason: reason,
      });
    },
    [tripId, updateActivity]
  );

  const rateActivity = useCallback(
    async (
      activityId: string,
      dayNumber: number,
      rating: number,
      notes?: string,
      quickTags?: QuickTag[]
    ) => {
      // Optimistic update
      setTimelines((prev) => ({
        ...prev,
        [activityId]: {
          ...prev[activityId],
          activity_id: activityId,
          trip_id: tripId,
          user_id: "",
          rating: rating as 1 | 2 | 3 | 4 | 5,
          experience_notes: notes,
          quick_tags: quickTags,
          created_at: prev[activityId]?.created_at || new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      }));

      await updateActivity(activityId, dayNumber, {
        rating,
        notes,
        quickTags,
      });
    },
    [tripId, updateActivity]
  );

  const getActivityStatus = useCallback(
    (activityId: string): ActivityStatus => {
      return timelines[activityId]?.status || "upcoming";
    },
    [timelines]
  );

  const getActivityRating = useCallback(
    (activityId: string): number | undefined => {
      return timelines[activityId]?.rating;
    },
    [timelines]
  );

  const getCurrentActivity = useCallback(
    (dayActivities: Activity[]): Activity | undefined => {
      // Filter to only activities with IDs
      const activitiesWithIds = dayActivities.filter((a) => a.id);

      // Find the first activity that is in_progress
      const inProgress = activitiesWithIds.find(
        (a) => a.id && timelines[a.id]?.status === "in_progress"
      );
      if (inProgress) return inProgress;

      // If none in progress, find the first upcoming
      return activitiesWithIds.find(
        (a) => a.id && (!timelines[a.id] || timelines[a.id]?.status === "upcoming")
      );
    },
    [timelines]
  );

  const getNextActivity = useCallback(
    (dayActivities: Activity[]): Activity | undefined => {
      const current = getCurrentActivity(dayActivities);
      if (!current || !current.id) return undefined;

      const currentIndex = dayActivities.findIndex((a) => a.id === current.id);
      if (currentIndex === -1 || currentIndex >= dayActivities.length - 1) {
        return undefined;
      }

      // Return the next activity if it's upcoming and has an ID
      const next = dayActivities[currentIndex + 1];
      if (!next.id) return undefined;

      const nextStatus = timelines[next.id]?.status || "upcoming";
      if (nextStatus === "upcoming") {
        return next;
      }

      return undefined;
    },
    [getCurrentActivity, timelines]
  );

  const getDayProgress = useCallback(
    (activities: Activity[][], currentDay: number): DayProgress[] => {
      return activities.map((dayActivities, index) => {
        const dayNumber = index + 1;
        // Filter to only activities with IDs for status tracking
        const activitiesWithIds = dayActivities.filter((a) => a.id);
        const completed = activitiesWithIds.filter(
          (a) => a.id && timelines[a.id]?.status === "completed"
        ).length;
        const skipped = activitiesWithIds.filter(
          (a) => a.id && timelines[a.id]?.status === "skipped"
        ).length;

        return {
          day_number: dayNumber,
          total_activities: dayActivities.length,
          completed_activities: completed,
          skipped_activities: skipped,
          is_current: dayNumber === currentDay,
          is_completed: activitiesWithIds.length > 0 && completed + skipped === activitiesWithIds.length,
        };
      });
    },
    [timelines]
  );

  const refresh = useCallback(async () => {
    setIsLoading(true);
    await fetchTimelines();
  }, [fetchTimelines]);

  return {
    timelines,
    isLoading,
    error,
    startActivity,
    completeActivity,
    skipActivity,
    rateActivity,
    getActivityStatus,
    getActivityRating,
    getCurrentActivity,
    getNextActivity,
    getDayProgress,
    refresh,
  };
}
