/**
 * Which legs of a day's route get their travel-time label on the map. Pins are
 * about 28 px across and a label about 50 px, so a leg too short on screen has
 * its label on the pins, and legs close together have theirs on each other.
 * Those wait until the map is zoomed in far enough to fit them.
 */

type Point = { lat: number; lng: number };

export interface LabelledLeg {
  key: string;
  from: Point;
  to: Point;
  mid: Point;
  minutes: number;
}

// Room for a label between two pins, and the box a label takes.
const MIN_LEG_PX = 70;
const LABEL_WIDTH_PX = 52;
const LABEL_HEIGHT_PX = 22;

/** Web Mercator, in the map's pixels at this zoom. */
function toPixels({ lat, lng }: Point, zoom: number): { x: number; y: number } {
  const scale = 256 * 2 ** zoom;
  const sin = Math.sin((lat * Math.PI) / 180);
  return {
    x: ((lng + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
  };
}

/** The keys of the legs to label at this zoom, the longest walks first when two would touch. */
export function legsToLabel(legs: readonly LabelledLeg[], zoom: number | null | undefined): Set<string> {
  if (zoom == null) return new Set();
  const placed: { x: number; y: number }[] = [];
  const shown = new Set<string>();
  for (const leg of [...legs].sort((a, b) => b.minutes - a.minutes)) {
    const from = toPixels(leg.from, zoom);
    const to = toPixels(leg.to, zoom);
    if (Math.hypot(to.x - from.x, to.y - from.y) < MIN_LEG_PX) continue;
    const at = toPixels(leg.mid, zoom);
    if (placed.some((p) => Math.abs(p.x - at.x) < LABEL_WIDTH_PX && Math.abs(p.y - at.y) < LABEL_HEIGHT_PX)) continue;
    placed.push(at);
    shown.add(leg.key);
  }
  return shown;
}
