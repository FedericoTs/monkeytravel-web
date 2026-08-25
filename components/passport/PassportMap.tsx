import worldPaths from "@/lib/geo/world-paths.json";
import type { VisaStatus } from "@/lib/visa/types";

/**
 * World choropleth of what a passport gets you, coloured by visa status.
 *
 * SERVER COMPONENT, ZERO CLIENT JAVASCRIPT
 * The geometry is pre-projected SVG path data (lib/geo/world-paths.json,
 * vendored by scripts/vendor-world-map.mjs), so this is just <path d={...}/>.
 * No d3, no topojson-client, no runtime projection, and nothing fetched from a
 * CDN — which also means the CSP has nothing to block.
 *
 * It is rendered inline rather than fetched as a static asset on purpose. A
 * client-fetched map pops in after paint, and this site is already failing
 * Core Web Vitals on CLS (homepage p75 0.57); adding another late-arriving
 * block would make that worse. Inline costs ~37KB gzipped and the fixed
 * viewBox plus aspect-ratio box means the space is reserved before first paint.
 *
 * COVERAGE — STATED, NOT HIDDEN
 * The 110m Natural Earth geometry has no polygon for 32 of the 199 destinations
 * in the visa matrix: micro-states and small island nations, including real
 * destinations like Singapore, Malta, Maldives, Mauritius, Seychelles and Hong
 * Kong. They are too small to draw at this scale. Every one of them appears in
 * the grouped lists below the map, and the caption says so — a map that
 * silently omits a sixth of the answer would be worse than no map.
 */

interface Props {
  /** iso2 -> status for one passport. ~4KB, built server-side. */
  statusByIso2: Record<string, VisaStatus>;
  /** The passport's own country, outlined rather than filled. */
  homeIso2: string;
  /** status -> localized label, for the accessible description. */
  labels: Record<string, string>;
  /** Localized caption naming the coverage limit. */
  caption: string;
  /** Accessible title for the figure. */
  title: string;
}

/**
 * Same semantic ramp as PassportStatusChart: green "go", amber/orange "apply
 * first", slate "full visa", rose "closed". Hex rather than Tailwind classes
 * because SVG fill needs a value, and these must match the chart exactly.
 */
const FILL: Record<string, string> = {
  "visa free": "#10b981", // emerald-500
  "visa on arrival": "#14b8a6", // teal-500
  eta: "#fbbf24", // amber-400
  "e-visa": "#fb923c", // orange-400
  "visa required": "#94a3b8", // slate-400
  "no admission": "#f43f5e", // rose-500
};

/** Countries with no visa data at all — drawn, but visibly inert. */
const NO_DATA = "#e2e8f0"; // slate-200

const PATHS = worldPaths as Record<string, string>;

export default function PassportMap({
  statusByIso2,
  homeIso2,
  labels,
  caption,
  title,
}: Props) {
  const entries = Object.entries(PATHS);

  // Counts for the accessible description, so a screen reader gets the same
  // summary a sighted reader gets from the colours.
  const counts: Record<string, number> = {};
  for (const [iso2] of entries) {
    const s = statusByIso2[iso2];
    if (s) counts[s] = (counts[s] ?? 0) + 1;
  }
  const described = Object.entries(counts)
    .map(([s, n]) => `${labels[s] ?? s}: ${n}`)
    .join(", ");

  return (
    <figure className="mt-8">
      {/* aspect-ratio reserves the box before the SVG paints — no layout shift. */}
      <div
        className="w-full overflow-hidden rounded-2xl border border-slate-200 bg-slate-50"
        style={{ aspectRatio: "360 / 144" }}
      >
        <svg
          viewBox="-180 -84 360 144"
          className="h-full w-full"
          role="img"
          aria-label={`${title}. ${described}`}
          preserveAspectRatio="xMidYMid meet"
        >
          {entries.map(([iso2, d]) => {
            const status = statusByIso2[iso2];
            const isHome = iso2 === homeIso2;
            return (
              <path
                key={iso2}
                d={d}
                fill={isHome ? "#0f172a" : (status ? FILL[status] : NO_DATA) ?? NO_DATA}
                stroke="#ffffff"
                // Hairline in viewBox units: 0.15 of a degree keeps borders
                // visible at every render width without thickening small nations
                // into blobs.
                strokeWidth={0.15}
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
        </svg>
      </div>
      <figcaption className="mt-2 text-xs text-slate-500">{caption}</figcaption>
    </figure>
  );
}
