/**
 * Supabase-side wrappers for persisting a generated trip, so the wizard's
 * auto-save hook (`useAutoSaveTrip`) can sequence INSERT / UPDATE / DELETE
 * without re-implementing the row shape, and so tests can swap the
 * implementation behind a clean signature. Called from the browser.
 *
 * Conventions:
 * - All functions throw on Supabase errors; callers translate to UI state.
 * - `attachCoverImage` is fire-and-forget; never throws back to the caller
 *   because a missing cover image must not block save.
 * - Column names match the live `public.trips` schema (`cover_image_url`,
 *   not `cover_image`).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { GeneratedItinerary, TripAnchor, TripVibe } from "@/types";
import { scheduleTripNotifications } from "@/lib/notifications/scheduling";
import { splitCities } from "@/lib/ai/multi-city-core";
import { isSupportedLanguage, resolveAiLanguage } from "@/lib/ai/language";
import { isValidTimeZone } from "@/lib/trip/live";
import { ensureActivityIds } from "@/lib/utils/activity-id";

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
  /**
   * The UI locale the trip was made from (next-intl). Fallback only: the
   * itinerary carries the language it was generated in and that wins.
   */
  locale?: string;
  /**
   * Fixed commitments the traveller pinned on step 1 (a booked flight, a
   * wedding, dinner with a named friend).
   *
   * Persisted because the rendered `locked` flag on an activity is a DERIVED
   * signal — a regeneration or an assistant edit can drop it while the user's
   * original commitment still stands. Anything that has to ask "is this trip
   * built around something private?" (today: the publish guard) needs the
   * source of truth, not just its projection into the itinerary.
   */
  anchors?: TripAnchor[];
  /**
   * Must-do wishlist from wizard step 2. Persisted so post-save
   * surfaces (assistant, regeneration) can keep honouring the traveller's
   * explicit wishes — the same "source of truth vs projection" reasoning
   * as anchors above: an assistant edit can drop the generated activity
   * while the wish still stands.
   */
  mustDos?: string[];
  /**
   * Whether the user said they were travelling solo or with others, from the
   * "Who's coming?" toggle on wizard step 1.
   *
   * Written to the trip so "do our users actually travel in groups?" can be
   * answered from the database (PostHog needs a personal API key to query).
   * The invite / crew / voting / expense-split surface assumes group travel,
   * and stated intent is the cheapest check of that assumption.
   *
   * "unspecified" is not persisted (the key stays absent), so a row carrying
   * trip_intent means the user actively chose.
   */
  tripIntent?: "solo" | "group" | "unspecified";
}

/**
 * Which code path created a trip row, and which wizard mount it came from.
 *
 * Written into trip_meta so a duplicate pair is self-diagnosing instead of
 * needing forensics. The arm is stated rather than inferred from other keys:
 * both arms write trip_meta.destination, so its presence says nothing about
 * which arm saved the row.
 *
 * `mountId` distinguishes "two inserts from ONE wizard mount" (the auto-save
 * ref was cleared — a code bug) from "two inserts from DIFFERENT mounts"
 * (reload or second tab, where the ref legitimately starts null).
 */
export interface SaveOrigin {
  arm: "auto" | "manual";
  /** Stable for the life of one wizard mount. */
  mountId?: string | null;
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
 * handleSaveTrip math in app/[locale]/trips/new/NewTripWizard.tsx).
 */
export function computeDurationDays(formState: TripFormState): number {
  const start = new Date(formState.startDate).getTime();
  const end = new Date(formState.endDate).getTime();
  return Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
}

function buildTripRow(
  input: PersistInput,
  userId: string,
  coverImageUrl: string | null,
  origin?: SaveOrigin,
) {
  const { itinerary, formState } = input;
  // Language the text is written in: the generate routes stamp it on the
  // itinerary; the UI locale covers an itinerary without the stamp.
  const generationLocale = isSupportedLanguage(itinerary.language)
    ? itinerary.language
    : formState.locale
      ? resolveAiLanguage(formState.locale)
      : undefined;
  const tripMeta = {
    // Provenance. See SaveOrigin — cheap to write, and it is what turns the
    // next duplicate-trip report into a query instead of an investigation.
    ...(origin ? { save_arm: origin.arm } : {}),
    ...(origin?.mountId ? { wizard_mount_id: origin.mountId } : {}),
    // Canonical user-specified destination. getTripDestination() prefers this
    // over title-stripping (which breaks on non-English / renamed / multi-city
    // titles). Same value as the cover-image lookup
    // (attachCoverImage(formState.destination)). For multi-city this carries
    // the user's full route string ("A & B").
    destination: formState.destination,
    // Structured route legs. Titles like "Tokyo & Osaka Trip" are display
    // strings; this is the only machine-readable record of the route.
    ...(splitCities(formState.destination).length > 1
      ? { cities: splitCities(formState.destination) }
      : {}),
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
    // Only written when the trip actually has anchors, so the key stays absent
    // (rather than an empty array) on the overwhelming majority of rows — the
    // publish guard reads it with `Array.isArray`, which treats both alike.
    ...(formState.anchors?.length ? { anchors: formState.anchors } : {}),
    // Same absent-when-empty convention for the must-do wishlist.
    ...(formState.mustDos?.length ? { must_dos: formState.mustDos } : {}),
    // Pace the trip was generated at. Always present on the form, so
    // always written — the feasibility strip on the detail/share views reads
    // it to pick the day-time budget; absent (older rows) reads as moderate.
    pace: formState.pace,
    // Every later AI edit reads this before the visitor's cookie, so the
    // trip stays one language. Absent only when neither source knew.
    ...(generationLocale ? { locale: generationLocale } : {}),
    // IANA timezone, so Today mode opens on the correct day wherever the
    // viewer is. Derived server-side by the generate routes from the itinerary
    // coordinates and carried on the itinerary — the same path as `language`.
    // persistTrip runs client-side, so it must never pull in the coordinate
    // table itself; it just reads the resolved string.
    ...(isValidTimeZone(itinerary.timezone) ? { timezone: itinerary.timezone } : {}),
    // Only written when the user actually picked, so `trip_intent is not null`
    // reads as "answered" and the untouched-default case stays distinguishable
    // from a deliberate choice.
    ...(formState.tripIntent === "solo" || formState.tripIntent === "group"
      ? { trip_intent: formState.tripIntent }
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
    // Stored with activity ids (as the wizard's insert): photo enrichment and
    // the trip page's saves refer to activities by id.
    itinerary: ensureActivityIds(itinerary.days),
    cover_image_url: coverImageUrl,
    budget: {
      total: itinerary.trip_summary.total_estimated_cost,
      spent: 0,
      currency: itinerary.trip_summary.currency,
    },
    tags: formState.derivedInterests,
    trip_meta: tripMeta,
    // travel_style is also a real column (migration
    // 20260528_trips_travel_style_column.sql). Written to BOTH (above + here)
    // so readers of either keep working. TODO: drop trip_meta.travel_style
    // once no reader references it.
    travel_style: formState.travelStyle === "backpacker" ? "backpacker" as const : "classic" as const,
    packing_list: itinerary.trip_summary.packing_suggestions,
  };
}

/**
 * Fire-and-forget: ask the server to upgrade a KEPT trip's curated activity
 * photos to real Google Place photos (budget-capped, server-side, owner-only).
 *
 * Trip generation runs with ZERO paid Places lookups (cost control), so only
 * trips that are actually saved pay for real photos. Never throws; a saved trip
 * already has good type-relevant curated images if this no-ops. keepalive so the
 * request survives the same-tab navigation to /trips/[id] right after save
 * (mirrors `attachCoverImage`).
 */
function enrichTripPhotos(tripId: string): void {
  try {
    void fetch(`/api/trips/${tripId}/enrich-photos`, {
      method: "POST",
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Best-effort — never block or fail the save on photo enrichment.
  }
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
  origin?: SaveOrigin,
): Promise<SaveResult> {
  const fallback = pickFallbackCoverImage(input.itinerary);
  const row = buildTripRow(input, userId, fallback, origin);

  // Atomic server-side dedupe. A client-side check-then-insert cannot stop
  // concurrent saves: both pass the SELECT before either INSERT commits. The
  // insert_trip_dedup RPC takes a pg_advisory_xact_lock on (user, title,
  // start_date) so concurrent saves serialize, then runs a 60s-window reuse
  // check, then inserts — one round-trip, no race. SECURITY INVOKER, so RLS
  // still applies and user_id comes from auth.uid() server-side.
  const { data, error } = await supabase
    .rpc("insert_trip_dedup", { p_row: row })
    .single();

  if (error) throw error;
  const result = data as { trip_id: string; reused: boolean } | null;
  if (!result?.trip_id) throw new Error("Trip insert returned no id");

  if (result.reused) {
    // The concurrent first save already ran the side effects below.
    return {
      tripId: result.trip_id,
      durationDays: computeDurationDays(input.formState),
    };
  }

  // A no-op in the browser, where the wizard calls this: the AFTER INSERT
  // trigger on trips (trips_enqueue_notifications) enqueues the trip's
  // reminders. Elsewhere it is gated by isTripNotificationsEnabled() and never
  // re-throws — saving a trip must NEVER fail because the reminder queue is
  // sick. See lib/notifications/scheduling.ts.
  void scheduleTripNotifications({ tripId: result.trip_id, userId });

  enrichTripPhotos(result.trip_id);

  return {
    tripId: result.trip_id,
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

  // Re-enrich photos for the updated (kept) trip — a regeneration may have
  // introduced new curated-fallback activities to upgrade to real photos.
  enrichTripPhotos(tripId);
}

/**
 * Soft-delete a trip row — used by Start Over / Discard after auto-save.
 *
 * Soft, not a hard DELETE, so a discarded trip and the data hanging off it
 * (Concierge conversations, activity timeline) stay recoverable. RLS hides
 * tombstoned rows from every read path, so the discarded autosave doesn't
 * surface anywhere, even in a new wizard run. Recovery is a manual UPDATE
 * deleted_at = NULL from the Supabase SQL editor.
 *
 * Goes through soft_delete_trip(), as the DELETE route in
 * `app/api/trips/[id]/route.ts` does: a direct UPDATE from a user-scoped
 * client (callers here pass the browser client) can never succeed, because
 * a tombstone satisfies no branch of trips_select_consolidated
 * (`deleted_at IS NULL AND ...`), so RLS rejects the new row with 42501.
 */
export async function deleteTrip(
  supabase: SupabaseClient,
  tripId: string,
): Promise<void> {
  // Ownership and the already-deleted guard are enforced inside the
  // function against auth.uid(); it returns false rather than throwing
  // when there was nothing to delete, which keeps discard idempotent.
  const { error } = await supabase.rpc("soft_delete_trip", {
    p_trip_id: tripId,
  });
  if (error) throw error;
}

/**
 * Asynchronously fetch a high-quality cover image for the trip and
 * attach it via UPDATE. Fire-and-forget: never throws, never returns
 * meaningful errors to the caller. Logs to the console on failure.
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

    // Never persist the generic fallback. The route returns one stock photo
    // when it can match neither a curated destination nor a Pexels result, and
    // writing that to the row makes it permanent: every such trip then shows
    // the SAME picture forever, even once the destination becomes matchable.
    // Leaving the column NULL is better: the card falls back to its own
    // gradient, which at least differs per card and is re-resolved on the
    // next attempt.
    if (data.source === "fallback") return;

    await supabase
      .from("trips")
      .update({ cover_image_url: data.url })
      .eq("id", tripId);
  } catch (err) {
    console.error("[trips/persistTrip] attachCoverImage failed:", err);
    // Don't rethrow. Console only: a caught error never reaches Sentry's
    // global handlers.
  }
}
