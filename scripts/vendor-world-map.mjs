#!/usr/bin/env node
/**
 * Vendor a world map as pre-projected SVG paths keyed by ISO 3166-1 alpha-2.
 *
 * Usage:
 *   node scripts/vendor-world-map.mjs            # fetch, convert, write
 *   node scripts/vendor-world-map.mjs --check    # exit 1 if the output drifted
 *
 * Output: lib/geo/world-paths.json  — { "US": "M...Z", "FR": "M...Z", ... }
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
 * The 110m resolution is deliberate. 50m is ~5x the bytes for detail nobody can
 * see in a 900px-wide choropleth.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "lib", "geo");
const OUT_FILE = path.join(OUT_DIR, "world-paths.json");
const LICENSE_FILE = path.join(OUT_DIR, "LICENSE");

const TOPO_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";
const CODES_URL =
  "https://raw.githubusercontent.com/datasets/country-codes/main/data/country-codes.csv";

// Latitude clip. Antarctica (~-90..-60) is dropped; the Arctic is trimmed so
// Greenland and Siberia do not stretch the viewBox for no informational gain.
const LAT_MIN = -60;
const LAT_MAX = 84;

// Coordinate precision in the emitted path data. On a 360x144 viewBox rendered
// ~900px wide, one unit is 2.5px, so 0.1 units is a quarter of a pixel — below
// what any display can resolve. Dropping from 2 decimals to 1 costs nothing
// visible and saves 25% of the payload (49.4 -> 37.0 KB gzipped).
const PRECISION = 1;

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

function ringToPath(pts) {
  if (pts.length < 3) return "";
  let d = "";
  let prev = null;
  for (let i = 0; i < pts.length; i++) {
    const [x, y] = project(pts[i]);
    const xs = x.toFixed(PRECISION);
    const ys = y.toFixed(PRECISION);
    // Collapse consecutive duplicate points — clipping creates a lot of them
    // along the -60 parallel.
    if (prev && prev[0] === xs && prev[1] === ys) continue;
    d += `${i === 0 ? "M" : "L"}${xs},${ys}`;
    prev = [xs, ys];
  }
  return d ? d + "Z" : "";
}

function geometryToPath(arcs, geom) {
  const polys =
    geom.type === "Polygon"
      ? [geom.arcs]
      : geom.type === "MultiPolygon"
        ? geom.arcs
        : [];
  let d = "";
  for (const poly of polys) {
    for (const ring of poly) d += ringToPath(ringPoints(arcs, ring));
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
