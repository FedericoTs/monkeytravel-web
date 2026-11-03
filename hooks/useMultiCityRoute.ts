"use client";

import { useEffect, useState } from "react";
import type { RouteStop } from "@/components/trips/MultiCityRouteBuilder";
import { joinCities } from "@/lib/ai/multi-city-core";
import { addIsoDaysOrThrow } from "@/lib/dates/iso-date";
import { routeLegs } from "@/lib/wizard/generation-request";

/** A new route: two cities still to choose, three nights and two. */
function freshCityRows(): RouteStop[] {
  return [
    { city: "", nights: 3 },
    { city: "", nights: 2 },
  ];
}

/**
 * Step 1's multi-city route: the mode and its city + nights rows. While it is
 * on, the route is mirrored into the destination (the cities, joined) and the
 * end date (the start plus the nights), so step 1's checks, the draft and the
 * result keep working through the single-city paths.
 *
 * Arriving with ?multi=1 (the route cards on /multi-city-trip-planner and the
 * route blog posts) turns the mode on, with the linked city as the first leg.
 * Without that, a link like ?destination=rome&multi=1 would lose the city: the
 * mirror rewrites the destination from the rows, empty on arrival, so Rome
 * would be blanked a tick after it was filled in.
 */
export function useMultiCityRoute({
  enabled,
  deepLinked,
  linkedCity,
  startDate,
  setDestination,
  setEndDate,
}: {
  /** NEXT_PUBLIC_MULTI_CITY_ENABLED. */
  enabled: boolean;
  /** The page was opened with ?multi=1. */
  deepLinked: boolean;
  /** The city the link named, if any. */
  linkedCity: string | null;
  startDate: string;
  setDestination: (destination: string) => void;
  setEndDate: (endDate: string) => void;
}) {
  const [multiCityMode, setMultiCityMode] = useState(false);
  const [cityRows, setCityRows] = useState<RouteStop[]>(freshCityRows);

  useEffect(() => {
    if (enabled && deepLinked) {
      setMultiCityMode(true);
      if (linkedCity) {
        setCityRows((rows) => (rows[0]?.city ? rows : [{ ...rows[0], city: linkedCity }, ...rows.slice(1)]));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!enabled || !multiCityMode) return;
    const legs = routeLegs(cityRows);
    setDestination(joinCities(legs.map((r) => r.city)));
    const total = legs.reduce((s, r) => s + r.nights, 0);
    if (startDate && total > 0) setEndDate(addIsoDaysOrThrow(startDate, total - 1));
  }, [enabled, multiCityMode, cityRows, startDate, setDestination, setEndDate]);

  /** Back to a single city and a new route (Start Over). */
  const resetRoute = () => {
    setMultiCityMode(false);
    setCityRows(freshCityRows());
  };

  return {
    multiCityMode,
    setMultiCityMode,
    cityRows,
    setCityRows,
    resetRoute,
  };
}
