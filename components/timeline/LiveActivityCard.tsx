"use client";

import { useRef, useState } from "react";
import { motion, useMotionValue, useTransform, AnimatePresence } from "framer-motion";
import type { ActivityStatus } from "@/types/timeline";
import StarRating from "../ui/StarRating";

interface ActivityData {
  id: string;
  name: string;
  description?: string;
  start_time: string;
  duration_minutes: number;
  address?: string;
  location?: string;
  type: string;
  image_url?: string;
  official_website?: string;
  estimated_cost?: {
    amount: number;
    currency: string;
    tier: "free" | "budget" | "moderate" | "expensive";
  };
}

interface LiveActivityCardProps {
  activity: ActivityData;
  status: ActivityStatus;
  onComplete: () => void;
  onSkip: () => void;
  onAddPhoto: () => void;
  onAddNote: () => void;
  rating?: number;
  onRate?: (rating: number) => void;
  isCompletingAnimation?: boolean;
}

export default function LiveActivityCard({
  activity,
  status,
  onComplete,
  onSkip,
  onAddPhoto,
  onAddNote,
  rating,
  onRate,
  isCompletingAnimation = false,
}: LiveActivityCardProps) {
  const constraintsRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [showCompletedFeedback, setShowCompletedFeedback] = useState(false);

  const x = useMotionValue(0);
  const progress = useTransform(x, [0, 240], [0, 100]);
  const trackOpacity = useTransform(x, [0, 120, 240], [1, 0.5, 0.2]);
  const checkmarkScale = useTransform(x, [200, 240], [1, 1.3]);

  const handleDragEnd = (_: unknown, info: { offset: { x: number }; velocity: { x: number } }) => {
    setIsDragging(false);
    // Complete if dragged far enough or with enough velocity
    if (info.offset.x > 200 || (info.offset.x > 100 && info.velocity.x > 500)) {
      setShowCompletedFeedback(true);
      setTimeout(() => {
        onComplete();
      }, 600);
    }
  };

  const statusConfig = {
    upcoming: {
      badge: "Upcoming",
      badgeClass: "bg-slate-100 text-slate-600",
      cardClass: "opacity-80",
      showSlider: false,
    },
    in_progress: {
      badge: "In Progress",
      badgeClass: "bg-blue-100 text-blue-700",
      cardClass: "ring-2 ring-blue-500/50 ring-offset-2",
      showSlider: true,
    },
    completed: {
      badge: "Completed",
      badgeClass: "bg-emerald-100 text-emerald-700",
      cardClass: "",
      showSlider: false,
    },
    skipped: {
      badge: "Skipped",
      badgeClass: "bg-orange-100 text-orange-700",
      cardClass: "opacity-60",
      showSlider: false,
    },
  };

  const config = statusConfig[status];

  // Format estimated cost
  const formatCost = (cost: ActivityData["estimated_cost"]) => {
    if (!cost) return null;
    if (cost.tier === "free") return "Free";
    const symbol = cost.currency === "EUR" ? "€" : cost.currency === "GBP" ? "£" : "$";
    return `${symbol}${cost.amount}`;
  };

  return (
    <motion.div
      className={`relative ${config.cardClass}`}
      initial={isCompletingAnimation ? { scale: 1 } : false}
      animate={isCompletingAnimation ? { scale: [1, 1.02, 1] } : {}}
      transition={{ duration: 0.4 }}
    >
      {/* Completion celebration overlay */}
      <AnimatePresence>
        {showCompletedFeedback && (
          <motion.div
            className="absolute inset-0 z-10 flex items-center justify-center bg-emerald-500/20 rounded-2xl backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="w-20 h-20 rounded-full bg-emerald-500 flex items-center justify-center shadow-lg"
              initial={{ scale: 0 }}
              animate={{ scale: [0, 1.2, 1] }}
              transition={{ duration: 0.4 }}
            >
              <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Card */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {/* Status Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-slate-900">
              {activity.start_time}
            </span>
            <span className={`
              inline-flex items-center gap-1.5
              px-2.5 py-0.5 rounded-full
              text-xs font-medium
              ${config.badgeClass}
            `}>
              {status === "in_progress" && (
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
              )}
              {status === "completed" && (
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              )}
              {config.badge}
            </span>
          </div>

          {/* Rating Stars (for completed) */}
          {status === "completed" && (
            <StarRating
              value={rating || 0}
              onChange={onRate}
              readonly={!onRate}
              size="sm"
            />
          )}
        </div>

        {/* Activity Image (if available) */}
        {activity.image_url && (
          <div className="relative h-32 bg-slate-100">
            <img
              src={activity.image_url}
              alt={activity.name}
              className="w-full h-full object-cover"
            />
            {/* Type badge overlay */}
            <span className="absolute bottom-2 left-2 px-2 py-0.5 rounded-full text-xs font-medium bg-black/60 text-white">
              {activity.type}
            </span>
          </div>
        )}

        {/* Activity Content */}
        <div className="p-4">
          <div className="flex items-start gap-3">
            {/* Type icon (if no image) */}
            {!activity.image_url && (
              <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-[var(--primary)]/10 flex items-center justify-center">
                <span className="text-lg">
                  {activity.type === "dining" && "🍽️"}
                  {activity.type === "sightseeing" && "🏛️"}
                  {activity.type === "activity" && "🎯"}
                  {activity.type === "transport" && "🚗"}
                  {activity.type === "entertainment" && "🎭"}
                  {activity.type === "shopping" && "🛍️"}
                  {!["dining", "sightseeing", "activity", "transport", "entertainment", "shopping"].includes(activity.type) && "📍"}
                </span>
              </div>
            )}

            <div className="flex-1 min-w-0">
              <h3 className="text-lg font-semibold text-slate-900 mb-1">
                {activity.name}
              </h3>
              {activity.description && (
                <p className="text-sm text-slate-600 mb-3 line-clamp-2">
                  {activity.description}
                </p>
              )}

              {/* Meta Info */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-500">
                {(activity.address || activity.location) && (
                  <div className="flex items-center gap-1.5">
                    <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    <span className="truncate max-w-[180px]">
                      {activity.address || activity.location}
                    </span>
                  </div>
                )}
                <div className="flex items-center gap-1.5">
                  <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span>{activity.duration_minutes} min</span>
                </div>
                {formatCost(activity.estimated_cost) && (
                  <div className="flex items-center gap-1.5">
                    <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span>{formatCost(activity.estimated_cost)}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Quick Actions (for in_progress) */}
        {status === "in_progress" && (
          <div className="flex items-center gap-2 px-4 pb-4">
            <button
              onClick={onAddPhoto}
              className="
                flex-1 flex items-center justify-center gap-2
                px-4 py-2.5 rounded-xl
                bg-slate-100 hover:bg-slate-200
                text-slate-700 text-sm font-medium
                transition-colors active:scale-95
              "
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span className="hidden sm:inline">Photo</span>
            </button>
            <button
              onClick={onAddNote}
              className="
                flex-1 flex items-center justify-center gap-2
                px-4 py-2.5 rounded-xl
                bg-slate-100 hover:bg-slate-200
                text-slate-700 text-sm font-medium
                transition-colors active:scale-95
              "
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              <span className="hidden sm:inline">Note</span>
            </button>
            <button
              onClick={onSkip}
              className="
                flex items-center justify-center gap-2
                px-4 py-2.5 rounded-xl
                bg-orange-50 hover:bg-orange-100
                text-orange-600 text-sm font-medium
                transition-colors active:scale-95
              "
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
              </svg>
              <span className="hidden sm:inline">Skip</span>
            </button>
          </div>
        )}

        {/* Slide to Complete (for in_progress) */}
        {config.showSlider && (
          <div className="px-4 pb-4">
            <div
              ref={constraintsRef}
              className="relative h-14 bg-slate-100 rounded-full overflow-hidden"
            >
              {/* Track background with gradient fill */}
              <motion.div
                className="absolute inset-y-0 left-0 bg-gradient-to-r from-emerald-400 to-emerald-500 rounded-full"
                style={{ width: progress.get() + "%" }}
              />

              {/* Track text */}
              <motion.div
                className="absolute inset-0 flex items-center justify-center"
                style={{ opacity: trackOpacity }}
              >
                <span className="text-sm font-medium text-slate-400">
                  Slide to mark complete
                </span>
              </motion.div>

              {/* Checkmark at end */}
              <motion.div
                className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center"
                style={{ scale: checkmarkScale }}
              >
                <svg className="w-5 h-5 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </motion.div>

              {/* Sliding knob */}
              <motion.div
                drag="x"
                dragConstraints={constraintsRef}
                dragElastic={0.1}
                dragMomentum={false}
                style={{ x }}
                onDragStart={() => setIsDragging(true)}
                onDragEnd={handleDragEnd}
                className={`
                  absolute left-1 top-1 bottom-1
                  w-12 rounded-full
                  bg-[var(--primary)] shadow-lg
                  flex items-center justify-center
                  cursor-grab active:cursor-grabbing
                  touch-none
                  ${isDragging ? "scale-105" : ""}
                `}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 1.1 }}
              >
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </motion.div>
            </div>
          </div>
        )}

        {/* Action buttons: Website & Navigate */}
        {(activity.address || activity.location || activity.official_website) && (
          <div className="px-4 pb-4 flex gap-2">
            {/* Website button */}
            {activity.official_website && (
              <a
                href={activity.official_website}
                target="_blank"
                rel="noopener noreferrer"
                className="
                  flex items-center justify-center gap-2
                  flex-1 px-4 py-2.5 rounded-xl
                  bg-[var(--primary)]/10 hover:bg-[var(--primary)]/20
                  text-[var(--primary)] text-sm font-medium
                  transition-colors
                "
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
                Website
              </a>
            )}
            {/* Navigate button */}
            {(activity.address || activity.location) && (
              <a
                href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(activity.address || activity.location || "")}`}
                target="_blank"
                rel="noopener noreferrer"
                className={`
                  flex items-center justify-center gap-2
                  ${activity.official_website ? 'flex-1' : 'w-full'} px-4 py-2.5 rounded-xl
                  border border-slate-200 hover:border-[var(--primary)] hover:bg-[var(--primary)]/5
                  text-slate-700 hover:text-[var(--primary)] text-sm font-medium
                  transition-colors
                `}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                </svg>
                Navigate
              </a>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}
