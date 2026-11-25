import { describe, expect, it } from "vitest";
import { closuresFor, isClosedPlace, LONG_CLOSURES, longClosuresLine, withoutLongClosures } from "./long-closures";
import { buildUserPrompt } from "./trip-prompt";
import type { TripCreationParams } from "@/types";

/**
 * Plans sent people to places shut for long works: the Centre Pompidou, closed
 * for renovation until 2030, was in nearly half the saved Paris trips ahead.
 */

const paris = { destination: "Paris, France", startDate: "2026-12-24", endDate: "2026-12-27" };
const berlin = { destination: "Berlin, Germany", startDate: "2027-03-10", endDate: "2027-03-13" };

describe("which closures a trip gets", () => {
  it("those of its city that cover every day of the trip", () => {
    expect(closuresFor(paris).map((c) => c.label)).toEqual(["Centre Pompidou (closed for renovation until 2030)"]);
    expect(closuresFor(berlin).map((c) => c.label)).toEqual(["Pergamonmuseum (closed for renovation until 4 June 2027)"]);
    expect(closuresFor({ ...paris, destination: "London, United Kingdom" })).toEqual([]);
  });

  it("in the planner's four languages", () => {
    expect(closuresFor({ ...paris, destination: "Parigi, Francia" })).toHaveLength(1);
    expect(closuresFor({ ...paris, destination: "París, Francia" })).toHaveLength(1);
    expect(closuresFor({ ...berlin, destination: "Berlino, Germania" })).toHaveLength(1);
    expect(closuresFor({ ...berlin, destination: "Berlín, Alemania" })).toHaveLength(1);
    expect(closuresFor({ ...berlin, destination: "Berlim, Alemanha" })).toHaveLength(1);
  });

  it("none when the place is open on some day of the trip, or the dates aren't dates", () => {
    // The Pergamonmuseum opens again on 4 June 2027.
    expect(closuresFor({ ...berlin, startDate: "2027-06-01", endDate: "2027-06-05" })).toEqual([]);
    expect(closuresFor({ ...berlin, startDate: "2027-06-04", endDate: "2027-06-08" })).toEqual([]);
    expect(closuresFor({ ...berlin, startDate: "2027-05-30", endDate: "2027-06-03" })).toHaveLength(1);
    // A trip that ends on the reopening day has a day it is open.
    expect(closuresFor({ ...berlin, startDate: "2027-05-31", endDate: "2027-06-04" })).toEqual([]);
    expect(closuresFor({ ...paris, startDate: "2030-02-01", endDate: "2030-02-04" })).toEqual([]);
    expect(closuresFor({ ...paris, startDate: "next week", endDate: "2026-12-27" })).toEqual([]);
  });

  it("each with the official page that gives its dates", () => {
    for (const c of LONG_CLOSURES) {
      expect(c.source).toMatch(/^https:\/\//);
      expect(c.from < c.until).toBe(true);
    }
  });
});

describe("which stops are the place", () => {
  const shut = [...closuresFor(paris), ...closuresFor(berlin)];

  it("what plans call it, in four languages", () => {
    for (const name of [
      "Centre Pompidou",
      "Centre Georges Pompidou",
      "Centre Pompidou (Musée National d'Art Moderne)",
      "Pompidou Center",
      "Centro Pompidou",
      "Pergamon Museum",
      "Pergamonmuseum",
      "Museo di Pergamo",
      "Museo de Pérgamo",
      "Museu de Pérgamo",
    ]) {
      expect(isClosedPlace(name, shut), name).toBe(true);
    }
  });

  it("never a look-alike that is open", () => {
    for (const name of [
      "Place Georges Pompidou",
      "Beaubourg and Le Marais walk",
      "Centre Pompidou-Metz",
      "Centre Pompidou Málaga",
      "Pergamonmuseum. Das Panorama",
      "Neues Museum",
      undefined,
    ]) {
      expect(isClosedPlace(name, shut), String(name)).toBe(false);
    }
  });
});

describe("telling the planner", () => {
  const params = (over: Partial<TripCreationParams> = {}): TripCreationParams =>
    ({ ...paris, budgetTier: "balanced", pace: "moderate", vibes: ["cultural"], interests: [], ...over }) as TripCreationParams;

  it("a line in the travel details, only for a trip it covers", () => {
    expect(longClosuresLine(paris)).toBe("Closed for the whole trip, never plan a visit: Centre Pompidou (closed for renovation until 2030).");
    expect(buildUserPrompt(params())).toContain(
      "- Closed for the whole trip, never plan a visit: Centre Pompidou (closed for renovation until 2030).\n"
    );
    expect(buildUserPrompt(params({ destination: "Lisbon, Portugal" }))).not.toContain("Closed for the whole trip");
  });

  it("and the place travellers kept is not offered again", () => {
    const knownPlaces = [
      { name: "Centre Pompidou", type: "museum" },
      { name: "Musée d'Orsay", type: "museum" },
    ];
    const prompt = buildUserPrompt(params(), { knownPlaces } as never);
    expect(prompt).toContain("- Musée d'Orsay (museum)");
    expect(prompt).not.toContain("- Centre Pompidou (museum)");
  });
});

describe("taking it out of a plan", () => {
  const plan = () => ({
    destination: { name: "Paris" },
    days: [
      { day_number: 1, activities: [{ name: "Louvre Museum" }, { name: "Centre Pompidou" }, { name: "Le Georges" }] },
      { day_number: 2, activities: [{ name: "Musée d'Orsay" }] },
    ],
  });

  it("drops the stop and keeps the rest, the days that didn't have it unchanged", () => {
    const before = plan();
    const { itinerary, removed } = withoutLongClosures(before, paris);
    expect(removed).toBe(1);
    expect(itinerary.days[0].activities.map((a) => a.name)).toEqual(["Louvre Museum", "Le Georges"]);
    expect(itinerary.days[1]).toBe(before.days[1]);
    expect(itinerary.destination).toBe(before.destination);
  });

  it("is the same plan for a trip nothing covers", () => {
    const before = plan();
    expect(withoutLongClosures(before, { ...paris, startDate: "2030-03-01", endDate: "2030-03-04" })).toEqual({ itinerary: before, removed: 0 });
    expect(withoutLongClosures(before, { ...paris, destination: "Rome, Italy" }).itinerary).toBe(before);
  });
});

describe("Dubai's Museum of the Future, shut since September 2026 and back in 2027 on a date not yet given", () => {
  const dubai = { destination: "Dubai, United Arab Emirates", startDate: "2026-12-12", endDate: "2026-12-16" };

  it("is kept out of a December 2026 trip, in the planner's languages", () => {
    expect(closuresFor(dubai).map((c) => c.label)).toEqual(["Museum of the Future (temporarily closed, reopening in 2027)"]);
    expect(closuresFor({ ...dubai, destination: "Dubái, Emiratos Árabes Unidos" })).toHaveLength(1);
    expect(isClosedPlace("Museum of the Future", closuresFor(dubai))).toBe(true);
    expect(isClosedPlace("Museo del Futuro", closuresFor(dubai))).toBe(true);
  });

  it("is left to a trip that reaches into 2027, when it may be open again", () => {
    expect(closuresFor({ ...dubai, startDate: "2026-12-29", endDate: "2027-01-02" })).toEqual([]);
    expect(closuresFor({ ...dubai, startDate: "2027-02-10", endDate: "2027-02-14" })).toEqual([]);
  });
});
