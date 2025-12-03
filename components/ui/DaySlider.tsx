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

  // Check scroll position to show/hide gradients
  const updateGradients = () => {
    if (!scrollRef.current) return;
    const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
    setShowLeftGradient(scrollLeft > 10);
    setShowRightGradient(scrollLeft < scrollWidth - clientWidth - 10);
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
  }, []);

  // Scroll to selected day on mount and when selection changes
  useEffect(() => {
    if (!scrollRef.current || selectedDay === null) return;

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
      {/* Left gradient fade */}
      <div
        className={`absolute left-0 top-0 bottom-0 w-8 bg-gradient-to-r from-white to-transparent z-10 pointer-events-none transition-opacity duration-200 ${
          showLeftGradient ? "opacity-100" : "opacity-0"
        }`}
      />

      {/* Right gradient fade */}
      <div
        className={`absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-white to-transparent z-10 pointer-events-none transition-opacity duration-200 ${
          showRightGradient ? "opacity-100" : "opacity-0"
        }`}
      />

      {/* Scrollable container */}
      <div
        ref={scrollRef}
        className="flex items-center gap-0 overflow-x-auto scrollbar-hide scroll-smooth snap-x snap-mandatory pb-1"
        style={{ WebkitOverflowScrolling: "touch" }}
      >
        {/* All Days button */}
        <button
          onClick={() => onSelectDay(null)}
          data-day="all"
          className={`
            relative flex-shrink-0 snap-center
            min-h-[44px] px-4 sm:px-5
            flex items-center justify-center
            font-medium text-sm sm:text-base
            transition-all duration-200
            rounded-l-full
            ${
              selectedDay === null
                ? "bg-[var(--primary)] text-white shadow-md"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }
          `}
        >
          <span className="relative z-10">All</span>
        </button>

        {/* Connecting track line on mobile */}
        <div className="hidden sm:block w-px h-6 bg-slate-200 flex-shrink-0" />
        <div className="sm:hidden w-1 h-6 bg-slate-200 flex-shrink-0" />

        {/* Day buttons */}
        {days.map((day, index) => {
          const isSelected = selectedDay === day.day_number;
          const isLast = index === days.length - 1;
          const isFirst = index === 0;

          return (
            <div key={day.day_number} className="flex items-center flex-shrink-0">
              <button
                onClick={() => onSelectDay(day.day_number)}
                data-day={day.day_number}
                className={`
                  relative snap-center
                  min-h-[44px] px-3 sm:px-4
                  flex flex-col items-center justify-center
                  font-medium text-sm
                  transition-all duration-200
                  ${isFirst && "rounded-l-lg"}
                  ${isLast && "rounded-r-full"}
                  ${
                    isSelected
                      ? "bg-[var(--primary)] text-white shadow-md z-20"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }
                `}
              >
                {/* Day number - prominent */}
                <span className="relative z-10 leading-tight">
                  Day {day.day_number}
                </span>
                {/* Theme - hidden on mobile, shown on larger screens */}
                {day.theme && (
                  <span
                    className={`
                      hidden sm:block
                      text-[10px] font-normal leading-tight mt-0.5
                      max-w-[80px] truncate
                      ${isSelected ? "text-white/80" : "text-slate-400"}
                    `}
                  >
                    {day.theme}
                  </span>
                )}
              </button>

              {/* Connecting line between days (except last) */}
              {!isLast && (
                <div className="w-px sm:w-1 h-4 bg-slate-200 flex-shrink-0" />
              )}
            </div>
          );
        })}
      </div>

      {/* Mobile scroll hint (pulsing dots) - only shown when many days */}
      {days.length > 4 && (
        <div className="flex sm:hidden justify-center gap-1.5 mt-2">
          {["all", ...days.map((d) => d.day_number)].map((day, idx) => {
            const isActive =
              (day === "all" && selectedDay === null) ||
              day === selectedDay;
            return (
              <button
                key={idx}
                onClick={() =>
                  onSelectDay(day === "all" ? null : (day as number))
                }
                className={`
                  w-2 h-2 rounded-full transition-all duration-200
                  ${
                    isActive
                      ? "bg-[var(--primary)] scale-125"
                      : "bg-slate-300 hover:bg-slate-400"
                  }
                `}
                aria-label={day === "all" ? "All days" : `Day ${day}`}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
