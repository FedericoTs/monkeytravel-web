import type { SupabaseClient } from "@supabase/supabase-js";
import { isBudgetTier, type ItineraryDay } from "@/types";
import { tripLocale } from "@/lib/ai/language";
import { dietsFrom } from "@/lib/trips/diet";
import { getTripDestination } from "@/lib/trips/destination";
import { casUpdateItinerary } from "@/lib/trips/itinerary-cas";
import { applyPlaceChanges, PLACES_TO_EAT_CHECKED_AT, type PlaceChange } from "./kept-trip";
import { placesToEatCheck, type PlacesToEatResult } from "./places-to-eat";

/** The trip as the check reads it. */
export interface KeptTripForCheck {
  id: string;
  user_id: string;
  title?: string | null;
  itinerary: unknown;
  itinerary_version: number | null;
  trip_meta: unknown;
  budget: unknown;
}

export type KeptTripCheck =
  /**
   * Stored, with the check's stamp: the changes, made on top of version
   * `fromVersion` as `itineraryVersion` (the same version when there are none).
   */
  | { status: "checked"; changes: PlaceChange[]; fromVersion: number; itineraryVersion: number; result: PlacesToEatResult }
  /**
   * Nothing stored: the check is off, Google answered none of its searches, or
   * the trip changed too often meanwhile. Due again on the next open.
   */
  | { status: "none"; result?: PlacesToEatResult };

/**
 * The row's trip_meta with the check's stamp. A trip whose plan took the
 * owner's profile diet (the planner was asked for none) keeps the diets it was
 * checked for: its later AI edits (a day or an activity made again, the
 * assistant's new day) read the trip's own diet, and a trip mate who asks for
 * one cannot read the owner's profile.
 */
function checkedMeta(meta: unknown, stamp: string, diets: string[]): Record<string, unknown> {
  const m = (meta ?? {}) as Record<string, unknown>;
  return { ...m, [PLACES_TO_EAT_CHECKED_AT]: stamp, ...(dietsFrom(m.dietary).length === 0 ? { dietary: diets } : {}) };
}

/**
 * Looks up a kept trip's places to eat for its diets (keptTripDiets) and
 * stores what changed, with those diets on a trip that had none of its own.
 * The write is a compare-and-set on the itinerary's version, and each change
 * lands only where its place still is as it was, so an edit made meanwhile
 * stays.
 */
export async function checkKeptTripPlacesToEat(
  db: SupabaseClient,
  trip: KeptTripForCheck,
  diets: string[],
): Promise<KeptTripCheck> {
  const meta = (trip.trip_meta ?? {}) as Record<string, unknown>;
  const tier = (trip.budget as { tier?: unknown } | null)?.tier;
  const check = placesToEatCheck({
    destination: getTripDestination(trip),
    dietary: diets,
    budgetTier: isBudgetTier(tier) ? tier : "balanced",
    travelStyle: meta.travel_style === "backpacker" ? "backpacker" : "classic",
    language: tripLocale(meta) ?? undefined,
    userId: trip.user_id,
  });
  if (!check || !Array.isArray(trip.itinerary)) return { status: "none" };

  const result = await check.finish(structuredClone(trip.itinerary as ItineraryDay[]));
  // Google down or the key refused: looked up on the next open, not never.
  if (result.checked > 0 && result.unanswered === result.checked) return { status: "none", result };

  const stamp = new Date().toISOString();
  const outcome = await casUpdateItinerary(db, {
    tripId: trip.id,
    ownerId: trip.user_id,
    from: { itinerary: trip.itinerary, itinerary_version: Number(trip.itinerary_version ?? 0), trip_meta: trip.trip_meta },
    change: (row) =>
      Array.isArray(row.itinerary)
        ? {
            itinerary: applyPlaceChanges(row.itinerary as ItineraryDay[], result.changes),
            extra: { trip_meta: checkedMeta(row.trip_meta, stamp, diets) },
          }
        : null,
  });
  if (outcome.status !== "written") return { status: "none", result };
  return {
    status: "checked",
    changes: result.changes,
    fromVersion: outcome.fromVersion,
    itineraryVersion: outcome.itineraryVersion,
    result,
  };
}
