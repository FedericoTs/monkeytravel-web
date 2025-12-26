/**
 * Date/Time Validation Utilities
 *
 * Consolidated validation functions for date checks and comparisons.
 */

/**
 * Check if a value is a valid date
 */
export function isValidDate(value: unknown): boolean {
  if (!value) return false;

  if (value instanceof Date) {
    return !isNaN(value.getTime());
  }

  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    return !isNaN(date.getTime());
  }

  return false;
}

/**
 * Check if a date is in the future
 */
export function isFutureDate(date: Date | string): boolean {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.getTime() > Date.now();
}

/**
 * Check if a date is in the past
 */
export function isPastDate(date: Date | string): boolean {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.getTime() < Date.now();
}

/**
 * Check if a date is today
 */
export function isToday(date: Date | string): boolean {
  const d = typeof date === "string" ? new Date(date) : date;
  const today = new Date();

  return (
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate()
  );
}

/**
 * Check if two dates are the same day
 */
export function isSameDay(date1: Date | string, date2: Date | string): boolean {
  const d1 = typeof date1 === "string" ? new Date(date1) : date1;
  const d2 = typeof date2 === "string" ? new Date(date2) : date2;

  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

/**
 * Check if two dates are in the same month
 */
export function isSameMonth(date1: Date | string, date2: Date | string): boolean {
  const d1 = typeof date1 === "string" ? new Date(date1) : date1;
  const d2 = typeof date2 === "string" ? new Date(date2) : date2;

  return d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth();
}

/**
 * Check if a date falls within a range (inclusive)
 */
export function isDateInRange(
  date: Date | string,
  start: Date | string,
  end: Date | string
): boolean {
  const d = typeof date === "string" ? new Date(date) : date;
  const s = typeof start === "string" ? new Date(start) : start;
  const e = typeof end === "string" ? new Date(end) : end;

  return d.getTime() >= s.getTime() && d.getTime() <= e.getTime();
}

/**
 * Check if a date is before another date
 */
export function isBefore(date: Date | string, compareDate: Date | string): boolean {
  const d = typeof date === "string" ? new Date(date) : date;
  const c = typeof compareDate === "string" ? new Date(compareDate) : compareDate;

  return d.getTime() < c.getTime();
}

/**
 * Check if a date is after another date
 */
export function isAfter(date: Date | string, compareDate: Date | string): boolean {
  const d = typeof date === "string" ? new Date(date) : date;
  const c = typeof compareDate === "string" ? new Date(compareDate) : compareDate;

  return d.getTime() > c.getTime();
}

/**
 * Parse a date string safely, returning null if invalid
 */
export function parseDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;

  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : value;
  }

  const parsed = new Date(value);
  return isNaN(parsed.getTime()) ? null : parsed;
}
