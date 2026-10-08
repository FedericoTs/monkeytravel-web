/** @vitest-environment node */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createHmac, randomBytes } from "crypto";
import {
  dayLinkExpiry,
  dayLinkUrl,
  digestDayUrl,
  signDayLink,
  tripDayDate,
  tripDayNumber,
  verifyDayLink,
} from "./day-link";

// Generated per run: no key-shaped literal in the source.
const SECRET = randomBytes(32).toString("hex");
const TRIP = "3f6c2a8e-91d4-4b7a-a5e2-6c0d8b1f4e29";
const OTHER_TRIP = "0b5c3a52-6f0e-4c1e-9d3b-8a7f6e5d4c3b";
const DATE = "2026-10-14";
// The link is minted the day before the plan's date.
const SENT_AT = Date.UTC(2026, 9, 13, 7);

beforeEach(() => {
  vi.stubEnv("EMAIL_UNSUBSCRIBE_SECRET", SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("expiry", () => {
  it("lasts until the end of the following day in every time zone", () => {
    expect(dayLinkExpiry(DATE)).toBe(Date.UTC(2026, 9, 16, 12) / 1000);
  });

  it("verifies until that moment and not after", () => {
    const k = signDayLink(TRIP, DATE);
    const expires = dayLinkExpiry(DATE) * 1000;
    expect(verifyDayLink(TRIP, DATE, k, SENT_AT)).toEqual({ ok: true });
    expect(verifyDayLink(TRIP, DATE, k, expires - 1)).toEqual({ ok: true });
    expect(verifyDayLink(TRIP, DATE, k, expires)).toEqual({ ok: false, reason: "expired" });
    expect(verifyDayLink(TRIP, DATE, k, expires + 30 * 86_400_000)).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects a link signed with an expiry already past", () => {
    const k = signDayLink(TRIP, DATE, SENT_AT / 1000 - 1);
    expect(verifyDayLink(TRIP, DATE, k, SENT_AT)).toEqual({ ok: false, reason: "expired" });
  });
});

describe("scope and tampering", () => {
  const k = () => signDayLink(TRIP, DATE);

  it("does not open another trip or another day", () => {
    expect(verifyDayLink(OTHER_TRIP, DATE, k(), SENT_AT)).toEqual({ ok: false, reason: "signature" });
    expect(verifyDayLink(TRIP, "2026-10-15", k(), SENT_AT)).toEqual({ ok: false, reason: "signature" });
    expect(verifyDayLink(TRIP, "2026-10-13", k(), SENT_AT)).toEqual({ ok: false, reason: "signature" });
  });

  it("cannot be extended by editing the expiry", () => {
    const [expires, sig] = k().split(".");
    const later = `${Number(expires) + 86_400 * 365}.${sig}`;
    expect(verifyDayLink(TRIP, DATE, later, SENT_AT)).toEqual({ ok: false, reason: "signature" });
  });

  it("rejects an altered signature", () => {
    const value = k();
    const last = value.slice(-1);
    const flipped = value.slice(0, -1) + (last === "A" ? "B" : "A");
    expect(verifyDayLink(TRIP, DATE, flipped, SENT_AT)).toEqual({ ok: false, reason: "signature" });
  });

  it("rejects a link signed with another secret", () => {
    const value = k();
    vi.stubEnv("EMAIL_UNSUBSCRIBE_SECRET", randomBytes(32).toString("hex"));
    expect(verifyDayLink(TRIP, DATE, value, SENT_AT)).toEqual({ ok: false, reason: "signature" });
  });

  it("accepts the trip id in either case", () => {
    expect(verifyDayLink(TRIP.toUpperCase(), DATE, k(), SENT_AT)).toEqual({ ok: true });
  });

  it("is not interchangeable with other signed tokens on the same secret", () => {
    const expires = dayLinkExpiry(DATE);
    const untagged = createHmac("sha256", SECRET).update(`${TRIP}|${DATE}|${expires}`).digest("base64url");
    expect(verifyDayLink(TRIP, DATE, `${expires}.${untagged}`, SENT_AT)).toEqual({ ok: false, reason: "signature" });
    // The shape of an unsubscribe or feedback token: base64url(payload).base64url(hmac(payload)).
    const payload = Buffer.from(JSON.stringify({ u: TRIP, k: "tripReminders", e: expires })).toString("base64url");
    const unsubscribeLike = `${payload}.${createHmac("sha256", SECRET).update(payload).digest("base64url")}`;
    expect(verifyDayLink(TRIP, DATE, unsubscribeLike, SENT_AT)).toEqual({ ok: false, reason: "format" });
  });

  it("rejects malformed input without throwing", () => {
    for (const bad of [null, undefined, "", "abc", "123.", ".abc", `${k()}x`, `-1.${k().split(".")[1]}`]) {
      expect(verifyDayLink(TRIP, DATE, bad, SENT_AT)).toEqual({ ok: false, reason: "format" });
    }
    expect(verifyDayLink("not-a-uuid", DATE, k(), SENT_AT)).toEqual({ ok: false, reason: "format" });
    expect(verifyDayLink(TRIP, "2026-02-30", k(), SENT_AT)).toEqual({ ok: false, reason: "format" });
    expect(verifyDayLink(TRIP, "14-10-2026", k(), SENT_AT)).toEqual({ ok: false, reason: "format" });
  });
});

describe("without a usable secret", () => {
  it("signs nothing and verifies nothing", () => {
    const k = signDayLink(TRIP, DATE);
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (const value of ["", "too-short"]) {
      vi.stubEnv("EMAIL_UNSUBSCRIBE_SECRET", value);
      expect(() => signDayLink(TRIP, DATE)).toThrow(/EMAIL_UNSUBSCRIBE_SECRET/);
      expect(() => dayLinkUrl({ appUrl: "https://monkeytravel.app", locale: "en", tripId: TRIP, date: DATE })).toThrow();
      expect(verifyDayLink(TRIP, DATE, k, SENT_AT)).toEqual({ ok: false, reason: "secret_missing" });
    }
  });

  it("refuses to sign a malformed trip or date", () => {
    expect(() => signDayLink("not-a-uuid", DATE)).toThrow();
    expect(() => signDayLink(TRIP, "2026-13-01")).toThrow();
  });
});

describe("dayLinkUrl", () => {
  it("builds a locale-prefixed link whose key verifies, with the slot for click tracking", () => {
    const en = new URL(dayLinkUrl({ appUrl: "https://monkeytravel.app", locale: "en", tripId: TRIP, date: DATE, slot: "in_trip_day_3" }));
    expect(en.pathname).toBe(`/day/${TRIP}/${DATE}`);
    expect(en.searchParams.get("slot")).toBe("in_trip_day_3");
    expect(verifyDayLink(TRIP, DATE, en.searchParams.get("k"), SENT_AT)).toEqual({ ok: true });

    const es = new URL(dayLinkUrl({ appUrl: "https://monkeytravel.app", locale: "es", tripId: TRIP.toUpperCase(), date: DATE }));
    expect(es.pathname).toBe(`/es/day/${TRIP}/${DATE}`);
    expect(es.searchParams.has("slot")).toBe(false);
  });
});

describe("digestDayUrl", () => {
  const opts = { appUrl: "https://monkeytravel.app", locale: "it", tripId: TRIP, startDate: "2026-10-12", day: 3, slot: "in_trip_day_3" };

  it("links the owner to that day's signed page", () => {
    const url = new URL(digestDayUrl(opts));
    expect(url.pathname).toBe(`/it/day/${TRIP}/2026-10-14`);
    expect(url.searchParams.get("slot")).toBe("in_trip_day_3");
    expect(verifyDayLink(TRIP, "2026-10-14", url.searchParams.get("k"), SENT_AT)).toEqual({ ok: true });
  });

  it("falls back to the trip page, never an unsigned link, without a secret", () => {
    vi.stubEnv("EMAIL_UNSUBSCRIBE_SECRET", "");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(digestDayUrl(opts)).toBe(`https://monkeytravel.app/trips/${TRIP}?slot=in_trip_day_3`);
  });
});

describe("trip day arithmetic", () => {
  it("maps a trip day to its date and back", () => {
    expect(tripDayDate("2026-10-12", 1)).toBe("2026-10-12");
    expect(tripDayDate("2026-10-12", 3)).toBe("2026-10-14");
    expect(tripDayDate("2026-10-30", 4)).toBe("2026-11-02");
    expect(tripDayDate("2026-10-12", 0)).toBeNull();
    expect(tripDayDate("not a date", 2)).toBeNull();

    expect(tripDayNumber("2026-10-12", "2026-10-16", "2026-10-14")).toBe(3);
    expect(tripDayNumber("2026-10-12", "2026-10-16", "2026-10-16")).toBe(5);
    expect(tripDayNumber("2026-10-12", null, "2026-10-12")).toBe(1);
  });

  it("returns null for a date outside the trip", () => {
    expect(tripDayNumber("2026-10-12", "2026-10-16", "2026-10-11")).toBeNull();
    expect(tripDayNumber("2026-10-12", "2026-10-16", "2026-10-17")).toBeNull();
    expect(tripDayNumber("2026-10-12", "2026-10-16", "garbage")).toBeNull();
  });
});
