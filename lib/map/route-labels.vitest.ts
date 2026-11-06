import { describe, expect, it } from "vitest";
import { legsToLabel, type LabelledLeg } from "./route-labels";

const leg = (key: string, from: [number, number], to: [number, number], minutes = 10): LabelledLeg => ({
  key,
  from: { lat: from[0], lng: from[1] },
  to: { lat: to[0], lng: to[1] },
  mid: { lat: (from[0] + to[0]) / 2, lng: (from[1] + to[1]) / 2 },
  minutes,
});

// Paris. At zoom 13 a pixel is about 12 m here, and 0.01° of longitude about 57 px.
const LOUVRE: [number, number] = [48.8606, 2.3376];

describe("which legs get a label", () => {
  it("none until the map's zoom is known", () => {
    const legs = [leg("a", LOUVRE, [48.8606, 2.38])];
    expect([...legsToLabel(legs, null)]).toEqual([]);
    expect([...legsToLabel(legs, undefined)]).toEqual([]);
  });

  it("a leg long enough on screen for a label between its pins", () => {
    expect([...legsToLabel([leg("long", LOUVRE, [48.8606, 2.38])], 13)]).toEqual(["long"]);
  });

  it("not a leg so short its label would sit on the pins, until zoomed in", () => {
    const short = [leg("short", LOUVRE, [48.8606, 2.345])];
    expect([...legsToLabel(short, 13)]).toEqual([]);
    expect([...legsToLabel(short, 15)]).toEqual(["short"]);
  });

  it("measures the leg in any direction", () => {
    expect([...legsToLabel([leg("north", LOUVRE, [48.88, 2.3376])], 13)]).toEqual(["north"]);
  });

  it("one of two labels that would touch: the longer walk", () => {
    const legs = [leg("near", LOUVRE, [48.8606, 2.38], 10), leg("far", [48.861, 2.3376], [48.861, 2.3802], 25)];
    expect([...legsToLabel(legs, 13)]).toEqual(["far"]);
  });

  it("both, once zoomed in far enough that they don't", () => {
    const legs = [leg("near", LOUVRE, [48.8606, 2.38], 10), leg("far", [48.8616, 2.3376], [48.8616, 2.38], 25)];
    expect(legsToLabel(legs, 13).size).toBe(1);
    expect(legsToLabel(legs, 16).size).toBe(2);
  });

  it("both, when they're side by side with room between", () => {
    const legs = [leg("west", LOUVRE, [48.8606, 2.3626]), leg("east", [48.8606, 2.3656], [48.8606, 2.3906])];
    expect(legsToLabel(legs, 13).size).toBe(2);
  });

  it("nothing from nothing", () => {
    expect(legsToLabel([], 13).size).toBe(0);
  });
});
