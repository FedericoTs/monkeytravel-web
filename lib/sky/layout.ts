import { toCss, type Rgb } from "./sky";

/** A moment of the plan and where it sits on the page, in pixels from the top of the sky. */
export interface Anchor {
  y: number;
  t: number;
}

/** The moment at a height of the page, between the moments placed above and below it. */
export function timeAtY(points: readonly Anchor[], y: number): number {
  if (y <= points[0].y) return points[0].t;
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]];
    if (y <= b.y) return b.y === a.y ? b.t : a.t + ((y - a.y) / (b.y - a.y)) * (b.t - a.t);
  }
  return points[points.length - 1].t;
}

const isNight = ([r, g, b]: Rgb) => r + g + b < 130;

/**
 * The sky behind a plan of `height` pixels: a colour every few dozen pixels from
 * each moment to the next, then the page's own colour for what follows the plan;
 * and the stretches dark enough for stars.
 */
export function skyGradient(
  anchors: readonly Anchor[],
  height: number,
  colorAt: (t: number) => Rgb,
  page: string
): { background: string; nights: Array<{ top: number; height: number }>; points: Anchor[] } {
  const last = anchors[anchors.length - 1];
  const end = Math.max(last.y + 120, height - 160);
  const points = [{ y: 0, t: anchors[0].t - 20 }, ...anchors, { y: end, t: last.t + 60 }];
  const parts: string[] = [];
  const nights: Array<{ top: number; height: number }> = [];
  let darkFrom: number | null = null;
  for (let i = 0; i < points.length - 1; i++) {
    const [a, b] = [points[i], points[i + 1]];
    const steps = Math.max(2, Math.min(12, Math.round((b.y - a.y) / 40)));
    for (let k = 0; k < steps; k++) {
      const f = k / steps;
      const color = colorAt(a.t + (b.t - a.t) * f);
      const y = Math.round(a.y + (b.y - a.y) * f);
      parts.push(`${toCss(color)} ${y}px`);
      if (isNight(color) && darkFrom === null) darkFrom = y;
      if (!isNight(color) && darkFrom !== null) {
        nights.push({ top: darkFrom, height: y - darkFrom });
        darkFrom = null;
      }
    }
  }
  parts.push(`${toCss(colorAt(points[points.length - 1].t))} ${Math.round(end)}px`, `${page} ${Math.max(height, end)}px`);
  if (darkFrom !== null) nights.push({ top: darkFrom, height: end - darkFrom });
  return { background: `linear-gradient(to bottom, ${parts.join(", ")})`, nights, points };
}
