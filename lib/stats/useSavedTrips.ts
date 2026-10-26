"use client";

import { useEffect, useState } from "react";
import { buildSavedPlaceIndex, savedTripsFor, type SavedPlace, type SavedPlaceIndex } from "./saved-places";

/**
 * One request per page load, shared by every card: the counted places come
 * from /api/stats/saved-places, a file the CDN serves to everyone. A failed
 * request shows no counts rather than an error.
 */
let index: Promise<SavedPlaceIndex> | null = null;

function loadIndex(): Promise<SavedPlaceIndex> {
  index ??= fetch("/api/stats/saved-places")
    .then((res) => (res.ok ? (res.json() as Promise<{ places?: SavedPlace[] }>) : { places: [] }))
    .then((body) => buildSavedPlaceIndex(Array.isArray(body.places) ? body.places : []))
    .catch(() => new Map());
  return index;
}

/** How many trips saved this place, or null until known or when it is not counted. */
export function useSavedTrips(name: string | undefined, coordinates: { lat: number; lng: number } | undefined): number | null {
  const [trips, setTrips] = useState<number | null>(null);
  const lat = coordinates?.lat;
  const lng = coordinates?.lng;

  useEffect(() => {
    if (!name || lat === undefined || lng === undefined) return;
    let alive = true;
    loadIndex().then((places) => {
      if (alive) setTrips(savedTripsFor(places, name, { lat, lng }));
    });
    return () => {
      alive = false;
    };
  }, [name, lat, lng]);

  return trips;
}
