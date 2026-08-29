/** @vitest-environment node */
import { describe, it, expect, vi } from "vitest";
import {
  getTripForecast,
  forecastLabel,
  tripLengthDays,
  type TripForecast,
} from "./trip-forecast";
import { tripStartCoordinate } from "./trip-coordinates";

/**
 * This module exists because the thing it replaces was confidently wrong. So
 * the bar is not "returns a number" — it is "returns a number ONLY when the
 * API gave us one, and returns nothing the rest of the time".
 *
 * Every test below that asserts `null` is guarding against reintroducing the
 * original bug in a new costume.
 */

const NOW = new Date("2026-08-29T00:00:00Z");

function mockFetch(body: unknown, ok = true) {
  return vi.fn().mockResolvedValue({
    ok,
    json: async () => body,
  }) as unknown as typeof fetch;
}

const GOOD = {
  daily: {
    time: ["2026-09-01", "2026-09-02", "2026-09-03"],
    temperature_2m_max: [30.6, 31.5, 30.5],
    temperature_2m_min: [22.0, 23.2, 23.6],
    precipitation_sum: [0, 0, 0],
  },
};

const base = {
  latitude: 34.05,
  longitude: -118.24,
  startDate: "2026-09-01",
  endDate: "2026-09-03",
  now: NOW,
};

describe("a real forecast is summarised faithfully", () => {
  it("reports the true min and max across the trip", async () => {
    const f = await getTripForecast({ ...base, fetchImpl: mockFetch(GOOD) });
    // The numbers Open-Meteo actually returned for Los Angeles that week —
    // against the "10-18°C" we emailed a user for the same trip.
    expect(f).toEqual({
      minC: 22,
      maxC: 32,
      days: 3,
      wetDays: 0,
      firstDay: { date: "2026-09-01", minC: 22, maxC: 31 },
    });
  });

  it("counts only days with meaningful rain", async () => {
    const f = await getTripForecast({
      ...base,
      fetchImpl: mockFetch({
        daily: {
          ...GOOD.daily,
          // 0.2mm is a damp pavement, not a wet day. 1mm is the threshold.
          precipitation_sum: [0.2, 4.1, 12.0],
        },
      }),
    });
    expect(f?.wetDays).toBe(2);
  });

  it("uses a partial window rather than discarding it", async () => {
    // Open-Meteo returns null for a day it cannot serve. Coercing those to 0
    // would report a freezing trip; skipping keeps the rest usable.
    const f = await getTripForecast({
      ...base,
      fetchImpl: mockFetch({
        daily: {
          time: ["2026-09-01", "2026-09-02", "2026-09-03"],
          temperature_2m_max: [30.6, null, 30.5],
          temperature_2m_min: [22.0, null, 23.6],
          precipitation_sum: [0, null, 0],
        },
      }),
    });
    expect(f?.days).toBe(2);
    expect(f?.minC).toBe(22);
    expect(f?.maxC).toBe(31);
  });

  it("requests only the trip's own dates", async () => {
    const f = mockFetch(GOOD);
    await getTripForecast({ ...base, fetchImpl: f });
    const url = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain("start_date=2026-09-01");
    expect(url).toContain("end_date=2026-09-03");
    expect(url).toContain("latitude=34.05");
  });

  it("clamps a start date already in the past to today", async () => {
    // morning_of fires on the travel day, so the trip has begun. Asking for
    // yesterday would be rejected by the API.
    const f = mockFetch(GOOD);
    await getTripForecast({
      ...base,
      startDate: "2026-08-20",
      endDate: "2026-09-02",
      fetchImpl: f,
    });
    const url = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain("start_date=2026-08-29");
  });

  it("clamps an end date beyond the 16-day horizon", async () => {
    const f = mockFetch(GOOD);
    await getTripForecast({
      ...base,
      startDate: "2026-09-01",
      endDate: "2026-12-25",
      fetchImpl: f,
    });
    const url = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    // 2026-08-29 + 15 days.
    expect(url).toContain("end_date=2026-09-13");
  });
});

describe("every failure is silence, never a guess", () => {
  it("returns null for a trip entirely beyond the horizon", async () => {
    const f = vi.fn();
    const out = await getTripForecast({
      ...base,
      startDate: "2027-06-01",
      endDate: "2027-06-10",
      fetchImpl: f as unknown as typeof fetch,
    });
    expect(out).toBeNull();
    // And it did not waste a call finding that out.
    expect(f).not.toHaveBeenCalled();
  });

  it("returns null on Open-Meteo's error BODY, which arrives with a 200", async () => {
    // Verified against the live API: an out-of-range date returns
    // {"error":true,"reason":"Parameter 'start_date' is out of allowed range"}
    // rather than an error status. Trusting res.ok alone would sail past it.
    const out = await getTripForecast({
      ...base,
      fetchImpl: mockFetch({ error: true, reason: "out of allowed range" }),
    });
    expect(out).toBeNull();
  });

  it("returns null on a non-200", async () => {
    expect(
      await getTripForecast({ ...base, fetchImpl: mockFetch(GOOD, false) })
    ).toBeNull();
  });

  it("returns null when the fetch throws or times out", async () => {
    const boom = vi.fn().mockRejectedValue(new Error("aborted"));
    expect(
      await getTripForecast({ ...base, fetchImpl: boom as unknown as typeof fetch })
    ).toBeNull();
  });

  it("returns null on a malformed payload rather than throwing", async () => {
    for (const junk of [null, {}, { daily: null }, { daily: {} }, { daily: { time: "x" } }, 42]) {
      expect(
        await getTripForecast({ ...base, fetchImpl: mockFetch(junk) }),
        JSON.stringify(junk)
      ).toBeNull();
    }
  });

  it("returns null when every day in the window is null", async () => {
    const out = await getTripForecast({
      ...base,
      fetchImpl: mockFetch({
        daily: {
          time: ["2026-09-01"],
          temperature_2m_max: [null],
          temperature_2m_min: [null],
          precipitation_sum: [null],
        },
      }),
    });
    expect(out).toBeNull();
  });

  it("rejects impossible coordinates without calling out", async () => {
    const f = vi.fn();
    for (const c of [
      { latitude: 91, longitude: 0 },
      { latitude: 0, longitude: 181 },
      { latitude: NaN, longitude: 0 },
    ]) {
      expect(
        await getTripForecast({ ...base, ...c, fetchImpl: f as unknown as typeof fetch })
      ).toBeNull();
    }
    expect(f).not.toHaveBeenCalled();
  });

  it("returns null on unparseable dates", async () => {
    expect(
      await getTripForecast({
        ...base,
        startDate: "not-a-date",
        fetchImpl: mockFetch(GOOD),
      })
    ).toBeNull();
  });
});

describe("tripStartCoordinate", () => {
  const itinerary = [
    { activities: [{ name: "No coords" }, { name: "Louvre", coordinates: { lat: 48.86, lng: 2.33 } }] },
    { activities: [{ name: "Later", coordinates: { lat: 1, lng: 1 } }] },
  ];

  it("takes the first usable coordinate, in order", () => {
    // Day one is where the traveller starts — and what confirm_1d and
    // morning_of are literally about.
    expect(tripStartCoordinate(itinerary)).toEqual({ latitude: 48.86, longitude: 2.33 });
  });

  it("accepts numeric strings, which is how jsonb hands them back", () => {
    expect(
      tripStartCoordinate([{ activities: [{ coordinates: { lat: "55.94957", lng: "-3.1975" } }] }])
    ).toEqual({ latitude: 55.94957, longitude: -3.1975 });
  });

  it("accepts the long key spellings", () => {
    expect(
      tripStartCoordinate([{ activities: [{ coordinates: { latitude: 10, longitude: 20 } }] }])
    ).toEqual({ latitude: 10, longitude: 20 });
  });

  it("skips Null Island", () => {
    // (0,0) is a real point in the Atlantic and in practice always means a
    // missing value. A forecast for open ocean is worse than no forecast.
    expect(
      tripStartCoordinate([
        { activities: [{ coordinates: { lat: 0, lng: 0 } }] },
        { activities: [{ coordinates: { lat: 41.12, lng: 16.87 } }] },
      ])
    ).toEqual({ latitude: 41.12, longitude: 16.87 });
  });

  it("skips out-of-range values", () => {
    expect(
      tripStartCoordinate([{ activities: [{ coordinates: { lat: 999, lng: 2 } }] }])
    ).toBeNull();
  });

  it("returns null for anything unparseable, without throwing", () => {
    for (const junk of [null, undefined, 42, "x", {}, [], [null], [{ activities: "no" }], [{ activities: [null, 3] }]]) {
      expect(() => tripStartCoordinate(junk), JSON.stringify(junk)).not.toThrow();
      expect(tripStartCoordinate(junk), JSON.stringify(junk)).toBeNull();
    }
  });
});

describe("the timeout actually fires", () => {
  /**
   * The mocked-rejection test above proves we handle a failed fetch. It does
   * NOT prove the AbortController ever fires — a broken timeout would pass it
   * and then hang the cron in production, where up to 200 rows share one 60s
   * function. This is the test that backs that claim.
   */
  it("gives up on a hanging request instead of waiting forever", async () => {
    let aborted = false;
    const hang: typeof fetch = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          aborted = true;
          reject(new DOMException("aborted", "AbortError"));
        });
      })) as unknown as typeof fetch;

    const started = performance.now();
    const out = await getTripForecast({ ...base, fetchImpl: hang });
    const elapsed = performance.now() - started;

    expect(out).toBeNull();
    expect(aborted).toBe(true);
    // TIMEOUT_MS is 2500. Anything past ~4s means the guard is not working.
    expect(elapsed).toBeLessThan(4000);
  }, 10_000);

  it("does not leave a timer holding the process open on the happy path", async () => {
    // clearTimeout lives in a `finally`. If it regressed, a fast success would
    // still keep a 2.5s timer alive per call — 200 of them per cron run.
    const started = performance.now();
    await getTripForecast({ ...base, fetchImpl: mockFetch(GOOD) });
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

describe("tripStartCoordinate resists a hallucinated point", () => {
  it("ignores an outlier that the first-activity rule would have picked", () => {
    // The real "Taipei Trip" day one, verbatim. Elephant Mountain's longitude
    // is right and its latitude is not — it lands 300km away in mainland
    // China, and it is the FIRST activity, so the previous rule chose it and
    // would have fetched a real forecast for the wrong country.
    const day1 = {
      activities: [
        { name: "Elephant Mountain (Xiangshan) Hike", coordinates: { lat: 27.767, lng: 121.57 } },
        { name: "Dinner at Din Tai Fung", coordinates: { lat: 25.034, lng: 121.565 } },
        { name: "Stroll through Xinyi", coordinates: { lat: 25.034, lng: 121.565 } },
      ],
    };
    const c = tripStartCoordinate([day1])!;
    expect(c.latitude).toBe(25.034);
    // Taipei, not Zhejiang.
    expect(Math.abs(c.latitude - 25.03)).toBeLessThan(0.5);
  });

  it("returns a real observation, never an average of two", () => {
    // An average would invent a point in between; the median is always a
    // place that appears in the itinerary.
    const c = tripStartCoordinate([
      { activities: [
        { coordinates: { lat: 10, lng: 10 } },
        { coordinates: { lat: 20, lng: 20 } },
      ] },
    ])!;
    expect([10, 20]).toContain(c.latitude);
  });

  it("uses the single point when a day has only one", () => {
    expect(
      tripStartCoordinate([{ activities: [{ coordinates: { lat: 55.95, lng: -3.19 } }] }])
    ).toEqual({ latitude: 55.95, longitude: -3.19 });
  });

  it("falls through to a later day when day one carries no coordinates", () => {
    expect(
      tripStartCoordinate([
        { activities: [{ name: "Arrive" }] },
        { activities: [{ coordinates: { lat: 41.12, lng: 16.87 } }] },
      ])
    ).toEqual({ latitude: 41.12, longitude: 16.87 });
  });

  it("does not straddle the antimeridian", () => {
    // -179 and 179 are neighbours; their median is 0, which is the Atlantic.
    const c = tripStartCoordinate([
      { activities: [
        { coordinates: { lat: -17.7, lng: 179.0 } },
        { coordinates: { lat: -17.8, lng: -179.9 } },
      ] },
    ])!;
    expect(Math.abs(c.longitude)).toBeGreaterThan(170);
  });
});

describe("forecastLabel states the scope it can actually see", () => {
  const fc = (days: number): TripForecast => ({
    minC: 10, maxC: 20, days, wetDays: 0, firstDay: null,
  });

  it("claims the whole trip only when it covers the whole trip", () => {
    expect(forecastLabel(fc(5), 5)).toEqual({ key: "weather" });
    expect(forecastLabel(fc(9), 5)).toEqual({ key: "weather" });
  });

  it("names the covered days when the horizon falls short", () => {
    // pack_early_14d fires 14 days out against a 16-day horizon, so 120 of
    // 122 queued rows look like this — a 2-day window under a heading that
    // used to say "while you're there".
    expect(forecastLabel(fc(2), 10)).toEqual({
      key: "weatherFirstDays",
      values: { days: 2 },
    });
  });

  it("does not claim the whole trip when the trip length is unknown", () => {
    expect(forecastLabel(fc(3), null)).toEqual({
      key: "weatherFirstDays",
      values: { days: 3 },
    });
  });
});

describe("tripLengthDays", () => {
  it("counts inclusively", () => {
    expect(tripLengthDays("2026-09-01", "2026-09-05")).toBe(5);
    expect(tripLengthDays("2026-09-01", "2026-09-01")).toBe(1);
  });

  it("returns null for unusable dates rather than a wrong number", () => {
    expect(tripLengthDays("2026-09-05", "2026-09-01")).toBeNull();
    expect(tripLengthDays("nope", "2026-09-01")).toBeNull();
  });
});
