"use client";

import { useEffect, useState } from "react";
import type { VisaStatus } from "@/lib/visa/types";

/**
 * World choropleth of what a passport gets you, coloured by visa status.
 *
 * WHY THE GEOMETRY IS FETCHED, NOT IMPORTED
 * This started as a server component with the paths imported directly. That put
 * the geometry in the HTML *and* again in Next's RSC flight payload — verified
 * by counting a distinctive path fragment, which appeared exactly twice — so
 * 87.5 KB of gzipped paths cost ~175 KB on the wire and took the passport page
 * to 297.9 KB gzipped.
 *
 * Fetching /geo/world-paths.json instead means one cached copy shared across
 * all 80 passport pages (20 passports x 4 locales), and the page HTML carries
 * none of it. next.config.ts caches it for a day with a week of
 * stale-while-revalidate, and middleware.ts excludes /geo from its matcher so
 * the fetch does not trigger a Supabase session round-trip — the same mistake
 * manifest.json cost 344 middleware invocations a day for.
 *
 * NO LAYOUT SHIFT DESPITE ARRIVING LATE
 * The container is a fixed aspect-ratio box, so its height is known before the
 * geometry lands. The map fades in inside an already-reserved frame; nothing
 * below it moves. That matters here because the site is already failing Core
 * Web Vitals on CLS (homepage p75 0.57) and this must not add to it.
 *
 * WHAT A READER LOSES IF THE FETCH FAILS
 * Nothing that matters. The map is a visual summary; the authoritative answer
 * is the grouped destination lists below it, which are server-rendered and
 * always present. On failure the frame simply stays empty rather than showing
 * an error the reader can do nothing about.
 *
 * COVERAGE — STATED, NOT HIDDEN
 * Built from 50m Natural Earth geometry, covering 197 of the 199 destinations
 * in the visa matrix. Only Tuvalu and Kosovo are undrawn; Kosovo has no
 * official ISO alpha-2 code at all. Both appear in the lists below and the
 * caption names them.
 */

interface Props {
  /** iso2 -> status for one passport. ~4KB, resolved server-side. */
  statusByIso2: Record<string, VisaStatus>;
  /** The passport's own country, filled distinctly. */
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

const ASSET = "/geo/world-paths.json";

/**
 * Module-level cache. Several passport pages in one session, or a re-mount,
 * must not each start their own request — the browser cache would usually
 * cover it, but sharing the promise makes it certain.
 */
let cached: Promise<Record<string, string>> | null = null;

function loadPaths(): Promise<Record<string, string>> {
  if (!cached) {
    cached = fetch(ASSET)
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json();
      })
      .catch((e) => {
        // Let a later mount retry rather than caching the failure forever.
        cached = null;
        throw e;
      });
  }
  return cached;
}

export default function PassportMap({
  statusByIso2,
  homeIso2,
  labels,
  caption,
  title,
}: Props) {
  const [paths, setPaths] = useState<Record<string, string> | null>(null);

  useEffect(() => {
    let alive = true;
    loadPaths()
      .then((p) => {
        if (alive) setPaths(p);
      })
      .catch(() => {
        /* frame stays empty; the lists below carry the answer */
      });
    return () => {
      alive = false;
    };
  }, []);

  // Described from the DATA, not from what happens to be drawable, so the
  // accessible summary is complete even before the geometry arrives.
  const counts: Record<string, number> = {};
  for (const status of Object.values(statusByIso2)) {
    counts[status] = (counts[status] ?? 0) + 1;
  }
  const described = Object.entries(counts)
    .map(([s, n]) => `${labels[s] ?? s}: ${n}`)
    .join(", ");

  return (
    <figure className="mt-8">
      {/* Fixed aspect-ratio: the height is known before the geometry lands, so
          the late arrival cannot shift anything below it. */}
      <div
        className="w-full overflow-hidden rounded-2xl border border-slate-200 bg-slate-50"
        style={{ aspectRatio: "360 / 144" }}
      >
        {paths && (
          <svg
            viewBox="-180 -84 360 144"
            className="h-full w-full"
            role="img"
            aria-label={`${title}. ${described}`}
            preserveAspectRatio="xMidYMid meet"
          >
            {Object.entries(paths).map(([iso2, d]) => {
              const status = statusByIso2[iso2];
              return (
                <path
                  key={iso2}
                  d={d}
                  fill={
                    iso2 === homeIso2
                      ? "#0f172a"
                      : (status ? FILL[status] : NO_DATA) ?? NO_DATA
                  }
                  stroke="#ffffff"
                  strokeWidth={0.15}
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
          </svg>
        )}
      </div>
      <figcaption className="mt-2 text-xs text-slate-500">{caption}</figcaption>
    </figure>
  );
}
