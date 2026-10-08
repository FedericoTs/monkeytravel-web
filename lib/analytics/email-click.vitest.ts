/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { handedToAfter } = vi.hoisted(() => ({ handedToAfter: vi.fn() }));
vi.mock("next/server", () => ({ after: handedToAfter }));

import { emailClickFromUrl, trackEmailClick } from "./email-click";

const TRIP = "77e96874-2985-4867-8472-d97c1f148b65";
const PHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

const at = (path: string) => new URL(`https://monkeytravel.app${path}`);

describe("emailClickFromUrl", () => {
  it("reads the slot and the trip an email link opens", () => {
    expect(emailClickFromUrl(at(`/trips/${TRIP}?slot=in_trip_day_9`))).toEqual({ slot: "in_trip_day_9", page: "trip", tripId: TRIP });
    expect(emailClickFromUrl(at(`/it/trips/${TRIP.toUpperCase()}?slot=morning_of`))).toEqual({ slot: "morning_of", page: "trip", tripId: TRIP });
    expect(emailClickFromUrl(at("/trips/new?slot=followup_next_21d"))).toEqual({ slot: "followup_next_21d", page: "wizard", tripId: null });
    expect(emailClickFromUrl(at("/shared/tok123?slot=in_trip_day_3"))?.page).toBe("shared");
    expect(emailClickFromUrl(at(`/es/day/${TRIP}/2026-10-14?k=1.x&slot=in_trip_day_3`))).toEqual({ slot: "in_trip_day_3", page: "day", tripId: TRIP });
    expect(emailClickFromUrl(at("/day/not-a-trip/2026-10-14?slot=in_trip_day_3"))?.page).toBe("other");
  });

  it("ignores links without a known slot", () => {
    for (const slot of ["", "in_trip_day_1", "in_trip_day_22", "in_trip_day_9x", "newsletter"]) {
      expect(emailClickFromUrl(at(`/trips/${TRIP}?slot=${slot}`))).toBeNull();
    }
    expect(emailClickFromUrl(at(`/trips/${TRIP}`))).toBeNull();
  });

  it("does not take a share token or a malformed id as the trip", () => {
    expect(emailClickFromUrl(at("/shared/tok123?slot=confirm_1d"))?.tripId).toBeNull();
    expect(emailClickFromUrl(at("/trips/not-a-uuid?slot=confirm_1d"))).toEqual({ slot: "confirm_1d", page: "other", tripId: null });
  });
});

describe("trackEmailClick", () => {
  const recorded = vi.fn(async () => new Response(null, { status: 201 }));
  const request = (path: string, headers: Record<string, string> = {}) => ({
    nextUrl: at(path),
    headers: new Headers({ "user-agent": PHONE_UA, "sec-fetch-mode": "navigate", ...headers }),
  });
  const body = () => JSON.parse((recorded.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);

  beforeEach(() => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
    recorded.mockClear();
    vi.stubGlobal("fetch", recorded);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("records the click with the public key and no user id, through after()", () => {
    handedToAfter.mockClear();
    trackEmailClick(request(`/trips/${TRIP}?slot=in_trip_day_9`), "sess-1", "user-1");
    expect(handedToAfter).toHaveBeenCalledTimes(1);
    expect(recorded).toHaveBeenCalledTimes(1);
    expect((recorded.mock.calls[0] as unknown as [string])[0]).toBe("https://example.supabase.co/rest/v1/funnel_events");
    expect(body()).toEqual({
      event_type: "email_clicked",
      trip_id: TRIP,
      session_id: "sess-1",
      metadata: { slot: "in_trip_day_9", page: "trip", signed_in: true, navigate: true },
    });
  });

  it("marks a click without a session, and one without fetch metadata", () => {
    trackEmailClick(request(`/trips/${TRIP}?slot=confirm_1d`, { "sec-fetch-mode": "" }), "sess-1");
    expect(body().metadata).toMatchObject({ signed_in: false, navigate: false });
  });

  it("skips bots, links without a slot, and non-probe sessions outside production", () => {
    trackEmailClick(request(`/trips/${TRIP}?slot=confirm_1d`, { "user-agent": "curl/8.0" }), "sess-1");
    trackEmailClick(request(`/trips/${TRIP}`), "sess-1");
    vi.stubEnv("VERCEL_ENV", "preview");
    trackEmailClick(request(`/trips/${TRIP}?slot=confirm_1d`), "sess-1");
    expect(recorded).not.toHaveBeenCalled();
    trackEmailClick(request(`/trips/${TRIP}?slot=confirm_1d`), "e2eprobe-1");
    expect(recorded).toHaveBeenCalledTimes(1);
  });
});
