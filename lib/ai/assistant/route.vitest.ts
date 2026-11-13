/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { planRoute, readRoute, routeLabel, routeRows } from "./route";

const stop = (name: string, days: number, country = "Portugal") => ({ name, country, days });

describe("readRoute: a route the page can plan", () => {
  const current = ["Lisboa", "Porto"];

  it("takes a return to the first city, the days adding up to the trip's", () => {
    expect(readRoute([stop("Lisboa", 4), stop("Porto", 4), stop("Lisboa", 6)], 14, current)).toEqual([
      stop("Lisboa", 4),
      stop("Porto", 4),
      stop("Lisboa", 6),
    ]);
  });

  it("refuses days that don't add up to the trip's, or a stop out of bounds", () => {
    expect(readRoute([stop("Lisboa", 4), stop("Porto", 4), stop("Lisboa", 5)], 14, current)).toEqual([]);
    expect(readRoute([stop("Lisboa", 0), stop("Porto", 14)], 14, current)).toEqual([]);
    expect(readRoute([stop("Lisboa", 3), stop("Porto", 11)], 14, current)).toEqual([]);
    expect(readRoute([stop("Lisboa", 2.6), stop("Porto", 11.4)], 14, current)).toEqual([]);
  });

  it("refuses one stop, more than a trip may have, or the same place twice running", () => {
    expect(readRoute([stop("Lisboa", 7)], 7, current)).toEqual([]);
    expect(readRoute(Array.from({ length: 6 }, (_, i) => stop(`City ${String.fromCharCode(65 + i)}`, 2)), 12, current)).toEqual([]);
    expect(readRoute([stop("Lisboa", 4), stop("lisboa", 4), stop("Porto", 6)], 14, current)).toEqual([]);
  });

  it("offers nothing when it is the plan's own route", () => {
    expect(readRoute([stop("Lisboa", 7), stop("Porto", 7)], 14, current)).toEqual([]);
    expect(readRoute([stop("lisboa", 5), stop("PORTO", 9)], 14, current)).toEqual([]);
  });

  it("refuses names the destination field wouldn't take, and anything not a list of stops", () => {
    expect(readRoute([stop("L", 7), stop("Porto", 7)], 14, current)).toEqual([]);
    expect(readRoute([stop("Lisboa <script>", 7), stop("Porto", 7)], 14, current)).toEqual([]);
    expect(readRoute("Lisboa, Porto", 14, current)).toEqual([]);
    expect(readRoute([null, stop("Porto", 14)], 14, current)).toEqual([]);
  });
});

describe("a route's other forms", () => {
  const route = [stop("Lisboa", 4), stop("Porto", 4), stop("Lisboa", 6)];

  it("reads as its stops in order", () => {
    expect(routeLabel(route)).toBe("Lisboa → Porto → Lisboa");
  });

  it("becomes the wizard's multi-city rows, as the request reader fills them", () => {
    expect(routeRows(route)).toEqual([
      { city: "Lisboa", nights: 4 },
      { city: "Porto", nights: 4 },
      { city: "Lisboa", nights: 6 },
    ]);
  });

  it("is read from a plan's days, one stop per stay", () => {
    const days = [..."LLLPPLL"].map((c) => ({ city: c === "L" ? "Lisboa, Portugal" : "Porto" }));
    expect(planRoute(days)).toEqual(["Lisboa", "Porto", "Lisboa"]);
    expect(planRoute([{}, {}])).toEqual([]);
  });
});
