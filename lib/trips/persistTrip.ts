/**
 * Supabase-side wrappers for persisting a generated trip. Pulled out of
 * `app/[locale]/trips/new/page.tsx`'s old monolithic `handleSaveTrip` so
 * the orchestration hook (`useAutoSaveTrip`) can sequence INSERT / UPDATE
 * / DELETE without re-implementing the row shape, and so callers in
 * tests can swap the implementation behind a clean signature.
 *
 * Conventions:
 * - All functions throw on Supabase errors; callers translate to UI state.
 * - `attachCoverImage` is fire-and-forget; never throws back to the caller
 *   because a missing cover image must not block save.
 * - Column names match the live `public.trips` schema (`cover_image_url`,
 *   not `cover_image`; verified 2026-05-02).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { GeneratedItinerary, TripVibe } from "@/types";

export interface TripFormState {
  destination: string;
  startDate: string;
  endDate: string;
  budgetTier: "budget" | "balanced" | "premium";
  pace: "relaxed" | "moderate" | "active";
  vibes: TripVibe[];
  /** Auto-derived from vibes — kept on input so the hook stays pure. */
  derivedInterests: string[];
}

export interface PersistInput {
  itinerary: GeneratedItinerary;
  formState: TripFormState;
}

export interface SaveResult {
  tripId: string;
  durationDays: number;
}

/**
 * Walk the itinerary's activities for a usable Google Places photo URL.
 * Synchronous, local data only — safe to run in the critical save path.
 */
export function pickFallbackCoverImage(
  itinerary: GeneratedItinerary,
): string | null {
  for (const day of itinerary.days) {
    for (const activity of day.activities) {
      if (activity.image_url && activity.image_url.includes("googleapis.com")) {
        return activity.image_url;
      }
    }
  }
  return null;
}

/**
 * Compute trip duration in days, inclusive of the end date (matches the
 * existing handleSaveTrip math at app/[locale]/trips/new/page.tsx).
 */
export function computeDurationDays(formState: TripFormState): number {
  const start = new Date(formState.startDate).getTime();
  const end = new Date(formState.endDate).getTime();
  return Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
}

function buildTripRow(input: PersistInput, userId: string, coverImageUrl: string | null) {
  const { itinerary, formState } = input;
  const tripMeta = {
    weather_note: itinerary.destination.weather_note,
    highlights: itinerary.trip_summary.highlights,
    booking_links: itinerary.booking_links,
    destination_best_for: itinerary.destination.best_for,
    packing_suggestions: itinerary.trip_summary.packing_suggestions,
  };

  return {
    user_id: userId,
    title: `${itinerary.destination.name} Trip`,
    description: itinerary.destination.description,
    start_date: formState.startDate,
    end_date: formState.endDate,
    status: "planning" as const,
    visibility: "private" as const,
    itinerary: itinerary.days,
    cover_image_url: coverImageUrl,
    budget: {
      total: itinerary.trip_summary.total_estimated_cost,
      spent: 0,
      currency: itinerary.trip_summary.currency,
    },
    tags: formState.derivedInterests,
    trip_meta: tripMeta,
    packing_list: itinerary.trip_summary.packing_suggestions,
  };
}

/**
 * INSERT a new trip row. Returns the new id + duration. Throws on RLS
 * failure or missing user. Cover image is set from the local fallback
 * only — the remote `/api/images/destination` lookup is deferred and
 * runs via `attachCoverImage` after the row exists.
 */
export async function insertTrip(
  supabase: SupabaseClient,
  input: PersistInput,
  userId: string,
): Promise<SaveResult> {
  const fallback = pickFallbackCoverImage(input.itinerary);
  const row = buildTripRow(input, userId, fallback);

  const { data, error } = await supabase
    .from("trips")
    .insert(row)
    .select("id")
    .single();

  if (error) throw error;
  if (!data?.id) throw new Error("Trip insert returned no id");

  return {
    tripId: data.id,
    durationDays: computeDurationDays(input.formState),
  };
}

/**
 * UPDATE an existing trip row in place — used when the user regenerates
 * after auto-save. Preserves the trip id so collaborators / share links
 * keep working across regenerations.
 */
export async function updateTrip(
  supabase: SupabaseClient,
  tripId: string,
  input: PersistInput,
  userId: string,
): Promise<void> {
  const fallback = pickFallbackCoverImage(input.itinerary);
  const row = buildTripRow(input, userId, fallback);

  const { error } = await supabase
    .from("trips")
    .update(row)
    .eq("id", tripId);

  if (error) throw error;
}

/**
 * DELETE a trip row — used by Start Over / Discard after auto-save.
 */
export async function deleteTrip(
  supabase: SupabaseClient,
  tripId: string,
): Promise<void> {
  const { error } = await supabase.from("trips").delete().eq("id", tripId);
  if (error) throw error;
}

/**
 * Asynchronously fetch a high-quality cover image for the trip and
 * attach it via UPDATE. Fire-and-forget: never throws, never returns
 * meaningful errors to the caller. Logs to console + Sentry on failure.
 *
 * Uses fetch keepalive so the request survives a same-tab navigation
 * to /trips/[id] right after save.
 */
export async function attachCoverImage(
  supabase: SupabaseClient,
  tripId: string,
  destination: string,
): Promise<void> {
  try {
    const response = await fetch(
      `/api/images/destination?destination=${encodeURIComponent(destination)}`,
      { keepalive: true },
    );
    if (!response.ok) return;
    const data = await response.json();
    if (!data?.url) return;

    await supabase
      .from("trips")
      .update({ cover_image_url: data.url })
      .eq("id", tripId);
  } catch (err) {
    console.error("[trips/persistTrip] attachCoverImage failed:", err);
    // Sentry capture handled by the global instrumentation. Don't rethrow.
  }
}
