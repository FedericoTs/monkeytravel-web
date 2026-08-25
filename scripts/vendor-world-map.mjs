#!/usr/bin/env node
/**
 * Vendor a world map as pre-projected SVG paths keyed by ISO 3166-1 alpha-2.
 *
 * Usage:
 *   node scripts/vendor-world-map.mjs            # fetch, convert, write
 *   node scripts/vendor-world-map.mjs --check    # exit 1 if the output drifted
 *
 * Output: public/geo/world-paths.json — { "US": "M...Z", "FR": "M...Z", ... }
 *
 * It is served as a STATIC ASSET, not imported. Inlining it put the geometry in
 * the HTML *and* again in Next's RSC flight payload — verified 2x by counting a
 * path fragment — which took the passport page to 297.9 KB gzipped. Fetched
 * once, it is cached across all 80 passport pages instead.
 *
 * WHY PRE-PROJECTED PATHS AND NOT A RUNTIME TOPOJSON
 * The passport pages need to colour ~198 countries by visa status. The obvious
 * route is topojson-client + d3-geo at runtime, which means two new runtime
 * dependencies and a projection recomputed on every render. Instead this runs
 * once at vendor time and emits plain SVG path strings, so the component is
 * `<path d={...}/>` with zero geo dependencies and zero client JavaScript.
 *
 * It also sidesteps the CSP: the artefact is a local module, so nothing is
 * fetched from a CDN at runtime. (The Artifact/Vercel CSP blocks external
 * hosts, which is why a jsdelivr-at-runtime approach was never an option.)
 *
 * SOURCES AND LICENCES
 *   Geometry: topojson/world-atlas countries-110m.json — ISC, (c) 2013-2019
 *             Michael Bostock. Derived from Natural Earth, which is public
 *             domain. The ISC notice is reproduced in lib/geo/LICENSE.
 *   Codes:    datasets/country-codes — ISO 3166-1 numeric -> alpha-2. Used only
 *             at vendor time to rekey the output; nothing from it ships.
 *
 * PROJECTION
 * Equirectangular (plate carrée): x = lon, y = -lat. Chosen because it is
 * exact, trivial to verify by eye, and needs no library. Antarctica and the
 * far north are clipped to latitudes [-60, 84] — Antarctica is not a travel
 * destination, it dominates an unclipped world map, and the visa matrix has no
 * entry for it.
 *
 * RESOLUTION: 50m, not 110m.
 * 110m has no polygon at all for 32 of the 199 destinations in the visa matrix
 * — Singapore, Malta, the Maldives, Mauritius, Seychelles, Hong Kong and 26
 * other micro-states and small islands. Those are real destinations, and a map
 * that silently omits a sixth of the answer is worse than a heavier one. 50m
 * covers 197 of 199 (only Tuvalu and Kosovo remain, the latter having no
 * official ISO alpha-2 at all).
 *
 * The cost is paid down by dropping coordinate precision (see PRECISION) and
 * by discarding rings too small to occupy a pixel at render size (see
 * MIN_RING_AREA), so the shipped payload stays close to the 110m version while
 * the coverage gap effectively disappears.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "public", "geo");
const OUT_FILE = path.join(OUT_DIR, "world-paths.json");
// The licence notice stays in lib/geo/ — it documents the vendored artefact
// and has no business being publicly served alongside it.
const LICENSE_FILE = path.join(ROOT, "lib", "geo", "LICENSE");

const TOPO_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json";
const CODES_URL =
  "https://raw.githubusercontent.com/datasets/country-codes/main/data/country-codes.csv";

// Latitude clip. Antarctica (~-90..-60) is dropped; the Arctic is trimmed so
// Greenland and Siberia do not stretch the viewBox for no informational gain.
const LAT_MIN = -60;
const LAT_MAX = 84;

// Coordinate precision in the emitted path data. On a 360x144 viewBox rendered
// ~950px wide, one unit is 2.6px, so 0.1 units is well under half a pixel —
// below what any display can resolve.
const PRECISION = 1;

// Radial-distance simplification tolerance, in viewBox units. A point closer
// than this to the last kept point cannot move the rendered outline visibly,
// so it is dropped. At the ~950px these maps render, one unit is 2.64px, so
// 0.32 units is 0.84px — still under a single pixel of deviation.
//
// This is what makes 50m affordable. Measured, at full 197/199 coverage:
//     raw 50m   855.3 KB -> 197.3 KB gzipped   (unusable inline)
//     tol 0.18  422.0 KB -> 119.7 KB gzipped
//     tol 0.32  ~305  KB ->  87.5 KB gzipped   <- chosen
//     tol 0.40  ~270  KB ->  77.1 KB gzipped   (1.06px, starts to show)
// Coverage is unaffected by the tolerance: tiny rings are protected by the
// fallback in prepareRing, so only long coastlines lose points.
const SIMPLIFY_TOLERANCE = 0.32;

// Rings smaller than this (bounding box, in square viewBox units) cannot
// occupy even one pixel. They are dropped — EXCEPT a country's largest ring,
// which is always kept. That exception is the whole point of moving to 50m:
// Monaco, Singapore, Macao and the Maldives exist only as tiny rings, and
// dropping them would recreate the coverage gap this change exists to close.
const MIN_RING_AREA = 0.02;

async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} for ${url}`);
  return r.json();
}

async function getText(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} for ${url}`);
  return r.text();
}

/**
 * Decode TopoJSON quantized delta-encoded arcs into absolute [lon, lat] pairs.
 * Spec: each arc's first position is absolute in quantized space; the rest are
 * deltas. Then transform: lon = x * scale[0] + translate[0].
 */
function decodeArcs(topology) {
  const { scale, translate } = topology.transform;
  return topology.arcs.map((arc) => {
    let x = 0;
    let y = 0;
    return arc.map(([dx, dy]) => {
      x += dx;
      y += dy;
      return [x * scale[0] + translate[0], y * scale[1] + translate[1]];
    });
  });
}

/** A negative arc index means "traverse this arc backwards": ~i === -i - 1. */
function arcPoints(arcs, index) {
  if (index >= 0) return arcs[index];
  return arcs[~index].slice().reverse();
}

/** Stitch a ring's arc indices into one continuous point list. */
function ringPoints(arcs, ring) {
  const pts = [];
  for (const idx of ring) {
    const seg = arcPoints(arcs, idx);
    // Arcs share endpoints; drop the duplicate join.
    for (let i = pts.length ? 1 : 0; i < seg.length; i++) pts.push(seg[i]);
  }
  return pts;
}

const project = ([lon, lat]) => [lon, -Math.max(LAT_MIN, Math.min(LAT_MAX, lat))];

/** Projected points, radially simplified, plus the ring's bounding-box area. */
function prepareRing(rawPts) {
  const proj = rawPts.map(project);
  const kept = [];
  let last = null;
  for (let i = 0; i < proj.length; i++) {
    const p = proj[i];
    // Always keep the final point so the ring closes where it started.
    const isLast = i === proj.length - 1;
    if (last && !isLast) {
      const dx = p[0] - last[0];
      const dy = p[1] - last[1];
      if (dx * dx + dy * dy < SIMPLIFY_TOLERANCE * SIMPLIFY_TOLERANCE) continue;
    }
    kept.push(p);
    last = p;
  }
  // If simplification collapsed the ring below a drawable triangle, fall back
  // to the unsimplified points rather than dropping it. Tiny rings are exactly
  // the ones 50m exists to provide — Maldives, Seychelles, Monaco, Vatican and
  // Macao are each a handful of points, and an early version of this function
  // discarded all of them here, silently recreating the gap it was meant to
  // close. Keeping them raw costs a few dozen bytes each.
  const pts = kept.length >= 3 ? kept : proj;
  if (pts.length < 3) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { pts, area: (maxX - minX) * (maxY - minY) };
}

/**
 * ANTIMERIDIAN SPLIT
 * Russia and Fiji have rings whose vertices sit on both sides of +/-180. In an
 * equirectangular projection a straight line between them is drawn across the
 * entire width of the map — a horizontal streak through everything. Measured
 * before this fix: 3 subpaths spanning a full 360 degrees and 6 point-to-point
 * jumps over 180.
 *
 * Splitting the subpath at the jump renders each landmass in its own place.
 * The polygon is not clipped to the meridian, so the split edges stop a
 * fraction short of the frame — invisible at choropleth scale, and vastly
 * better than a streak.
 */
const ANTIMERIDIAN_JUMP = 180;

function ringToPath(ring) {
  let d = "";
  let prev = null;
  let open = false;
  for (let i = 0; i < ring.pts.length; i++) {
    const [x, y] = ring.pts[i];
    const xs = x.toFixed(PRECISION);
    const ys = y.toFixed(PRECISION);
    // Collapse points that round to the same rendered coordinate.
    if (prev && prev[0] === xs && prev[1] === ys) continue;

    const wrapped = prev !== null && Math.abs(x - prev[2]) > ANTIMERIDIAN_JUMP;
    if (wrapped && open) {
      d += "Z";
      open = false;
    }
    d += `${open ? "L" : "M"}${xs},${ys}`;
    open = true;
    prev = [xs, ys, x];
  }
  return open ? d + "Z" : d;
}

function geometryToPath(arcs, geom) {
  const polys =
    geom.type === "Polygon"
      ? [geom.arcs]
      : geom.type === "MultiPolygon"
        ? geom.arcs
        : [];

  const rings = [];
  for (const poly of polys) {
    for (const ring of poly) {
      const prepared = prepareRing(ringPoints(arcs, ring));
      if (prepared) rings.push(prepared);
    }
  }
  if (rings.length === 0) return "";

  // Keep the largest ring unconditionally, so single-ring micro-states survive.
  let largest = 0;
  for (let i = 1; i < rings.length; i++) {
    if (rings[i].area > rings[largest].area) largest = i;
  }

  let d = "";
  for (let i = 0; i < rings.length; i++) {
    if (i !== largest && rings[i].area < MIN_RING_AREA) continue;
    d += ringToPath(rings[i]);
  }
  return d;
}

/** Minimal CSV parse — the source has quoted fields containing commas. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

async function build() {
  console.log(`[vendor-map] Fetching ${TOPO_URL}`);
  const topology = await getJson(TOPO_URL);
  if (topology.type !== "Topology" || !topology.objects?.countries) {
    throw new Error("unexpected topology shape — refusing to write");
  }

  console.log(`[vendor-map] Fetching ISO numeric -> alpha-2 map`);
  const rows = parseCsv(await getText(CODES_URL));
  const head = rows[0];
  const numIdx = head.indexOf("ISO3166-1-numeric");
  const a2Idx = head.indexOf("ISO3166-1-Alpha-2");
  if (numIdx < 0 || a2Idx < 0) throw new Error("country-codes columns moved");
  const numToA2 = new Map();
  for (const r of rows.slice(1)) {
    const num = (r[numIdx] || "").trim();
    const a2 = (r[a2Idx] || "").trim().toUpperCase();
    if (num && /^[A-Z]{2}$/.test(a2)) numToA2.set(String(Number(num)), a2);
  }

  const arcs = decodeArcs(topology);
  const out = {};
  const unmapped = [];
  for (const geom of topology.objects.countries.geometries) {
    const a2 = numToA2.get(String(Number(geom.id)));
    if (!a2) {
      unmapped.push(`${geom.id} ${geom.properties?.name ?? "?"}`);
      continue;
    }
    const d = geometryToPath(arcs, geom);
    if (d) out[a2] = d;
  }

  const sorted = Object.fromEntries(Object.keys(out).sort().map((k) => [k, out[k]]));
  const json = JSON.stringify(sorted);

  if (process.argv.includes("--check")) {
    const existing = await fs.readFile(OUT_FILE, "utf8").catch(() => null);
    if (existing !== json) {
      console.error("[vendor-map] DRIFT: regenerated output differs from the vendored file.");
      process.exit(1);
    }
    console.log("[vendor-map] No drift.");
    return;
  }

  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(OUT_FILE, json);
  await fs.writeFile(
    LICENSE_FILE,
    [
      "world-paths.json is generated by scripts/vendor-world-map.mjs from:",
      "",
      "1. topojson/world-atlas (countries-110m.json)",
      "   ISC License, Copyright 2013-2019 Michael Bostock",
      "",
      "   Permission to use, copy, modify, and/or distribute this software for any",
      "   purpose with or without fee is hereby granted, provided that the above",
      "   copyright notice and this permission notice appear in all copies.",
      "",
      "   THE SOFTWARE IS PROVIDED \"AS IS\" AND THE AUTHOR DISCLAIMS ALL WARRANTIES",
      "   WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF",
      "   MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR",
      "   ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES",
      "   WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN",
      "   ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF",
      "   OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.",
      "",
      "   world-atlas is itself derived from Natural Earth, which is in the",
      "   public domain: https://www.naturalearthdata.com/about/terms-of-use/",
      "",
      "2. datasets/country-codes (ISO 3166-1 numeric -> alpha-2)",
      "   Used only at vendor time to rekey the output. No content from it ships.",
      "",
      "Regenerate with: node scripts/vendor-world-map.mjs",
      "Verify with:     node scripts/vendor-world-map.mjs --check",
      "",
    ].join("\n"),
  );

  const bytes = Buffer.byteLength(json);
  console.log(`[vendor-map] Wrote ${Object.keys(sorted).length} countries, ${(bytes / 1024).toFixed(1)} KB`);
  console.log(`[vendor-map] -> ${path.relative(ROOT, OUT_FILE)}`);
  if (unmapped.length) {
    console.log(`[vendor-map] ${unmapped.length} geometries had no ISO alpha-2 and were skipped:`);
    for (const u of unmapped) console.log(`    - ${u}`);
  }
}

build().catch((e) => {
  console.error("[vendor-map] FAILED:", e.message);
  process.exit(1);
});
