/**
 * The route of a trip as a small drawing: every activity with coordinates,
 * in itinerary order, joined by a dotted line, with a dot per stop in the
 * colour of its day. No map tiles and no map API: a plain projection of the
 * points into a box, which is all a card needs to show the shape of a trip.
 */
import { dayColor } from "@/lib/map/day-colors";

export interface SketchDay {
  day_number: number;
  city?: string | null;
  activities: { coordinates?: { lat?: unknown; lng?: unknown } | null }[];
}

export interface Sketch {
  width: number;
  height: number;
  points: { x: number; y: number; day: number }[];
  path: string;
  /** One label per city, at that city's first stop, only when there are several cities. */
  labels: { x: number; y: number; text: string }[];
}

/** More stops than this and the drawing turns into a blob. */
const MAX_POINTS = 48;

const round1 = (n: number) => Math.round(n * 10) / 10;

export function routeSketch(
  days: SketchDay[],
  box: { width: number; height: number; padding?: number }
): Sketch | null {
  const pad = box.padding ?? 28;
  const raw: { lat: number; lng: number; day: number; city: string | null; firstOfDay: boolean }[] = [];
  for (const d of [...days].sort((a, b) => a.day_number - b.day_number)) {
    let first = true;
    for (const a of d.activities ?? []) {
      const lat = Number(a?.coordinates?.lat);
      const lng = Number(a?.coordinates?.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      if ((lat === 0 && lng === 0) || Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
      raw.push({ lat, lng, day: d.day_number, city: d.city?.trim() || null, firstOfDay: first });
      first = false;
    }
  }
  if (raw.length === 0) return null;

  // Thin a long trip out, keeping each day's first stop so every day stays visible.
  const stride = Math.ceil(raw.length / MAX_POINTS);
  const kept = stride > 1 ? raw.filter((p, i) => p.firstOfDay || i % stride === 0) : raw;

  const meanLat = kept.reduce((s, p) => s + p.lat, 0) / kept.length;
  const kx = Math.max(0.2, Math.cos((meanLat * Math.PI) / 180));
  const xs = kept.map((p) => p.lng * kx);
  const ys = kept.map((p) => -p.lat);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const spanX = Math.max(...xs) - minX;
  const spanY = Math.max(...ys) - minY;
  const innerW = box.width - 2 * pad;
  const innerH = box.height - 2 * pad;
  // A span of zero (one stop, or stops on one line) is centred, not stretched.
  const fit = Math.min(spanX > 0 ? innerW / spanX : Infinity, spanY > 0 ? innerH / spanY : Infinity);
  const scale = Number.isFinite(fit) ? fit : 0;
  const offX = pad + (innerW - spanX * scale) / 2;
  const offY = pad + (innerH - spanY * scale) / 2;

  const points = kept.map((p, i) => ({
    x: round1(offX + (xs[i] - minX) * scale),
    y: round1(offY + (ys[i] - minY) * scale),
    day: p.day,
  }));
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x} ${p.y}`).join(" ");

  const labels: Sketch["labels"] = [];
  const seen = new Set<string>();
  kept.forEach((p, i) => {
    if (p.city && !seen.has(p.city)) {
      seen.add(p.city);
      labels.push({ x: points[i].x, y: points[i].y, text: p.city });
    }
  });

  return { width: box.width, height: box.height, points, path, labels: seen.size > 1 ? labels : [] };
}

/** The drawing as SVG markup, for a data URI image. */
export function sketchSvg(s: Sketch, colors: { line: string; ring: string }): string {
  const line =
    s.points.length > 1
      ? `<path d="${s.path}" fill="none" stroke="${colors.line}" stroke-opacity="0.4" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="1 13"/>`
      : "";
  const dots = s.points
    .map(
      (p, i) =>
        `<circle cx="${p.x}" cy="${p.y}" r="${i === 0 ? 11 : 8}" fill="${dayColor(p.day)}" stroke="${colors.ring}" stroke-width="3"/>`
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s.width}" height="${s.height}" viewBox="0 0 ${s.width} ${s.height}">${line}${dots}</svg>`;
}

export function sketchDataUri(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
