"use client";

import { useRef, useEffect, useState } from "react";

interface Day {
  day_number: number;
  theme?: string;
}

interface DaySliderProps {
  days: Day[];
  selectedDay: number | null;
  onSelectDay: (dayNumber: number | null) => void;
  className?: string;
}

export default function DaySlider({
  days,
  selectedDay,
  onSelectDay,
  className = "",
}: DaySliderProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showLeftGradient, setShowLeftGradient] = useState(false);
  const [showRightGradient, setShowRightGradient] = useState(false);

  // Check scroll position to show/hide gradients (mobile only)
  const updateGradients = () => {
    if (!scrollRef.current) return;
    const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
    // Only show gradients if content overflows
    const hasOverflow = scrollWidth > clientWidth + 5;
    setShowLeftGradient(hasOverflow && scrollLeft > 10);
    setShowRightGradient(hasOverflow && scrollLeft < scrollWidth - clientWidth - 10);
  };

  useEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;

    updateGradients();
    scrollEl.addEventListener("scroll", updateGradients);
    window.addEventListener("resize", updateGradients);

    return () => {
      scrollEl.removeEventListener("scroll", updateGradients);
      window.removeEventListener("resize", updateGradients);
    };
  }, [days.length]);

  // Scroll to selected day on mount and when selection changes (mobile)
  useEffect(() => {
    if (!scrollRef.current || selectedDay === null) return;
    // Only scroll on mobile (when overflow exists)
    if (scrollRef.current.scrollWidth <= scrollRef.current.clientWidth + 5) return;

    const selectedButton = scrollRef.current.querySelector(
      `[data-day="${selectedDay}"]`
    );
    if (selectedButton) {
      selectedButton.scrollIntoView({
        behavior: "smooth",
        inline: "center",
        block: "nearest",
      });
    }
  }, [selectedDay]);

  return (
    <div className={`relative ${className}`}>
      {/* Left gradient fade - mobile only when scrollable */}
      <div
        className={`absolute left-0 top-0 bottom-0 w-8 bg-gradient-to-r from-white to-transparent z-10 pointer-events-none transition-opacity duration-200 sm:hidden ${
          showLeftGradient ? "opacity-100" : "opacity-0"
        }`}
      />

      {/* Right gradient fade - mobile only when scrollable */}
      <div
        className={`absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-white to-transparent z-10 pointer-events-none transition-opacity duration-200 sm:hidden ${
          showRightGradient ? "opacity-100" : "opacity-0"
        }`}
      />

      {/* Segmented control container */}
      <div
        ref={scrollRef}
        className="
          flex items-stretch
          overflow-x-auto sm:overflow-visible
          scrollbar-hide scroll-smooth snap-x snap-mandatory
          bg-slate-100 rounded-full
          p-1
        "
        style={{ WebkitOverflowScrolling: "touch" }}
      >
        {/* All Days button */}
        <button
          onClick={() => onSelectDay(null)}
          data-day="all"
          className={`
            relative flex-shrink-0 sm:flex-1
            snap-center
            min-h-[40px] min-w-[52px]
            px-4 sm:px-3
            flex items-center justify-center
            font-semibold text-sm
            transition-all duration-200 ease-out
            rounded-full
            ${
              selectedDay === null
                ? "bg-white text-[var(--primary)] shadow-sm"
                : "bg-transparent text-slate-500 hover:text-slate-700"
            }
          `}
        >
          All
        </button>

        {/* Day buttons */}
        {days.map((day, index) => {
          const isSelected = selectedDay === day.day_number;
          const isLast = index === days.length - 1;

          return (
            <button
              key={day.day_number}
              onClick={() => onSelectDay(day.day_number)}
              data-day={day.day_number}
              className={`
                relative flex-shrink-0 sm:flex-1
                snap-center
                min-h-[40px] min-w-[60px]
                px-3 sm:px-2
                flex flex-col items-center justify-center
                font-semibold text-sm
                transition-all duration-200 ease-out
                rounded-full
                ${
                  isSelected
                    ? "bg-white text-[var(--primary)] shadow-sm"
                    : "bg-transparent text-slate-500 hover:text-slate-700"
                }
              `}
            >
              {/* Day number */}
              <span className="leading-tight whitespace-nowrap">
                Day {day.day_number}
              </span>
              {/* Theme - hidden on mobile, shown on desktop */}
              {day.theme && (
                <span
                  className={`
                    hidden lg:block
                    text-[9px] font-medium leading-tight mt-0.5
                    max-w-[70px] truncate
                    ${isSelected ? "text-[var(--primary)]/70" : "text-slate-400"}
                  `}
                >
                  {day.theme}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
