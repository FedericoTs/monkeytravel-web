/**
 * Where a pre-trip reminder's button points, shared by the cron and the audit
 * script (relative imports, so tsx resolves them). Reminders are read on a
 * phone, mostly signed out, and the trip page asks them to sign in first: so
 * every reminder opens trip day 1 through a signed link, read-only with a way
 * on to the trip, or the trip page if the link cannot be signed.
 */
import { digestDayUrl } from "../trips/day-link";
import { buildNeedUrl } from "../feedback/token";
import { NEED_ANSWERS, type NeedAnswer } from "../feedback/need";
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

export interface NeedAnswerOpts {
  appUrl: string;
  /** The email's locale: prefixes the answer page (none for English). */
  locale: string;
  tripId: string;
  /** The recipient, the trip's owner: the answer is theirs. */
  userId: string;
}

/**
 * The links under a reminder's one question, "what do you still need for this
 * trip?" (lib/feedback/need.ts): one per answer, in order, each a signed
 * one-tap link that records the answer as its page opens. Null when the links
 * can't be signed: the question is left out and the reminder still goes.
 */
export function needAnswerUrls(
  slot: TripReminderSlot,
  opts: NeedAnswerOpts
): { need: NeedAnswer; url: string }[] | null {
  try {
    return NEED_ANSWERS.map((need) => ({
      need,
      url: buildNeedUrl(opts.userId, opts.tripId, need, slot, opts.locale, opts.appUrl),
    }));
  } catch {
    return null;
  }
}
