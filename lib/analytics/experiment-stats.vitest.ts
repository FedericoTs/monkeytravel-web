import { describe, it, expect } from "vitest";
import {
  wilson,
  twoProportionP,
  requiredN,
  verdict,
  formatRate,
} from "./experiment-stats";

describe("wilson", () => {
  it("brackets the point estimate", () => {
    const r = wilson(745 * 0.745, 745);
    expect(r.low).toBeLessThan(r.point);
    expect(r.high).toBeGreaterThan(r.point);
    expect(r.point).toBeCloseTo(0.745, 3);
  });

  it("is wide at the sample size the review actually has", () => {
    // The whole reason this module exists: 69% on n=42 is not a finding.
    const r = wilson(29, 42);
    expect(r.point).toBeCloseTo(0.690, 2);
    expect((r.high - r.low) * 100).toBeGreaterThan(25);
  });

  it("narrows as n grows", () => {
    const small = wilson(70, 100);
    const large = wilson(700, 1000);
    expect(large.high - large.low).toBeLessThan(small.high - small.low);
  });

  it("stays inside [0,1] at the extremes", () => {
    // The naive interval goes negative here, and collapses to zero width —
    // precisely when a reviewer is most tempted to over-read.
    const none = wilson(0, 20);
    expect(none.low).toBe(0);
    expect(none.high).toBeGreaterThan(0);

    const all = wilson(20, 20);
    expect(all.high).toBe(1);
    expect(all.low).toBeLessThan(1);
  });

  it("says nothing when there is nothing", () => {
    const r = wilson(5, 0);
    expect(r).toEqual({ successes: 0, n: 0, point: 0, low: 0, high: 1 });
  });

  it("never lets successes exceed n", () => {
    expect(wilson(50, 10).point).toBe(1);
  });
});

describe("twoProportionP", () => {
  it("finds no difference between identical rates", () => {
    expect(twoProportionP(50, 100, 50, 100)).toBeCloseTo(1, 6);
  });

  it("does NOT call the real step-1 comparison significant", () => {
    // 74.5% (n=745) vs 69.0% (n=42) — the actual numbers on review day.
    const p = twoProportionP(555, 745, 29, 42);
    expect(p).toBeGreaterThan(0.05);
  });

  it("detects a large, well-powered difference", () => {
    expect(twoProportionP(500, 1000, 700, 1000)).toBeLessThan(0.001);
  });

  it("returns 1 rather than NaN for an empty arm", () => {
    expect(twoProportionP(10, 0, 5, 50)).toBe(1);
    expect(twoProportionP(10, 50, 5, 0)).toBe(1);
  });

  it("returns 1 rather than NaN when both arms are degenerate", () => {
    // se is 0 here; a NaN in a review reads as a missing result and someone
    // fills the gap with their prior.
    expect(twoProportionP(0, 30, 0, 30)).toBe(1);
    expect(twoProportionP(30, 30, 30, 30)).toBe(1);
  });

  it("is symmetric", () => {
    expect(twoProportionP(60, 100, 40, 100)).toBeCloseTo(
      twoProportionP(40, 100, 60, 100),
      12
    );
  });
});

describe("requiredN", () => {
  it("needs more sessions for a smaller effect", () => {
    expect(requiredN(0.745, 0.02)).toBeGreaterThan(requiredN(0.745, 0.10));
  });

  it("shows the 2026-09-09 review date is too early", () => {
    // This assertion is the finding, not a bound I guessed: resolving a 5pp
    // move against the 74.5% baseline needs ~597 dwelled sessions in the new
    // arm. Post-ship supplies ~40/day (42 in the first 25h), so that is about
    // 15 days from the 2026-09-02 ship — the 09-09 review lands at ~280,
    // enough for ~7pp and no finer. Decide on 09-09 knowing that, or extend.
    expect(requiredN(0.745, 0.05)).toBe(597);
    expect(requiredN(0.745, 0.073)).toBeLessThanOrEqual(280);
  });

  it("refuses to schedule the undetectable", () => {
    // "How long until we can detect no difference" has no answer, and a big
    // finite number here would be read as a date.
    expect(requiredN(0.745, 0)).toBe(Infinity);
  });

  it("ignores the sign of the effect", () => {
    expect(requiredN(0.5, -0.05)).toBe(requiredN(0.5, 0.05));
  });
});

describe("verdict", () => {
  const base = wilson(555, 745);

  it("is inconclusive for the real step-1 numbers", () => {
    const cand = wilson(29, 42);
    const p = twoProportionP(555, 745, 29, 42);
    expect(verdict(base, cand, p)).toBe("inconclusive");
  });

  it("calls a significant improvement better", () => {
    expect(verdict(wilson(500, 1000), wilson(700, 1000), 0.0001)).toBe("better");
  });

  it("calls a significant regression worse", () => {
    expect(verdict(wilson(700, 1000), wilson(500, 1000), 0.0001)).toBe("worse");
  });

  it("is inconclusive with no data, whatever p says", () => {
    expect(verdict(base, wilson(0, 0), 0.0001)).toBe("inconclusive");
  });
});

describe("formatRate", () => {
  it("never prints a rate without its interval", () => {
    const s = formatRate(wilson(29, 42));
    expect(s).toMatch(/69\.0%/);
    expect(s).toMatch(/\[.*–.*\]/);
    expect(s).toMatch(/n=42/);
  });

  it("says so when there is no data", () => {
    expect(formatRate(wilson(0, 0))).toBe("n/a (no sessions)");
  });
});
