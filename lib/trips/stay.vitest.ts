import { describe, expect, it } from "vitest";
import { STAY_BOX_DEGREES } from "@/lib/places/stay-search";
import { STAY_NAME_MAX, cleanStayName, readStay, stayFarFrom } from "./stay";

/**
 * Where the traveller is staying reaches the plan's prompt as one line of their
 * words, so it is cleaned to one short line, and a stored one is read back only
 * when it is one.
 */

describe("cleanStayName", () => {
  it("makes one short line of what was typed", () => {
    expect(cleanStayName("  Memmo Alfama,\n\tTravessa  das Merceeiras\u0007 27 ")).toBe("Memmo Alfama, Travessa das Merceeiras 27");
    expect(cleanStayName("x".repeat(STAY_NAME_MAX + 50))).toHaveLength(STAY_NAME_MAX);
  });

  it("is empty for nothing, or for something that isn't words", () => {
    for (const raw of ["", "   ", "\n\t", undefined, null, 42, { name: "Alfama" }]) expect(cleanStayName(raw)).toBe("");
  });
});

describe("readStay", () => {
  it("reads a stored stay back clean, with its place when both numbers are real", () => {
    expect(readStay({ name: " Memmo  Alfama ", coordinates: { lat: 38.7111, lng: -9.1306 } })).toEqual({
      name: "Memmo Alfama",
      coordinates: { lat: 38.7111, lng: -9.1306 },
    });
    expect(readStay({ name: "Alfama" })).toEqual({ name: "Alfama" });
  });

  it("drops a place that isn't one, and keeps the name", () => {
    for (const coordinates of [{ lat: "38.7", lng: -9.1 }, { lat: 91, lng: 0 }, { lat: 0, lng: 181 }, { lat: Number.NaN, lng: 1 }, { lat: 38.7 }]) {
      expect(readStay({ name: "Alfama", coordinates })).toEqual({ name: "Alfama" });
    }
  });

  it("is nothing when there's no name", () => {
    for (const value of [null, undefined, "Alfama", { name: "  " }, { coordinates: { lat: 1, lng: 2 } }]) expect(readStay(value)).toBeNull();
  });
});

describe("stayFarFrom", () => {
  const lisbon = { latitude: 38.7223, longitude: -9.1393 };
  const alfama = { name: "Memmo Alfama", coordinates: { lat: 38.7111, lng: -9.1306 } };

  it("lets a picked stay go when the destination is now somewhere else", () => {
    expect(stayFarFrom(alfama, { latitude: 41.1579, longitude: -8.6291 })).toBe(true);
    // Évora, a city of its own a little over 100 km away.
    expect(stayFarFrom(alfama, { latitude: 38.5714, longitude: -7.9135 })).toBe(true);
  });

  it("keeps one in or near the destination", () => {
    expect(stayFarFrom(alfama, lisbon)).toBe(false);
    // Sintra is about 25 km out: a day trip, still this trip.
    expect(stayFarFrom({ name: "Sintra", coordinates: { lat: 38.8029, lng: -9.3817 } }, lisbon)).toBe(false);
  });

  it("keeps every place the search can suggest, out to the corners of its box", () => {
    // The box is widest at the equator, where a corner is about 63 km away.
    const corner = { name: "Edge of town", coordinates: { lat: STAY_BOX_DEGREES, lng: STAY_BOX_DEGREES } };
    expect(stayFarFrom(corner, { latitude: 0, longitude: 0 })).toBe(false);
  });

  it("can't tell for a typed stay or an unplaced destination, so keeps it", () => {
    expect(stayFarFrom({ name: "Alfama" }, lisbon)).toBe(false);
    expect(stayFarFrom(alfama, null)).toBe(false);
    expect(stayFarFrom(null, lisbon)).toBe(false);
  });
});
