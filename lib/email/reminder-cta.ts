/**
 * Where a pre-trip reminder's button points, shared by the cron and the audit
 * script (relative imports, so tsx resolves them). Reminders are read on a
 * phone, mostly signed out, and the trip page asks them to sign in first: so
 * every reminder opens trip day 1 through a signed link, read-only with a way
 * on to the trip, or the trip page if the link cannot be signed.
 */
import { digestDayUrl } from "../trips/day-link";
import type { TripReminderSlot } from "./templates/TripReminder";

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
  return digestDayUrl({ ...opts, day: 1, slot });
}
