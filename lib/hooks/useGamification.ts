"use client";

import { useState, useCallback, useMemo } from "react";
import type {
  AchievementId,
  TripGamification,
  XpGainEvent,
  ActivityTimeline,
} from "@/types/timeline";
import { ACTIVITY_XP, STREAK_MULTIPLIERS, ACHIEVEMENTS } from "@/types/timeline";
import type { Activity, ItineraryDay } from "@/types";

interface UseGamificationProps {
  tripId: string;
  itinerary: ItineraryDay[];
  activityTimelines: Record<string, ActivityTimeline>;
}

interface UseGamificationReturn {
  // State
  gamification: TripGamification;
  isLoading: boolean;

  // XP Calculations
  calculateActivityXp: (activity: Activity) => number;
  getStreakMultiplier: () => number;

  // Actions
  recordCompletion: (activity: Activity, dayNumber: number) => XpGainEvent;
  recordSkip: (activityId: string) => void;

  // Progress
  getTotalPossibleXp: () => number;
  getProgressPercentage: () => number;
  getTodayProgress: (currentDayNumber: number) => { completed: number; total: number; xpEarned: number };

  // Achievements
  getUnlockedAchievements: () => AchievementId[];
  getAvailableAchievements: () => AchievementId[];
  checkNewAchievements: (activity: Activity, dayNumber: number) => AchievementId[];
}

/**
 * Hook for managing trip gamification (XP, streaks, achievements)
 */
export function useGamification({
  tripId,
  itinerary,
  activityTimelines,
}: UseGamificationProps): UseGamificationReturn {
  // Initialize gamification state from timelines
  const initialGamification = useMemo((): TripGamification => {
    const completedIds: string[] = [];
    const activityTypeCounts: Record<string, number> = {};
    let totalXp = 0;
    let skippedCount = 0;
    let currentStreak = 0;
    let longestStreak = 0;
    let tempStreak = 0;

    // Process activities in order to calculate streaks
    for (const day of itinerary) {
      for (const activity of day.activities) {
        const timeline = activity.id ? activityTimelines[activity.id] : null;

        if (timeline?.status === "completed") {
          completedIds.push(activity.id!);

          // Track activity type counts
          const type = activity.type || "activity";
          activityTypeCounts[type] = (activityTypeCounts[type] || 0) + 1;

          // Calculate XP
          const baseXp = ACTIVITY_XP[type] || ACTIVITY_XP.activity;
          const multiplier = STREAK_MULTIPLIERS[Math.min(tempStreak, 6)] || 2;
          totalXp += Math.round(baseXp * multiplier);

          tempStreak++;
          longestStreak = Math.max(longestStreak, tempStreak);
        } else if (timeline?.status === "skipped") {
          skippedCount++;
          tempStreak = 0; // Reset streak on skip
        }
      }
    }

    currentStreak = tempStreak;

    // Check which achievements should already be unlocked
    const unlockedAchievements: AchievementId[] = [];
    const achievementUnlockedAt: Record<AchievementId, string> = {} as Record<AchievementId, string>;

    // First Steps
    if (completedIds.length >= 1) {
      unlockedAchievements.push("first_steps");
      achievementUnlockedAt.first_steps = new Date().toISOString();
      totalXp += ACHIEVEMENTS.first_steps.xpBonus;
    }

    // Streak achievements
    if (longestStreak >= 3) {
      unlockedAchievements.push("streak_3");
      achievementUnlockedAt.streak_3 = new Date().toISOString();
      totalXp += ACHIEVEMENTS.streak_3.xpBonus;
    }
    if (longestStreak >= 5) {
      unlockedAchievements.push("streak_5");
      achievementUnlockedAt.streak_5 = new Date().toISOString();
      totalXp += ACHIEVEMENTS.streak_5.xpBonus;
    }

    // Foodie (3+ food activities)
    const foodTypes = ["food", "restaurant", "foodie", "cafe", "bar", "market"];
    const foodCount = foodTypes.reduce((sum, t) => sum + (activityTypeCounts[t] || 0), 0);
    if (foodCount >= 3) {
      unlockedAchievements.push("foodie");
      achievementUnlockedAt.foodie = new Date().toISOString();
      totalXp += ACHIEVEMENTS.foodie.xpBonus;
    }

    // Culture Vulture (5+ cultural activities)
    const culturalTypes = ["cultural", "museum", "landmark", "attraction"];
    const culturalCount = culturalTypes.reduce((sum, t) => sum + (activityTypeCounts[t] || 0), 0);
    if (culturalCount >= 5) {
      unlockedAchievements.push("culture_vulture");
      achievementUnlockedAt.culture_vulture = new Date().toISOString();
      totalXp += ACHIEVEMENTS.culture_vulture.xpBonus;
    }

    // Explorer (10+ unique locations)
    if (completedIds.length >= 10) {
      unlockedAchievements.push("explorer");
      achievementUnlockedAt.explorer = new Date().toISOString();
      totalXp += ACHIEVEMENTS.explorer.xpBonus;
    }

    // Halfway There
    const totalActivities = itinerary.reduce((sum, day) => sum + day.activities.length, 0);
    if (completedIds.length >= Math.ceil(totalActivities / 2)) {
      unlockedAchievements.push("halfway_there");
      achievementUnlockedAt.halfway_there = new Date().toISOString();
      totalXp += ACHIEVEMENTS.halfway_there.xpBonus;
    }

    // Finish Line (all completed)
    if (completedIds.length === totalActivities && totalActivities > 0) {
      unlockedAchievements.push("finish_line");
      achievementUnlockedAt.finish_line = new Date().toISOString();
      totalXp += ACHIEVEMENTS.finish_line.xpBonus;

      // Perfectionist (no skips)
      if (skippedCount === 0) {
        unlockedAchievements.push("perfectionist");
        achievementUnlockedAt.perfectionist = new Date().toISOString();
        totalXp += ACHIEVEMENTS.perfectionist.xpBonus;
      }
    }

    return {
      tripId,
      totalXp,
      currentStreak,
      longestStreak,
      unlockedAchievements,
      achievementUnlockedAt,
      activityTypeCounts,
      completedActivityIds: completedIds,
      skippedCount,
      updatedAt: new Date().toISOString(),
    };
  }, [tripId, itinerary, activityTimelines]);

  const [gamification, setGamification] = useState<TripGamification>(initialGamification);
  const [isLoading] = useState(false);

  // Calculate XP for a single activity
  const calculateActivityXp = useCallback((activity: Activity): number => {
    const type = activity.type || "activity";
    return ACTIVITY_XP[type] || ACTIVITY_XP.activity;
  }, []);

  // Get current streak multiplier
  const getStreakMultiplier = useCallback((): number => {
    const streak = Math.min(gamification.currentStreak, 6);
    return STREAK_MULTIPLIERS[streak] || 2;
  }, [gamification.currentStreak]);

  // Check for new achievements on completion
  const checkNewAchievements = useCallback(
    (activity: Activity, dayNumber: number): AchievementId[] => {
      const newAchievements: AchievementId[] = [];
      const state = gamification;

      // Already unlocked?
      const isUnlocked = (id: AchievementId) => state.unlockedAchievements.includes(id);

      // First Steps
      if (!isUnlocked("first_steps") && state.completedActivityIds.length === 0) {
        newAchievements.push("first_steps");
      }

      // Early Bird (before 9am)
      if (!isUnlocked("early_bird")) {
        const hour = parseInt(activity.start_time.split(":")[0], 10);
        if (hour < 9) {
          newAchievements.push("early_bird");
        }
      }

      // Night Owl (after 9pm)
      if (!isUnlocked("night_owl")) {
        const hour = parseInt(activity.start_time.split(":")[0], 10);
        if (hour >= 21) {
          newAchievements.push("night_owl");
        }
      }

      // Streak achievements
      const newStreak = state.currentStreak + 1;
      if (!isUnlocked("streak_3") && newStreak === 3) {
        newAchievements.push("streak_3");
      }
      if (!isUnlocked("streak_5") && newStreak === 5) {
        newAchievements.push("streak_5");
      }

      // Foodie
      const foodTypes = ["food", "restaurant", "foodie", "cafe", "bar", "market"];
      if (!isUnlocked("foodie") && foodTypes.includes(activity.type)) {
        const newFoodCount =
          foodTypes.reduce((sum, t) => sum + (state.activityTypeCounts[t] || 0), 0) + 1;
        if (newFoodCount >= 3) {
          newAchievements.push("foodie");
        }
      }

      // Culture Vulture
      const culturalTypes = ["cultural", "museum", "landmark", "attraction"];
      if (!isUnlocked("culture_vulture") && culturalTypes.includes(activity.type)) {
        const newCount =
          culturalTypes.reduce((sum, t) => sum + (state.activityTypeCounts[t] || 0), 0) + 1;
        if (newCount >= 5) {
          newAchievements.push("culture_vulture");
        }
      }

      // Explorer (10 locations)
      if (!isUnlocked("explorer") && state.completedActivityIds.length === 9) {
        newAchievements.push("explorer");
      }

      // Day Master (all activities in a day)
      if (!isUnlocked("day_master")) {
        const dayActivities = itinerary.find((d) => d.day_number === dayNumber)?.activities || [];
        const dayCompletedCount = dayActivities.filter(
          (a) => a.id && (state.completedActivityIds.includes(a.id) || a.id === activity.id)
        ).length;
        if (dayCompletedCount === dayActivities.length) {
          newAchievements.push("day_master");
        }
      }

      // Halfway There
      const totalActivities = itinerary.reduce((sum, day) => sum + day.activities.length, 0);
      const newCompleted = state.completedActivityIds.length + 1;
      if (!isUnlocked("halfway_there") && newCompleted >= Math.ceil(totalActivities / 2)) {
        newAchievements.push("halfway_there");
      }

      // Finish Line
      if (!isUnlocked("finish_line") && newCompleted === totalActivities) {
        newAchievements.push("finish_line");

        // Perfectionist
        if (!isUnlocked("perfectionist") && state.skippedCount === 0) {
          newAchievements.push("perfectionist");
        }
      }

      return newAchievements;
    },
    [gamification, itinerary]
  );

  // Record activity completion
  const recordCompletion = useCallback(
    (activity: Activity, dayNumber: number): XpGainEvent => {
      const baseXp = calculateActivityXp(activity);
      const multiplier = getStreakMultiplier();
      const newStreak = gamification.currentStreak + 1;
      const newAchievements = checkNewAchievements(activity, dayNumber);

      // Calculate achievement bonus XP
      const achievementXp = newAchievements.reduce(
        (sum, id) => sum + ACHIEVEMENTS[id].xpBonus,
        0
      );

      const totalXp = Math.round(baseXp * multiplier) + achievementXp;

      // Update state
      setGamification((prev) => {
        const newTypeCounts = { ...prev.activityTypeCounts };
        const type = activity.type || "activity";
        newTypeCounts[type] = (newTypeCounts[type] || 0) + 1;

        const now = new Date().toISOString();
        const newAchievementTimes = { ...prev.achievementUnlockedAt };
        newAchievements.forEach((id) => {
          newAchievementTimes[id] = now;
        });

        return {
          ...prev,
          totalXp: prev.totalXp + totalXp,
          currentStreak: newStreak,
          longestStreak: Math.max(prev.longestStreak, newStreak),
          completedActivityIds: [...prev.completedActivityIds, activity.id!],
          activityTypeCounts: newTypeCounts,
          unlockedAchievements: [...prev.unlockedAchievements, ...newAchievements],
          achievementUnlockedAt: newAchievementTimes,
          lastActivityCompletedAt: now,
          updatedAt: now,
        };
      });

      return {
        baseXp,
        streakMultiplier: multiplier,
        totalXp,
        newStreak,
        newAchievements,
      };
    },
    [calculateActivityXp, getStreakMultiplier, checkNewAchievements, gamification.currentStreak]
  );

  // Record skip (resets streak)
  const recordSkip = useCallback((activityId: string) => {
    setGamification((prev) => ({
      ...prev,
      currentStreak: 0,
      skippedCount: prev.skippedCount + 1,
      updatedAt: new Date().toISOString(),
    }));
  }, []);

  // Calculate total possible XP
  const getTotalPossibleXp = useCallback((): number => {
    let total = 0;
    for (const day of itinerary) {
      for (const activity of day.activities) {
        const type = activity.type || "activity";
        total += ACTIVITY_XP[type] || ACTIVITY_XP.activity;
      }
    }
    // Add achievement bonuses
    Object.values(ACHIEVEMENTS).forEach((a) => {
      total += a.xpBonus;
    });
    return total;
  }, [itinerary]);

  // Progress percentage based on XP
  const getProgressPercentage = useCallback((): number => {
    const total = getTotalPossibleXp();
    if (total === 0) return 0;
    return Math.min(100, Math.round((gamification.totalXp / total) * 100));
  }, [gamification.totalXp, getTotalPossibleXp]);

  // Today's progress
  const getTodayProgress = useCallback(
    (currentDayNumber: number) => {
      const day = itinerary.find((d) => d.day_number === currentDayNumber);
      if (!day) return { completed: 0, total: 0, xpEarned: 0 };

      let completed = 0;
      let xpEarned = 0;
      for (const activity of day.activities) {
        if (activity.id && gamification.completedActivityIds.includes(activity.id)) {
          completed++;
          xpEarned += calculateActivityXp(activity);
        }
      }

      return { completed, total: day.activities.length, xpEarned };
    },
    [itinerary, gamification.completedActivityIds, calculateActivityXp]
  );

  const getUnlockedAchievements = useCallback(
    () => gamification.unlockedAchievements,
    [gamification.unlockedAchievements]
  );

  const getAvailableAchievements = useCallback((): AchievementId[] => {
    return (Object.keys(ACHIEVEMENTS) as AchievementId[]).filter(
      (id) => !gamification.unlockedAchievements.includes(id)
    );
  }, [gamification.unlockedAchievements]);

  return {
    gamification,
    isLoading,
    calculateActivityXp,
    getStreakMultiplier,
    recordCompletion,
    recordSkip,
    getTotalPossibleXp,
    getProgressPercentage,
    getTodayProgress,
    getUnlockedAchievements,
    getAvailableAchievements,
    checkNewAchievements,
  };
}
