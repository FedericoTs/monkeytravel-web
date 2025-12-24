"use client";

import { useState, useEffect, useMemo } from "react";
import { useTranslations } from "next-intl";
import { motion, AnimatePresence } from "framer-motion";
import {
  optimizeDayRoute,
  calculateTotalDistance,
  type OptimizationResult,
  type OptimizationConstraints,
} from "@/lib/optimization/routeOptimizer";
import type { Activity } from "@/types";

interface RouteOptimizationModalProps {
  isOpen: boolean;
  onClose: () => void;
  dayNumber: number;
  activities: Activity[];
  onApplyOptimization: (optimizedActivities: Activity[]) => void;
}

/**
 * Format distance for display
 */
function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  return `${(meters / 1000).toFixed(1)} km`;
}

/**
 * Get activity icon based on type
 */
function getActivityIcon(type: string): string {
  const icons: Record<string, string> = {
    restaurant: "🍽️",
    food: "🍽️",
    cafe: "☕",
    bar: "🍷",
    attraction: "🏛️",
    museum: "🖼️",
    landmark: "🏰",
    park: "🌳",
    nature: "🌲",
    shopping: "🛍️",
    market: "🛒",
    spa: "💆",
    wellness: "🧘",
    entertainment: "🎭",
    nightlife: "🌙",
    activity: "🎯",
  };
  return icons[type?.toLowerCase()] || "📍";
}

export function RouteOptimizationModal({
  isOpen,
  onClose,
  dayNumber,
  activities,
  onApplyOptimization,
}: RouteOptimizationModalProps) {
  const t = useTranslations("common.routeOptimization");
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [result, setResult] = useState<OptimizationResult | null>(null);
  const [constraints, setConstraints] = useState<OptimizationConstraints>({
    keepFirstActivity: true,
    keepLastActivity: false,
  });

  // Run optimization when modal opens or constraints change
  useEffect(() => {
    if (!isOpen || activities.length < 3) {
      setResult(null);
      return;
    }

    setIsOptimizing(true);
    // Use setTimeout to allow UI to update before heavy computation
    const timer = setTimeout(() => {
      try {
        const optimizationResult = optimizeDayRoute(activities, constraints);
        setResult(optimizationResult);
      } catch (error) {
        console.error("Optimization failed:", error);
      }
      setIsOptimizing(false);
    }, 100);

    return () => clearTimeout(timer);
  }, [isOpen, activities, constraints]);

  // Check if there are enough activities with coordinates
  const activitiesWithCoords = useMemo(() => {
    return activities.filter(a => a.coordinates?.lat && a.coordinates?.lng);
  }, [activities]);

  const canOptimize = activitiesWithCoords.length >= 3;

  const handleApply = () => {
    if (!result) return;

    // Update start times in the optimized activities
    const updatedActivities = result.optimizedOrder.map(activity => {
      const newTime = result.updatedStartTimes.get(activity.id || "");
      if (newTime) {
        return { ...activity, start_time: newTime };
      }
      return activity;
    });

    onApplyOptimization(updatedActivities);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50"
            onClick={onClose}
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="fixed inset-4 md:inset-auto md:top-1/2 md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2
                       md:w-[600px] md:max-h-[80vh] bg-white rounded-2xl shadow-2xl z-50
                       flex flex-col overflow-hidden"
          >
            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  {t("title")}
                </h2>
                <p className="text-sm text-gray-500">
                  {t("subtitle", { day: dayNumber, count: activities.length })}
                </p>
              </div>
              <button
                onClick={onClose}
                className="p-2 hover:bg-gray-100 rounded-full transition-colors"
              >
                <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto px-6 py-4">
              {!canOptimize ? (
                <div className="text-center py-8">
                  <div className="w-16 h-16 mx-auto mb-4 bg-amber-100 rounded-full flex items-center justify-center">
                    <svg className="w-8 h-8 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                  </div>
                  <h3 className="text-lg font-medium text-gray-900 mb-2">
                    {t("notEnoughData")}
                  </h3>
                  <p className="text-gray-500 text-sm max-w-sm mx-auto">
                    {t("notEnoughDataDesc", { current: activitiesWithCoords.length })}
                  </p>
                </div>
              ) : isOptimizing ? (
                <div className="text-center py-12">
                  <div className="w-12 h-12 mx-auto mb-4 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
                  <p className="text-gray-600">{t("calculating")}</p>
                </div>
              ) : result ? (
                <div className="space-y-6">
                  {/* Savings Summary */}
                  <div className={`p-4 rounded-xl ${
                    result.savingsPercent > 0
                      ? "bg-gradient-to-br from-green-50 to-emerald-50 border border-green-200"
                      : "bg-gray-50 border border-gray-200"
                  }`}>
                    <div className="flex items-center gap-4">
                      <div className={`w-14 h-14 rounded-full flex items-center justify-center ${
                        result.savingsPercent > 0 ? "bg-green-100" : "bg-gray-200"
                      }`}>
                        {result.savingsPercent > 0 ? (
                          <span className="text-2xl">🎯</span>
                        ) : (
                          <span className="text-2xl">✅</span>
                        )}
                      </div>
                      <div className="flex-1">
                        {result.savingsPercent > 0 ? (
                          <>
                            <p className="text-sm text-green-700 font-medium">
                              {t("potentialSavings")}
                            </p>
                            <p className="text-2xl font-bold text-green-800">
                              {t("lessTravel", { distance: formatDistance(result.savingsMeters) })}
                            </p>
                            <p className="text-sm text-green-600">
                              {t("shorterRoute", { percent: result.savingsPercent })}
                            </p>
                          </>
                        ) : (
                          <>
                            <p className="text-sm text-gray-600 font-medium">
                              {t("alreadyOptimal")}
                            </p>
                            <p className="text-lg font-semibold text-gray-800">
                              {t("routeEfficient")}
                            </p>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Distance Comparison */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-3 bg-gray-50 rounded-lg">
                      <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">
                        {t("currentDistance")}
                      </p>
                      <p className="text-lg font-semibold text-gray-700">
                        {formatDistance(result.originalDistanceMeters)}
                      </p>
                    </div>
                    <div className={`p-3 rounded-lg ${
                      result.savingsPercent > 0 ? "bg-green-50" : "bg-gray-50"
                    }`}>
                      <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">
                        {t("optimizedDistance")}
                      </p>
                      <p className={`text-lg font-semibold ${
                        result.savingsPercent > 0 ? "text-green-700" : "text-gray-700"
                      }`}>
                        {formatDistance(result.optimizedDistanceMeters)}
                      </p>
                    </div>
                  </div>

                  {/* Route Comparison */}
                  {result.savingsPercent > 0 && (
                    <div className="space-y-3">
                      <h3 className="text-sm font-medium text-gray-700">
                        {t("suggestedOrder")}
                      </h3>
                      <div className="space-y-2">
                        {result.optimizedOrder.map((activity, index) => {
                          const originalIndex = result.originalOrder.findIndex(
                            a => a.id === activity.id
                          );
                          const moved = originalIndex !== index;
                          const newTime = result.updatedStartTimes.get(activity.id || "");

                          return (
                            <motion.div
                              key={activity.id || index}
                              initial={{ opacity: 0, x: -10 }}
                              animate={{ opacity: 1, x: 0 }}
                              transition={{ delay: index * 0.05 }}
                              className={`flex items-center gap-3 p-3 rounded-lg border ${
                                moved
                                  ? "bg-amber-50 border-amber-200"
                                  : "bg-gray-50 border-gray-200"
                              }`}
                            >
                              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                                moved ? "bg-amber-200 text-amber-800" : "bg-gray-200 text-gray-600"
                              }`}>
                                {index + 1}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="text-lg">{getActivityIcon(activity.type)}</span>
                                  <span className="font-medium text-gray-900 truncate">
                                    {activity.name}
                                  </span>
                                </div>
                                <p className="text-xs text-gray-500">
                                  {newTime || activity.start_time}
                                  {moved && originalIndex !== -1 && (
                                    <span className="ml-2 text-amber-600">
                                      {t("wasPosition", { position: originalIndex + 1 })}
                                    </span>
                                  )}
                                </p>
                              </div>
                              {moved && (
                                <div className="text-amber-500">
                                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                      d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                                  </svg>
                                </div>
                              )}
                            </motion.div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Constraints */}
                  <div className="border-t pt-4">
                    <h3 className="text-sm font-medium text-gray-700 mb-3">
                      {t("constraints")}
                    </h3>
                    <div className="space-y-2">
                      <label className="flex items-center gap-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={constraints.keepFirstActivity}
                          onChange={(e) => setConstraints(prev => ({
                            ...prev,
                            keepFirstActivity: e.target.checked,
                          }))}
                          className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="text-sm text-gray-700">
                          {t("keepFirst")}
                        </span>
                      </label>
                      <label className="flex items-center gap-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={constraints.keepLastActivity}
                          onChange={(e) => setConstraints(prev => ({
                            ...prev,
                            keepLastActivity: e.target.checked,
                          }))}
                          className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="text-sm text-gray-700">
                          {t("keepLast")}
                        </span>
                      </label>
                    </div>
                    <p className="text-xs text-gray-500 mt-2">
                      {t("mealTimesNote")}
                    </p>
                  </div>
                </div>
              ) : null}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-gray-100 flex gap-3">
              <button
                onClick={onClose}
                className="flex-1 py-3 px-4 text-gray-700 font-medium rounded-xl
                         border border-gray-300 hover:bg-gray-50 transition-colors"
              >
                {t("cancel")}
              </button>
              {result && result.savingsPercent > 0 && (
                <button
                  onClick={handleApply}
                  className="flex-1 py-3 px-4 bg-gradient-to-r from-green-600 to-emerald-600
                           text-white font-medium rounded-xl hover:from-green-700 hover:to-emerald-700
                           transition-all shadow-lg shadow-green-500/25"
                >
                  {t("applyOptimization")}
                </button>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
