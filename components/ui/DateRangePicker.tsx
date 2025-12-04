"use client";

/**
 * Premium DateRangePicker Component
 *
 * A beautiful, travel-themed date range selector with:
 * - Custom calendar UI with month navigation
 * - Visual date range selection
 * - Validation to prevent start date > end date
 * - Trip duration display
 * - Mobile-optimized touch interactions
 */

import { useState, useEffect, useRef, useCallback } from "react";

interface DateRangePickerProps {
  startDate: string;
  endDate: string;
  onStartDateChange: (date: string) => void;
  onEndDateChange: (date: string) => void;
  maxDays?: number;
  minDate?: string;
  className?: string;
}

// Helper functions
const formatDate = (date: Date): string => {
  return date.toISOString().split("T")[0];
};

const parseDate = (dateStr: string): Date | null => {
  if (!dateStr) return null;
  const date = new Date(dateStr + "T00:00:00");
  return isNaN(date.getTime()) ? null : date;
};

const getDaysInMonth = (year: number, month: number): number => {
  return new Date(year, month + 1, 0).getDate();
};

const getFirstDayOfMonth = (year: number, month: number): number => {
  return new Date(year, month, 1).getDay();
};

const formatDisplayDate = (dateStr: string): string => {
  if (!dateStr) return "Select date";
  const date = parseDate(dateStr);
  if (!date) return "Select date";
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
};

const calculateTripDuration = (start: string, end: string): number => {
  if (!start || !end) return 0;
  const startDate = parseDate(start);
  const endDate = parseDate(end);
  if (!startDate || !endDate) return 0;
  const diff = endDate.getTime() - startDate.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24)) + 1;
};

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

export default function DateRangePicker({
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange,
  maxDays = 14,
  minDate,
  className = "",
}: DateRangePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectingStart, setSelectingStart] = useState(true);
  const [viewDate, setViewDate] = useState(() => {
    const start = parseDate(startDate);
    return start || new Date();
  });
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Update view when start date changes externally
  useEffect(() => {
    const start = parseDate(startDate);
    if (start) {
      setViewDate(start);
    }
  }, [startDate]);

  const minDateObj = minDate ? parseDate(minDate) : new Date();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const handleDateClick = useCallback((date: Date) => {
    const dateStr = formatDate(date);
    const startDateObj = parseDate(startDate);
    const endDateObj = parseDate(endDate);

    if (selectingStart) {
      // Setting start date
      onStartDateChange(dateStr);

      // If new start is after current end, clear end date
      if (endDateObj && date > endDateObj) {
        onEndDateChange("");
      }

      setSelectingStart(false);
    } else {
      // Setting end date
      if (startDateObj && date < startDateObj) {
        // If selected date is before start, make it the new start
        onStartDateChange(dateStr);
        onEndDateChange("");
      } else {
        // Check max days constraint
        if (startDateObj) {
          const daysDiff = Math.ceil((date.getTime() - startDateObj.getTime()) / (1000 * 60 * 60 * 24)) + 1;
          if (daysDiff > maxDays) {
            // Adjust to max days
            const maxEndDate = new Date(startDateObj);
            maxEndDate.setDate(maxEndDate.getDate() + maxDays - 1);
            onEndDateChange(formatDate(maxEndDate));
          } else {
            onEndDateChange(dateStr);
          }
        } else {
          onEndDateChange(dateStr);
        }
        setSelectingStart(true);
        setIsOpen(false);
      }
    }
  }, [selectingStart, startDate, endDate, maxDays, onStartDateChange, onEndDateChange]);

  const isDateDisabled = (date: Date): boolean => {
    if (minDateObj && date < minDateObj) return true;
    return false;
  };

  const isDateInRange = (date: Date): boolean => {
    const start = parseDate(startDate);
    const end = parseDate(endDate);
    if (!start || !end) return false;
    return date >= start && date <= end;
  };

  const isDateStart = (date: Date): boolean => {
    const start = parseDate(startDate);
    return start ? formatDate(date) === formatDate(start) : false;
  };

  const isDateEnd = (date: Date): boolean => {
    const end = parseDate(endDate);
    return end ? formatDate(date) === formatDate(end) : false;
  };

  const navigateMonth = (direction: -1 | 1) => {
    setViewDate((prev) => {
      const newDate = new Date(prev);
      newDate.setMonth(newDate.getMonth() + direction);
      return newDate;
    });
  };

  const renderCalendar = () => {
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();
    const daysInMonth = getDaysInMonth(year, month);
    const firstDay = getFirstDayOfMonth(year, month);
    const days: (Date | null)[] = [];

    // Add empty cells for days before the first day of the month
    for (let i = 0; i < firstDay; i++) {
      days.push(null);
    }

    // Add all days of the month
    for (let i = 1; i <= daysInMonth; i++) {
      days.push(new Date(year, month, i));
    }

    return (
      <div className="grid grid-cols-7 gap-1">
        {/* Weekday headers */}
        {WEEKDAYS.map((day) => (
          <div
            key={day}
            className="h-8 flex items-center justify-center text-xs font-medium text-slate-400"
          >
            {day}
          </div>
        ))}

        {/* Calendar days */}
        {days.map((date, idx) => {
          if (!date) {
            return <div key={`empty-${idx}`} className="h-10" />;
          }

          const disabled = isDateDisabled(date);
          const inRange = isDateInRange(date);
          const isStart = isDateStart(date);
          const isEnd = isDateEnd(date);
          const isToday = formatDate(date) === formatDate(today);

          return (
            <button
              key={formatDate(date)}
              onClick={() => !disabled && handleDateClick(date)}
              disabled={disabled}
              className={`
                h-10 w-full rounded-lg text-sm font-medium
                transition-all duration-200 relative
                ${disabled
                  ? "text-slate-300 cursor-not-allowed"
                  : "hover:bg-[var(--primary)]/10 cursor-pointer"
                }
                ${isStart || isEnd
                  ? "bg-[var(--primary)] text-white hover:bg-[var(--primary)]/90 shadow-md"
                  : ""
                }
                ${inRange && !isStart && !isEnd
                  ? "bg-[var(--primary)]/10 text-[var(--primary)]"
                  : ""
                }
                ${!inRange && !isStart && !isEnd && !disabled
                  ? "text-slate-700"
                  : ""
                }
                ${isToday && !isStart && !isEnd
                  ? "ring-2 ring-[var(--primary)]/30 ring-offset-1"
                  : ""
                }
              `}
            >
              {date.getDate()}
              {isStart && (
                <span className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 text-[8px] opacity-80">
                  Start
                </span>
              )}
              {isEnd && !isStart && (
                <span className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 text-[8px] opacity-80">
                  End
                </span>
              )}
            </button>
          );
        })}
      </div>
    );
  };

  const tripDuration = calculateTripDuration(startDate, endDate);

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {/* Date Display Buttons */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Start Date */}
        <button
          onClick={() => {
            setIsOpen(true);
            setSelectingStart(true);
          }}
          className={`
            group relative flex items-center gap-3 p-4 rounded-2xl border-2 text-left
            transition-all duration-300 bg-white
            ${selectingStart && isOpen
              ? "border-[var(--primary)] shadow-lg shadow-[var(--primary)]/10"
              : "border-slate-200 hover:border-[var(--primary)]/50"
            }
          `}
        >
          <div className={`
            w-12 h-12 rounded-xl flex items-center justify-center
            transition-all duration-300
            ${startDate
              ? "bg-gradient-to-br from-[var(--primary)] to-[var(--primary)]/80 text-white shadow-md"
              : "bg-slate-100 text-slate-400"
            }
          `}>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-0.5">
              Check-in
            </div>
            <div className={`font-semibold truncate ${startDate ? "text-slate-900" : "text-slate-400"}`}>
              {formatDisplayDate(startDate)}
            </div>
          </div>
          <div className="absolute top-2 right-2">
            <div className={`w-2 h-2 rounded-full ${selectingStart && isOpen ? "bg-[var(--primary)] animate-pulse" : "bg-transparent"}`} />
          </div>
        </button>

        {/* End Date */}
        <button
          onClick={() => {
            setIsOpen(true);
            setSelectingStart(false);
          }}
          className={`
            group relative flex items-center gap-3 p-4 rounded-2xl border-2 text-left
            transition-all duration-300 bg-white
            ${!selectingStart && isOpen
              ? "border-[var(--primary)] shadow-lg shadow-[var(--primary)]/10"
              : "border-slate-200 hover:border-[var(--primary)]/50"
            }
          `}
        >
          <div className={`
            w-12 h-12 rounded-xl flex items-center justify-center
            transition-all duration-300
            ${endDate
              ? "bg-gradient-to-br from-[var(--secondary)] to-[var(--secondary)]/80 text-white shadow-md"
              : "bg-slate-100 text-slate-400"
            }
          `}>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-0.5">
              Check-out
            </div>
            <div className={`font-semibold truncate ${endDate ? "text-slate-900" : "text-slate-400"}`}>
              {formatDisplayDate(endDate)}
            </div>
          </div>
          <div className="absolute top-2 right-2">
            <div className={`w-2 h-2 rounded-full ${!selectingStart && isOpen ? "bg-[var(--primary)] animate-pulse" : "bg-transparent"}`} />
          </div>
        </button>
      </div>

      {/* Trip Duration Badge */}
      {tripDuration > 0 && (
        <div className="mt-3 flex items-center justify-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-[var(--accent)]/20 to-[var(--accent)]/10 rounded-full border border-[var(--accent)]/30">
            <svg className="w-4 h-4 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-sm font-semibold text-amber-700">
              {tripDuration} {tripDuration === 1 ? "day" : "days"}
            </span>
            <span className="text-sm text-amber-600">
              · {tripDuration - 1} {tripDuration - 1 === 1 ? "night" : "nights"}
            </span>
          </div>
        </div>
      )}

      {/* Max days hint */}
      {tripDuration === 0 && (
        <p className="mt-2 text-xs text-slate-400 text-center">
          Select dates for your trip (max {maxDays} days)
        </p>
      )}

      {/* Calendar Dropdown */}
      {isOpen && (
        <div className="absolute left-0 right-0 sm:left-auto sm:right-auto sm:w-[340px] mt-3 p-4 bg-white rounded-2xl shadow-2xl border border-slate-200 z-50 animate-fade-in-up">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <button
              onClick={() => navigateMonth(-1)}
              className="w-10 h-10 rounded-xl flex items-center justify-center text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div className="text-center">
              <div className="font-semibold text-slate-900">
                {MONTHS[viewDate.getMonth()]} {viewDate.getFullYear()}
              </div>
              <div className="text-xs text-slate-500">
                {selectingStart ? "Select check-in date" : "Select check-out date"}
              </div>
            </div>
            <button
              onClick={() => navigateMonth(1)}
              className="w-10 h-10 rounded-xl flex items-center justify-center text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>

          {/* Calendar Grid */}
          {renderCalendar()}

          {/* Footer */}
          <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
            <button
              onClick={() => {
                onStartDateChange("");
                onEndDateChange("");
                setSelectingStart(true);
              }}
              className="text-sm text-slate-500 hover:text-slate-700 transition-colors"
            >
              Clear dates
            </button>
            <button
              onClick={() => setIsOpen(false)}
              className="px-4 py-2 bg-[var(--primary)] text-white text-sm font-medium rounded-lg hover:bg-[var(--primary)]/90 transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
