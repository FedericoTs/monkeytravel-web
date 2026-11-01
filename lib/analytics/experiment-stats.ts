/**
 * The small amount of statistics a flag review needs, so a number is never
 * mistaken for a verdict.
 *
 * WHY THIS EXISTS
 * ---------------
 * A raw before/after rate can point the wrong way: a polluted denominator
 * makes a fake win, and a gap of a few points on a few dozen sessions is
 * noise. Printing an interval next to every rate avoids both errors, which is
 * all this module is for.
 *
 * Everything here is a pure function of counts so it can be unit-tested, and
 * deliberately plain: a normal approximation, no dependencies, no simulation.
 */

/** A proportion with a confidence interval. Bounds are clamped to [0, 1]. */
export interface Rate {
  successes: number;
  n: number;
  /** successes / n, or 0 when n is 0. */
  point: number;
  low: number;
  high: number;
}

/** z for a two-sided 95% interval. */
const Z_95 = 1.959964;
/** z for 80% power. */
const Z_POWER_80 = 0.841621;

/**
 * Wilson score interval — not the textbook normal approximation.
 *
 * At the sample sizes a flag review actually has (n=42 here) the naive
 * interval misbehaves badly: it can run past 0 or 1 and it collapses to zero
 * width when a rate hits 0% or 100%, which is exactly when a reviewer is most
 * tempted to over-read. Wilson stays inside [0,1] and keeps a sane width at
 * the extremes.
 */
export function wilson(successes: number, n: number, z: number = Z_95): Rate {
  if (!Number.isFinite(n) || n <= 0) {
    return { successes: 0, n: 0, point: 0, low: 0, high: 1 };
  }
  const s = Math.max(0, Math.min(successes, n));
  const p = s / n;
  const d = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / d;
  const half = (z / d) * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return {
    successes: s,
    n,
    point: p,
    low: Math.max(0, centre - half),
    high: Math.min(1, centre + half),
  };
}

/** Abramowitz & Stegun 7.1.26 — plenty for a p-value printed to two decimals. */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}

function normalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

/**
 * Two-sided p-value for "these two rates are the same", pooled z-test.
 *
 * Returns 1 (i.e. no evidence of difference) whenever the test is undefined —
 * an empty arm, or both arms at exactly the same degenerate rate. Never NaN:
 * a NaN rendered into a review reads as a missing result, not as "unknown",
 * and someone will fill the gap with their prior.
 */
export function twoProportionP(
  successesA: number,
  nA: number,
  successesB: number,
  nB: number
): number {
  if (nA <= 0 || nB <= 0) return 1;
  const pA = successesA / nA;
  const pB = successesB / nB;
  const pooled = (successesA + successesB) / (nA + nB);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / nA + 1 / nB));
  if (!Number.isFinite(se) || se === 0) return 1;
  const z = (pA - pB) / se;
  return Math.max(0, Math.min(1, 2 * (1 - normalCdf(Math.abs(z)))));
}

/**
 * Sessions needed in the NEW arm to resolve a `delta` change against a
 * baseline rate treated as known, at 80% power and 95% confidence.
 *
 * The baseline really is near-known here (n=745 against n=42), so the
 * two-sample formula would overstate the requirement. Returns Infinity for a
 * delta of zero — "how long until we can detect no difference" has no answer,
 * and that is worth saying out loud rather than printing a large number that
 * looks like a schedule.
 */
export function requiredN(baselineRate: number, delta: number): number {
  const d = Math.abs(delta);
  if (d === 0) return Infinity;
  const p = Math.max(0, Math.min(1, baselineRate));
  const z = Z_95 + Z_POWER_80;
  return Math.ceil((z * z * p * (1 - p)) / (d * d));
}

/**
 * The verdict a reviewer should act on.
 *
 * "inconclusive" is the honest default and by far the most common outcome at
 * these sample sizes. It is returned whenever the intervals overlap, which is
 * the case a bare percentage hides.
 */
export type Verdict = "better" | "worse" | "inconclusive";

export function verdict(
  baseline: Rate,
  candidate: Rate,
  p: number,
  alpha = 0.05
): Verdict {
  if (baseline.n === 0 || candidate.n === 0) return "inconclusive";
  if (p >= alpha) return "inconclusive";
  return candidate.point > baseline.point ? "better" : "worse";
}

/** `74.5% [70.1–78.4]` — one rate, never without its interval. */
export function formatRate(r: Rate): string {
  if (r.n === 0) return "n/a (no sessions)";
  const pct = (x: number) => (x * 100).toFixed(1);
  return `${pct(r.point)}% [${pct(r.low)}–${pct(r.high)}] (n=${r.n})`;
}
