# Trip Timeline Component Specifications

## Design System Integration

This document provides exact implementation specifications for each Trip Timeline component, ensuring they integrate seamlessly with the existing MonkeyTravel design system.

---

## Core Design Tokens

### From globals.css (Existing)
```css
--primary: #FF6B6B       /* Coral - main actions, highlights */
--secondary: #00B4A6     /* Teal - success states, navigation */
--accent: #FFD93D        /* Gold - special highlights, stars */
--background: #FFFAF5    /* Warm cream - page backgrounds */

--font-display: Playfair Display  /* Headlines, numbers */
--font-sans: Source Sans Pro      /* Body text, labels */
```

### New Timeline-Specific Tokens
```css
:root {
  /* Status colors */
  --timeline-upcoming: #94A3B8;     /* slate-400 */
  --timeline-in-progress: #3B82F6;  /* blue-500 */
  --timeline-completed: #10B981;    /* emerald-500 */
  --timeline-skipped: #F97316;      /* orange-500 */

  /* Progress indicators */
  --timeline-track: #E2E8F0;        /* slate-200 */
  --timeline-fill: var(--primary);

  /* Rating */
  --star-empty: #E2E8F0;
  --star-filled: var(--accent);
}
```

---

## Component 1: CountdownHero

### File: `components/timeline/CountdownHero.tsx`

```tsx
"use client";

import { useState, useEffect, useMemo } from "react";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";

interface CountdownHeroProps {
  destination: string;
  startDate: Date;
  tripDays: number;
  activitiesCount: number;
  weatherForecast?: { temp: number; condition: string; icon: string };
  coverImageUrl?: string;
}

export default function CountdownHero({
  destination,
  startDate,
  tripDays,
  activitiesCount,
  weatherForecast,
  coverImageUrl,
}: CountdownHeroProps) {
  const [timeLeft, setTimeLeft] = useState(calculateTimeLeft());

  function calculateTimeLeft() {
    const now = new Date();
    const diff = startDate.getTime() - now.getTime();

    if (diff <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0 };

    return {
      days: Math.floor(diff / (1000 * 60 * 60 * 24)),
      hours: Math.floor((diff / (1000 * 60 * 60)) % 24),
      minutes: Math.floor((diff / (1000 * 60)) % 60),
      seconds: Math.floor((diff / 1000) % 60),
    };
  }

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft(calculateTimeLeft());
    }, 1000);

    return () => clearInterval(timer);
  }, [startDate]);

  return (
    <div className="relative overflow-hidden rounded-2xl lg:rounded-3xl">
      {/* Background Image with Overlay */}
      <div className="absolute inset-0">
        {coverImageUrl ? (
          <Image
            src={coverImageUrl}
            alt={destination}
            fill
            className="object-cover"
            priority
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-[var(--primary)] to-[var(--primary)]/70" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/30 to-black/10" />
      </div>

      {/* Content */}
      <div className="relative z-10 px-6 py-10 sm:px-8 sm:py-16 lg:py-20 text-center">
        {/* Pre-trip badge */}
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/20 backdrop-blur-md border border-white/30 text-white text-sm font-medium mb-6">
          <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          Your adventure awaits
        </div>

        {/* Countdown Grid */}
        <div className="flex items-center justify-center gap-3 sm:gap-4 mb-8">
          <CountdownBox value={timeLeft.days} label="Days" />
          <span className="text-white/60 text-2xl font-light">:</span>
          <CountdownBox value={timeLeft.hours} label="Hours" />
          <span className="text-white/60 text-2xl font-light hidden sm:block">:</span>
          <div className="hidden sm:block">
            <CountdownBox value={timeLeft.minutes} label="Mins" />
          </div>
          <span className="text-white/60 text-2xl font-light hidden lg:block">:</span>
          <div className="hidden lg:block">
            <CountdownBox value={timeLeft.seconds} label="Secs" />
          </div>
        </div>

        {/* Trip Stats */}
        <div className="flex items-center justify-center gap-4 sm:gap-6 text-white/90">
          {weatherForecast && (
            <div className="flex items-center gap-2">
              <span className="text-2xl">{weatherForecast.icon}</span>
              <span className="font-medium">{weatherForecast.temp}°C</span>
            </div>
          )}
          <div className="w-px h-5 bg-white/30" />
          <div className="flex items-center gap-1.5">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <span className="font-medium">{tripDays} days</span>
          </div>
          <div className="w-px h-5 bg-white/30" />
          <div className="flex items-center gap-1.5">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            <span className="font-medium">{activitiesCount} activities</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function CountdownBox({ value, label }: { value: number; label: string }) {
  const displayValue = String(value).padStart(2, "0");

  return (
    <div className="flex flex-col items-center">
      <div className="relative">
        <div className="
          w-16 h-16 sm:w-20 sm:h-20 lg:w-24 lg:h-24
          rounded-xl sm:rounded-2xl
          bg-white/10 backdrop-blur-xl
          border border-white/20
          flex items-center justify-center
          shadow-lg
        ">
          <AnimatePresence mode="popLayout">
            <motion.span
              key={value}
              initial={{ rotateX: -90, opacity: 0 }}
              animate={{ rotateX: 0, opacity: 1 }}
              exit={{ rotateX: 90, opacity: 0 }}
              transition={{ duration: 0.3, ease: "easeInOut" }}
              className="
                font-display font-bold
                text-2xl sm:text-3xl lg:text-4xl
                text-white
              "
            >
              {displayValue}
            </motion.span>
          </AnimatePresence>
        </div>
      </div>
      <span className="
        mt-2 text-[10px] sm:text-xs
        font-medium uppercase tracking-widest
        text-white/70
      ">
        {label}
      </span>
    </div>
  );
}
```

---

## Component 2: LiveActivityCard

### File: `components/timeline/LiveActivityCard.tsx`

```tsx
"use client";

import { useState, useRef } from "react";
import { motion, useMotionValue, useTransform } from "framer-motion";
import type { Activity } from "@/types";

interface LiveActivityCardProps {
  activity: Activity;
  status: "upcoming" | "in_progress" | "completed" | "skipped";
  onComplete: () => void;
  onSkip: () => void;
  onAddPhoto: () => void;
  onAddNote: () => void;
  rating?: number;
  onRate?: (rating: number) => void;
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
}: LiveActivityCardProps) {
  const x = useMotionValue(0);
  const opacity = useTransform(x, [0, 100, 200], [1, 1, 0.5]);
  const scale = useTransform(x, [0, 200, 280], [1, 1.02, 1.05]);

  const handleDragEnd = (_: unknown, info: { offset: { x: number } }) => {
    if (info.offset.x > 240) {
      onComplete();
    }
  };

  const statusConfig = {
    upcoming: {
      badge: "Upcoming",
      badgeClass: "bg-slate-100 text-slate-600",
      cardClass: "opacity-75",
    },
    in_progress: {
      badge: "In Progress",
      badgeClass: "bg-blue-100 text-blue-700",
      cardClass: "ring-2 ring-blue-500 ring-offset-2",
    },
    completed: {
      badge: "Completed",
      badgeClass: "bg-green-100 text-green-700",
      cardClass: "",
    },
    skipped: {
      badge: "Skipped",
      badgeClass: "bg-orange-100 text-orange-700",
      cardClass: "opacity-60",
    },
  };

  const config = statusConfig[status];

  return (
    <div className={`relative ${config.cardClass}`}>
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
              {config.badge}
            </span>
          </div>

          {/* Rating Stars (for completed) */}
          {status === "completed" && (
            <div className="flex items-center gap-0.5">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  onClick={() => onRate?.(star)}
                  className="focus:outline-none"
                >
                  <motion.svg
                    className={`w-5 h-5 ${
                      rating && star <= rating
                        ? "text-[var(--accent)]"
                        : "text-slate-200"
                    }`}
                    fill="currentColor"
                    viewBox="0 0 20 20"
                    whileHover={{ scale: 1.2 }}
                    whileTap={{ scale: 0.9 }}
                  >
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </motion.svg>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Activity Content */}
        <div className="p-4">
          <h3 className="text-lg font-semibold text-slate-900 mb-1">
            {activity.name}
          </h3>
          <p className="text-sm text-slate-600 mb-3 line-clamp-2">
            {activity.description}
          </p>

          {/* Meta Info */}
          <div className="flex flex-wrap items-center gap-3 text-sm text-slate-500">
            <div className="flex items-center gap-1.5">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span className="truncate max-w-[150px]">
                {activity.address || activity.location}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>{activity.duration_minutes} min</span>
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        {status === "in_progress" && (
          <div className="flex items-center gap-2 px-4 pb-4">
            <button
              onClick={onAddPhoto}
              className="
                flex-1 flex items-center justify-center gap-2
                px-4 py-2.5 rounded-xl
                bg-slate-100 hover:bg-slate-200
                text-slate-700 text-sm font-medium
                transition-colors
              "
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Photo
            </button>
            <button
              onClick={onAddNote}
              className="
                flex-1 flex items-center justify-center gap-2
                px-4 py-2.5 rounded-xl
                bg-slate-100 hover:bg-slate-200
                text-slate-700 text-sm font-medium
                transition-colors
              "
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              Note
            </button>
            <button
              onClick={onSkip}
              className="
                flex items-center justify-center gap-2
                px-4 py-2.5 rounded-xl
                bg-orange-50 hover:bg-orange-100
                text-orange-600 text-sm font-medium
                transition-colors
              "
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
              </svg>
              Skip
            </button>
          </div>
        )}

        {/* Slide to Complete */}
        {status === "in_progress" && (
          <div className="px-4 pb-4">
            <div className="relative h-14 bg-slate-100 rounded-full overflow-hidden">
              {/* Track background with text */}
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-sm font-medium text-slate-400">
                  Slide to mark complete
                </span>
              </div>

              {/* Sliding knob */}
              <motion.div
                drag="x"
                dragConstraints={{ left: 0, right: 260 }}
                dragElastic={0.1}
                style={{ x, opacity, scale }}
                onDragEnd={handleDragEnd}
                className="
                  absolute left-1 top-1 bottom-1
                  w-12 rounded-full
                  bg-[var(--primary)] shadow-lg
                  flex items-center justify-center
                  cursor-grab active:cursor-grabbing
                "
                whileHover={{ scale: 1.05 }}
              >
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </motion.div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

---

## Component 3: PreTripChecklist

### File: `components/timeline/PreTripChecklist.tsx`

```tsx
"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface ChecklistItem {
  id: string;
  text: string;
  is_checked: boolean;
  category: "booking" | "packing" | "document" | "custom";
  due_date?: string;
}

interface PreTripChecklistProps {
  items: ChecklistItem[];
  onToggle: (id: string) => void;
  onAdd: (text: string, category: string) => void;
  onDelete: (id: string) => void;
}

export default function PreTripChecklist({
  items,
  onToggle,
  onAdd,
  onDelete,
}: PreTripChecklistProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [newItemText, setNewItemText] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);

  const completedCount = items.filter((i) => i.is_checked).length;
  const progress = items.length > 0 ? (completedCount / items.length) * 100 : 0;

  const groupedItems = items.reduce((acc, item) => {
    if (!acc[item.category]) acc[item.category] = [];
    acc[item.category].push(item);
    return acc;
  }, {} as Record<string, ChecklistItem[]>);

  const categoryConfig = {
    booking: { label: "Bookings", icon: "🎫", color: "blue" },
    packing: { label: "Packing", icon: "🧳", color: "green" },
    document: { label: "Documents", icon: "📄", color: "amber" },
    custom: { label: "Other", icon: "📝", color: "slate" },
  };

  const handleAddItem = () => {
    if (newItemText.trim()) {
      onAdd(newItemText.trim(), "custom");
      setNewItemText("");
      setShowAddForm(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-4 py-4 hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="relative w-10 h-10">
            {/* Circular progress */}
            <svg className="w-10 h-10 transform -rotate-90">
              <circle
                cx="20"
                cy="20"
                r="16"
                fill="none"
                stroke="#E2E8F0"
                strokeWidth="3"
              />
              <motion.circle
                cx="20"
                cy="20"
                r="16"
                fill="none"
                stroke="var(--primary)"
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray={100}
                strokeDashoffset={100 - progress}
                initial={{ strokeDashoffset: 100 }}
                animate={{ strokeDashoffset: 100 - progress }}
                transition={{ duration: 0.5, ease: "easeOut" }}
              />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-slate-700">
              {Math.round(progress)}%
            </span>
          </div>
          <div className="text-left">
            <h3 className="font-semibold text-slate-900">Trip Preparation</h3>
            <p className="text-sm text-slate-500">
              {completedCount} of {items.length} completed
            </p>
          </div>
        </div>
        <motion.svg
          animate={{ rotate: isExpanded ? 180 : 0 }}
          className="w-5 h-5 text-slate-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </motion.svg>
      </button>

      {/* Content */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="px-4 pb-4 space-y-4">
              {Object.entries(categoryConfig).map(([category, config]) => {
                const categoryItems = groupedItems[category] || [];
                if (categoryItems.length === 0 && category !== "custom") return null;

                return (
                  <div key={category}>
                    <h4 className="flex items-center gap-2 text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
                      <span>{config.icon}</span>
                      {config.label}
                    </h4>
                    <div className="space-y-1">
                      {categoryItems.map((item) => (
                        <ChecklistRow
                          key={item.id}
                          item={item}
                          onToggle={() => onToggle(item.id)}
                          onDelete={() => onDelete(item.id)}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}

              {/* Add Item */}
              {showAddForm ? (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={newItemText}
                    onChange={(e) => setNewItemText(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleAddItem()}
                    placeholder="Add a custom item..."
                    className="
                      flex-1 px-3 py-2 rounded-lg
                      border border-slate-200
                      focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20
                      outline-none text-sm
                    "
                    autoFocus
                  />
                  <button
                    onClick={handleAddItem}
                    className="
                      px-3 py-2 rounded-lg
                      bg-[var(--primary)] text-white
                      text-sm font-medium
                      hover:bg-[var(--primary)]/90
                    "
                  >
                    Add
                  </button>
                  <button
                    onClick={() => {
                      setShowAddForm(false);
                      setNewItemText("");
                    }}
                    className="px-3 py-2 text-sm text-slate-500 hover:text-slate-700"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowAddForm(true)}
                  className="
                    flex items-center gap-2
                    text-sm text-[var(--primary)] font-medium
                    hover:underline
                  "
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Add custom item
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ChecklistRow({
  item,
  onToggle,
  onDelete,
}: {
  item: ChecklistItem;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const [showDelete, setShowDelete] = useState(false);

  const isDueSoon = item.due_date && !item.is_checked && (() => {
    const due = new Date(item.due_date);
    const now = new Date();
    const diff = due.getTime() - now.getTime();
    return diff < 3 * 24 * 60 * 60 * 1000; // 3 days
  })();

  return (
    <div
      className="
        flex items-center gap-3 px-3 py-2.5 rounded-lg
        hover:bg-slate-50 group
        transition-colors
      "
      onMouseEnter={() => setShowDelete(true)}
      onMouseLeave={() => setShowDelete(false)}
    >
      <button
        onClick={onToggle}
        className={`
          flex-shrink-0 w-5 h-5 rounded-md border-2
          flex items-center justify-center
          transition-all duration-200
          ${item.is_checked
            ? "bg-[var(--primary)] border-[var(--primary)]"
            : "border-slate-300 hover:border-[var(--primary)]"
          }
        `}
      >
        {item.is_checked && (
          <motion.svg
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="w-3 h-3 text-white"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
          </motion.svg>
        )}
      </button>

      <span className={`
        flex-1 text-sm
        ${item.is_checked ? "text-slate-400 line-through" : "text-slate-700"}
      `}>
        {item.text}
      </span>

      {isDueSoon && (
        <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-xs font-medium">
          Due soon
        </span>
      )}

      {item.is_checked && (
        <span className="text-xs text-green-600 font-medium">Done</span>
      )}

      {showDelete && (
        <button
          onClick={onDelete}
          className="
            p-1 rounded text-slate-400 hover:text-red-500
            opacity-0 group-hover:opacity-100 transition-opacity
          "
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}
```

---

## Component 4: StarRating (Reusable UI)

### File: `components/ui/StarRating.tsx`

```tsx
"use client";

import { motion } from "framer-motion";

interface StarRatingProps {
  value: number;
  onChange?: (value: number) => void;
  readonly?: boolean;
  size?: "sm" | "md" | "lg";
}

export default function StarRating({
  value,
  onChange,
  readonly = false,
  size = "md",
}: StarRatingProps) {
  const sizes = {
    sm: "w-4 h-4",
    md: "w-6 h-6",
    lg: "w-8 h-8",
  };

  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <motion.button
          key={star}
          type="button"
          onClick={() => !readonly && onChange?.(star)}
          disabled={readonly}
          className={`
            ${readonly ? "cursor-default" : "cursor-pointer"}
            focus:outline-none
          `}
          whileHover={readonly ? {} : { scale: 1.2 }}
          whileTap={readonly ? {} : { scale: 0.9 }}
        >
          <motion.svg
            className={`
              ${sizes[size]}
              ${value >= star ? "text-[var(--accent)]" : "text-slate-200"}
              transition-colors
            `}
            fill="currentColor"
            viewBox="0 0 20 20"
            initial={false}
            animate={value >= star ? {
              scale: [1, 1.2, 1],
              rotate: [0, 10, -10, 0],
            } : {}}
            transition={{ duration: 0.3 }}
          >
            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
          </motion.svg>
        </motion.button>
      ))}
    </div>
  );
}
```

---

## Component 5: BottomSheet (Reusable UI)

### File: `components/ui/BottomSheet.tsx`

```tsx
"use client";

import { useEffect } from "react";
import { motion, AnimatePresence, useDragControls } from "framer-motion";

interface BottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  title?: string;
  snapPoints?: ("content" | "50%" | "75%" | "full")[];
}

export default function BottomSheet({
  isOpen,
  onClose,
  children,
  title,
  snapPoints = ["content"],
}: BottomSheetProps) {
  const dragControls = useDragControls();

  // Prevent body scroll when sheet is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  const handleDragEnd = (_: unknown, info: { offset: { y: number }; velocity: { y: number } }) => {
    if (info.offset.y > 100 || info.velocity.y > 500) {
      onClose();
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="
              fixed inset-0 z-50
              bg-black/50 backdrop-blur-sm
            "
          />

          {/* Sheet */}
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
            drag="y"
            dragControls={dragControls}
            dragConstraints={{ top: 0 }}
            dragElastic={{ top: 0, bottom: 0.5 }}
            onDragEnd={handleDragEnd}
            className="
              fixed bottom-0 left-0 right-0 z-50
              bg-white rounded-t-3xl
              max-h-[90vh] overflow-hidden
              shadow-2xl
            "
            style={{ touchAction: "none" }}
          >
            {/* Drag Handle */}
            <div
              onPointerDown={(e) => dragControls.start(e)}
              className="flex justify-center pt-3 pb-2 cursor-grab active:cursor-grabbing"
            >
              <div className="w-10 h-1 rounded-full bg-slate-300" />
            </div>

            {/* Title */}
            {title && (
              <div className="px-4 pb-3 border-b border-slate-100">
                <h2 className="text-lg font-semibold text-slate-900 text-center">
                  {title}
                </h2>
              </div>
            )}

            {/* Content */}
            <div className="overflow-y-auto max-h-[calc(90vh-60px)] pb-safe">
              {children}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
```

---

## Tailwind Configuration Updates

### File: `tailwind.config.ts` (additions)

```typescript
// Add to extend section
extend: {
  animation: {
    'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
    'slide-up': 'slideUp 0.3s ease-out',
    'slide-down': 'slideDown 0.3s ease-out',
    'scale-in': 'scaleIn 0.2s ease-out',
    'confetti': 'confetti 1s ease-out forwards',
  },
  keyframes: {
    slideUp: {
      '0%': { transform: 'translateY(100%)', opacity: '0' },
      '100%': { transform: 'translateY(0)', opacity: '1' },
    },
    slideDown: {
      '0%': { transform: 'translateY(-100%)', opacity: '0' },
      '100%': { transform: 'translateY(0)', opacity: '1' },
    },
    scaleIn: {
      '0%': { transform: 'scale(0.9)', opacity: '0' },
      '100%': { transform: 'scale(1)', opacity: '1' },
    },
    confetti: {
      '0%': { transform: 'translateY(0) rotate(0deg)', opacity: '1' },
      '100%': { transform: 'translateY(-100vh) rotate(720deg)', opacity: '0' },
    },
  },
  spacing: {
    'safe': 'env(safe-area-inset-bottom)',
  },
}
```

---

## CSS Utilities to Add

### File: `app/globals.css` (additions)

```css
/* Timeline-specific utilities */
.pb-safe {
  padding-bottom: env(safe-area-inset-bottom);
}

.scrollbar-hide {
  -ms-overflow-style: none;
  scrollbar-width: none;
}

.scrollbar-hide::-webkit-scrollbar {
  display: none;
}

/* Slide to complete track */
.slide-track {
  background: linear-gradient(
    90deg,
    var(--primary) 0%,
    var(--primary) var(--slide-progress, 0%),
    #E2E8F0 var(--slide-progress, 0%),
    #E2E8F0 100%
  );
}

/* Star rating glow effect */
.star-glow {
  filter: drop-shadow(0 0 6px var(--accent));
}

/* Photo grid masonry */
@supports (grid-template-rows: masonry) {
  .photo-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    grid-template-rows: masonry;
    gap: 0.5rem;
  }
}
```

---

## Dependencies to Add

```json
// package.json additions
{
  "dependencies": {
    "framer-motion": "^10.16.4",
    "@radix-ui/react-progress": "^1.0.3"
  }
}
```

Run: `npm install framer-motion @radix-ui/react-progress`

---

## TypeScript Types

### File: `types/timeline.ts`

```typescript
export type TripPhase = "planning" | "pre_trip" | "active" | "completed";

export type ActivityStatus = "upcoming" | "in_progress" | "completed" | "skipped";

export interface ActivityTimeline {
  activity_id: string;
  status: ActivityStatus;
  started_at?: string;
  completed_at?: string;
  actual_duration_minutes?: number;
  rating?: 1 | 2 | 3 | 4 | 5;
  experience_notes?: string;
  quick_tags?: ("must-do" | "crowded" | "worth-it" | "skip-next-time")[];
  photos?: ActivityPhoto[];
}

export interface ActivityPhoto {
  id: string;
  url: string;
  thumbnail_url: string;
  caption?: string;
  taken_at: string;
  is_favorite?: boolean;
}

export interface ChecklistItem {
  id: string;
  text: string;
  is_checked: boolean;
  category: "booking" | "packing" | "document" | "custom";
  due_date?: string;
  source_activity_id?: string;
}

export interface TripStats {
  total_activities: number;
  completed_activities: number;
  skipped_activities: number;
  total_photos: number;
  average_rating: number | null;
  total_walking_km: number;
  total_travel_time_minutes: number;
  favorite_activity_id?: string;
}

export interface TimelineState {
  phase: TripPhase;
  current_day?: number;
  current_activity_id?: string;
  checklist: ChecklistItem[];
  activity_timelines: Map<string, ActivityTimeline>;
  stats?: TripStats;
}
```

---

This component specification provides exact implementation details for the core Trip Timeline components. Each component follows the existing MonkeyTravel design system while introducing new timeline-specific patterns for pre-trip, active, and post-trip experiences.
