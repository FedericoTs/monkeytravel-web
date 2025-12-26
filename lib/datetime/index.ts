/**
 * DateTime Module
 *
 * Consolidated date/time utilities for the MonkeyTravel application.
 * Import from '@/lib/datetime' for all date/time operations.
 *
 * @example
 * import { formatDateWithWeekday, calculateNights, isValidDate } from '@/lib/datetime';
 *
 * const formatted = formatDateWithWeekday(new Date());
 * const nights = calculateNights(checkIn, checkOut);
 * const valid = isValidDate(userInput);
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

// Calculation functions
export {
  calculateNights,
  calculateDays,
  calculateDuration,
  calculateLayoverMinutes,
  parseDurationToMinutes,
  addDays,
  addHours,
  addMinutes,
  getTomorrowDate,
  getDateFromNow,
  startOfDay,
  endOfDay,
} from "./calculate";

// Validation functions
export {
  isValidDate,
  isFutureDate,
  isPastDate,
  isToday,
  isSameDay,
  isSameMonth,
  isDateInRange,
  isBefore,
  isAfter,
  parseDate,
} from "./validate";
