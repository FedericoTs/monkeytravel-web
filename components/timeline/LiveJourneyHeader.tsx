"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import type { DayProgress, ActivityStatus } from "@/types/timeline";

interface CurrentActivity {
  id: string;
  name: string;
  start_time: string;
  end_time?: string;
  location?: string;
  status: ActivityStatus;
}

interface LiveJourneyHeaderProps {
  tripTitle: string;
  currentDay: number;
  totalDays: number;
  dayProgress: DayProgress[];
  currentActivity?: CurrentActivity;
  nextActivity?: CurrentActivity;
  destination?: string;
}

export default function LiveJourneyHeader({
  tripTitle,
  currentDay,
  totalDays,
  dayProgress,
  currentActivity,
  nextActivity,
  destination,
}: LiveJourneyHeaderProps) {
  const t = useTranslations("common.liveJourney");
  const [timeUntilNext, setTimeUntilNext] = useState<string>("");

  // Calculate time until next activity
  useEffect(() => {
    const calculateTimeUntil = () => {
      const targetActivity = currentActivity?.status === "upcoming"
        ? currentActivity
        : nextActivity;

      if (!targetActivity?.start_time) {
        setTimeUntilNext("");
        return;
      }

      // Parse the time (HH:MM format)
      const [hours, minutes] = targetActivity.start_time.split(":").map(Number);
      const now = new Date();
      const targetTime = new Date();
      targetTime.setHours(hours, minutes, 0, 0);

      // If target time is in the past, activity may be in progress
      if (targetTime <= now && currentActivity?.status === "in_progress") {
        setTimeUntilNext(t("now"));
        return;
      }

      const diffMs = targetTime.getTime() - now.getTime();
      if (diffMs < 0) {
        setTimeUntilNext("");
        return;
      }

      const diffMins = Math.floor(diffMs / 60000);
      if (diffMins < 60) {
        setTimeUntilNext(t("inMinutes", { minutes: diffMins }));
      } else {
        const diffHours = Math.floor(diffMins / 60);
        const remainingMins = diffMins % 60;
        setTimeUntilNext(t("inHoursMinutes", { hours: diffHours, minutes: remainingMins }));
      }
    };

    calculateTimeUntil();
    const interval = setInterval(calculateTimeUntil, 60000); // Update every minute

    return () => clearInterval(interval);
  }, [currentActivity, nextActivity, t]);

  // Calculate day completion percentage
  const currentDayProgress = dayProgress.find(d => d.is_current);
  const dayCompletionPercent = currentDayProgress
    ? (currentDayProgress.completed_activities / currentDayProgress.total_activities) * 100
    : 0;

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      {/* Header with day info */}
      <div className="px-4 py-3 border-b border-slate-100 bg-gradient-to-r from-[var(--primary)]/5 to-transparent">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              {t("dayOfTotal", { current: currentDay, total: totalDays })}
            </h2>
            {destination && (
              <p className="text-sm text-slate-600">{destination}</p>
            )}
          </div>

          {/* Day progress dots */}
          <div className="flex items-center gap-1.5">
            {dayProgress.map((day, index) => (
              <motion.div
                key={index}
                className={`
                  w-2.5 h-2.5 rounded-full transition-colors
                  ${day.is_completed
                    ? "bg-emerald-500"
                    : day.is_current
                      ? "bg-[var(--primary)] ring-2 ring-[var(--primary)]/30"
                      : "bg-slate-200"
                  }
                `}
                animate={day.is_current ? { scale: [1, 1.2, 1] } : {}}
                transition={{
                  repeat: Infinity,
                  duration: 2,
                  ease: "easeInOut"
                }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Current/Next activity preview */}
      <div className="p-4">
        {currentActivity?.status === "in_progress" ? (
          <div className="flex items-start gap-3">
            {/* Now indicator */}
            <div className="flex-shrink-0 w-10 h-10 rounded-full bg-blue-500 flex items-center justify-center">
              <motion.div
                className="w-3 h-3 rounded-full bg-white"
                animate={{ scale: [1, 0.7, 1] }}
                transition={{ repeat: Infinity, duration: 1.5 }}
              />
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                  {t("inProgress")}
                </span>
                <span className="text-sm text-slate-500">{currentActivity.start_time}</span>
              </div>
              <h3 className="font-semibold text-slate-900 truncate">
                {currentActivity.name}
              </h3>
              {currentActivity.location && (
                <p className="text-sm text-slate-500 truncate flex items-center gap-1 mt-0.5">
                  <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  {currentActivity.location}
                </p>
              )}
            </div>
          </div>
        ) : nextActivity ? (
          <div className="flex items-start gap-3">
            {/* Upcoming indicator */}
            <div className="flex-shrink-0 w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center">
              <svg className="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
                  {t("upNext")}
                </span>
                <span className="text-sm text-slate-500">{nextActivity.start_time}</span>
                {timeUntilNext && (
                  <span className="text-xs text-[var(--primary)] font-medium">
                    {timeUntilNext}
                  </span>
                )}
              </div>
              <h3 className="font-semibold text-slate-900 truncate">
                {nextActivity.name}
              </h3>
              {nextActivity.location && (
                <p className="text-sm text-slate-500 truncate flex items-center gap-1 mt-0.5">
                  <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  {nextActivity.location}
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center py-4 text-slate-500">
            <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span>{t("allComplete")}</span>
          </div>
        )}
      </div>

      {/* Day progress bar */}
      <div className="px-4 pb-3">
        <div className="flex items-center justify-between text-xs text-slate-500 mb-1.5">
          <span>{t("todaysProgress")}</span>
          <span>
            {t("activitiesCount", {
              completed: currentDayProgress?.completed_activities || 0,
              total: currentDayProgress?.total_activities || 0
            })}
          </span>
        </div>
        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-gradient-to-r from-[var(--primary)] to-[var(--primary)]/80 rounded-full"
            initial={{ width: 0 }}
            animate={{ width: `${dayCompletionPercent}%` }}
            transition={{ duration: 0.5, ease: "easeOut" }}
          />
        </div>
      </div>
    </div>
  );
}
