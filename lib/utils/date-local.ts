/**
 * Timezone-safe parsing of YYYY-MM-DD trip date strings.
 *
 * THE BUG WE'RE AVOIDING:
 *   `new Date("2026-06-15")` parses as UTC midnight. In a negative-offset
 *   timezone (e.g. US Pacific, UTC-8) that's 4 PM on June 14 local time,
 *   so `.toLocaleDateString()` shows "Jun 14" — one day off from what the
 *   user picked. Caught live in LIVE_AUDIT F3 inside SeasonalContextCard;
 *   same pattern exists in multiple components.
 *
 * THE FIX:
 *   Split the ISO string and use the multi-arg Date constructor, which
 *   interprets components as LOCAL time. That makes the displayed date
 *   match what the user picked regardless of their browser timezone.
 *
 * WHEN TO USE THIS vs `new Date(str)`:
 *   - Use parseLocalDate() any time you'll display the date (via
 *     toLocaleDateString, getDate, etc.) — the values are user-facing.
 *   - It's also safe (and recommended for consistency) for DURATION
 *     calculations, though there `new Date(str)` is technically correct
 *     because UTC-X minus UTC-Y equals the local-X minus local-Y.
 *
 * Returns null for invalid input rather than throwing — caller decides
 * whether to surface that as an error or quietly skip rendering.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseLocalDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const m = ISO_DATE.exec(iso);
  if (!m) {
    // Fall back to standard parsing so callers passing full timestamps
    // (not just YYYY-MM-DD) still get a Date out. Invalid strings still
    // produce an Invalid Date — caller should check isNaN(d.getTime()).
    const d = new Date(iso);
    return isNaN(d.getTime()) ? null : d;
  }
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  const d = parseInt(m[3], 10);
  return new Date(y, mo - 1, d);
}

/**
 * Convenience formatter — parses a YYYY-MM-DD string in local TZ and
 * passes it through toLocaleDateString with the given options.
 *
 * Returns the original string if parsing fails (defensive — never
 * shows "Invalid Date" to the user).
 */
export function formatLocalDate(
  iso: string | null | undefined,
  options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" },
  locale: string = "en-US"
): string {
  if (!iso) return "";
  const d = parseLocalDate(iso);
  if (!d) return iso;
  return d.toLocaleDateString(locale, options);
}
