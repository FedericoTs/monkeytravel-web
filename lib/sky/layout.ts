import { toCss, type Rgb } from "./sky";

/** A moment of the plan and where it sits on the page, in pixels from the top of the sky. */
export interface Anchor {
  y: number;
  t: number;
}

/** Where a block of words starts and ends on the page. */
export interface Span {
  top: number;
  bottom: number;
}

/** A colour of the drawn sky, and its height on the page. */
export interface Stop {
  y: number;
  color: Rgb;
}

export interface SkyLayout {
  /** The plan's moments, where they sit on the page. */
  anchors: readonly Anchor[];
  /** The blocks of words on the sky. */
  words: readonly Span[];
  /** The plan's height. */
  height: number;
  /** The sky's colour at a moment. */
  colorAt: (t: number) => Rgb;
  /** The moments the sky's colours are given for, where it turns from one blend to the next. */
  turns: readonly number[];
  /** The page's own colour, after the plan. */
  page: Rgb;
}

/** The moment at a height of the page, between the moments placed around it; where two share a height, the later. */
export function timeAtY(points: readonly Anchor[], y: number): number {
  if (y < points[0].y) return points[0].t;
  let i = 0;
  while (i + 1 < points.length && points[i + 1].y <= y) i++;
  const [a, b] = [points[i], points[i + 1]];
  return !b || a.y === y ? a.t : a.t + ((y - a.y) / (b.y - a.y)) * (b.t - a.t);
}

/** The colour at a height of the page, as the browser blends the stops around it. */
export function colorAtY(stops: readonly Stop[], y: number): Rgb {
  if (y <= stops[0].y) return stops[0].color;
  for (let i = 1; i < stops.length; i++) {
    const [a, b] = [stops[i - 1], stops[i]];
    if (y <= b.y) {
      const f = b.y === a.y ? 1 : (y - a.y) / (b.y - a.y);
      return [a.color[0] + (b.color[0] - a.color[0]) * f, a.color[1] + (b.color[1] - a.color[1]) * f, a.color[2] + (b.color[2] - a.color[2]) * f];
    }
  }
  return stops[stops.length - 1].color;
}

const isNight = ([r, g, b]: Rgb) => r + g + b < 130;
const rounded = ([r, g, b]: Rgb): Rgb => [Math.round(r), Math.round(g), Math.round(b)];
/** Words closer than this read as one block, in one light: the lines of a stop. */
const TOGETHER = 16;

/**
 * The sky behind a plan. Time moves down the page from one moment to the next,
 * never back, and passes only where there are no words: behind photos and between
 * blocks. Each block of words is drawn in the light where it starts, so the ink
 * picked for that light reads all the way down it; a moment placed inside a block
 * waits for the next one. A colour is set at every turn of the sky, so the
 * browser's blend between them is the sky itself, and reading the stops back
 * gives what is on screen. After the plan, the page's own colour; and the
 * stretches dark enough for stars.
 */
export function skyGradient({ anchors, words, height, colorAt, turns, page }: SkyLayout): {
  background: string;
  stops: Stop[];
  nights: Array<{ top: number; height: number }>;
} {
  const spans: Span[] = [];
  for (const span of [...words].sort((a, b) => a.top - b.top)) {
    const previous = spans[spans.length - 1];
    if (span.bottom <= span.top) continue;
    if (previous && span.top - previous.bottom < TOGETHER) previous.bottom = Math.max(previous.bottom, span.bottom);
    else spans.push({ ...span });
  }
  const inside = (y: number) => spans.some((s) => y > s.top + 0.5 && y < s.bottom + 0.5);
  const placed = [...anchors].sort((a, b) => a.y - b.y);
  const outside = placed.filter(({ y }) => !inside(y));
  let latest = -Infinity;
  const moments = (outside.length ? outside : placed.slice(0, 1)).map(({ y, t }) => ({ y, t: (latest = Math.max(latest, t)) }));
  const last = moments[moments.length - 1];
  const end = Math.max(last.y + 120, height - 160);
  const points = [{ y: 0, t: moments[0].t - 20 }, ...moments, { y: end, t: last.t + 60 }];
  // A height without the words above it, where time passes; and back to the page.
  const free = (y: number) => spans.reduce((left, s) => left - Math.max(0, Math.min(y, s.bottom) - s.top), y);
  const onPage = (f: number) => spans.reduce((y, s) => (s.top < y ? y + s.bottom - s.top : y), f);
  const timeline = points.map(({ y, t }) => ({ y: free(y), t }));

  const heights = new Set<number>(points.map(({ y }) => y));
  for (const s of spans) heights.add(s.top).add(s.bottom);
  for (let i = 1; i < timeline.length; i++) {
    const [a, b] = [timeline[i - 1], timeline[i]];
    if (b.y <= a.y || b.t <= a.t) continue;
    for (const turn of turns) {
      if (turn > a.t && turn < b.t) heights.add(onPage(a.y + ((turn - a.t) / (b.t - a.t)) * (b.y - a.y)));
    }
  }

  const stops: Stop[] = [...heights]
    .filter((h) => h >= 0 && h <= end)
    .sort((a, b) => a - b)
    .map((y) => ({ y, color: rounded(colorAt(timeAtY(timeline, free(y)))) }));

  const nights: Array<{ top: number; height: number }> = [];
  let darkFrom: number | null = null;
  for (const { y, color } of stops) {
    if (isNight(color) && darkFrom === null) darkFrom = y;
    if (!isNight(color) && darkFrom !== null) {
      nights.push({ top: darkFrom, height: y - darkFrom });
      darkFrom = null;
    }
  }
  if (darkFrom !== null) nights.push({ top: darkFrom, height: end - darkFrom });

  stops.push({ y: Math.max(height, end), color: page });
  return { background: `linear-gradient(to bottom, ${stops.map(({ y, color }) => `${toCss(color)} ${Number(y.toFixed(2))}px`).join(", ")})`, stops, nights };
}
