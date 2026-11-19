"use client";

import { useEffect, useState, type SetStateAction } from "react";
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
 * route blog posts) starts with the mode on, from the first render (the
 * server's too), with the linked city as the first leg. Without that, a link
 * like ?destination=rome&multi=1 would lose the city: the mirror rewrites the
 * destination from the rows, so Rome would be blanked as it was filled in.
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
  const arrivesAsRoute = enabled && deepLinked;
  const [multiCityMode, setMode] = useState(arrivesAsRoute);
  const [cityRows, setCityRows] = useState<RouteStop[]>(() => {
    const rows = freshCityRows();
    return arrivesAsRoute && linkedCity ? [{ ...rows[0], city: linkedCity }, ...rows.slice(1)] : rows;
  });

  // The place typed before step 1's offered route was taken ("Thailand"): the
  // route stands for it while on, and the switch gives it back when the
  // traveller turns the route off, rather than the route's cities as one place.
  const [routeFrom, setRouteFrom] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !multiCityMode) return;
    const legs = routeLegs(cityRows);
    setDestination(joinCities(legs.map((r) => r.city)));
    const total = legs.reduce((s, r) => s + r.nights, 0);
    if (startDate && total > 0) setEndDate(addIsoDaysOrThrow(startDate, total - 1));
  }, [enabled, multiCityMode, cityRows, startDate, setDestination, setEndDate]);

  const resolve = (next: SetStateAction<boolean>) => (typeof next === "function" ? next(multiCityMode) : next);

  /**
   * The mode, as the page sets it (a request read as a route, a draft
   * restored): turned off, an offered route's place is forgotten, since what
   * the page puts in the destination next is another trip's.
   */
  const setMultiCityMode = (next: SetStateAction<boolean>) => {
    const on = resolve(next);
    setMode(on);
    if (!on) setRouteFrom(null);
  };

  /** Step 1's switch: an offered route turned off gives back the place it stood for. */
  const switchMultiCity = (next: SetStateAction<boolean>) => {
    const on = resolve(next);
    setMode(on);
    if (on || routeFrom === null) return;
    setDestination(routeFrom);
    setRouteFrom(null);
  };

  /** The route step 1 offered for a place typed as a whole country or region, taken. */
  const takeRoute = (rows: RouteStop[], place: string) => {
    setCityRows(rows);
    setMode(true);
    setRouteFrom(place);
  };

  /** Back to a single city and a new route (Start Over). */
  const resetRoute = () => {
    setMultiCityMode(false);
    setCityRows(freshCityRows());
  };

  return {
    multiCityMode,
    setMultiCityMode,
    switchMultiCity,
    cityRows,
    setCityRows,
    resetRoute,
    routeFrom,
    takeRoute,
  };
}
