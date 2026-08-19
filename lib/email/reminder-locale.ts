/**
 * Locale handling for the trip-reminder emails.
 *
 * WHY THIS IS ITS OWN MODULE
 * These two functions used to sit inside app/api/cron/scheduled-notifications/
 * route.ts, where nothing but `GET` is exported and so neither could be tested
 * directly. The reminder i18n suite therefore tested the *translations* — it
 * enumerated all four locales and asserted the copy resolved — and passed for
 * months while `resolveLocale` could only ever return en/it/es. The data was
 * verified; the routing to it was not. Portuguese users got English reminders.
 *
 * Pulling them out means the mapping itself is under test, not just the strings
 * it points at.
 */

/**
 * Locales the reminder email can be sent in.
 *
 * Must stay in step with `routing.locales`. Deliberately NOT imported from
 * lib/i18n/routing: that module builds next-intl navigation helpers, which a
 * cron route has no business pulling in. reminder-i18n.vitest.ts asserts the
 * two lists are identical, so adding a locale to the app fails this file's
 * tests instead of silently downgrading those users to English — which is
 * exactly how `pt` was missed.
 */
export const REMINDER_LOCALES = ["en", "it", "es", "pt"] as const;

export type ReminderLocale = (typeof REMINDER_LOCALES)[number];

/**
 * BCP-47 tag per locale, for Intl formatting.
 *
 * pt maps to pt-BR to match the rest of the product (ogLocaleMap in the blog
 * pages does the same); the difference from pt-PT shows up in month
 * abbreviations, which is precisely what formatDateRange renders.
 */
const INTL_TAG: Record<ReminderLocale, string> = {
  en: "en-US",
  it: "it-IT",
  es: "es-ES",
  pt: "pt-BR",
};

function isReminderLocale(value: string): value is ReminderLocale {
  return (REMINDER_LOCALES as readonly string[]).includes(value);
}

/**
 * Normalise a stored `preferred_language` down to a supported locale.
 *
 * Defaults to "en" so the email still goes out when the column is null or holds
 * something unexpected. Also accepts a regional tag ("pt-BR", "es-419") by
 * taking its base subtag, since the column is user-supplied and has held both
 * forms.
 */
export function resolveLocale(raw: string | null | undefined): ReminderLocale {
  if (!raw) return "en";
  const base = raw.trim().toLowerCase().split(/[-_]/)[0];
  return isReminderLocale(base) ? base : "en";
}

/**
 * Format a date range "Sep 1 – Sep 7" in the recipient's locale.
 * Falls back gracefully when end < start or either side is invalid.
 */
export function formatDateRange(
  start: string,
  end: string | null,
  locale: ReminderLocale
): string {
  try {
    const s = new Date(start);
    if (Number.isNaN(s.getTime())) return "";
    const fmt = new Intl.DateTimeFormat(INTL_TAG[locale], {
      month: "short",
      day: "numeric",
    });
    const startLabel = fmt.format(s);
    if (!end) return startLabel;
    const e = new Date(end);
    if (Number.isNaN(e.getTime()) || e.getTime() < s.getTime()) {
      return startLabel;
    }
    return `${startLabel} – ${fmt.format(e)}`;
  } catch {
    return "";
  }
}
