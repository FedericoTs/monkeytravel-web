import { describe, expect, it } from "vitest";
import { FAR_PIN_KM, farPins } from "./far-pins";
import { PLACEHOLDER_POINT } from "./placeholder-point";

// Real places: three in Barcelona, one in Madrid (~505 km away), Tokyo (~10,000 km).
const BOQUERIA = { lat: 41.382, lng: 2.172 };
const RAMBLA = { lat: 41.381, lng: 2.173 };
const BATLLO = { lat: 41.392, lng: 2.165 };
const MADRID = { lat: 40.354, lng: -3.714 };
const TOKYO = { lat: 35.714, lng: 139.777 };
const MONTSERRAT = { lat: 41.593, lng: 1.837 };

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
    expect(farPins([BOQUERIA, RAMBLA, MADRID, { lat: 40.415, lng: -3.707 }])).toEqual(new Set());
  });

  it("judges only against at least two stops that stay", () => {
    expect(farPins([BOQUERIA, MADRID])).toEqual(new Set());
    expect(farPins([BOQUERIA, MADRID, TOKYO])).toEqual(new Set());
    expect(farPins([BOQUERIA, RAMBLA, MADRID, TOKYO])).toEqual(new Set([2, 3]));
  });

  it("counts only stops with a real pin, by their place in the day", () => {
    expect(farPins([null, BOQUERIA, undefined, { ...PLACEHOLDER_POINT }, RAMBLA, { lat: 0, lng: 0 }, MADRID])).toEqual(new Set([6]));
    expect(farPins([BOQUERIA, { ...PLACEHOLDER_POINT }, MADRID])).toEqual(new Set());
  });

  it("measures the distance, not a difference of degrees", () => {
    // ~290 km due north of Barcelona: under the limit, kept.
    expect(farPins([{ lat: 43.99, lng: 2.17 }, BOQUERIA, RAMBLA])).toEqual(new Set());
    // ~310 km: over it.
    expect(farPins([{ lat: 44.17, lng: 2.17 }, BOQUERIA, RAMBLA])).toEqual(new Set([0]));
  });
});
