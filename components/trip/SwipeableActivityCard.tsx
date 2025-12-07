"use client";

import { useState, useRef } from "react";
import { motion, useMotionValue, useTransform, AnimatePresence, PanInfo } from "framer-motion";
import {
  Check,
  X,
  Clock,
  MapPin,
  ChevronRight,
  Utensils,
  Landmark,
  Camera,
  ShoppingBag,
  Coffee,
  Bus,
  TreePine,
  Sparkles,
} from "lucide-react";
import type { Activity } from "@/types";
import type { ActivityStatus } from "@/types/timeline";
import { ACTIVITY_XP } from "@/types/timeline";

interface SwipeableActivityCardProps {
  activity: Activity;
  status: ActivityStatus;
  xpValue: number;
  streakMultiplier: number;
  onComplete: () => void;
  onSkip: () => void;
  onTap?: () => void;
  isExpanded?: boolean;
  currency?: string;
}

// Icon mapping for activity types
const TYPE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  restaurant: Utensils,
  food: Utensils,
  foodie: Utensils,
  cafe: Coffee,
  bar: Coffee,
  cultural: Landmark,
  museum: Landmark,
  landmark: Landmark,
  attraction: Camera,
  shopping: ShoppingBag,
  market: ShoppingBag,
  transport: Bus,
  nature: TreePine,
  park: TreePine,
};

export default function SwipeableActivityCard({
  activity,
  status,
  xpValue,
  streakMultiplier,
  onComplete,
  onSkip,
  onTap,
  isExpanded = false,
  currency = "USD",
}: SwipeableActivityCardProps) {
  const constraintsRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isCollapsing, setIsCollapsing] = useState(false);

  // Motion values for swipe gesture
  const x = useMotionValue(0);

  // Transform values for visual feedback
  const completeOpacity = useTransform(x, [0, 80, 160], [0, 0.5, 1]);
  const skipOpacity = useTransform(x, [-160, -80, 0], [1, 0.5, 0]);
  const scale = useTransform(x, [-100, 0, 100], [0.98, 1, 0.98]);
  const checkScale = useTransform(x, [100, 160], [0.8, 1.2]);

  // Handle drag end
  const handleDragEnd = (_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    setIsDragging(false);

    // Complete threshold
    if (info.offset.x > 120 || (info.offset.x > 60 && info.velocity.x > 500)) {
      setIsCollapsing(true);
      setTimeout(() => {
        onComplete();
      }, 400);
      return;
    }

    // Skip threshold
    if (info.offset.x < -120 || (info.offset.x < -60 && info.velocity.x < -500)) {
      setIsCollapsing(true);
      setTimeout(() => {
        onSkip();
      }, 400);
      return;
    }
  };

  const Icon = TYPE_ICONS[activity.type] || Sparkles;
  const isCompleted = status === "completed";
  const isSkipped = status === "skipped";
  const isUpcoming = status === "upcoming";
  const isInProgress = status === "in_progress";

  // Format price
  const formatPrice = (amount: number) => {
    if (amount === 0) return "Free";
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 0,
    }).format(amount);
  };

  // Card content for both expanded and collapsed states
  const CardContent = () => (
    <>
      {/* Activity Type Icon */}
      <div
        className={`flex-shrink-0 w-12 h-12 rounded-xl flex items-center justify-center ${
          isCompleted
            ? "bg-emerald-100 text-emerald-600"
            : isSkipped
            ? "bg-orange-100 text-orange-600"
            : isInProgress
            ? "bg-blue-100 text-blue-600"
            : "bg-slate-100 text-slate-500"
        }`}
      >
        {isCompleted ? (
          <Check className="w-6 h-6" />
        ) : isSkipped ? (
          <X className="w-6 h-6" />
        ) : (
          <Icon className="w-6 h-6" />
        )}
      </div>

      {/* Activity Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h3
            className={`font-semibold truncate ${
              isCompleted || isSkipped
                ? "text-slate-400 line-through decoration-2"
                : "text-slate-900"
            }`}
          >
            {activity.name}
          </h3>
        </div>

        <div className="flex items-center gap-3 mt-1 text-sm">
          <span
            className={`flex items-center gap-1 ${
              isCompleted || isSkipped ? "text-slate-300" : "text-slate-500"
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            {activity.start_time}
          </span>
          <span
            className={`flex items-center gap-1 truncate ${
              isCompleted || isSkipped ? "text-slate-300" : "text-slate-500"
            }`}
          >
            <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="truncate">{activity.address || activity.location}</span>
          </span>
        </div>
      </div>

      {/* XP Badge or Status */}
      <div className="flex-shrink-0 flex items-center gap-2">
        {isCompleted ? (
          <span className="px-2 py-1 bg-emerald-100 text-emerald-700 text-xs font-medium rounded-full">
            Done
          </span>
        ) : isSkipped ? (
          <span className="px-2 py-1 bg-orange-100 text-orange-700 text-xs font-medium rounded-full">
            Skipped
          </span>
        ) : (
          <>
            <span className="text-xs text-slate-400">
              +{Math.round(xpValue * streakMultiplier)} XP
            </span>
            <ChevronRight className="w-5 h-5 text-slate-300" />
          </>
        )}
      </div>
    </>
  );

  // Collapsed mini-card for completed activities
  if ((isCompleted || isSkipped) && !isCollapsing) {
    return (
      <motion.div
        initial={{ height: 80, opacity: 1 }}
        animate={{ height: 56, opacity: 0.8 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="overflow-hidden"
      >
        <motion.div
          className={`flex items-center gap-3 px-4 py-2 rounded-xl border ${
            isCompleted
              ? "bg-emerald-50/50 border-emerald-100"
              : "bg-orange-50/50 border-orange-100"
          }`}
          onClick={onTap}
        >
          {/* Checkmark or Skip icon */}
          <div
            className={`w-8 h-8 rounded-lg flex items-center justify-center ${
              isCompleted ? "bg-emerald-100 text-emerald-600" : "bg-orange-100 text-orange-600"
            }`}
          >
            {isCompleted ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
          </div>

          {/* Name with strikethrough */}
          <span className="flex-1 text-sm text-slate-400 line-through decoration-1 truncate">
            {activity.name}
          </span>

          {/* Time */}
          <span className="text-xs text-slate-300">{activity.start_time}</span>
        </motion.div>
      </motion.div>
    );
  }

  // Collapsing animation
  if (isCollapsing) {
    return (
      <motion.div
        initial={{ height: 80, opacity: 1 }}
        animate={{ height: 56, opacity: 0.8 }}
        transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
        className="overflow-hidden"
      >
        <motion.div
          className="flex items-center gap-4 px-4 py-3 bg-emerald-50 rounded-xl border border-emerald-100"
          initial={{ scale: 1 }}
          animate={{ scale: 0.98 }}
        >
          <motion.div
            className="w-10 h-10 rounded-xl bg-emerald-500 flex items-center justify-center text-white"
            initial={{ scale: 0 }}
            animate={{ scale: 1, rotate: [0, -10, 10, 0] }}
            transition={{ duration: 0.3 }}
          >
            <Check className="w-6 h-6" />
          </motion.div>
          <span className="text-emerald-700 font-medium">{activity.name}</span>
          <motion.span
            className="ml-auto text-emerald-600 font-bold"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
          >
            +{Math.round(xpValue * streakMultiplier)} XP
          </motion.span>
        </motion.div>
      </motion.div>
    );
  }

  // Swipeable card for upcoming/in_progress activities
  return (
    <div ref={constraintsRef} className="relative overflow-hidden rounded-xl">
      {/* Swipe backgrounds */}
      <div className="absolute inset-0 flex">
        {/* Complete background (right swipe) */}
        <motion.div
          className="flex-1 bg-emerald-500 flex items-center justify-start pl-6"
          style={{ opacity: completeOpacity }}
        >
          <motion.div style={{ scale: checkScale }}>
            <Check className="w-8 h-8 text-white" />
          </motion.div>
        </motion.div>
      </div>
      <div className="absolute inset-0 flex">
        {/* Skip background (left swipe) */}
        <motion.div
          className="flex-1 bg-orange-500 flex items-center justify-end pr-6"
          style={{ opacity: skipOpacity }}
        >
          <X className="w-8 h-8 text-white" />
        </motion.div>
      </div>

      {/* Draggable card */}
      <motion.div
        drag="x"
        dragConstraints={{ left: -160, right: 160 }}
        dragElastic={0.1}
        onDragStart={() => setIsDragging(true)}
        onDragEnd={handleDragEnd}
        style={{ x, scale }}
        onClick={() => !isDragging && onTap?.()}
        className={`relative flex items-center gap-4 px-4 py-3 bg-white border rounded-xl shadow-sm cursor-grab active:cursor-grabbing ${
          isInProgress
            ? "border-blue-200 ring-2 ring-blue-100"
            : "border-slate-200 hover:border-slate-300"
        }`}
      >
        <CardContent />

        {/* Swipe hint for in_progress */}
        {isInProgress && !isDragging && (
          <motion.div
            className="absolute inset-0 pointer-events-none"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 0.3, 0] }}
            transition={{ duration: 2, repeat: Infinity, repeatDelay: 3 }}
          >
            <div className="absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-emerald-100 to-transparent rounded-r-xl" />
          </motion.div>
        )}
      </motion.div>

      {/* Current activity indicator */}
      {isInProgress && (
        <motion.div
          className="absolute left-0 top-0 bottom-0 w-1 bg-blue-500 rounded-l-xl"
          initial={{ scaleY: 0 }}
          animate={{ scaleY: 1 }}
          transition={{ duration: 0.3 }}
        />
      )}
    </div>
  );
}
