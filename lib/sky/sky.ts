import type { SunTimes } from "./sun";

/**
 * The colour of the sky at a moment of a day, set by that day's real sunrise
 * and sunset: dawn, a clear day, golden hour, dusk, then night. And which ink
 * reads on it.
 */

export type Rgb = readonly [number, number, number];

const hex = (value: string): Rgb => {
  const n = parseInt(value.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
};

export const NIGHT = hex("#0d1433");
const MIDDAY = hex("#a9dcf9");

/** Moments around sunrise and sunset, in minutes from each, and the sky's colour then. */
const DAWN: ReadonlyArray<[number, string]> = [
  [-95, "#0e1638"],
  [-42, "#2c3068"],
  [-12, "#b06c82"],
  [10, "#f4a981"],
  [50, "#fbdcba"],
  [125, "#d7edf8"],
];
const DUSK: ReadonlyArray<[number, string]> = [
  [-175, "#b6e0f7"],
  [-95, "#f8e6bb"],
  [-42, "#fac182"],
  [-6, "#ee8558"],
  [18, "#a7527f"],
  [46, "#4b3578"],
  [88, "#1f2453"],
  [142, "#0d1433"],
];

/** The day's colour stops, always in time order, from one midnight to the next. */
export function skyStops(sun: SunTimes): Array<[number, Rgb]> {
  if (sun.polar === "day") return [[0, MIDDAY], [1440, MIDDAY]];
  if (sun.polar === "night" || sun.sunrise === null || sun.sunset === null) {
    return [[0, NIGHT], [720, hex("#2c3068")], [1440, NIGHT]];
  }
  const { sunrise, sunset } = sun;
  const raw: Array<[number, Rgb]> = [
    [0, NIGHT],
    ...DAWN.map(([offset, color]): [number, Rgb] => [sunrise + offset, hex(color)]),
    [(sunrise + sunset) / 2, MIDDAY],
    ...DUSK.map(([offset, color]): [number, Rgb] => [sunset + offset, hex(color)]),
  ];
  // A short winter day can't fit every stop: keep the ones still in order.
  const stops: Array<[number, Rgb]> = [];
  for (const stop of raw) {
    if (!stops.length || stop[0] > stops[stops.length - 1][0]) stops.push(stop);
  }
  if (stops[stops.length - 1][0] < 1440) stops.push([1440, NIGHT]);
  return stops;
}

/** The sky at a moment, in minutes after that day's midnight; before and after the day it's night. */
export function skyAt(stops: ReadonlyArray<[number, Rgb]>, minutes: number): Rgb {
  if (minutes <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    const [t1, c1] = stops[i];
    if (minutes <= t1) {
      const [t0, c0] = stops[i - 1];
      const f = (minutes - t0) / (t1 - t0);
      return [c0[0] + (c1[0] - c0[0]) * f, c0[1] + (c1[1] - c0[1]) * f, c0[2] + (c1[2] - c0[2]) * f];
    }
  }
  return stops[stops.length - 1][1];
}

export const toCss = ([r, g, b]: Rgb) => `rgb(${Math.round(r)} ${Math.round(g)} ${Math.round(b)})`;

function luminance([r, g, b]: Rgb): number {
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export const INK: Rgb = hex("#0f2230");
export const BLACK: Rgb = [0, 0, 0];
export const WHITE: Rgb = [255, 255, 255];
const READABLE = 4.5;

/**
 * The words' colour on a stretch of sky, given the sky at a few points behind
 * them: the site's dark ink on a bright sky, white once it's dark. Around dusk,
 * or where a block spans light and dark, neither may reach 4.5 to 1 everywhere;
 * then whichever of the ink, white and black reads best at its worst point.
 */
export function inkFor(samples: readonly Rgb[]): Rgb {
  const worst = (ink: Rgb) => Math.min(...samples.map((sky) => contrast(sky, ink)));
  if (worst(INK) >= READABLE) return INK;
  if (worst(WHITE) >= READABLE) return WHITE;
  return [INK, WHITE, BLACK].reduce((best, ink) => (worst(ink) > worst(best) ? ink : best));
}
