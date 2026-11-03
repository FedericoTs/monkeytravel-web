"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useToast } from "@/components/ui/Toast";
import { captureEditModeDiscarded, captureEditModeEntered, captureEditModeSaved } from "@/lib/posthog/events";
import {
  createItinerarySync,
  ItineraryWriteBlockedError,
  latestKnownVersion,
  readItineraryVersion,
  type ServerItinerary,
} from "@/lib/trips/itinerary-sync";
import { ensureActivityIdsStable } from "@/lib/utils/activity-id";
import type { Activity, ItineraryDay } from "@/types";

interface ItinerarySyncOptions {
  trip: {
    id: string;
    itinerary: ItineraryDay[];
    itineraryVersion?: number | null;
    startDate: string;
    endDate: string;
  };
  /** The stored itinerary as first loaded, with stable activity ids. */
  initialItinerary: ItineraryDay[];
  editedItinerary: ItineraryDay[];
  setEditedItinerary: Dispatch<SetStateAction<ItineraryDay[]>>;
  isEditMode: boolean;
  setIsEditMode: (editing: boolean) => void;
  /** A solo owner's edits save themselves; everyone else uses edit mode and Save. */
  ambientEdit: boolean;
  /** The payload whose auto-save last failed; undo and redo clear it too. */
  lastFailedSaveRef: MutableRefObject<string | null>;
  clearHistory: () => void;
  setRenderEpoch: Dispatch<SetStateAction<number>>;
  setAiUpdatedActivityId: Dispatch<SetStateAction<string | null>>;
}

/**
 * Where the latest edit stands: nothing to save, saving, saved, failed, or
 * refused because the trip changed elsewhere (a conflict to settle).
 */
export type ItinerarySaveStatus = "idle" | "saving" | "saved" | "error" | "conflict";

/**
 * The trip page's saves. It keeps the saved copy of the itinerary and the
 * version it was saved at, and sends edits through one queue
 * (lib/trips/itinerary-sync.ts): a solo owner's auto-save, the explicit Save of
 * edit mode, and the server writes this tab starts. A save refused because the
 * trip changed elsewhere becomes a conflict for the planner to settle.
 */
export function useItinerarySync({
  trip,
  initialItinerary,
  editedItinerary,
  setEditedItinerary,
  isEditMode,
  setIsEditMode,
  ambientEdit,
  lastFailedSaveRef,
  clearHistory,
  setRenderEpoch,
  setAiUpdatedActivityId,
}: ItinerarySyncOptions) {
  const t = useTranslations("trips");
  const router = useRouter();
  const { addToast } = useToast();

  // Track the last saved state (so we can detect changes and revert without page reload)
  const [savedItinerary, setSavedItinerary] = useState<ItineraryDay[]>(initialItinerary);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  // Ambient-edit auto-save status ('idle' | 'saving' | 'saved' | 'error' |
  // 'conflict'). Drives the small status pill that replaces the
  // Modifica/Save/Discard cluster for solo owners (see ambientEdit below).
  const [saveStatus, setSaveStatus] = useState<ItinerarySaveStatus>("idle");

  // Itinerary save queue + base version (lib/trips/itinerary-sync.ts). Every
  // itinerary PATCH, and every server write this tab starts, goes through it
  // one at a time, so the tab never 409s on itself.
  // INVARIANT: savedItinerary and sync.baseVersion() only ever change
  // together. router.refresh() re-renders props with a newer version while
  // this state keeps the older content, and a base taken from props alone
  // would then pass the check while reverting someone else's work. Props seed
  // the queue here; newer props are adopted only as a pair, content and
  // version together (see the router-cache effect below).
  const propsVersion = readItineraryVersion(trip.itineraryVersion);
  const [sync] = useState(() => createItinerarySync({ tripId: trip.id, initialVersion: propsVersion }));
  // A save refused because the trip changed elsewhere (a trip mate, another
  // tab). The ref mirrors the state for code running inside the queue.
  const [conflict, setConflictState] = useState<{ server: ServerItinerary; source: "save" | "autosave" } | null>(null);
  const conflictRef = useRef<typeof conflict>(null);
  const setConflict = useCallback((next: typeof conflict) => {
    conflictRef.current = next;
    setConflictState(next);
  }, []);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  // The itinerary JSON that still needs persisting (set when a save is
  // scheduled, cleared on success). Read by the unmount-flush effect so an
  // edit made within the debounce window isn't lost to a client-side
  // navigation (beforeunload doesn't fire on SPA route changes).
  const pendingSaveRef = useRef<string | null>(null);
  // sync.epoch() when that pending payload was built (see sendPendingInline).
  const pendingEpochRef = useRef(0);
  // Server itinerary writes this tab started and that have not finished
  // (regenerate a day, assistant, concierge, add from email). The explicit
  // Save waits for them: a Save clicked mid-write would send a copy without
  // the write's result.
  const [itineraryWritesInFlight, setItineraryWritesInFlight] = useState(0);
  // Auto-saves are queued, never aborted: an aborted fetch does not stop a
  // PATCH the server already received, and the next save would then carry an
  // outdated base version.
  // Fire the manual-edit adoption metric (captureEditModeSaved) at most once
  // per page-view, not once per debounced flush — otherwise the ambient cohort
  // inflates edit_mode_saved relative to the AI-agent comparison metric.
  const editCapturedRef = useRef(false);

  // Track if there are unsaved changes (compare against saved state, not prop)
  const hasChanges = JSON.stringify(editedItinerary) !== JSON.stringify(savedItinerary);
  // For code running inside the save queue. (ambientEdit's ref is kept in step
  // further down, before the id-minting effect.)
  const hasChangesRef = useRef(hasChanges);
  useEffect(() => {
    hasChangesRef.current = hasChanges;
  }, [hasChanges]);
  const isEditModeRef = useRef(isEditMode);
  useEffect(() => {
    isEditModeRef.current = isEditMode;
  }, [isEditMode]);
  const ambientEditRef = useRef(false);
  // handleRefetchTrip is declared further down; callbacks above reach it here.
  const refetchTripRef = useRef<((options?: { onlyIfUnedited?: boolean }) => Promise<boolean>) | null>(null);

  // A save landed: the payload is the saved copy at `version` (null from an
  // older server). Replies arrive in queue order, so an older version can only
  // show up after a reset (Load latest); ignore it then.
  const adoptSaved = useCallback(
    (payload: string, version: number | null) => {
      const base = sync.baseVersion();
      if (version !== null && base !== null && version < base) return;
      if (version !== null) sync.adopt(version);
      setSavedItinerary(JSON.parse(payload));
    },
    [sync]
  );

  // Send the pending ambient auto-save, if any. Runs INSIDE the queue only
  // (flushPendingSave / runItineraryWrite); never enqueue from in here.
  const sendPendingInline = useCallback(async () => {
    const payload = pendingSaveRef.current;
    if (!payload || payload === lastFailedSaveRef.current || conflictRef.current) return;
    // Built before the base moved to content this edit does not contain (a
    // day regeneration this tab started landed while the save waited in the
    // queue, or a server copy was loaded) and React has not re-rendered the
    // edit on top of it yet. Sent now it would revert that content; the effect
    // re-builds it from the new state. (A base moved by this tab's own earlier
    // autosave keeps the epoch: the pending edit is built on top of it.)
    if (pendingEpochRef.current !== sync.epoch()) return;
    const base = sync.baseVersion();
    const result = await sync.send(payload, base);
    if (result.kind === "saved") {
      if (pendingSaveRef.current === payload) pendingSaveRef.current = null;
      adoptSaved(payload, result.version);
      lastFailedSaveRef.current = null;
      if (!pendingSaveRef.current) setSaveStatus("saved");
      // Manual-edit adoption metric: ONCE per page-view, not per debounced
      // flush, so the ambient cohort stays comparable to ai_assistant_used.
      if (!editCapturedRef.current) {
        editCapturedRef.current = true;
        const snapshot = JSON.parse(payload) as ItineraryDay[];
        void captureEditModeSaved({
          trip_id: trip.id,
          days_count: snapshot.length,
          activities_count: snapshot.reduce((acc, day) => acc + day.activities.length, 0),
        });
      }
    } else if (result.kind === "conflict") {
      setConflict({ server: result.server, source: "autosave" });
      setSaveStatus("conflict");
      if (!mountedRef.current) {
        console.warn("[trip-autosave] an edit was not saved: the trip was changed elsewhere");
      }
    } else {
      console.warn("[trip-autosave] failed", result.status);
      lastFailedSaveRef.current = payload;
      setSaveStatus("error");
    }
  }, [lastFailedSaveRef, sync, adoptSaved, trip.id, setConflict]);

  const flushPendingSave = useCallback(() => sync.enqueue(sendPendingInline), [sync, sendPendingInline]);

  // A server-side itinerary write started from this tab (regenerate a day,
  // assistant apply/undo, concierge apply, add from email). Pending edits are
  // saved first and the task runs alone, so the version it returns is the one
  // this tab can adopt.
  // Most of these writes start from the server's copy and the page then takes
  // the result as its own copy, so they must not start over unsaved edits.
  // `keepsLocalEdits`: the result is merged into the page's copy instead
  // (regenerate a day splices one day in), so unsaved edits elsewhere survive.
  const runItineraryWrite = useCallback(
    <T,>(task: () => Promise<T>, options?: { keepsLocalEdits?: boolean }): Promise<T> => {
      setItineraryWritesInFlight((n) => n + 1);
      return sync
        .enqueue(async () => {
          // One more try for an autosave that failed: this write starts from
          // the stored copy (and a retry adopts a save whose reply was lost).
          lastFailedSaveRef.current = null;
          await sendPendingInline();
          // Edits held by a conflict: the write and the refetch after it would
          // silently replace them and dismiss the choice. The user picks first.
          if (conflictRef.current) throw new ItineraryWriteBlockedError(t("detail.writeBlockedConflict"));
          // Still unsaved: the autosave failed, or is being re-built on a copy
          // that just changed, or an editor in edit mode has not saved yet.
          // (Only real editing counts: outside edit mode there is nothing the
          // person could save, so it must never block.)
          const unsavedEdit =
            pendingSaveRef.current !== null ||
            (!ambientEditRef.current && isEditModeRef.current && hasChangesRef.current);
          if (!options?.keepsLocalEdits && unsavedEdit) {
            throw new ItineraryWriteBlockedError(t("detail.writeBlockedUnsaved"));
          }
          return task();
        })
        .finally(() => setItineraryWritesInFlight((n) => n - 1));
    },
    [sync, lastFailedSaveRef, sendPendingInline, t]
  );

  useEffect(() => {
    ambientEditRef.current = ambientEdit;
  }, [ambientEdit]);
  // Activities stored without an id got derived ids on this load. Solo owners
  // store them once, because photos, crew asks and votes refer to activities
  // by id. Safe on every mount: the ids are the same for the same stored copy,
  // so a sibling mount's save that landed first counts as this one (409 with
  // equal content = saved), and a stale copy (router cache) gets a 409 and
  // takes the stored copy when nothing is edited.
  useEffect(() => {
    if (!ambientEdit || propsVersion === null) return;
    const payload = JSON.stringify(initialItinerary);
    if (payload === JSON.stringify(trip.itinerary)) return; // nothing minted
    const base = sync.baseVersion();
    void sync.enqueue(async () => {
      if (sync.baseVersion() !== base || conflictRef.current) return;
      const result = await sync.send(payload, base);
      if (result.kind === "saved") {
        adoptSaved(payload, result.version);
      } else if (result.kind === "conflict" && !pendingSaveRef.current && !hasChangesRef.current) {
        // Changed since this page loaded, and nothing is edited here yet: no
        // choice to make, take the stored copy.
        const fresh = ensureActivityIdsStable(result.server.itinerary, trip.id);
        sync.reset(result.server.version);
        setSavedItinerary(fresh);
        setEditedItinerary(JSON.parse(JSON.stringify(fresh)));
        clearHistory();
        setRenderEpoch((v) => v + 1);
      }
    });
    // Mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The explicit Save (editors, and owners of trips with collaborators),
  // through the queue with the base version. A stale save stays in edit mode
  // and shows the conflict choice instead of overwriting.
  const saveExplicit = useCallback(
    async (payload: string, snapshot: ItineraryDay[], base: number | null) => {
      setIsSaving(true);
      setSaveError(null);
      setSaveSuccess(false);
      try {
        const result = await sync.enqueue(() => sync.send(payload, base));
        if (result.kind === "conflict") {
          setConflict({ server: result.server, source: "save" });
          return;
        }
        if (result.kind === "failed") throw new Error(`Failed to save changes (${result.status ?? "network"})`);

        adoptSaved(payload, result.version);
        // Exit edit mode on success. The ref now too: a write queued behind
        // this save runs before React re-renders and must not see "editing
        // with unsaved changes" from the render before.
        isEditModeRef.current = false;
        setIsEditMode(false);
        // Instrument a completed manual edit — the head-to-head counterpart to
        // ai_assistant_used, so we can compare who edits via the drag-and-drop
        // editor vs the AI agent.
        void captureEditModeSaved({
          trip_id: trip.id,
          days_count: snapshot.length,
          activities_count: snapshot.reduce((acc, day) => acc + day.activities.length, 0),
        });
        // Show success feedback, auto-hidden after 3 seconds
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 3000);
      } catch (error) {
        console.error("Error saving changes:", error);
        setSaveError(t("detail.saveChangesFailed"));
      } finally {
        setIsSaving(false);
      }
    },
    [sync, adoptSaved, setIsEditMode, trip.id, setConflict, t]
  );

  const handleSaveChanges = useCallback(async () => {
    if (conflictRef.current || itineraryWritesInFlight > 0) return;
    // "Done" with nothing changed: nothing to send. PATCHing the unchanged
    // itinerary from a stale tab would get a false 409.
    if (!hasChanges) {
      setIsEditMode(false);
      return;
    }
    // The base is taken with the content it belongs to.
    await saveExplicit(JSON.stringify(editedItinerary), editedItinerary, sync.baseVersion());
  }, [itineraryWritesInFlight, hasChanges, saveExplicit, editedItinerary, sync, setIsEditMode]);

  // Conflict choice 1: take the version saved elsewhere, drop local changes.
  const handleLoadLatest = useCallback(() => {
    const c = conflictRef.current;
    if (!c) return;
    const fresh = ensureActivityIdsStable(c.server.itinerary, trip.id);
    sync.reset(c.server.version);
    setSavedItinerary(fresh);
    setEditedItinerary(JSON.parse(JSON.stringify(fresh)));
    pendingSaveRef.current = null;
    lastFailedSaveRef.current = null;
    // Undo snapshots predate the adopted version; replaying one would
    // silently revert the changes just loaded.
    clearHistory();
    setConflict(null);
    if (!ambientEdit) setIsEditMode(false);
    setSaveStatus("saved");
    setRenderEpoch((v) => v + 1);
    addToast(t("detail.conflictLoadedLatest"), "success");
  }, [trip.id, sync, setEditedItinerary, lastFailedSaveRef, clearHistory, setConflict, ambientEdit, setIsEditMode, setRenderEpoch, addToast, t]);

  // Conflict choice 2: keep my version, saved on top of the newer one (a
  // rebase: the base becomes the server's version, the content stays mine).
  const handleKeepMine = useCallback(() => {
    const c = conflictRef.current;
    if (!c) return;
    sync.reset(c.server.version);
    setSavedItinerary(ensureActivityIdsStable(c.server.itinerary, trip.id));
    setConflict(null);
    lastFailedSaveRef.current = null;
    const payload = JSON.stringify(editedItinerary);
    if (c.source === "autosave") {
      pendingSaveRef.current = payload;
      pendingEpochRef.current = sync.epoch();
      setSaveStatus("saving");
      void flushPendingSave();
    } else {
      void saveExplicit(payload, editedItinerary, c.server.version);
    }
  }, [sync, trip.id, setConflict, lastFailedSaveRef, editedItinerary, flushPendingSave, saveExplicit]);

  const handleDiscardChanges = useCallback(() => {
    // With a conflict pending, "discard" means the version saved elsewhere,
    // not this tab's stale copy.
    if (conflictRef.current) {
      handleLoadLatest();
      void captureEditModeDiscarded({ trip_id: trip.id });
      return;
    }
    // Revert to last saved state (not trip.itinerary prop, which may be stale)
    setEditedItinerary(JSON.parse(JSON.stringify(savedItinerary)));
    setIsEditMode(false);
    setSaveError(null);
    clearHistory(); // Clear undo/redo stacks
    void captureEditModeDiscarded({ trip_id: trip.id });
  }, [setEditedItinerary, savedItinerary, setIsEditMode, clearHistory, trip.id, handleLoadLatest]);

  const handleEnterEditMode = useCallback(() => {
    // Start editing from the last saved state
    setEditedItinerary(JSON.parse(JSON.stringify(savedItinerary)));
    setIsEditMode(true);
    clearHistory(); // Start fresh undo/redo stacks
    // Instrument manual-editor adoption.
    void captureEditModeEntered({ trip_id: trip.id, days_count: savedItinerary.length });
  }, [setEditedItinerary, savedItinerary, setIsEditMode, clearHistory, trip.id]);

  // Warn user about unsaved changes when navigating away
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasChanges) {
        e.preventDefault();
        e.returnValue = ''; // Required for Chrome
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasChanges]);

  // A page restored from the client router cache (browser Back/Forward)
  // starts from the props it was first rendered with, which can be older than
  // this tab's own later saves; its first save would then be refused against
  // this person's own work. Ask the server for fresh props...
  useEffect(() => {
    const known = latestKnownVersion(trip.id);
    if (known !== null && propsVersion !== null && known > propsVersion) router.refresh();
    // Mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // ...and take newer props (content and version together, in the queue) as
  // long as nothing on the page is edited, waiting to save, or in conflict.
  useEffect(() => {
    if (propsVersion === null) return;
    const itinerary = trip.itinerary;
    void sync.enqueue(async () => {
      const base = sync.baseVersion();
      if (base === null || propsVersion <= base) return;
      if (pendingSaveRef.current || hasChangesRef.current || conflictRef.current) return;
      const fresh = ensureActivityIdsStable(itinerary, trip.id);
      sync.reset(propsVersion);
      setSavedItinerary(fresh);
      setEditedItinerary(JSON.parse(JSON.stringify(fresh)));
      clearHistory();
      setRenderEpoch((v) => v + 1);
    });
  }, [trip.id, propsVersion, trip.itinerary, sync, clearHistory, setEditedItinerary, setRenderEpoch]);

  // Ambient auto-save. For solo owners there's no Save button — every
  // drag/delete/edit/add persists in the background after a short debounce.
  // Collaborative trips (ambientEdit=false) keep their explicit Save via
  // handleSaveChanges and never enter this effect.
  useEffect(() => {
    if (!ambientEdit) return;
    // In sync with the server (a save just landed, OR the user undid back to
    // the saved baseline). Nothing to persist: drop the pending marker, clear
    // any stale failed-payload guard, and reconcile the pill so it never
    // falsely lingers on "error"/"saving" once we're back in sync.
    if (!hasChanges) {
      pendingSaveRef.current = null;
      lastFailedSaveRef.current = null;
      setSaveStatus(conflictRef.current ? "conflict" : "saved");
      return;
    }
    const payload = JSON.stringify(editedItinerary);
    // Don't auto-retry a payload we already know fails — wait for a real new
    // edit (undo/redo also clears the guard so history navigation retries).
    if (payload === lastFailedSaveRef.current) return;
    pendingSaveRef.current = payload;
    // Effects run after a commit, and every epoch change is made together
    // with the content it belongs to, so this is the payload's own epoch.
    pendingEpochRef.current = sync.epoch();
    // The trip changed elsewhere: hold every save until the user chooses
    // (Load latest / Keep mine), or each would 409 again.
    if (conflictRef.current) {
      setSaveStatus("conflict");
      return;
    }
    setSaveStatus("saving");
    // Queued, never aborted: see flushPendingSave / lib/trips/itinerary-sync.ts.
    const timer = setTimeout(() => {
      void flushPendingSave();
    }, 1000);
    return () => clearTimeout(timer);
  }, [ambientEdit, hasChanges, editedItinerary, conflict, flushPendingSave, sync, lastFailedSaveRef]);

  // Flush a pending ambient auto-save on unmount. Client-side (SPA) navigation
  // — the back-to-trips <Link>, the bottom-nav tabs — does NOT fire the
  // beforeunload guard above, so an edit made inside the 1s debounce window
  // would otherwise be silently dropped. The JS realm survives an SPA nav, so
  // the queued save completes in the background; hard document unloads are
  // still covered by the beforeunload warning. Queued behind any save in
  // flight, so the same payload is never sent twice.
  const flushRef = useRef(flushPendingSave);
  useEffect(() => {
    flushRef.current = flushPendingSave;
  }, [flushPendingSave]);
  useEffect(() => {
    return () => {
      void flushRef.current();
    };
  }, []);

  // Changes from the assistant reach the page through handleRefetchTrip,
  // inside the save queue.

  // Refetch trip data from the database (called after AI modifications)
  // Resolves true when the stored copy was taken. With onlyIfUnedited it is
  // not taken if an edit arrived while reading (a regenerate's re-read must
  // not drop it).
  const handleRefetchTrip = useCallback(async (options?: { onlyIfUnedited?: boolean }): Promise<boolean> => {
    console.log("[TripDetailClient] Refetching trip data from database...");
    try {
      // The write before this already landed: without this read the page
      // keeps an older copy and version, and its next save is refused against
      // this person's own change. One retry for a blip.
      const read = () =>
        fetch(`/api/trips/${trip.id}`, {
          cache: 'no-store', // Ensure we get fresh data
          headers: {
            'Cache-Control': 'no-cache',
          },
        });
      let response = await read().catch(() => null);
      if (!response?.ok) {
        await new Promise((resolve) => setTimeout(resolve, 800));
        response = await read();
      }
      if (!response.ok) {
        throw new Error(`Failed to fetch trip: ${response.status}`);
      }
      const data = await response.json();
      console.log("[TripDetailClient] Trip data fetched successfully:", {
        tripId: data.trip?.id,
        itineraryDays: data.trip?.itinerary?.length,
        firstDayActivities: data.trip?.itinerary?.[0]?.activities?.map((a: Activity) => a.name),
      });

      if (data.trip?.itinerary) {
        if (options?.onlyIfUnedited && (pendingSaveRef.current !== null || hasChangesRef.current)) return false;
        // Deep clone to ensure we're working with fresh data
        const freshItinerary = JSON.parse(JSON.stringify(data.trip.itinerary));
        const processedItinerary = ensureActivityIdsStable(freshItinerary, trip.id);

        console.log("[TripDetailClient] Processed itinerary:", {
          days: processedItinerary.length,
          day1Activities: processedItinerary[0]?.activities?.map((a: Activity) => a.name),
        });

        // Find changed activities for animation
        let changedId: string | undefined;
        for (let dayIdx = 0; dayIdx < processedItinerary.length; dayIdx++) {
          const newDay = processedItinerary[dayIdx];
          const oldDay = editedItinerary[dayIdx];
          if (newDay && oldDay) {
            // Check if activity count changed (added activity)
            if (newDay.activities.length !== oldDay.activities.length) {
              // Find the new activity
              for (const act of newDay.activities) {
                const exists = oldDay.activities.some((a: Activity) => a.id === act.id || a.name === act.name);
                if (!exists) {
                  console.log("[TripDetailClient] Found new activity:", act.name);
                  changedId = act.id;
                  break;
                }
              }
            } else {
              // Check for replaced activity
              for (let actIdx = 0; actIdx < newDay.activities.length; actIdx++) {
                const newAct = newDay.activities[actIdx];
                const oldAct = oldDay.activities[actIdx];
                if (oldAct && newAct.name !== oldAct.name) {
                  console.log("[TripDetailClient] Found replaced activity:", oldAct.name, "->", newAct.name);
                  changedId = newAct.id;
                  break;
                }
              }
            }
          }
        }

        // Force update by creating new array reference
        console.log("[TripDetailClient] Updating state with new itinerary...");
        const freshCopy = [...processedItinerary];
        // The change is already stored (assistant apply/undo, add from email):
        // this copy IS the saved one, at the version it was read with, in both
        // modes, so nobody has to "confirm" a change that is already saved.
        // Runs only inside runItineraryWrite, so nothing else writes between
        // the server write and this read.
        const version = readItineraryVersion(data.trip?.itinerary_version);
        if (version !== null) sync.reset(version);
        setEditedItinerary(freshCopy);
        setSavedItinerary(JSON.parse(JSON.stringify(freshCopy)));
        pendingSaveRef.current = null;
        lastFailedSaveRef.current = null;
        if (conflictRef.current) setConflict(null);
        // Undo snapshots predate this copy (which may hold a trip mate's
        // changes too): replaying one would pass the version check and revert them.
        clearHistory();
        setRenderEpoch((v) => {
          const newVersion = v + 1;
          console.log("[TripDetailClient] Itinerary version bumped to:", newVersion);
          return newVersion;
        });

        // Highlight it until the animation ends, unless a newer change took over
        if (changedId) {
          const highlighted = changedId;
          setAiUpdatedActivityId(highlighted);
          setTimeout(() => setAiUpdatedActivityId((id) => (id === highlighted ? null : id)), 2000);
        }

        // The hero and countdown read the dates and day count from props, and
        // adding days or undoing them moves end_date: take fresh props then.
        // The effect above keeps the itinerary just read (same version).
        if (data.trip.start_date !== trip.startDate || data.trip.end_date !== trip.endDate) router.refresh();

        console.log("[TripDetailClient] State update complete - UI should re-render now");
        return true;
      } else {
        console.error("[TripDetailClient] No itinerary in response:", data);
        return false;
      }
    } catch (error) {
      console.error("[TripDetailClient] Failed to refetch trip:", error);
      throw error;
    }
  }, [trip.id, trip.startDate, trip.endDate, sync, setEditedItinerary, lastFailedSaveRef, setConflict, clearHistory, setRenderEpoch, router, editedItinerary, setAiUpdatedActivityId]);
  useEffect(() => {
    refetchTripRef.current = handleRefetchTrip;
  }, [handleRefetchTrip]);

  // A change the server already stored (an approved proposal): the stored copy
  // is taken in the queue, unless a conflict holds this page's edits.
  const refetchQueued = useCallback(
    () =>
      sync.enqueue(async () => {
        if (!conflictRef.current) await refetchTripRef.current?.({ onlyIfUnedited: true });
      }),
    [sync]
  );

  // A day regenerated on the server (`splice` puts it into a copy), stored on
  // top of version `from` as version `to`. Runs inside runItineraryWrite.
  const adoptDayWrite = useCallback(
    async (splice: (it: ItineraryDay[]) => ItineraryDay[], from: number | null, to: number | null) => {
      // The day is already stored. When the server wrote it on top of the
      // version this tab holds, it is part of the saved copy too; if
      // someone else wrote in between, the next save correctly gets a 409.
      if (from !== null && to !== null && from === sync.baseVersion()) {
        const epoch = sync.epoch();
        sync.adoptWrite(to);
        setSavedItinerary(splice);
        // Move an edit pending since before this write onto it now (the
        // same string the effect will build), so it is still sent if the
        // page unmounts before React re-renders.
        if (pendingSaveRef.current && pendingEpochRef.current === epoch) {
          pendingSaveRef.current = JSON.stringify(splice(JSON.parse(pendingSaveRef.current) as ItineraryDay[]));
          pendingEpochRef.current = sync.epoch();
        }
      } else if (
        (!ambientEditRef.current && !isEditModeRef.current) ||
        (pendingSaveRef.current === null && !hasChangesRef.current)
      ) {
        // Someone else wrote first and this page has no edits of its own
        // (or is only viewing): show the stored copy, the new day and what
        // changed since the page loaded, instead of a local splice whose
        // next save is sure to be refused. The day is stored either way:
        // if the read fails, fall back to a server refresh of the props.
        let tookStored = false;
        try {
          tookStored = (await refetchTripRef.current?.({ onlyIfUnedited: true })) ?? false;
        } catch (err) {
          console.warn("[regenerate-day] stored, but the page could not re-read the trip", err);
          router.refresh();
          return;
        }
        if (tookStored) return;
        // An edit arrived while re-reading: keep it, with the day spliced
        // in; its save gets the conflict choice (below).
        hasChangesRef.current = true;
      } else {
        // Kept on top of this page's own edits; the next save carries the
        // older base and gets the conflict choice. Marked now, before
        // React renders, so a queued adoption of newer props does not
        // replace it.
        hasChangesRef.current = true;
      }
      setEditedItinerary(splice);
    },
    [sync, router, setEditedItinerary]
  );

  // The concierge's apply, already stored at `serverVersion`.
  const adoptStoredItinerary = useCallback(
    (next: ItineraryDay[], serverVersion?: number | null) => {
      // The /apply endpoint already persisted this itinerary —
      // adopt it as BOTH edited and saved state, with the version it
      // was written at (runs inside the save queue), so the ambient
      // auto-save doesn't immediately re-PATCH an identical body.
      const withIds = ensureActivityIdsStable(next, trip.id);
      if (serverVersion != null) sync.reset(serverVersion);
      setEditedItinerary(withIds);
      setSavedItinerary(JSON.parse(JSON.stringify(withIds)));
      if (conflictRef.current) setConflict(null);
      // As in handleRefetchTrip: older undo snapshots would revert it.
      clearHistory();
      setRenderEpoch((v) => v + 1);
    },
    [trip.id, sync, setEditedItinerary, setConflict, clearHistory, setRenderEpoch]
  );

  return {
    savedItinerary,
    setSavedItinerary,
    hasChanges,
    saveStatus,
    isSaving,
    saveError,
    setSaveError,
    saveSuccess,
    setSaveSuccess,
    conflict,
    itineraryWritesInFlight,
    runItineraryWrite,
    handleSaveChanges,
    handleLoadLatest,
    handleKeepMine,
    handleDiscardChanges,
    handleEnterEditMode,
    handleRefetchTrip,
    refetchQueued,
    adoptDayWrite,
    adoptStoredItinerary,
  };
}
