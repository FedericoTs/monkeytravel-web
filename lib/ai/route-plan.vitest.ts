import { describe, expect, it } from "vitest";
import { routeFor, routeQuestion } from "./route-plan";

const stop = (name: string, days: number, country = "Thailand") => ({ name, country, days });

describe("routeFor", () => {
  it("offers the bases in order when they make a route the planner takes", () => {
    const answer = { stops: [stop("Bangkok", 3), stop("Chiang Mai", 4), stop("Phuket", 4), stop("Ko Phi Phi", 3)] };
    expect(routeFor(answer, "Thailand", 14).map((s) => [s.name, s.days])).toEqual([
      ["Bangkok", 3],
      ["Chiang Mai", 4],
      ["Phuket", 4],
      ["Ko Phi Phi", 3],
    ]);
  });

  it("offers nothing for one base: a city stays the place typed", () => {
    expect(routeFor({ stops: [stop("Tokyo", 10, "Japan")] }, "Tokyo", 10)).toEqual([]);
    expect(routeFor({ stops: [] }, "Goa", 5)).toEqual([]);
  });

  it("offers nothing when a base is the typed place itself", () => {
    const answer = { stops: [stop("Thailand", 7), stop("Phuket", 7)] };
    expect(routeFor(answer, "Thailand", 14)).toEqual([]);
  });

  it("keeps the places of a typed list, which are the bases", () => {
    const answer = { stops: [stop("Lisbon", 3, "Portugal"), stop("Porto", 3, "Portugal"), stop("Albufeira", 2, "Portugal")] };
    expect(routeFor(answer, "Lisbon, Porto & Algarve", 8).map((s) => s.name)).toEqual(["Lisbon", "Porto", "Albufeira"]);
  });

  it("offers nothing when the days don't add up to the trip's, or a base is too long or unnamed", () => {
    expect(routeFor({ stops: [stop("Bangkok", 3), stop("Chiang Mai", 4)] }, "Thailand", 14)).toEqual([]);
    expect(routeFor({ stops: [stop("Bangkok", 3), stop("Phuket", 11)] }, "Thailand", 14)).toEqual([]);
    expect(routeFor({ stops: [stop("", 7), stop("Phuket", 7)] }, "Thailand", 14)).toEqual([]);
    expect(routeFor(null, "Thailand", 14)).toEqual([]);
    expect(routeFor({ stops: "Bangkok" }, "Thailand", 14)).toEqual([]);
  });

  it("offers nothing for more than five bases", () => {
    const six = ["A1", "B2", "C3", "D4", "E5", "F6"].map((n) => stop(`City ${n.toLowerCase()}`, 2));
    expect(routeFor({ stops: six }, "Thailand", 12)).toEqual([]);
  });
});

describe("routeQuestion", () => {
  it("names the place, the days, the month and the language of the answer", () => {
    const q = routeQuestion("Tailandia", 12, 8, "es");
    expect(q).toContain('12 days to "Tailandia", in August');
    expect(q).toContain("Spanish");
    expect(q).toContain("The days add up to 12");
  });

  it("leaves the month out when it isn't known", () => {
    expect(routeQuestion("Japan", 10, null, "en")).toContain('10 days to "Japan", and wants');
    expect(routeQuestion("Japan", 10, 13, "en")).toContain('10 days to "Japan", and wants');
  });
});
