/**
 * Date/Time Formatting Utilities
 *
 * Consolidated formatting functions with clear, distinct names
 * to avoid confusion between different output formats.
 */

/**
 * Format date with weekday: "Wed, Jun 15"
 * Use for trip cards, headers where weekday context helps
 */
export function formatDateWithWeekday(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/**
 * Format date with weekday and year: "Wed, Jun 15, 2025"
 * Use for PDF exports, documents where full date context is needed
 */
export function formatDateFull(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Format date without weekday: "Jun 15"
 * Use for compact displays, flight times, etc.
 */
export function formatDateShort(datetime: string | Date): string {
  if (!datetime) return "";

  try {
    const date = typeof datetime === "string" ? new Date(datetime) : datetime;
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  } catch {
    return typeof datetime === "string" ? datetime : "";
  }
}

/**
 * Format date range: "Jun 15-20, 2025" or "Jun 15 - Jul 2, 2025"
 * Handles same-month and cross-month ranges intelligently
 */
export function formatDateRange(start: Date | string, end: Date | string): string {
  const s = typeof start === "string" ? new Date(start) : start;
  const e = typeof end === "string" ? new Date(end) : end;

  const startMonth = s.toLocaleDateString("en-US", { month: "short" });
  const endMonth = e.toLocaleDateString("en-US", { month: "short" });

  if (startMonth === endMonth) {
    return `${startMonth} ${s.getDate()}-${e.getDate()}, ${e.getFullYear()}`;
  }
  return `${startMonth} ${s.getDate()} - ${endMonth} ${e.getDate()}, ${e.getFullYear()}`;
}

/**
 * Format date range with weekdays: "Wed, Jun 15 - Sat, Jun 22"
 * Use for PDF overviews where weekday context helps planning
 */
export function formatDateRangeWithWeekdays(start: Date | string, end: Date | string): string {
  const s = typeof start === "string" ? new Date(start) : start;
  const e = typeof end === "string" ? new Date(end) : end;

  const options: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" };
  return `${s.toLocaleDateString("en-US", options)} - ${e.toLocaleDateString("en-US", options)}`;
}

/**
 * Format time in 24h format: "14:30"
 * Use for flight times, schedules
 */
export function formatTime24h(datetime: string | Date): string {
  if (!datetime) return "";

  try {
    const date = typeof datetime === "string" ? new Date(datetime) : datetime;
    return date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return typeof datetime === "string" ? datetime : "";
  }
}

/**
 * Format full datetime: "Jun 15, 14:30"
 * Use when both date and time context needed
 */
export function formatDateTime(datetime: string | Date): string {
  if (!datetime) return "";

  try {
    const date = typeof datetime === "string" ? new Date(datetime) : datetime;
    const dateStr = date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
    const timeStr = date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    return `${dateStr}, ${timeStr}`;
  } catch {
    return typeof datetime === "string" ? datetime : "";
  }
}

/**
 * Format ISO 8601 duration string: "PT12H30M" → "12h 30m"
 * Use for flight durations from Amadeus API
 */
export function formatISODuration(duration: string): string {
  if (!duration) return "";

  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
  if (!match) return duration;

  const hours = match[1] ? `${match[1]}h` : "";
  const minutes = match[2] ? `${match[2]}m` : "";

  return [hours, minutes].filter(Boolean).join(" ");
}

/**
 * Format minutes to duration: 150 → "2h 30m"
 * Use for activity durations, layovers
 */
export function formatMinutesToDuration(minutes: number): string {
  if (minutes <= 0) return "";

  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;

  if (hours === 0) return `${mins}m`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

/**
 * Format seconds to duration: 5400 → "1h 30m" or 300 → "5 min"
 * Use for travel time estimates
 */
export function formatSecondsToDuration(seconds: number): string {
  if (seconds <= 0) return "";

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMins = minutes % 60;
  return remainingMins > 0 ? `${hours} hr ${remainingMins} min` : `${hours} hr`;
}

/**
 * Format layover duration with label: 150 → "2h 30m layover"
 */
export function formatLayover(minutes: number): string {
  if (minutes <= 0) return "";

  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;

  if (hours === 0) return `${mins}m layover`;
  if (mins === 0) return `${hours}h layover`;
  return `${hours}h ${mins}m layover`;
}

/**
 * Format Date object to ISO date string: YYYY-MM-DD
 */
export function formatDateToISO(date: Date): string {
  return date.toISOString().split("T")[0];
}

/**
 * Format minutes since midnight to HH:MM time string: 570 → "09:30"
 * Use for activity scheduling, time slot displays
 *
 * @param minutes - Minutes since midnight (0-1439 for valid times)
 * @returns Time string in 24h format "HH:MM"
 */
export function formatMinutesToTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}`;
}
