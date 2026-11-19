import { describe, expect, it } from "vitest";
import { FAR_PIN_KM, farPins, isRide } from "./far-pins";
import { PLACEHOLDER_POINT } from "./placeholder-point";

// Real places: three in Barcelona, one in Madrid (~505 km away), Tokyo (~10,000 km).
const at = (lat: number, lng: number) => ({ coordinates: { lat, lng } });
const BOQUERIA = at(41.382, 2.172);
const RAMBLA = at(41.381, 2.173);
const BATLLO = at(41.392, 2.165);
const MADRID = at(40.354, -3.714);
const TOKYO = at(35.714, 139.777);
const MONTSERRAT = at(41.593, 1.837);

describe("farPins", () => {
  it("is the stop farther than 300 km from every other stop of its day", () => {
    expect(FAR_PIN_KM).toBe(300);
    expect(farPins([MADRID, BOQUERIA, RAMBLA, BATLLO])).toEqual(new Set([0]));
    expect(farPins([BOQUERIA, RAMBLA, TOKYO])).toEqual(new Set([2]));
  });

  it("keeps a day trip's stop, nearer than that", () => {
    expect(farPins([BOQUERIA, MONTSERRAT, RAMBLA, BATLLO])).toEqual(new Set());
  });

  it("keeps a day split in two places that each have stops", () => {
    expect(farPins([BOQUERIA, RAMBLA, MADRID, at(40.415, -3.707)])).toEqual(new Set());
  });

  it("judges only against at least two stops that stay", () => {
    expect(farPins([BOQUERIA, MADRID])).toEqual(new Set());
    expect(farPins([BOQUERIA, MADRID, TOKYO])).toEqual(new Set());
    expect(farPins([BOQUERIA, RAMBLA, MADRID, TOKYO])).toEqual(new Set([2, 3]));
  });

  it("counts only stops with a real pin, by their place in the day", () => {
    const placeholder = { coordinates: { ...PLACEHOLDER_POINT } };
    expect(farPins([{}, BOQUERIA, { coordinates: null }, placeholder, RAMBLA, at(0, 0), MADRID])).toEqual(new Set([6]));
    expect(farPins([BOQUERIA, placeholder, MADRID])).toEqual(new Set());
  });

  it("measures the distance, not a difference of degrees", () => {
    // ~290 km due north of Barcelona: under the limit, kept.
    expect(farPins([at(43.99, 2.17), BOQUERIA, RAMBLA])).toEqual(new Set());
    // ~310 km: over it.
    expect(farPins([at(44.17, 2.17), BOQUERIA, RAMBLA])).toEqual(new Set([0]));
  });

  // Munich in the morning, the train, dinner in Berlin; or a cruise's docking with the day's stops ashore.
  it("keeps every pin of a day with a ride: it is in two places", () => {
    const munich = [at(48.177, 11.556), at(48.14, 11.558)];
    const berlin = at(52.52, 13.4);
    expect(farPins([...munich, berlin])).toEqual(new Set([2]));
    expect(farPins([munich[0], { ...munich[1], type: "transport" }, berlin])).toEqual(new Set());
    expect(farPins([{ ...munich[0], type: "Transportation" }, munich[1], berlin])).toEqual(new Set());
    expect(farPins([...munich, { coordinates: null, transport_mode: "train" }, berlin])).toEqual(new Set());
  });
});

describe("isRide", () => {
  it("is the card between two cities, or a stop the plan calls transport", () => {
    expect(isRide({ transport_mode: "flight" })).toBe(true);
    for (const type of ["transport", "Transportation", "travel", "transfer"]) expect(isRide({ type }), type).toBe(true);
    for (const type of ["attraction", "restaurant", "accommodation", undefined, null]) expect(isRide({ type }), String(type)).toBe(false);
    expect(isRide({ transport_mode: null })).toBe(false);
  });
});
