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
 *   - For DURATIONS, count days with daysBetweenLocal(): local midnights
 *     are 23 or 25 hours apart across a daylight-saving change.
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

/** A date's local calendar day as YYYY-MM-DD: the inverse of parseLocalDate. */
export function toLocalISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * The user's "today" as YYYY-MM-DD. `toISOString()` gives UTC's day, which in
 * the evening west of UTC is already tomorrow.
 */
export function localTodayISO(): string {
  return toLocalISODate(new Date());
}

/**
 * Whole days from one local midnight to another. Rounded, never floored or
 * ceiled: across a daylight-saving change the gap is a day plus or minus an
 * hour.
 */
export function daysBetweenLocal(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

