/**
 * Pick the historical date range the weather panel looks up.
 *
 * Extracted from app/api/weather/route.ts for the same reason
 * lib/email/reminder-locale.ts was extracted: nothing but `GET` is exported
 * from a route file, so the date maths could not be tested directly — and date
 * maths is exactly where silent, seasonal, hard-to-notice bugs live.
 *
 * WHAT WENT WRONG
 *
 * The original subtracted exactly one year. archive-api.open-meteo.com only
 * serves dates up to today and rejects anything later outright:
 *
 *   {"reason":"Parameter 'start_date' is out of allowed range from
 *              1940-01-01 to 2026-08-21","error":true}
 *
 * So a trip planned a year or more ahead (start 2027-10-15 -> 2026-10-15) asked
 * for a FUTURE date, Open-Meteo answered 400, and the route turned that into a
 * 500. The weather panel failed for precisely the users planning furthest
 * ahead. Seen 7 times in production before this fix.
 *
 * WHY WHOLE YEARS
 *
 * The feature's premise is seasonality — "what is Rome like in mid-October" —
 * so the month and day must be preserved. Stepping back in whole years keeps
 * them, and shifting BOTH ends by the same amount means a range that straddles
 * today is never truncated.
 *
 * WHY UTC ACCESSORS
 *
 * getFullYear/setFullYear operate in LOCAL time. On any host west of UTC they
 * move the underlying instant across midnight and hand back the wrong CALENDAR
 * DAY — 2029-03-10 came back as 2026-03-09 during testing. These are date-only
 * values for a date-only API, so local time must never enter the maths.
 */

/** Bounded so a nonsense far-future date cannot spin the loop. */
const MAX_YEARS_BACK = 100;

export function getHistoricalDateRange(
  startDate: string,
  endDate: string,
  /** Injectable for tests; defaults to now. */
  now: Date = new Date()
): { start: string; end: string } {
  const start = new Date(startDate);
  const end = new Date(endDate);

  const todayUtc = new Date(now);
  todayUtc.setUTCHours(0, 0, 0, 0);

  const baseStartYear = start.getUTCFullYear();
  const baseEndYear = end.getUTCFullYear();

  let yearsBack = 0;
  do {
    yearsBack += 1;
    start.setUTCFullYear(baseStartYear - yearsBack);
    end.setUTCFullYear(baseEndYear - yearsBack);
  } while (end > todayUtc && yearsBack < MAX_YEARS_BACK);

  return {
    start: start.toISOString().split("T")[0],
    end: end.toISOString().split("T")[0],
  };
}
