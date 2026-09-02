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

/**
 * Why an itinerary was NOT auto-saved. `not_authenticated` is the ordinary
 * anonymous case; `auth_pending` means the result landed before the client
 * resolved auth (the save runs once it does); `disabled` is the env kill
 * switch. Reported once per itinerary identity — until 2026-09-02 every one
 * of these was a silent early return, which is how six signed-in users lost
 * generations in a month with no event of any kind.
 */
export type AutoSaveSkipReason = "not_authenticated" | "disabled" | "auth_pending" | "pending_claim";

/** Backoff between attempts. Three attempts total, ~5.5s worst case. */
export const DEFAULT_RETRY_DELAYS_MS: readonly number[] = [1500, 4000];

export interface UseAutoSaveTripOptions {
  /** The latest generated itinerary, or null when wizard is pre-generation. */
  itinerary: GeneratedItinerary | null;
  /** Authenticated state from the parent page. null = not yet known; false = anon. */
  isAuthenticated: boolean | null;
  /** Master kill-switch. When false the hook is inert. */
  enabled: boolean;
  /**
   * The itinerary on screen already exists as an anonymous trip this browser
   * shared, and its claim has not reported yet (lib/trips/pending-claim.ts).
   * Parks the hook with skip reason "pending_claim"; flip back once the
   * claim is adopted (pass adoptedTripId) or released.
   */
  deferred?: boolean;
  /**
   * A trip row that already holds this itinerary: a claimed anonymous share.
   * Adopted as the saved trip - no insert; later edits update that row.
   */
  adoptedTripId?: string | null;
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
  /**
   * Called ONCE, after every retry has failed. Defaults to console.error —
   * callers that want to see failures in production must pass their own
   * (the wizard reports to Sentry, PostHog and the server funnel).
   */
  onError?: (error: Error, info: { attempts: number }) => void;
  /**
   * Called once per itinerary identity when a rendered itinerary is NOT
   * auto-saved and why. See AutoSaveSkipReason.
   */
  onSkipped?: (reason: AutoSaveSkipReason) => void;
  /** Backoff schedule between attempts; tests pass [0, 0]. */
  retryDelaysMs?: readonly number[];
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
  onSkipped,
  deferred = false,
  adoptedTripId = null,
  retryDelaysMs = DEFAULT_RETRY_DELAYS_MS,
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
    onSkipped,
  });
  useEffect(() => {
    callbacksRef.current = {
      saveTrip,
      updateTrip,
      deleteTrip,
      attachCoverImage,
      onPersisted,
      onError,
      onSkipped,
    };
  }, [saveTrip, updateTrip, deleteTrip, attachCoverImage, onPersisted, onError, onSkipped]);
  const retryDelaysRef = useRef(retryDelaysMs);
  useEffect(() => {
    retryDelaysRef.current = retryDelaysMs;
  }, [retryDelaysMs]);

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
      // Retry with backoff (2026-09-02). One transient network or PostgREST
      // error used to be terminal: a single throw, a console.error nobody
      // could see, and the itinerary was never attempted again. Each attempt
      // re-reads savedTripIdRef, so a retry after an INSERT that succeeded
      // server-side but failed to report becomes an UPDATE, never a second
      // INSERT (the insert_trip_dedup advisory lock backstops that too).
      const delays = retryDelaysRef.current;
      let attempt = 0;
      for (;;) {
        attempt += 1;
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
          return;
        } catch (err) {
          const e = err instanceof Error ? err : new Error(String(err));
          if (attempt <= delays.length) {
            await new Promise((resolve) => setTimeout(resolve, delays[attempt - 1]));
            continue;
          }
          setError(e);
          setStatus("error");
          (cbs.onError ?? defaultOnError)(e, { attempts: attempt });
          return;
        }
      }
    },
    [],
  );

  // Auto-save trigger.
  //
  // Serialization (2026-08-10): a new itinerary object identity landing while
  // an INSERT is still in flight used to start a SECOND concurrent persist —
  // savedTripIdRef was still null, so both took the INSERT branch, and the
  // server's 60s dedupe was check-then-insert so both passed (19 duplicate
  // trips measured, gaps 0.0-0.35s: streaming finalize / day-edit apply /
  // draft restore all mint new identities). Chaining on the pending promise
  // means the second persist waits, sees savedTripIdRef set, and correctly
  // becomes an UPDATE with the latest content. The server-side advisory-lock
  // RPC (insert_trip_dedup) backstops paths this ref can't see (two tabs,
  // remounts).
  // Every early return below used to be silent. Report a skipped save once per
  // itinerary identity so "rendered a result, never attempted a save" is
  // visible — the signature six signed-in users left in 30 days (2026-09).
  // Adopt a row that already holds this itinerary (a claimed anonymous
  // share). Declared before the persist effect below so that, in the render
  // where the deferral lifts and the id arrives together, adoption runs
  // first and the persist effect sees "already attempted" instead of inserting.
  useEffect(() => {
    if (!adoptedTripId || savedTripIdRef.current === adoptedTripId) return;
    savedTripIdRef.current = adoptedTripId;
    setSavedTripId(adoptedTripId);
    setStatus("saved");
    setError(null);
    lastAttemptedItineraryRef.current = itinerary;
  }, [adoptedTripId, itinerary]);
  const skipReportedForRef = useRef<GeneratedItinerary | null>(null);
  useEffect(() => {
    if (!itinerary) return;
    const skipReason: AutoSaveSkipReason | null = !enabled
      ? "disabled"
      : deferred
        ? "pending_claim"
        : isAuthenticated === null
        ? "auth_pending"
        : !isAuthenticated
          ? "not_authenticated"
          : null;
    if (skipReason) {
      if (skipReportedForRef.current !== itinerary) {
        skipReportedForRef.current = itinerary;
        callbacksRef.current.onSkipped?.(skipReason);
      }
      return;
    }
    if (lastAttemptedItineraryRef.current === itinerary) return;
    lastAttemptedItineraryRef.current = itinerary;

    const prev = pendingSaveRef.current;
    const chained: Promise<void> = (
      prev ? prev.catch(() => {}).then(() => persist(itinerary)) : persist(itinerary)
    ).finally(() => {
      // Only clear if no newer save has been chained on since.
      if (pendingSaveRef.current === chained) pendingSaveRef.current = null;
    });
    pendingSaveRef.current = chained;
  }, [enabled, deferred, isAuthenticated, itinerary, persist]);

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
      (callbacksRef.current.onError ?? defaultOnError)(e, { attempts: 1 });
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

function defaultOnError(err: Error, info: { attempts: number }): void {
  console.error(`[useAutoSaveTrip] save error after ${info.attempts} attempt(s):`, err);
}
