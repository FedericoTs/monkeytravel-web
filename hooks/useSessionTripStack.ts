"use client";

/**
 * Session-scoped generation counter + trip stack for /trips/new.
 *
 * Save Sprint (2026-07-20): 74% of users who receive a completed itinerary
 * leave without saving — many of them "sample" several generations in one
 * sitting and each new generation silently destroys the previous one. This
 * hook keeps the last MAX_STACK generated trips of the browser session in
 * sessionStorage so the result view can (a) show how many unsaved trips the
 * session has produced and (b) let the user flip back to an earlier one.
 *
 * Storage keys (sessionStorage — per-tab, survives reloads + the OAuth
 * full-page round trip, dies with the tab, never synced anywhere):
 *   - "mt_gen_count"             int   — generations attempted this session
 *   - "mt_session_trips"         JSON  — array of SessionTripSnapshot, cap 5
 *   - "mt_session_trips_current" str   — id of the snapshot currently shown
 *
 * All storage access is wrapped in try/catch (Safari private mode throws on
 * write; some WebViews disable Web Storage entirely). On storage failure the
 * hook degrades to in-memory state for the page's lifetime.
 *
 * The snapshot payload mirrors what hooks/useItineraryDraft.tsx persists
 * (destination/dates/pace/vibes/budgetTier/travelStyle + the itinerary) so a
 * restore can drive the exact same wizard state operations as the existing
 * draft-restore path.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { GeneratedItinerary } from "@/types";

const STACK_KEY = "mt_session_trips";
const CURRENT_KEY = "mt_session_trips_current";
const GEN_COUNT_KEY = "mt_gen_count";
const MAX_STACK = 5;

export interface SessionTripSnapshot {
  id: string;
  destination: string;
  startDate: string;
  endDate: string;
  dayCount: number;
  itinerary: GeneratedItinerary;
  pace: string;
  vibes: string[];
  budgetTier: string;
  travelStyle?: "classic" | "backpacker";
  /**
   * True when this entry got onto the screen via a restore (post-auth silent
   * draft restore, draft-recovery banner, or a tray chip click) rather than a
   * fresh generation. recordGeneration uses it to refresh-in-place instead of
   * duplicating when the SAME trip is re-generated while displayed.
   */
  restored?: boolean;
  createdAt: number;
}

/** Snapshot payload minus the hook-managed bookkeeping fields. */
export type SessionTripData = Omit<
  SessionTripSnapshot,
  "id" | "createdAt" | "restored"
>;

export interface UseSessionTripStackReturn {
  /** Oldest → newest. Never longer than MAX_STACK. */
  trips: SessionTripSnapshot[];
  /** Id of the snapshot currently displayed, when known. */
  currentId: string | null;
  /** Increment mt_gen_count (call at the top of handleGenerate). Returns the new count. */
  bumpGenCount: () => number;
  /** Read mt_gen_count without incrementing (for analytics props). */
  getGenCount: () => number;
  /** Push a successful generation onto the stack (becomes current). */
  recordGeneration: (data: SessionTripData) => void;
  /** Register a draft-restored trip as current (adopts a matching entry instead of duplicating). */
  registerRestore: (data: SessionTripData) => void;
  /**
   * Tray chip click: refresh the currently displayed trip into the stack
   * (so applied assistant edits aren't lost), then mark `targetId` current.
   * Returns the target snapshot to restore, or null if it vanished.
   */
  swapTo: (
    targetId: string,
    currentData: SessionTripData | null
  ) => SessionTripSnapshot | null;
  /** Forget which entry is current (Start Over). Stack entries survive. */
  clearCurrent: () => void;
}

function isSnapshot(v: unknown): v is SessionTripSnapshot {
  if (!v || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  return (
    typeof s.id === "string" &&
    typeof s.destination === "string" &&
    typeof s.startDate === "string" &&
    typeof s.endDate === "string" &&
    typeof s.dayCount === "number" &&
    !!s.itinerary &&
    typeof s.itinerary === "object"
  );
}

function sameTrip(
  a: Pick<SessionTripSnapshot, "destination" | "startDate" | "endDate">,
  b: Pick<SessionTripSnapshot, "destination" | "startDate" | "endDate">
): boolean {
  return (
    a.destination === b.destination &&
    a.startDate === b.startDate &&
    a.endDate === b.endDate
  );
}

function newId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // fall through to the manual id
  }
  // Older Safari (<15.4) / non-secure contexts: good-enough session-local id.
  return `mt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Write the stack + current pointer to sessionStorage. On QuotaExceededError
 * (five full itineraries can be a few hundred KB) evict oldest entries and
 * retry until the write fits. Returns the list that was actually persisted —
 * or the input list untouched when storage is unavailable altogether, so the
 * in-memory experience keeps working for this page's lifetime.
 */
function persistStack(
  trips: SessionTripSnapshot[],
  currentId: string | null
): SessionTripSnapshot[] {
  if (typeof window === "undefined") return trips;
  let list = trips;
  try {
    for (;;) {
      try {
        window.sessionStorage.setItem(STACK_KEY, JSON.stringify(list));
        break;
      } catch (err) {
        if (list.length <= 1) throw err;
        list = list.slice(1); // evict oldest, retry
      }
    }
    if (currentId) {
      window.sessionStorage.setItem(CURRENT_KEY, currentId);
    } else {
      window.sessionStorage.removeItem(CURRENT_KEY);
    }
    return list;
  } catch {
    // Storage blocked (private mode / disabled) — in-memory only.
    return trips;
  }
}

export function useSessionTripStack(): UseSessionTripStackReturn {
  // Initialized empty and hydrated from sessionStorage in a mount effect —
  // same pattern as the wizard's popularPicks — so SSR markup and the first
  // client render can never diverge.
  const [trips, setTrips] = useState<SessionTripSnapshot[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);

  // Synchronous mirrors so mutators can read the latest values without
  // depending on state (handlers stay referentially stable).
  const tripsRef = useRef<SessionTripSnapshot[]>(trips);
  const currentIdRef = useRef<string | null>(currentId);
  // In-memory fallback when sessionStorage is unavailable (private mode).
  const genCountFallbackRef = useRef(0);

  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(STACK_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          const valid = parsed.filter(isSnapshot).slice(-MAX_STACK);
          if (valid.length > 0) {
            tripsRef.current = valid;
            setTrips(valid);
          }
        }
      }
      const cur = window.sessionStorage.getItem(CURRENT_KEY);
      if (cur) {
        currentIdRef.current = cur;
        setCurrentId(cur);
      }
      const rawCount = window.sessionStorage.getItem(GEN_COUNT_KEY);
      const count = rawCount ? Number.parseInt(rawCount, 10) : 0;
      if (Number.isFinite(count) && count > 0) {
        genCountFallbackRef.current = count;
      }
    } catch {
      // Corrupt JSON or storage blocked — start clean, in-memory only.
    }
  }, []);

  const commit = useCallback(
    (nextTrips: SessionTripSnapshot[], nextCurrentId: string | null) => {
      const persisted = persistStack(nextTrips, nextCurrentId);
      tripsRef.current = persisted;
      currentIdRef.current = nextCurrentId;
      setTrips(persisted);
      setCurrentId(nextCurrentId);
    },
    []
  );

  const bumpGenCount = useCallback((): number => {
    let next = genCountFallbackRef.current + 1;
    try {
      const raw = window.sessionStorage.getItem(GEN_COUNT_KEY);
      const cur = raw ? Number.parseInt(raw, 10) : 0;
      next = (Number.isFinite(cur) && cur >= 0 ? cur : 0) + 1;
      window.sessionStorage.setItem(GEN_COUNT_KEY, String(next));
    } catch {
      // Storage blocked — count in memory for this page's lifetime.
    }
    genCountFallbackRef.current = next;
    return next;
  }, []);

  const getGenCount = useCallback((): number => {
    try {
      const raw = window.sessionStorage.getItem(GEN_COUNT_KEY);
      const cur = raw ? Number.parseInt(raw, 10) : 0;
      if (Number.isFinite(cur) && cur >= 0) return cur;
    } catch {
      // fall through to the in-memory count
    }
    return genCountFallbackRef.current;
  }, []);

  const recordGeneration = useCallback(
    (data: SessionTripData) => {
      const list = tripsRef.current;
      const curId = currentIdRef.current;
      const cur = curId ? list.find((t) => t.id === curId) : undefined;
      // Dedupe: re-generating the trip that's on screen via a restore
      // (regenerate after a tray/draft restore) refreshes the existing entry
      // instead of appending a lookalike chip.
      if (cur && cur.restored && sameTrip(cur, data)) {
        const next = list.map((t) =>
          t.id === cur.id
            ? { ...t, ...data, restored: false, createdAt: Date.now() }
            : t
        );
        commit(next, cur.id);
        return;
      }
      const entry: SessionTripSnapshot = {
        ...data,
        id: newId(),
        createdAt: Date.now(),
      };
      // Cap MAX_STACK, FIFO — drop the oldest.
      commit([...list, entry].slice(-MAX_STACK), entry.id);
    },
    [commit]
  );

  const registerRestore = useCallback(
    (data: SessionTripData) => {
      const list = tripsRef.current;
      const match = list.find((t) => sameTrip(t, data));
      if (match) {
        // Adopt the existing entry (content may carry newer assistant edits).
        const next = list.map((t) =>
          t.id === match.id ? { ...t, ...data, restored: true } : t
        );
        commit(next, match.id);
        return;
      }
      const entry: SessionTripSnapshot = {
        ...data,
        id: newId(),
        restored: true,
        createdAt: Date.now(),
      };
      commit([...list, entry].slice(-MAX_STACK), entry.id);
    },
    [commit]
  );

  const swapTo = useCallback(
    (
      targetId: string,
      currentData: SessionTripData | null
    ): SessionTripSnapshot | null => {
      let list = tripsRef.current;
      const curId = currentIdRef.current;
      // Refresh (or, when unknown, push) the trip currently on screen so
      // switching away never loses its latest state (assistant edits, etc).
      if (currentData) {
        const cur = curId ? list.find((t) => t.id === curId) : undefined;
        if (cur) {
          list = list.map((t) =>
            t.id === cur.id ? { ...t, ...currentData } : t
          );
        } else {
          list = [
            ...list,
            { ...currentData, id: newId(), createdAt: Date.now() },
          ];
          if (list.length > MAX_STACK) {
            // Evict the oldest entry that is NOT the restore target — never
            // delete the snapshot the user just clicked.
            const evictIdx = list.findIndex((t) => t.id !== targetId);
            list = list.filter((_, i) => i !== evictIdx);
          }
        }
      }
      const target = list.find((t) => t.id === targetId);
      if (!target) {
        commit(list, curId);
        return null;
      }
      const next = list.map((t) =>
        t.id === targetId ? { ...t, restored: true } : t
      );
      commit(next, targetId);
      return { ...target, restored: true };
    },
    [commit]
  );

  const clearCurrent = useCallback(() => {
    commit(tripsRef.current, null);
  }, [commit]);

  return {
    trips,
    currentId,
    bumpGenCount,
    getGenCount,
    recordGeneration,
    registerRestore,
    swapTo,
    clearCurrent,
  };
}
