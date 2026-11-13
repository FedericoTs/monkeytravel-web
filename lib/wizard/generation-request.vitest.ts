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
  stay: null,
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
      tripIntent: "solo",
      locale: "pt",
    });
    expect([stream, isMultiCity, isAnchored]).toEqual([true, false, false]);
  });

  it("leaves out who's coming when nobody answered", () => {
    const { body } = generationRequest({ ...answers, tripIntent: "unspecified" }, extra);
    expect(body).not.toHaveProperty("tripIntent");
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

  it("sends where they're staying, and where that is when it was picked, on a one-city trip only", () => {
    const stay = { name: "Memmo Alfama", coordinates: { lat: 38.7111, lng: -9.1306 } };
    const picked = generationRequest({ ...answers, stay }, extra).body;
    expect(picked.stay).toBe("Memmo Alfama");
    expect(picked.stayCoords).toEqual({ latitude: 38.7111, longitude: -9.1306 });
    const typed = generationRequest({ ...answers, stay: { name: "Alfama" } }, extra).body;
    expect(typed.stay).toBe("Alfama");
    expect(typed).not.toHaveProperty("stayCoords");
    expect(generationRequest(answers, extra).body).not.toHaveProperty("stay");
    const route = generationRequest({ ...answers, stay }, {
      ...extra,
      legs: [
        { city: "Lisbon", nights: 3 },
        { city: "Porto", nights: 2 },
      ],
    }).body;
    expect(route).not.toHaveProperty("stay");
    expect(route).not.toHaveProperty("stayCoords");
  });

  it("sends where the place is, for its sunrise and sunset, on a one-city trip only", () => {
    const coordinates = { latitude: 38.7223, longitude: -9.1393 };
    expect(generationRequest(answers, { ...extra, coordinates }).body.destinationCoords).toEqual(coordinates);
    expect(generationRequest(answers, extra).body).not.toHaveProperty("destinationCoords");
    const route = generationRequest(answers, {
      ...extra,
      coordinates,
      legs: [
        { city: "Rome", nights: 3 },
        { city: "Venice", nights: 2 },
      ],
    });
    expect(route.body).not.toHaveProperty("destinationCoords");
  });

  it("plans a route with one filled leg as a one-city trip", () => {
    const { body, isMultiCity } = generationRequest(answers, { ...extra, legs: [{ city: "Rome", nights: 3 }] });
    expect(body).not.toHaveProperty("destinations");
    expect(isMultiCity).toBe(false);
  });
});
