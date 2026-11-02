import type { ItineraryDay, TripMeta } from "@/types";
import { tripPackingList } from "@/lib/trips/packing";
import type { SharedTrip } from "./SharedTripView";

/** The columns of a stored trip that the shared view reads. */
interface StoredTrip {
  id: string;
  title: string;
  description?: string;
  status: string;
  start_date: string;
  end_date: string;
  tags?: string[];
  budget?: unknown;
  shared_at?: string;
  trip_meta?: unknown;
  packing_list?: unknown;
}

/**
 * The trip as SharedTripView shows it, from its stored row and the
 * itinerary the page prepared: the share link's page and the public page
 * show the same trip.
 */
export function sharedViewTrip(trip: StoredTrip, itinerary: ItineraryDay[]): SharedTrip {
  const meta = (trip.trip_meta as TripMeta) || {};
  return {
    id: trip.id,
    title: trip.title,
    description: trip.description,
    status: trip.status,
    startDate: trip.start_date,
    endDate: trip.end_date,
    tags: trip.tags,
    budget: trip.budget as { total: number; currency: string } | null,
    itinerary,
    sharedAt: trip.shared_at,
    meta,
    packingList: tripPackingList(trip.packing_list, meta),
    // Worked out locally when the trip was saved, so the view needs no API.
    cachedTravelDistances: meta.travel_distances,
    cachedTravelHash: meta.travel_distances_hash,
  };
}
