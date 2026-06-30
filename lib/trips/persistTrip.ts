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
import { scheduleTripNotifications } from "@/lib/notifications/scheduling";

export interface TripFormState {
  destination: string;
  startDate: string;
  endDate: string;
  budgetTier: "budget" | "balanced" | "premium";
  pace: "relaxed" | "moderate" | "active";
  vibes: TripVibe[];
  /** Auto-derived from vibes — kept on input so the hook stays pure. */
  derivedInterests: string[];
  /**
   * Travel style preset from the wizard. Stored on the trip so the
   * detail / share / explore views can light up backpacker-specific
   * affordances (hostel CTAs, "Backpacker route" badge, etc.). Optional
   * for backwards compat — old drafts have no value.
   */
  travelStyle?: "classic" | "backpacker";
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
    // Canonical user-specified destination. getTripDestination() prefers this
    // over title-stripping (which breaks on non-English / renamed / multi-city
    // titles). It was previously NEVER written here — a latent bug, despite the
    // comment in lib/trips/destination.ts claiming the wizard sets it — so the
    // helper always fell back to the title strip. Mirrors the value already
    // used for the cover-image lookup (attachCoverImage(formState.destination)).
    // For multi-city this carries the user's full route string ("A & B").
    destination: formState.destination,
    weather_note: itinerary.destination.weather_note,
    highlights: itinerary.trip_summary.highlights,
    booking_links: itinerary.booking_links,
    destination_best_for: itinerary.destination.best_for,
    packing_suggestions: itinerary.trip_summary.packing_suggestions,
    // Persist travel style on the trip so downstream views can branch on
    // it without re-asking the wizard. Only write the field when it's
    // explicitly "backpacker" — undefined defaults to classic, keeping
    // existing rows readable as-is.
    ...(formState.travelStyle === "backpacker"
      ? { travel_style: "backpacker" as const }
      : {}),
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
    // 2026-05-28 — Tier 1.1 migration promoted travel_style from JSONB
    // to a real column. We write to BOTH (above + here) during the
    // transition so any existing reader keeps working. trip_meta can
    // be cleaned up in a later pass once no reader references it.
    travel_style: formState.travelStyle === "backpacker" ? "backpacker" as const : "classic" as const,
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

  // Server-side dedupe (defense in depth). The autosave hook serializes
  // calls within a single mount via pendingSaveRef, but cross-tab saves,
  // hook remounts, or any other caller of insertTrip can still hit the
  // race. Before inserting, check if the same user already has a trip
  // with the same title + start_date created in the last 60s. If so,
  // reuse it — same contract as the row would have had on first save.
  // RLS scopes the SELECT to the caller's own trips.
  //
  // Surfaced 2026-06-01: paul.harrington@hostelworld.com landed 2 identical
  // Warsaw trips 4 seconds apart on signup. The NewTripWizard manual-save
  // path got its own dedupe in commit 31e1d41; this is the autosave-path
  // counterpart.
  const sixtySecondsAgo = new Date(Date.now() - 60_000).toISOString();
  const { data: existing } = await supabase
    .from("trips")
    .select("id")
    .eq("user_id", userId)
    .eq("title", row.title)
    .eq("start_date", row.start_date)
    .gte("created_at", sixtySecondsAgo)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing?.id) {
    return {
      tripId: existing.id,
      durationDays: computeDurationDays(input.formState),
    };
  }

  const { data, error } = await supabase
    .from("trips")
    .insert(row)
    .select("id")
    .single();

  if (error) throw error;
  if (!data?.id) throw new Error("Trip insert returned no id");

  // Fire-and-forget enqueue of the pre-trip reminder cascade. Internally
  // gated by NEXT_PUBLIC_CALENDAR_EXPORT_ENABLED; a failed enqueue logs
  // + Sentry-captures but never re-throws — saving a trip must NEVER
  // fail because the reminder queue is sick. See
  // lib/notifications/scheduling.ts for the full contract.
  void scheduleTripNotifications({ tripId: data.id, userId });

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
 * Soft-delete a trip row — used by Start Over / Discard after auto-save.
 *
 * Switched from hard DELETE to UPDATE deleted_at = NOW() on 2026-06-07
 * alongside the trips_soft_delete migration. See
 * `app/api/trips/[id]/route.ts` for the full rationale (david-cassoni
 * incident: trip + 7 Concierge questions lost when the row vanished).
 *
 * RLS hides tombstoned rows from every read path, so even if the user
 * immediately starts a new wizard run the discarded autosave doesn't
 * surface anywhere. Recovery is a manual UPDATE deleted_at = NULL from
 * the Supabase SQL editor.
 */
export async function deleteTrip(
  supabase: SupabaseClient,
  tripId: string,
): Promise<void> {
  const { error } = await supabase
    .from("trips")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", tripId)
    .is("deleted_at", null);
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
