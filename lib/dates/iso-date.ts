/**
 * Guards for the YYYY-MM-DD strings the trip wizard produces.
 *
 * WHY THIS EXISTS
 *
 * `<input type="date">` accepts years up to 275760, so a user typing an extra
 * digit produces a value like "20220-05-01" that the input itself considers
 * valid. That string then reached multi-city itinerary generation:
 *
 *   MultiCityError: addDaysISO: invalid date "20220-05-01"
 *
 * because ISO 8601 requires a sign for extended years (+020220-05-01), so
 * `new Date("20220-05-01T00:00:00Z")` is NaN. Sentry JAVASCRIPT-NEXTJS-1J,
 * 5 occurrences, all on the wizard — the top of the funnel.
 *
 * A `max` attribute alone does not close this: Chrome still surfaces an
 * out-of-range but parseable date through `.value`. So the value is sanitized
 * on the way in as well.
 */

/** Exactly four digits, then a real calendar month/day. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** How far ahead a trip may start. Generous, but bounded. */
const MAX_YEARS_AHEAD = 5;

export function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  // Reject impossible calendar dates ("2026-02-31") as well as bad shapes:
  // Date normalises those, so round-tripping catches them.
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return false;
  return d.toISOString().slice(0, 10) === value;
}

/**
 * Return the value only if it is a real YYYY-MM-DD date; otherwise "".
 *
 * Empty string is what an <input type="date"> already reports for a partially
 * typed date, so callers and React state handle it natively — a cleared field
 * rather than a crash further down.
 */
export function sanitizeIsoDate(value: string): string {
  return isValidIsoDate(value) ? value : "";
}

/** Upper bound for the wizard's start-date input, as YYYY-MM-DD. */
export function maxTripStartDate(now: Date = new Date()): string {
  const d = new Date(now);
  d.setUTCFullYear(d.getUTCFullYear() + MAX_YEARS_AHEAD);
  return d.toISOString().slice(0, 10);
}

/**
 * How far back a trip may start and still be a trip rather than a typo. One
 * year keeps "editing last summer's trip" possible.
 */
const MAX_YEARS_BACK = 1;

/**
 * A real calendar date whose year is near the present.
 *
 * `isValidIsoDate` accepts "0201-10-30": four digits, a real month, a real
 * day. That is exactly what `<input type="date">` reports while someone is
 * still typing the year of 2026 (0002 → 0020 → 0202 → 2026), and each of those
 * keystrokes reached /api/weather, which asked Open-Meteo for the weather of
 * the year 201 and got HTTP 400 — 82 of the 626 weather calls in the fortnight
 * to 2026-09-12 were that. The sanitiser above cannot reject them: they ARE
 * valid dates. This guard adds the one thing that separates a typed year from
 * a real one: it is within a year behind, or MAX_YEARS_AHEAD ahead, of today.
 */
export function isPlausibleTripDate(
  value: string,
  now: Date = new Date()
): boolean {
  if (!isValidIsoDate(value)) return false;
  const year = Number(value.slice(0, 4));
  const thisYear = now.getUTCFullYear();
  return year >= thisYear - MAX_YEARS_BACK && year <= thisYear + MAX_YEARS_AHEAD;
}

/**
 * Both ends plausible, and the trip does not end before it starts. The second
 * half catches the other mid-edit shape: a new start typed after the old end.
 * YYYY-MM-DD compares correctly as text.
 */
export function isPlausibleTripRange(
  start: string,
  end: string,
  now: Date = new Date()
): boolean {
  return (
    isPlausibleTripDate(start, now) &&
    isPlausibleTripDate(end, now) &&
    start <= end
  );
}
