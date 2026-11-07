import { describe, expect, it } from "vitest";
import { skyGradient, timeAtY } from "./layout";
import type { Rgb } from "./sky";

describe("where a moment sits on the page", () => {
  const points = [
    { y: 0, t: 600 },
    { y: 100, t: 700 },
    { y: 300, t: 1300 },
  ];

  it("is in between the moments placed around it", () => {
    expect(timeAtY(points, 50)).toBe(650);
    expect(timeAtY(points, 200)).toBe(1000);
  });

  it("holds the first and last moments beyond them", () => {
    expect(timeAtY(points, -20)).toBe(600);
    expect(timeAtY(points, 900)).toBe(1300);
  });

  it("doesn't divide by zero where two moments share a height", () => {
    expect(timeAtY([{ y: 0, t: 0 }, { y: 100, t: 60 }, { y: 100, t: 90 }], 100)).toBe(60);
  });
});

describe("the sky behind the plan", () => {
  const day: Rgb = [169, 220, 249];
  const night: Rgb = [13, 20, 51];
  const colorAt = (t: number): Rgb => (t < 1200 ? day : night);

  it("ends on the page's own colour, so what follows the plan isn't on the sky", () => {
    const { background } = skyGradient([{ y: 0, t: 600 }, { y: 400, t: 900 }], 1000, colorAt, "rgb(1 2 3)");
    expect(background.startsWith("linear-gradient(to bottom, ")).toBe(true);
    expect(background.endsWith("rgb(1 2 3) 1000px)")).toBe(true);
  });

  it("marks the dark stretches for stars, and only those", () => {
    const { nights } = skyGradient([{ y: 0, t: 600 }, { y: 400, t: 1100 }, { y: 800, t: 1400 }], 1600, colorAt, "white");
    expect(nights.length).toBe(1);
    expect(nights[0].top).toBeGreaterThan(400);
    expect(nights[0].top).toBeLessThan(800);
  });

  it("has no stars on a plan that ends before dark", () => {
    expect(skyGradient([{ y: 0, t: 600 }, { y: 500, t: 1000 }], 900, colorAt, "white").nights).toEqual([]);
  });
});
