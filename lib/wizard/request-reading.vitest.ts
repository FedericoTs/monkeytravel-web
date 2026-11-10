import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_TRIP_DAYS, MAX_TRIP_DAYS_MULTI, ROUTE_STOP_NIGHTS_MAX } from "@/lib/trips/request-limits";
import { fetchReading, fillOf, readingOf, type RequestReading } from "./request-reading";

const TODAY = "2026-11-10";

const reading = (r: Partial<RequestReading>): RequestReading => ({
  places: [],
  days: null,
  startDate: null,
  endDate: null,
  month: null,
  who: null,
  vibes: [],
  budget: null,
  ...r,
});

describe("readingOf", () => {
  it("keeps what the answer says, and nothing it leaves out", () => {
    expect(
      readingOf(
        {
          places: [{ name: " Vietnam ", days: 12 }],
          days: 12,
          start_date: "",
          end_date: "",
          month: 10,
          who: "family",
          vibes: ["foodie", "nature"],
          budget: "",
        },
        TODAY
      )
    ).toEqual(reading({ places: [{ name: "Vietnam", days: 12 }], days: 12, month: 10, who: "family", vibes: ["foodie", "nature"] }));
  });

  it("drops places a destination can't be, and days that are no length", () => {
    const r = readingOf(
      { places: [{ name: "Lyon", days: 0 }, { name: "x" }, { name: "Paris: the city of light" }, { name: "a".repeat(70) }, { name: "Geneva", days: 400 }, null as never], days: -3 },
      TODAY
    );
    expect(r.places).toEqual([{ name: "Lyon", days: null }, { name: "Geneva", days: null }]);
    expect(r.days).toBeNull();
  });

  it("takes dates from today on, in order", () => {
    expect(readingOf({ start_date: "2026-12-16", end_date: "2026-12-31" }, TODAY)).toMatchObject({ startDate: "2026-12-16", endDate: "2026-12-31" });
    expect(readingOf({ start_date: TODAY, end_date: "2026-11-12" }, TODAY)).toMatchObject({ startDate: TODAY, endDate: "2026-11-12" });
    // Past, impossible or reversed dates are no dates; a start alone stays.
    expect(readingOf({ start_date: "2026-11-01", end_date: "2026-11-05" }, TODAY)).toMatchObject({ startDate: null, endDate: null });
    expect(readingOf({ start_date: "2026-02-31", end_date: "2027-03-02" }, TODAY)).toMatchObject({ startDate: null, endDate: null });
    expect(readingOf({ start_date: "2026-12-20", end_date: "2026-12-18" }, TODAY)).toMatchObject({ startDate: "2026-12-20", endDate: null });
  });

  it("keeps the wizard's vibes, each once, as many as a trip has", () => {
    expect(readingOf({ vibes: ["foodie", "spa", "foodie", "nature", "cultural", "urban"] }, TODAY).vibes).toEqual(["foodie", "nature", "cultural"]);
    expect(readingOf({ vibes: "foodie" }, TODAY).vibes).toEqual([]);
  });

  it("knows who is going and the budget only by their names", () => {
    expect(readingOf({ who: "friends", budget: "luxury" }, TODAY)).toMatchObject({ who: "friends", budget: "luxury" });
    expect(readingOf({ who: "colleagues", budget: "cheap", month: 13 }, TODAY)).toMatchObject({ who: null, budget: null, month: null });
  });
});

const fill = (r: Partial<RequestReading>, opts: Partial<Parameters<typeof fillOf>[1]> = {}) =>
  fillOf(reading(r), { today: TODAY, multiCity: true, chosen: null, ...opts });

describe("fillOf", () => {
  it("fills nothing when no place was named", () => {
    expect(fill({ days: 7, vibes: ["wellness"] })).toBeNull();
  });

  it("pencils in a one-place trip for the days and month asked", () => {
    expect(fill({ places: [{ name: "Vietnam", days: null }], days: 10, month: 8, who: "family" })).toEqual({
      destination: "Vietnam",
      route: null,
      startDate: "2027-08-15",
      endDate: "2027-08-24",
      datesSaid: false,
      capped: null,
      intent: "group",
      vibes: [],
      budget: null,
    });
    // Neither said: five days, three weeks out.
    expect(fill({ places: [{ name: "Natal", days: null }] })).toMatchObject({ startDate: "2026-12-01", endDate: "2026-12-05" });
  });

  it("goes solo or as a group as the wizard does; a couple sets neither", () => {
    const natal = { places: [{ name: "Natal", days: null }] };
    expect(fill({ ...natal, who: "solo" })?.intent).toBe("solo");
    expect(fill({ ...natal, who: "friends" })?.intent).toBe("group");
    expect(fill({ ...natal, who: "couple" })?.intent).toBeNull();
  });

  it("keeps the most days a trip may have, and says so", () => {
    expect(fill({ places: [{ name: "Vietnam", days: 18 }], days: 18 })).toMatchObject({
      endDate: "2026-12-14",
      capped: MAX_TRIP_DAYS,
    });
    expect(fill({ places: [{ name: "Vietnam", days: null }], days: MAX_TRIP_DAYS })).toMatchObject({ endDate: "2026-12-14", capped: null });
    const route = fill({ places: [{ name: "Hanoi", days: 15 }, { name: "Saigon", days: 15 }] });
    expect(route?.capped).toBe(MAX_TRIP_DAYS_MULTI);
    expect(route?.route?.every((r) => r.nights <= ROUTE_STOP_NIGHTS_MAX)).toBe(true);
  });

  it("takes the request's dates, and the traveller's own over them", () => {
    const asked = { places: [{ name: "Valencia", days: null }], startDate: "2026-12-25", endDate: "2026-12-30" };
    expect(fill(asked)).toMatchObject({ startDate: "2026-12-25", endDate: "2026-12-30", datesSaid: true });
    expect(fill(asked, { chosen: { start: "2027-01-04", end: "2027-01-07" } })).toMatchObject({ startDate: "2027-01-04", endDate: "2027-01-07", datesSaid: true });
    // A start alone, for the days asked.
    expect(fill({ places: [{ name: "Valencia", days: null }], startDate: "2026-12-25", days: 3 })).toMatchObject({ endDate: "2026-12-27", datesSaid: true });
  });

  it("makes several places a route, each with its own days", () => {
    expect(fill({ places: [{ name: "Paris", days: 5 }, { name: "Berlin", days: 3 }, { name: "Amsterdam", days: 3 }] })).toMatchObject({
      destination: "Paris, Berlin & Amsterdam",
      route: [
        { city: "Paris", nights: 5 },
        { city: "Berlin", nights: 3 },
        { city: "Amsterdam", nights: 3 },
      ],
      startDate: "2026-12-01",
      endDate: "2026-12-11",
    });
  });

  it("fits a route to its dates: what's given, the rest shared, the last stop taking what's over", () => {
    const route = fill({
      places: [{ name: "Paris", days: 3 }, { name: "Strasbourg", days: 2 }, { name: "Berlin", days: 5 }, { name: "Budapest", days: 5 }],
      startDate: "2026-12-16",
      endDate: "2026-12-31",
    });
    expect(route?.route?.map((r) => r.nights)).toEqual([3, 2, 5, 6]);
    expect(route?.endDate).toBe("2026-12-31");
    expect(fill({ places: [{ name: "Rome", days: 4 }, { name: "Florence", days: null }, { name: "Venice", days: null }], days: 12 })?.route?.map((r) => r.nights)).toEqual([4, 4, 4]);
    // Too many days given: the longest stay gives way.
    expect(fill({ places: [{ name: "Rome", days: 6 }, { name: "Naples", days: 2 }], days: 6 })?.route?.map((r) => r.nights)).toEqual([4, 2]);
  });

  it("keeps a route to the cities a trip may have", () => {
    const route = fill({ places: ["A", "B", "C", "D", "E", "F"].map((c) => ({ name: `${c}ville`, days: null })) });
    expect(route?.route).toHaveLength(5);
  });

  it("joins several places as one destination when multi-city is off", () => {
    expect(fill({ places: [{ name: "Manali", days: null }, { name: "Kasol", days: null }] }, { multiCity: false })).toMatchObject({
      destination: "Manali & Kasol",
      route: null,
      endDate: "2026-12-05",
    });
    const many = fill({ places: Array.from({ length: 9 }, (_, i) => ({ name: `Somewhere Long Named ${String.fromCharCode(65 + i)}`, days: null })) }, { multiCity: false });
    expect(many?.destination.length).toBeLessThanOrEqual(100);
  });
});

describe("fetchReading", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is the server's reading, or null when there is none", async () => {
    const r = reading({ places: [{ name: "Lisbon", days: 4 }] });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ reading: r }), { status: 200 })));
    await expect(fetchReading("Lisbon for 4 days with friends", "en", TODAY)).resolves.toEqual(r);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 429 })));
    await expect(fetchReading("Lisbon for 4 days with friends", "en", TODAY)).resolves.toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));
    await expect(fetchReading("Lisbon for 4 days with friends", "en", TODAY)).resolves.toBeNull();
  });
});
