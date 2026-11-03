import { describe, expect, it } from "vitest";
import type { WizardAnswers } from "./answers";
import { generationRequest, routeLegs } from "./generation-request";

const answers: WizardAnswers = {
  destination: "Lisbon, Portugal",
  startDate: "2027-05-10",
  endDate: "2027-05-14",
  pace: "relaxed",
  vibes: ["foodie"],
  budgetTier: "premium",
  travelStyle: "backpacker",
  anchors: [],
  mustDos: [],
  dietary: [],
  tripIntent: "solo",
  flexibleDates: false,
};
const extra = { legs: [], interests: ["food"], seasonalContext: null, requirements: "", locale: "pt" };
const anchor = { id: "a1", type: "transport" as const, title: "Land at LIS 09:40", date: "2027-05-10" };

describe("routeLegs", () => {
  it("keeps the rows with a city and nights, trimmed", () => {
    expect(
      routeLegs([
        { city: " Rome ", nights: 3 },
        { city: "", nights: 2 },
        { city: "Florence", nights: 0 },
        { city: "Venice", nights: 2 },
      ])
    ).toEqual([
      { city: "Rome", nights: 3 },
      { city: "Venice", nights: 2 },
    ]);
  });
});

describe("generationRequest", () => {
  it("streams a one-city trip, with only the answers it has", () => {
    const { body, stream, isMultiCity, isAnchored } = generationRequest(answers, extra);
    expect(JSON.parse(JSON.stringify(body))).toEqual({
      destination: "Lisbon, Portugal",
      startDate: "2027-05-10",
      endDate: "2027-05-14",
      budgetTier: "premium",
      pace: "relaxed",
      vibes: ["foodie"],
      interests: ["food"],
      travelStyle: "backpacker",
      locale: "pt",
    });
    expect([stream, isMultiCity, isAnchored]).toEqual([true, false, false]);
  });

  it("sends wishes, diets, the requirements, the season and a fresh ask when there are some", () => {
    const season = { season: "spring" } as unknown as NonNullable<Parameters<typeof generationRequest>[1]["seasonalContext"]>;
    const { body } = generationRequest(
      { ...answers, mustDos: ["Tram 28"], dietary: ["vegan"] },
      { ...extra, requirements: "step-free", seasonalContext: season, fresh: true }
    );
    expect(body).toMatchObject({ mustDos: ["Tram 28"], dietary: ["vegan"], requirements: "step-free", seasonalContext: season, fresh: true });
  });

  it("plans an anchored trip around its anchors, as one JSON body", () => {
    const { body, stream, isAnchored } = generationRequest({ ...answers, anchors: [anchor] }, extra);
    expect(body.anchors).toEqual([anchor]);
    expect([stream, isAnchored]).toEqual([false, true]);
  });

  it("fans a route of more than one leg out per city and leaves stale anchors out", () => {
    const legs = [
      { city: "Rome", nights: 3 },
      { city: "Venice", nights: 2 },
    ];
    const { body, stream, isMultiCity, isAnchored } = generationRequest({ ...answers, anchors: [anchor] }, { ...extra, legs });
    expect(body.destinations).toEqual(legs);
    expect(body).not.toHaveProperty("anchors");
    expect([stream, isMultiCity, isAnchored]).toEqual([false, true, false]);
  });

  it("plans a route with one filled leg as a one-city trip", () => {
    const { body, isMultiCity } = generationRequest(answers, { ...extra, legs: [{ city: "Rome", nights: 3 }] });
    expect(body).not.toHaveProperty("destinations");
    expect(isMultiCity).toBe(false);
  });
});
