import type { SupabaseClient } from "@supabase/supabase-js";
import type { ItineraryDay } from "@/types";

/**
 * Compare-and-set write of trips.itinerary for server code that reads the
 * itinerary, waits on something slow (Gemini, Places), and writes it back.
 *
 * A blind write there overwrites whatever anyone saved during the wait, and
 * since 20260924125000 it also moves itinerary_version under an open tab,
 * which then gets a false 409 on its next save. Here the write only lands if
 * the version is still the one the change was computed from; on a miss the
 * row is re-read and the change is recomputed on the fresh copy (by id or day
 * number, never by position), up to `attempts` times.
 */

export interface ItineraryRow {
  itinerary: unknown;
  itinerary_version: number;
  trip_meta?: unknown;
}

export type CasOutcome =
  | { status: "written"; itinerary: ItineraryDay[]; fromVersion: number; itineraryVersion: number }
  | { status: "skipped" }
  | { status: "missing" }
  | { status: "busy" };

export async function casUpdateItinerary(
  db: SupabaseClient,
  opts: {
    tripId: string;
    /** Adds user_id = ownerId to the write and the re-read (owner-only routes). */
    ownerId?: string;
    from: ItineraryRow;
    /** The new itinerary for this row, or null to give up (e.g. the day is gone). */
    change: (
      row: ItineraryRow,
      attempt: number
    ) => { itinerary: ItineraryDay[]; extra?: Record<string, unknown> } | null;
    attempts?: number;
  }
): Promise<CasOutcome> {
  const attempts = opts.attempts ?? 3;
  let row = opts.from;

  for (let attempt = 0; attempt < attempts; attempt++) {
    const next = opts.change(row, attempt);
    if (!next) return { status: "skipped" };

    let write = db
      .from("trips")
      .update({ ...(next.extra ?? {}), itinerary: next.itinerary })
      .eq("id", opts.tripId)
      .eq("itinerary_version", row.itinerary_version);
    if (opts.ownerId) write = write.eq("user_id", opts.ownerId);
    const { data: written, error } = await write.select("itinerary_version");
    if (error) throw error;

    const landed = Array.isArray(written) ? written[0] : null;
    if (landed) {
      return {
        status: "written",
        itinerary: next.itinerary,
        fromVersion: row.itinerary_version,
        itineraryVersion: Number((landed as { itinerary_version: number }).itinerary_version),
      };
    }

    let read = db.from("trips").select("itinerary, itinerary_version, trip_meta").eq("id", opts.tripId);
    if (opts.ownerId) read = read.eq("user_id", opts.ownerId);
    const { data: fresh, error: readError } = await read.maybeSingle();
    if (readError) throw readError;
    if (!fresh) return { status: "missing" };
    const freshRow = fresh as ItineraryRow;
    // Same version and still no row written: not a race, the write was refused.
    if (freshRow.itinerary_version === row.itinerary_version) return { status: "missing" };
    row = freshRow;
  }
  return { status: "busy" };
}
