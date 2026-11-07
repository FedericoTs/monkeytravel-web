/**
 * Sunrise and sunset for a place and a date, from the date and the coordinates
 * alone: the NOAA approximation, good to a few minutes, with no API and no
 * library, so it runs in the browser. Times are minutes after local midnight in
 * the place's own time zone, which is where a plan's start times live.
 */

export interface SunTimes {
  /** Minutes after local midnight; null when the sun doesn't rise or set that day. */
  sunrise: number | null;
  sunset: number | null;
  /** Set when the sun stays up, or down, all day. */
  polar: "day" | "night" | null;
}

const RAD = Math.PI / 180;

/** How far the zone is ahead of UTC on that date, in minutes, summer time included. */
export function zoneOffsetMinutes(timeZone: string, date: string): number {
  const noonUtc = new Date(`${date}T12:00:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(noonUtc);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  const local = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  return Math.round((local - noonUtc.getTime()) / 60_000);
}

export function sunTimes(date: string, lat: number, lng: number, timeZone: string): SunTimes {
  const day = new Date(`${date}T12:00:00Z`);
  const dayOfYear = Math.floor((day.getTime() - Date.UTC(day.getUTCFullYear(), 0, 0)) / 86_400_000);
  const g = ((2 * Math.PI) / 365) * (dayOfYear - 1 + 0.5);
  const equation = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const declination =
    0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  // The sun's centre 0.833° below the horizon: refraction and the sun's own size.
  const cosHourAngle = Math.cos(90.833 * RAD) / (Math.cos(lat * RAD) * Math.cos(declination)) - Math.tan(lat * RAD) * Math.tan(declination);
  if (cosHourAngle > 1) return { sunrise: null, sunset: null, polar: "night" };
  if (cosHourAngle < -1) return { sunrise: null, sunset: null, polar: "day" };
  const hourAngle = Math.acos(cosHourAngle) / RAD;
  const solarNoon = 720 - 4 * lng - equation + zoneOffsetMinutes(timeZone, date);
  return { sunrise: Math.round(solarNoon - 4 * hourAngle), sunset: Math.round(solarNoon + 4 * hourAngle), polar: null };
}
