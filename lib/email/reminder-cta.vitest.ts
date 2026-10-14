/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "crypto";
import { reminderCtaUrl } from "./reminder-cta";
import { verifyDayLink } from "../trips/day-link";

const APP = "https://monkeytravel.app";
const TRIP = "3f6c2a8e-91d4-4b7a-a5e2-6c0d8b1f4e29";
const START = "2026-10-15";
const opts = (locale = "en") => ({ appUrl: APP, locale, tripId: TRIP, startDate: START });

beforeEach(() => {
  // Generated per run: no key-shaped literal in the source.
  vi.stubEnv("EMAIL_UNSUBSCRIBE_SECRET", randomBytes(32).toString("hex"));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("reminderCtaUrl", () => {
  it("opens trip day 1 without sign-in from the day-before and departure-day emails", () => {
    for (const slot of ["confirm_1d", "morning_of"] as const) {
      const url = new URL(reminderCtaUrl(slot, opts()));
      expect(`${url.origin}${url.pathname}`).toBe(`${APP}/day/${TRIP}/${START}`);
      expect(url.searchParams.get("slot")).toBe(slot);
      // Valid from the day-before send to the evening of departure day.
      const k = url.searchParams.get("k");
      expect(verifyDayLink(TRIP, START, k, Date.UTC(2026, 9, 14, 7))).toEqual({ ok: true });
      expect(verifyDayLink(TRIP, START, k, Date.UTC(2026, 9, 15, 23))).toEqual({ ok: true });
    }
  });

  it("prefixes the day link with the email's locale, except English", () => {
    for (const slot of ["confirm_1d", "morning_of"] as const) {
      for (const locale of ["es", "it", "pt"]) {
        expect(new URL(reminderCtaUrl(slot, opts(locale))).pathname).toBe(`/${locale}/day/${TRIP}/${START}`);
      }
    }
  });

  it("keeps the trip page for the other reminders", () => {
    for (const slot of ["pack_early_14d", "visa_check_7d", "weather_3d"] as const) {
      for (const locale of ["en", "es", "it", "pt"]) {
        expect(reminderCtaUrl(slot, opts(locale))).toBe(`${APP}/trips/${TRIP}?slot=${slot}`);
      }
    }
  });

  it("falls back to the trip page, never an unsigned link, without a signing secret", () => {
    vi.stubEnv("EMAIL_UNSUBSCRIBE_SECRET", "");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const slot of ["confirm_1d", "morning_of"] as const) {
      expect(reminderCtaUrl(slot, opts("it"))).toBe(`${APP}/trips/${TRIP}?slot=${slot}`);
    }
  });
});
