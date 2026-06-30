/**
 * Journey ribbon — the signature hero for MULTI-CITY trips (docs/MULTI_CITY_PLAN.md §2.5).
 *
 * The trip's cities on a connected line: a teal route, coral ordered city nodes
 * (1→N), each with a nights pill, and a transit indicator between cities. This is
 * what makes a multi-city trip feel like a *journey* (acts/chapters) rather than
 * "a second destination box" — and it doubles as the shareable artifact.
 *
 * Pure presentational + reusable: the multi-city preview page, the wizard result,
 * and the trip-detail view all feed it the same `stops` derived from
 * `trip_meta.destinations` / the city-tagged `ItineraryDay`s.
 */
import { Fragment } from "react";

const TEAL = "#0EA5A4"; // route line
const CORAL = "#FB7150"; // ordered city nodes

export interface JourneyStop {
  city: string;
  nights: number;
  /** Optional inter-city transit label shown on the line BEFORE this stop, e.g. "TRAIN · 4h 10m". */
  transitFromPrev?: string;
}

export function JourneyRibbon({
  stops,
  className = "",
}: {
  stops: JourneyStop[];
  className?: string;
}) {
  if (stops.length < 2) return null;

  return (
    <div
      className={`rounded-2xl border border-teal-100 bg-gradient-to-b from-teal-50/70 to-white px-4 py-5 ${className}`}
    >
      {/* Horizontal scroll on narrow screens so long routes never crush. */}
      <div className="overflow-x-auto">
        <div className="flex min-w-max items-start justify-center gap-0 px-1">
          {stops.map((stop, i) => (
            <Fragment key={`${stop.city}-${i}`}>
              {/* Connector + transit (between stops, not before the first) */}
              {i > 0 && (
                <div className="relative flex flex-col items-center self-start pt-5">
                  <div className="flex items-center" style={{ minWidth: 56 }}>
                    <span className="h-0.5 w-full" style={{ backgroundColor: TEAL }} />
                    <svg
                      width="9"
                      height="9"
                      viewBox="0 0 8 8"
                      className="-ml-px flex-none"
                      aria-hidden="true"
                    >
                      <path d="M0 0l5 4-5 4z" fill={TEAL} />
                    </svg>
                  </div>
                  <span className="mt-1.5 whitespace-nowrap text-[10px] font-semibold uppercase tracking-wide text-teal-700/70">
                    {stop.transitFromPrev ?? `→ ${stop.city}`}
                  </span>
                </div>
              )}

              {/* City node */}
              <div className="flex w-20 flex-none flex-col items-center text-center">
                <div
                  className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold text-white shadow-sm"
                  style={{ backgroundColor: CORAL }}
                >
                  {i + 1}
                </div>
                <span className="mt-2 text-sm font-semibold leading-tight text-slate-900">
                  {stop.city}
                </span>
                <span className="mt-1 rounded-full bg-teal-100 px-2 py-0.5 text-[11px] font-medium text-teal-800">
                  {stop.nights} {stop.nights === 1 ? "night" : "nights"}
                </span>
              </div>
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}
