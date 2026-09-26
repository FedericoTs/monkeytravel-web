/**
 * DateTime Module
 *
 * Consolidated date/time utilities for the MonkeyTravel application.
 * Import from '@/lib/datetime' for all date/time operations.
 *
 * @example
 * import { formatDateWithWeekday } from '@/lib/datetime';
 *
 * const formatted = formatDateWithWeekday(new Date());
 */

// Formatting functions
export {
  formatDateWithWeekday,
  formatDateFull,
  formatDateShort,
  formatDateRange,
  formatDateRangeWithWeekdays,
  formatTime24h,
  formatDateTime,
  formatISODuration,
  formatMinutesToDuration,
  formatSecondsToDuration,
  formatLayover,
  formatDateToISO,
} from "./format";
