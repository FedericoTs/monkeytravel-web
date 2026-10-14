/**
 * Where a pre-trip reminder's button points, shared by the cron and the audit
 * script (relative imports, so tsx resolves them). The day-before and
 * departure-day emails are read on a phone, often signed out: they open trip
 * day 1 through a signed link, or the trip page if it cannot be signed.
 */
import { digestDayUrl } from "../trips/day-link";
import type { TripReminderSlot } from "./templates/TripReminder";

const DAY_ONE_SLOTS: ReadonlySet<TripReminderSlot> = new Set(["confirm_1d", "morning_of"]);

export interface ReminderCtaOpts {
  /** Absolute app origin, e.g. https://monkeytravel.app. */
  appUrl: string;
  /** The email's locale: prefixes the day link (none for English). */
  locale: string;
  tripId: string;
  /** The trip's start_date, YYYY-MM-DD: the date of day 1. */
  startDate: string;
}

export function reminderCtaUrl(slot: TripReminderSlot, opts: ReminderCtaOpts): string {
  if (DAY_ONE_SLOTS.has(slot)) return digestDayUrl({ ...opts, day: 1, slot });
  return `${opts.appUrl}/trips/${opts.tripId}?slot=${slot}`;
}
