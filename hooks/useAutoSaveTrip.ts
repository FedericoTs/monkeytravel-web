"use client";

/**
 * Auto-save the most recent generated trip itinerary as soon as it
 * appears, gated by the `auto-save-v1` PostHog feature flag.
 *
 * Why this lives in a hook (not inline in /trips/new/page.tsx):
 * Two failure modes were the highest-risk parts of this change —
 *
 *   1. Regenerate race: user clicks Regenerate while an INSERT is
 *      in flight, then the second INSERT fires before the first
 *      finishes, and the wrong itinerary wins.
 *   2. State drift across the page's 5 `handleGenerate` callsites:
 *      ad-hoc ref mutation in any one of them would silently leak
 *      the saved trip id and cause double-INSERTs or stale UPDATEs.
 *
 * Putting the save state machine here means there's exactly one
 * owner of `savedTripId`, `saving`, and the in-flight save promise,
 * and exactly one effect that decides INSERT vs UPDATE. The wizard
 * page calls `regenerate()` and `discard()` instead of poking refs
 * directly — collapses the integration surface from "audit 5
 * callsites" to "audit one hook".
 *
 * Tests in hooks/useAutoSaveTrip.vitest.tsx exercise the dedup,
 * regenerate-await, error path, and discard delete.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { GeneratedItinerary } from "@/types";
import type {
  PersistInput,
  SaveResult,
  TripFormState,
} from "@/lib/trips/persistTrip";

type SaveTripFn = (input: PersistInput) => Promise<SaveResult>;
type UpdateTripFn = (tripId: string, input: PersistInput) => Promise<void>;
type DeleteTripFn = (tripId: string) => Promise<void>;
type AttachCoverFn = (tripId: string, destination: string) => Promise<void>;

export type AutoSaveStatus = "idle" | "saving" | "saved" | "error";

export interface UseAutoSaveTripOptions {
  /** The latest generated itinerary, or null when wizard is pre-generation. */
  itinerary: GeneratedItinerary | null;
  /** Authenticated state from the parent page. null = not yet known; false = anon. */
  isAuthenticated: boolean | null;
  /** Master kill-switch. When false the hook is inert. */
  enabled: boolean;
  /** Form state needed to build the trip row. Read via ref so the hook
   *  doesn't re-run on every keystroke. */
  formState: TripFormState;
  /** Bound save/update/delete functions — production passes wrappers
   *  around the Supabase client; tests pass mocks. */
  saveTrip: SaveTripFn;
  updateTrip: UpdateTripFn;
  deleteTrip: DeleteTripFn;
  attachCoverImage?: AttachCoverFn;
  /** Called once per successful persist with mode="insert" or "update".
   *  Wires to GA4 + referral + PostHog `trip_created` from the page. */
  onPersisted?: (
    tripId: string,
    durationDays: number,
    mode: "insert" | "update",
  ) => void;
  /** Called once when an error occurs. Defaults to console.error. */
  onError?: (error: Error) => void;
}

export interface UseAutoSaveTripReturn {
  status: AutoSaveStatus;
  savedTripId: string | null;
  error: Error | null;
  /** Manual retry button. No-op while a save is in flight. */
  retry: () => Promise<void>;
  /**
   * Call BEFORE clearing the itinerary in the parent. Awaits any
   * in-flight save so the next save reliably becomes an UPDATE
   * (matching the just-persisted row), not a stale INSERT.
   */
  regenerate: () => Promise<void>;
  /**
   * Permanently delete the auto-saved trip and reset the hook to idle.
   * Used by the StartOver flow.
   */
  discard: () => Promise<void>;
}

export function useAutoSaveTrip({
  itinerary,
  isAuthenticated,
  enabled,
  formState,
  saveTrip,
  updateTrip,
  deleteTrip,
  attachCoverImage,
  onPersisted,
  onError,
}: UseAutoSaveTripOptions): UseAutoSaveTripReturn {
  const [status, setStatus] = useState<AutoSaveStatus>("idle");
  const [savedTripId, setSavedTripId] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);

  // Refs so the auto-save effect can read the latest values without
  // having to depend on them and re-fire on every render.
  const formStateRef = useRef(formState);
  useEffect(() => {
    formStateRef.current = formState;
  }, [formState]);

  const callbacksRef = useRef({
    saveTrip,
    updateTrip,
    deleteTrip,
    attachCoverImage,
    onPersisted,
    onError,
  });
  useEffect(() => {
    callbacksRef.current = {
      saveTrip,
      updateTrip,
      deleteTrip,
      attachCoverImage,
      onPersisted,
      onError,
    };
  }, [saveTrip, updateTrip, deleteTrip, attachCoverImage, onPersisted, onError]);

  // Synchronous mirror of savedTripId for use inside the persist
  // function; setState is async so reading it directly would race.
  const savedTripIdRef = useRef<string | null>(null);
  useEffect(() => {
    savedTripIdRef.current = savedTripId;
  }, [savedTripId]);

  // Holds the in-flight save promise so regenerate()/discard() can
  // await before tearing down state. Cleared in `finally`.
  const pendingSaveRef = useRef<Promise<void> | null>(null);

  // Tracks which itinerary reference we last attempted to persist.
  // Prevents a double-fire of the effect on the same value (React 18
  // strict mode, hot reload, parent re-renders that don't actually
  // change the itinerary).
  const lastAttemptedItineraryRef = useRef<GeneratedItinerary | null>(null);

  const persist = useCallback(
    async (it: GeneratedItinerary) => {
      const cbs = callbacksRef.current;
      const form = formStateRef.current;
      const input: PersistInput = { itinerary: it, formState: form };

      setStatus("saving");
      setError(null);
      try {
        if (savedTripIdRef.current) {
          // UPDATE path — preserve trip id across regenerations.
          const id = savedTripIdRef.current;
          await cbs.updateTrip(id, input);
          const durationDays = computeDurationDaysLocal(form);
          cbs.onPersisted?.(id, durationDays, "update");
          setStatus("saved");
        } else {
          // INSERT path — first-time save.
          const result = await cbs.saveTrip(input);
          savedTripIdRef.current = result.tripId;
          setSavedTripId(result.tripId);
          cbs.onPersisted?.(result.tripId, result.durationDays, "insert");
          setStatus("saved");

          // Fire-and-forget cover image fetch. Doesn't block the
          // "saved" state transition or further regenerations.
          if (cbs.attachCoverImage) {
            void cbs.attachCoverImage(result.tripId, form.destination);
          }
        }
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        setError(e);
        setStatus("error");
        (cbs.onError ?? defaultOnError)(e);
      }
    },
    [],
  );

  // Auto-save trigger.
  useEffect(() => {
    if (!enabled) return;
    if (!isAuthenticated) return;
    if (!itinerary) return;
    if (lastAttemptedItineraryRef.current === itinerary) return;
    lastAttemptedItineraryRef.current = itinerary;

    pendingSaveRef.current = persist(itinerary).finally(() => {
      pendingSaveRef.current = null;
    });
  }, [enabled, isAuthenticated, itinerary, persist]);

  const retry = useCallback(async () => {
    if (!itinerary) return;
    if (pendingSaveRef.current) return;
    // Force the effect's dedup guard to allow a fresh attempt.
    lastAttemptedItineraryRef.current = null;
    pendingSaveRef.current = persist(itinerary).finally(() => {
      pendingSaveRef.current = null;
    });
    await pendingSaveRef.current;
  }, [itinerary, persist]);

  const regenerate = useCallback(async () => {
    // Wait for any in-flight save to settle so the next persist sees
    // savedTripIdRef set and chooses UPDATE rather than INSERT.
    if (pendingSaveRef.current) {
      try {
        await pendingSaveRef.current;
      } catch {
        // Surfaces via state — don't block regen.
      }
    }
    // Reset the dedup ref so the next setItinerary triggers a save.
    lastAttemptedItineraryRef.current = null;
  }, []);

  const discard = useCallback(async () => {
    if (pendingSaveRef.current) {
      try {
        await pendingSaveRef.current;
      } catch {
        // Already surfaced via state.
      }
    }
    const id = savedTripIdRef.current;
    if (!id) {
      // Nothing to delete — just reset.
      setStatus("idle");
      setSavedTripId(null);
      setError(null);
      lastAttemptedItineraryRef.current = null;
      return;
    }
    try {
      await callbacksRef.current.deleteTrip(id);
    } catch (err) {
      // Surface but don't block reset — the user wanted to start over.
      const e = err instanceof Error ? err : new Error(String(err));
      (callbacksRef.current.onError ?? defaultOnError)(e);
    } finally {
      savedTripIdRef.current = null;
      setSavedTripId(null);
      setStatus("idle");
      setError(null);
      lastAttemptedItineraryRef.current = null;
    }
  }, []);

  return {
    status,
    savedTripId,
    error,
    retry,
    regenerate,
    discard,
  };
}

function computeDurationDaysLocal(form: TripFormState): number {
  const start = new Date(form.startDate).getTime();
  const end = new Date(form.endDate).getTime();
  return Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
}

function defaultOnError(err: Error): void {
  console.error("[useAutoSaveTrip] save error:", err);
}
