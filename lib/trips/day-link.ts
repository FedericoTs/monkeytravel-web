/**
 * Signed links to one day of one trip: /day/<tripId>/<date>?k=<expiry>.<mac>,
 * read-only and without sign-in. The HMAC covers a purpose tag, the trip, the
 * date and the expiry, so a link cannot be moved to another trip or day, or
 * extended. Signed with EMAIL_UNSUBSCRIBE_SECRET; without it nothing is
 * signed and nothing verifies.
 */

import { createHmac, timingSafeEqual } from "crypto";

const PURPOSE = "mt-trip-day:v1";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY_RE = /^(\d{1,12})\.([A-Za-z0-9_-]{43})$/;
const DAY_MS = 86_400_000;

function secret(): string | null {
  const s = process.env.EMAIL_UNSUBSCRIBE_SECRET;
  return s && s.length >= 16 ? s : null;
}

/** UTC midnight of a real YYYY-MM-DD date, or null. */
function dayStartUtc(date: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const t = Date.parse(`${date}T00:00:00Z`);
  return Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== date ? null : t;
}

function mac(key: string, tripId: string, date: string, expires: number): Buffer {
  return createHmac("sha256", key).update(`${PURPOSE}|${tripId.toLowerCase()}|${date}|${expires}`).digest();
}

/** Unix seconds at the end of the day after `date`, in every time zone (UTC-12 included). */
export function dayLinkExpiry(date: string): number {
  const start = dayStartUtc(date);
  if (start === null) throw new Error(`invalid date: ${date}`);
  return (start + 2 * DAY_MS + 12 * 3_600_000) / 1000;
}

/** The `k` parameter for /day/<tripId>/<date>. Throws without a usable secret. */
export function signDayLink(tripId: string, date: string, expires: number = dayLinkExpiry(date)): string {
  const key = secret();
  if (!key) throw new Error("EMAIL_UNSUBSCRIBE_SECRET is not set (or too short)");
  if (!UUID_RE.test(tripId) || dayStartUtc(date) === null) throw new Error("invalid trip id or date");
  return `${expires}.${mac(key, tripId, date, expires).toString("base64url")}`;
}

export type DayLinkCheck =
  | { ok: true }
  | { ok: false; reason: "format" | "signature" | "expired" | "secret_missing" };

/** Never throws; every failure is a reason. */
export function verifyDayLink(
  tripId: string,
  date: string,
  k: string | null | undefined,
  now: number = Date.now(),
): DayLinkCheck {
  const key = secret();
  if (!key) {
    console.error("[day-link] EMAIL_UNSUBSCRIBE_SECRET missing: every day link is rejected");
    return { ok: false, reason: "secret_missing" };
  }
  const parts = KEY_RE.exec(k ?? "");
  if (!parts || !UUID_RE.test(tripId) || dayStartUtc(date) === null) return { ok: false, reason: "format" };
  const expires = Number(parts[1]);
  // Compared as encoded text: decoding would accept other spellings of one MAC.
  const given = Buffer.from(parts[2]);
  const expected = Buffer.from(mac(key, tripId, date, expires).toString("base64url"));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, reason: "signature" };
  }
  return expires * 1000 > now ? { ok: true } : { ok: false, reason: "expired" };
}

/** Absolute URL of a signed day link, locale-prefixed as-needed. Throws without a secret. */
export function dayLinkUrl(opts: {
  appUrl: string;
  locale: string;
  tripId: string;
  date: string;
  /** Queue slot, read by email click tracking. */
  slot?: string;
}): string {
  const query = new URLSearchParams({ k: signDayLink(opts.tripId, opts.date) });
  if (opts.slot) query.set("slot", opts.slot);
  const prefix = opts.locale === "en" ? "" : `/${opts.locale}`;
  return `${opts.appUrl}${prefix}/day/${opts.tripId.toLowerCase()}/${opts.date}?${query}`;
}

/**
 * The owner's link in the day-`day` digest: that day's signed page, or the
 * trip page (which needs sign-in) when no link can be signed.
 */
export function digestDayUrl(opts: {
  appUrl: string;
  locale: string;
  tripId: string;
  startDate: string;
  day: number;
  slot: string;
}): string {
  const date = tripDayDate(opts.startDate, opts.day);
  if (date) {
    try {
      return dayLinkUrl({ appUrl: opts.appUrl, locale: opts.locale, tripId: opts.tripId, date, slot: opts.slot });
    } catch (err) {
      console.warn("[day-link] not signed, linking the trip page:", err instanceof Error ? err.message : err);
    }
  }
  return `${opts.appUrl}/trips/${opts.tripId}?slot=${opts.slot}`;
}

/** The calendar date of trip day `day` (1-based), or null. */
export function tripDayDate(startDate: string, day: number): string | null {
  const start = dayStartUtc(startDate.slice(0, 10));
  if (start === null || !Number.isInteger(day) || day < 1) return null;
  return new Date(start + (day - 1) * DAY_MS).toISOString().slice(0, 10);
}

/** The 1-based trip day `date` falls on, or null when it is outside the trip. */
export function tripDayNumber(startDate: string, endDate: string | null, date: string): number | null {
  const start = dayStartUtc(startDate.slice(0, 10));
  const end = endDate ? dayStartUtc(endDate.slice(0, 10)) : start;
  const at = dayStartUtc(date);
  if (start === null || end === null || at === null || at < start || at > end) return null;
  return Math.round((at - start) / DAY_MS) + 1;
}
