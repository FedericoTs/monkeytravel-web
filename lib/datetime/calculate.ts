/**
 * Date/Time Calculation Utilities
 *
 * Consolidated calculation functions for durations, differences, and date math.
 */

/**
 * Calculate number of nights between two dates
 * Use for hotel stays, trip duration displays
 */
export function calculateNights(checkIn: Date | string, checkOut: Date | string): number {
  const start = typeof checkIn === "string" ? new Date(checkIn) : checkIn;
  const end = typeof checkOut === "string" ? new Date(checkOut) : checkOut;

  const diffTime = end.getTime() - start.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

/**
 * Calculate number of days between two dates (inclusive)
 * Use for trip duration, activity spans
 */
export function calculateDays(start: Date | string, end: Date | string): number {
  const s = typeof start === "string" ? new Date(start) : start;
  const e = typeof end === "string" ? new Date(end) : end;

  const diffTime = e.getTime() - s.getTime();
  return Math.floor(diffTime / (1000 * 60 * 60 * 24)) + 1;
}

/**
 * Calculate duration between two Date objects
 * Returns object with hours, minutes, totalMinutes
 */
export function calculateDuration(
  start: Date | string,
  end: Date | string
): { hours: number; minutes: number; totalMinutes: number } {
  const s = typeof start === "string" ? new Date(start) : start;
  const e = typeof end === "string" ? new Date(end) : end;

  const diffMs = e.getTime() - s.getTime();
  const totalMinutes = Math.round(diffMs / (1000 * 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  return { hours, minutes, totalMinutes };
}

/**
 * Calculate layover duration in minutes from two datetime strings
 * Use for flight connections
 */
export function calculateLayoverMinutes(arrival: string, departure: string): number {
  const arrivalTime = new Date(arrival).getTime();
  const departureTime = new Date(departure).getTime();

  return Math.round((departureTime - arrivalTime) / (1000 * 60));
}

/**
 * Parse ISO 8601 duration string to minutes
 * "PT2H30M" → 150
 */
export function parseDurationToMinutes(duration: string): number {
  if (!duration) return 0;

  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
  if (!match) return 0;

  const hours = parseInt(match[1] || "0", 10);
  const minutes = parseInt(match[2] || "0", 10);

  return hours * 60 + minutes;
}

/**
 * Add days to a date
 */
export function addDays(date: Date | string, days: number): Date {
  const d = typeof date === "string" ? new Date(date) : new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/**
 * Add hours to a date
 */
export function addHours(date: Date | string, hours: number): Date {
  const d = typeof date === "string" ? new Date(date) : new Date(date);
  d.setTime(d.getTime() + hours * 60 * 60 * 1000);
  return d;
}

/**
 * Add minutes to a date
 */
export function addMinutes(date: Date | string, minutes: number): Date {
  const d = typeof date === "string" ? new Date(date) : new Date(date);
  d.setTime(d.getTime() + minutes * 60 * 1000);
  return d;
}

/**
 * Get tomorrow's date at midnight (local time)
 */
export function getTomorrowDate(): Date {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  return tomorrow;
}

/**
 * Get date N days from now
 */
export function getDateFromNow(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(0, 0, 0, 0);
  return date;
}

/**
 * Get the start of day for a date (midnight)
 */
export function startOfDay(date: Date | string): Date {
  const d = typeof date === "string" ? new Date(date) : new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Get the end of day for a date (23:59:59.999)
 */
export function endOfDay(date: Date | string): Date {
  const d = typeof date === "string" ? new Date(date) : new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}
