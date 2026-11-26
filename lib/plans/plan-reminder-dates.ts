/**
 * When a kept plan's reminders go (lib/plans/plan-reminders.ts sends them): one email in the week before the trip
 * and one the day before, to an address that ticked "remind me" (components/wizard/EmailPlanCard.tsx). Days are
 * calendar days, YYYY-MM-DD, counted in UTC like the daily run that sends them.
 */

export const PLAN_REMINDER_WEEK = "plan_reminder_7d";
export const PLAN_REMINDER_DAY = "plan_reminder_1d";
export type PlanReminderSlot = typeof PLAN_REMINDER_WEEK | typeof PLAN_REMINDER_DAY;
/** What a reminder asked for now would send: the week's email and the day before's, or only the day before's. */
export type ReminderKind = "week" | "day";

const DAY_MS = 86_400_000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
/** The fewest days ahead a reminder can be asked for: the day-before email needs a morning to go. */
const MIN_DAYS_AHEAD = 2;
/** The fewest days ahead that still leave room for the week's email after the first one. */
const WEEK_DAYS_AHEAD = 8;
/** How long the plan's link stays after the trip's last day once a reminder was asked for. */
const PLAN_KEPT_DAYS_AFTER = 14;

function isDay(day: unknown): day is string {
  if (typeof day !== "string" || !ISO_DAY.test(day)) return false;
  const time = Date.parse(`${day}T00:00:00Z`);
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === day;
}

/** Days from `today` to `day`; null when either isn't a real calendar day (2026-02-31 isn't). */
export function daysFrom(today: string, day: unknown): number | null {
  if (!isDay(today) || !isDay(day)) return null;
  return Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS);
}

/** Today as the daily run counts it. */
export const utcToday = (now = new Date()): string => now.toISOString().slice(0, 10);

/** What a reminder asked for today would send; null when the trip can't be reminded of (too close, or dates not chosen). */
export function reminderKind(start: unknown, today: string, flexibleDates = false): ReminderKind | null {
  if (flexibleDates) return null;
  const days = daysFrom(today, start);
  if (days === null || days < MIN_DAYS_AHEAD) return null;
  return days >= WEEK_DAYS_AHEAD ? "week" : "day";
}

/**
 * The reminder due today, or null. The week's email goes 7 to 5 days out (a missed run still gets it there), and
 * only when the reminder was asked for at least 8 days out: closer, its first email already did that job. The
 * day-before email goes the day before, when asked for at least 2 days out. Each goes once.
 */
export function dueReminder(
  start: unknown,
  askedOn: string,
  today: string,
  sent: readonly string[],
): PlanReminderSlot | null {
  const days = daysFrom(today, start);
  const askedDaysBefore = daysFrom(askedOn, start);
  if (days === null || askedDaysBefore === null) return null;
  if (days === 1 && askedDaysBefore >= MIN_DAYS_AHEAD && !sent.includes(PLAN_REMINDER_DAY)) return PLAN_REMINDER_DAY;
  if (days >= 5 && days <= 7 && askedDaysBefore >= WEEK_DAYS_AHEAD && !sent.includes(PLAN_REMINDER_WEEK)) {
    return PLAN_REMINDER_WEEK;
  }
  return null;
}

/** Whether a reminder's address has done its job and goes: from the trip's first day, or when it has no real start. */
export function reminderIsOver(start: unknown, today: string): boolean {
  const days = daysFrom(today, start);
  return days === null || days < 1;
}

/** The earliest the plan's link may expire once a reminder was asked for: two weeks after the trip's last day. */
export function planKeptUntil(start: unknown, end: unknown): string | null {
  const last = isDay(end) ? end : isDay(start) ? start : null;
  if (!last) return null;
  return new Date(Date.parse(`${last}T00:00:00Z`) + (PLAN_KEPT_DAYS_AFTER + 1) * DAY_MS).toISOString();
}
