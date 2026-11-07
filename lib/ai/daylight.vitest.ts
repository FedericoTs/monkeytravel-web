import { describe, expect, it } from "vitest";
import { daylightFor, readCoordinates } from "./daylight";

const minutes = (clock: string | null) => {
  const [h, m] = (clock ?? "").split(":").map(Number);
  return h * 60 + m;
};

describe("the coordinates a planner sends", () => {
  it("are read when they're a real place", () => {
    expect(readCoordinates({ latitude: 48.8566, longitude: 2.3522 })).toEqual({ lat: 48.8566, lng: 2.3522 });
  });

  it.each([
    ["nothing", undefined],
    ["text", "48.8,2.3"],
    ["text numbers", { latitude: "48.8", longitude: "2.3" }],
    ["off the globe", { latitude: 91, longitude: 2 }],
    ["the empty point", { latitude: 0, longitude: 0 }],
    ["not a number", { latitude: Number.NaN, longitude: 2 }],
  ])("are ignored when they're %s", (_what, value) => {
    expect(readCoordinates(value)).toBeNull();
  });
});

describe("the sun on the trip's days", () => {
  it("is the real sunrise and sunset there, in local time", () => {
    const paris = daylightFor({ lat: 48.8566, lng: 2.3522 }, "2027-05-10", "2027-05-12")!;
    // Published: sunrise 06:16, sunset 21:17 on 10 May 2027.
    expect(Math.abs(minutes(paris.first.sunrise) - minutes("06:16"))).toBeLessThanOrEqual(4);
    expect(Math.abs(minutes(paris.first.sunset) - minutes("21:17"))).toBeLessThanOrEqual(4);
    expect(paris.last.sunset! > paris.first.sunset!).toBe(true);
  });

  it("is told plainly when the sun doesn't set", () => {
    expect(daylightFor({ lat: 69.6492, lng: 18.9553 }, "2027-06-21", "2027-06-23")!.first.polar).toBe("day");
  });

  it("isn't guessed without the place or proper dates", () => {
    expect(daylightFor(null, "2027-05-10", "2027-05-12")).toBeUndefined();
    expect(daylightFor({ lat: 48.8566, lng: 2.3522 }, "10 May", "2027-05-12")).toBeUndefined();
    expect(daylightFor({ lat: 48.8566, lng: 2.3522 }, undefined, "2027-05-12")).toBeUndefined();
  });
});

describe("a sunset after midnight", () => {
  it("reads as the early-morning clock it is", () => {
    // Reykjavik, 21 June: the sun sets a few minutes after midnight.
    expect(daylightFor({ lat: 64.1466, lng: -21.9426 }, "2027-06-21", "2027-06-21")!.first.sunset).toMatch(/^00:0\d$/);
  });
});
