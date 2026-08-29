/**
 * Real weather for the trip-reminder emails.
 *
 * Replaces trip_meta.weather_note, which was model-generated prose that read
 * like data and was not. Measured across 279 trips: Kyoto in September came
 * out as BOTH "10-18°C" and "27-32°C" on different trips, Tokyo in November
 * ("20-35°C") was hotter than Tokyo in September ("8-18°C"), and six
 * round-number buckets covered 229 of them. We emailed a user "10-18°C" for
 * Los Angeles on 1 September; the forecast for that day was 22-31°C.
 *
 * WHY FORECAST AND NOT THE ARCHIVE
 * --------------------------------
 * app/api/weather/route.ts uses Open-Meteo's ARCHIVE endpoint, because the
 * in-app panel answers "what is Rome usually like in October" for a trip that
 * may be years away.
 *
 * These emails are different: each fires at a FIXED OFFSET from the trip —
 * 14, 7, 3, 1 and 0 days — so at send time the trip is always within 14 days.
 * That sits inside Open-Meteo's 16-day forecast horizon, so we can state what
 * the weather will ACTUALLY be rather than what it usually is. For someone
 * deciding what to pack, that is a materially better answer.
 *
 * WHY NOT THE apiGateway CLIENT
 * -----------------------------
 * lib/api-gateway/clients/weather.ts wraps the same API, but the gateway
 * records usage rows per call. Open-Meteo is free (the client already sets
 * costOverride: 0), so that write buys no cost visibility here and adds a
 * database dependency inside the email loop — a place where extra failure
 * surface has no upside. This uses plain fetch with a hard timeout instead.
 *
 * FAILURE IS ALWAYS SILENCE, NEVER A GUESS
 * ----------------------------------------
 * No coordinates, a timeout, a non-200, dates outside the horizon, nulls in
 * the series — every one of them returns null and the email renders without a
 * weather block. That is exactly how it behaves today. The entire point of
 * this module is that a number appears only when it came from the API.
 */

/** Open-Meteo's published horizon. Requesting more is silently clamped. */
export const MAX_FORECAST_DAYS = 16;

/**
 * Hard ceiling on one lookup. The cron may process up to MAX_ROWS_PER_RUN
 * (200) rows inside a 60s function, so a hanging call must not be able to
 * starve the rest of the batch — a missing weather block is trivial next to a
 * reminder that never sends.
 */
const TIMEOUT_MS = 2500;

export interface TripForecast {
  /** Coldest daily minimum across the covered days, rounded. */
  minC: number;
  /** Warmest daily maximum across the covered days, rounded. */
  maxC: number;
  /** How many trip days the forecast actually covered. */
  days: number;
  /** Days with meaningful precipitation (>= 1mm). */
  wetDays: number;
  /** The first covered day, for the "today / tomorrow" slots. */
  firstDay: { date: string; minC: number; maxC: number } | null;
}

export interface ForecastQuery {
  latitude: number;
  longitude: number;
  /** Trip start, YYYY-MM-DD. */
  startDate: string;
  /** Trip end, YYYY-MM-DD. */
  endDate: string;
  /** Injectable for tests. */
  now?: Date;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** YYYY-MM-DD in UTC. Local accessors would shift the calendar day. */
function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Fetch the forecast covering a trip's dates.
 *
 * Returns null rather than throwing, for anything at all. The caller is a cron
 * delivering email; it must never be taken down by a weather lookup.
 */
export async function getTripForecast(
  q: ForecastQuery
): Promise<TripForecast | null> {
  const { latitude, longitude, startDate, endDate } = q;

  if (!isFiniteNumber(latitude) || !isFiniteNumber(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;

  const now = q.now ?? new Date();
  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);

  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;

  // The window we can actually speak to: from today (a trip may already have
  // begun, which is exactly the morning_of case) to the horizon.
  const horizon = new Date(today);
  horizon.setUTCDate(horizon.getUTCDate() + MAX_FORECAST_DAYS - 1);

  const from = start < today ? today : start;
  const to = end > horizon ? horizon : end;
  // Trip is entirely beyond the horizon, or entirely in the past.
  if (from > to) return null;

  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(latitude));
  url.searchParams.set("longitude", String(longitude));
  url.searchParams.set(
    "daily",
    "temperature_2m_max,temperature_2m_min,precipitation_sum"
  );
  // Ask for the exact window rather than a day count — Open-Meteo honours
  // start_date/end_date on the forecast endpoint and it keeps the response
  // small.
  url.searchParams.set("start_date", toIsoDate(from));
  url.searchParams.set("end_date", toIsoDate(to));
  url.searchParams.set("timezone", "auto");

  const doFetch = q.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let payload: unknown;
  try {
    const res = await doFetch(url.toString(), { signal: controller.signal });
    if (!res.ok) return null;
    payload = await res.json();
  } catch {
    // Timeout, abort, DNS, malformed JSON — all the same answer: no block.
    return null;
  } finally {
    clearTimeout(timer);
  }

  // Open-Meteo signals a bad request with an error BODY, not always an error
  // status: asking beyond the horizon returns
  //   {"error":true,"reason":"Parameter 'start_date' is out of allowed range"}
  // The clamp above should prevent that, but the horizon moves daily and a
  // 200-with-error-body must never be mistaken for data.
  if ((payload as { error?: unknown })?.error) return null;

  const daily = (payload as { daily?: Record<string, unknown> })?.daily;
  if (!daily || typeof daily !== "object") return null;

  const time = daily.time;
  const maxes = daily.temperature_2m_max;
  const mins = daily.temperature_2m_min;
  const precip = daily.precipitation_sum;
  if (!Array.isArray(time) || !Array.isArray(maxes) || !Array.isArray(mins)) {
    return null;
  }

  let minC = Infinity;
  let maxC = -Infinity;
  let days = 0;
  let wetDays = 0;
  let firstDay: TripForecast["firstDay"] = null;

  for (let i = 0; i < time.length; i++) {
    const lo = mins[i];
    const hi = maxes[i];
    // Open-Meteo returns null for a day it cannot serve. Skipping rather than
    // coercing keeps a partial window usable instead of poisoning the range
    // with a zero.
    if (!isFiniteNumber(lo) || !isFiniteNumber(hi)) continue;

    days++;
    if (lo < minC) minC = lo;
    if (hi > maxC) maxC = hi;

    const mm = Array.isArray(precip) ? precip[i] : undefined;
    if (isFiniteNumber(mm) && mm >= 1) wetDays++;

    if (!firstDay && typeof time[i] === "string") {
      firstDay = {
        date: time[i] as string,
        minC: Math.round(lo),
        maxC: Math.round(hi),
      };
    }
  }

  if (days === 0) return null;

  return {
    minC: Math.round(minC),
    maxC: Math.round(maxC),
    days,
    wetDays,
    firstDay,
  };
}

/**
 * Which localised sentence a forecast should render as, and with what numbers.
 *
 * Returns a descriptor rather than a string because this module stays free of
 * next-intl (the same reason trip-context.ts takes its labels as arguments).
 * The CALLER translates; the rule about which message and which numbers lives
 * here, once, so the cron and scripts/audit-queued-emails.mts cannot drift.
 * They already drifted once on the subject rule — inside an hour.
 *
 * Two messages rather than one with a conditional clause: "rain on 0 of 5
 * days" is a worse sentence than "no rain expected", and assembling that by
 * concatenation would not survive translation into es/it/pt.
 */
export interface ForecastMessage {
  key: "weatherNoRain" | "weatherWithRain";
  values: { range: string; wet: number; days: number };
}

/**
 * The temperature range as one pre-formatted string.
 *
 * Composed here rather than in the ICU message because the separator depends
 * on the numbers. A tight en dash reads well between positives — "22–32°C" —
 * but collides with the minus sign the moment either end goes below zero:
 * "-8–-1°C" is what four locales rendered before this existed, and any winter
 * trip would have shipped it. A negative endpoint gets a spaced dash instead.
 *
 * An identical pair collapses to a single figure. "3–3°C" is not a range, and
 * a one-day forecast produces that pair often enough to matter.
 */
export function formatTempRange(minC: number, maxC: number): string {
  if (minC === maxC) return `${minC}°C`;
  const sep = minC < 0 || maxC < 0 ? " – " : "–";
  return `${minC}${sep}${maxC}°C`;
}

/**
 * How many days the trip runs, inclusive. Null if the dates are unusable.
 */
export function tripLengthDays(
  startDate: string,
  endDate: string
): number | null {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
  return Math.round((end - start) / 86_400_000) + 1;
}

/**
 * Which HEADING the weather block should carry.
 *
 * This exists because a forecast usually cannot see the whole trip, and the
 * default heading claims otherwise. Measured over the queued backlog:
 *
 *   pack_early_14d   120 of 122 rows cover only PART of the trip — a median
 *                    of 29% of it, as little as 10% — because the slot fires
 *                    14 days out and the horizon reaches 16. Under a heading
 *                    reading "Weather while you're there", a three-day sample
 *                    was about to describe a ten-day trip.
 *   weather_3d       124 of 146 cover the whole trip, median 100%.
 *
 * The numbers were never wrong; the scope was. So a partial window says so in
 * the heading, and the line beneath it is unchanged.
 */
export type ForecastLabel =
  | { key: "weather"; values?: undefined }
  | { key: "weatherFirstDays"; values: { days: number } };

export function forecastLabel(
  fc: TripForecast,
  tripDays: number | null
): ForecastLabel {
  // Unknown trip length: claim only what was actually fetched.
  if (tripDays === null) return { key: "weatherFirstDays", values: { days: fc.days } };
  if (fc.days >= tripDays) return { key: "weather" };
  return { key: "weatherFirstDays", values: { days: fc.days } };
}

export function forecastMessage(fc: TripForecast): ForecastMessage {
  return {
    key: fc.wetDays > 0 ? "weatherWithRain" : "weatherNoRain",
    values: {
      range: formatTempRange(fc.minC, fc.maxC),
      wet: fc.wetDays,
      days: fc.days,
    },
  };
}
