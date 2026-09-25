import type { ItineraryDay } from "@/types";

/**
 * One tab's itinerary save queue and base version (20260924125000).
 *
 * WHY
 * The trip page saved the whole itinerary from its own copy with no check, so
 * an owner and an editor (or two tabs) silently overwrote each other. Saves
 * now carry baseItineraryVersion, the version the tab's saved copy was read
 * at, and a stale save gets a 409 with the current itinerary.
 *
 * The hard part is not the check but never tripping it on yourself. So:
 *   - every itinerary PATCH from the tab, and every server write the tab
 *     starts (regenerate a day, assistant apply/undo, concierge apply, add
 *     from email), runs through ONE queue, one at a time, never aborted. An
 *     aborted fetch does not stop a PATCH the server already has, and the next
 *     save would then carry an old base;
 *   - a new version is adopted only together with the content it belongs to
 *     (the caller keeps savedItinerary and baseVersion() as a pair);
 *   - a save carries the base its content was derived from, captured with the
 *     content, not the base current when it is finally sent: a server write
 *     queued in between may have moved the base, and the stale content would
 *     then pass the check and revert that write;
 *   - a 409 whose current itinerary equals what this tab just sent (ignoring
 *     photos and key order) is treated as saved: a duplicate flush, or the
 *     same edit made twice;
 *   - a save whose reply never arrived (network drop, gateway 5xx) may still
 *     have landed. If the next save 409s against exactly that content, the
 *     newer version is this tab's own write: it is re-sent once on top of it.
 *
 * Framework-free and unit-tested (itinerary-sync.vitest.ts).
 */

export interface ServerItinerary {
  itinerary: ItineraryDay[];
  version: number;
}

export type SaveResult =
  | { kind: "saved"; version: number | null }
  | { kind: "conflict"; server: ServerItinerary }
  | { kind: "failed"; status: number | null };

export interface ItinerarySync {
  /** The version the tab's saved copy was read at, or null (older page). */
  baseVersion(): number | null;
  /** Monotonic: for replies to this tab's own saves. False if not newer. */
  adopt(version: number): boolean;
  /**
   * Monotonic, for a server write this tab started (a day regeneration), whose
   * content the edits already pending do NOT contain: moves the epoch too.
   */
  adoptWrite(version: number): boolean;
  /** Unconditional: ONLY together with replacing savedItinerary by that version's content. Moves the epoch. */
  reset(version: number | null): void;
  /**
   * Changes whenever the base moves to content the tab's own save stream did
   * not produce (adoptWrite, reset). An edit pending since an older epoch was
   * built without that content; one from the same epoch contains every save
   * adopted since, so it is valid on the current base.
   */
  epoch(): number;
  /** Runs tasks one at a time, in order. Never call enqueue from inside a task. */
  enqueue<T>(task: () => Promise<T>): Promise<T>;
  /**
   * The itinerary PATCH. Call ONLY inside a task. `base` is the version the
   * payload was derived from (baseVersion() when the payload was built).
   */
  send(payload: string, base: number | null): Promise<SaveResult>;
}

/** A server write the tab refused to start; the message is for the person. */
export class ItineraryWriteBlockedError extends Error {}

// Per trip, the newest version any trip page in this JS realm has held. It
// survives client-side navigation, so a page restored from the router cache
// (Back/Forward) with props older than this tab's own later saves can tell.
const latestByTrip = new Map<string, number>();

function remember(tripId: string, version: number | null) {
  if (version !== null && version > (latestByTrip.get(tripId) ?? -1)) latestByTrip.set(tripId, version);
}

/** The newest version of this trip a page in this tab has held, or null. */
export function latestKnownVersion(tripId: string): number | null {
  return latestByTrip.get(tripId) ?? null;
}

/** A non-negative integer, or null. */
export function readItineraryVersion(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

/** Same rule as the database trigger: activity image_url does not count. */
function withoutPhotos(itinerary: unknown): unknown {
  if (!Array.isArray(itinerary)) return itinerary;
  return itinerary.map((day) => {
    if (!day || typeof day !== "object" || !Array.isArray((day as { activities?: unknown }).activities)) return day;
    const d = day as { activities: unknown[] };
    return {
      ...d,
      activities: d.activities.map((a) => {
        if (!a || typeof a !== "object") return a;
        const { image_url: _photo, ...rest } = a as Record<string, unknown>;
        return rest;
      }),
    };
  });
}

/** JSON with object keys sorted at every level (jsonb reorders keys). */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.keys(v as Record<string, unknown>).sort().map((k) => [k, (v as Record<string, unknown>)[k]]))
      : v
  );
}

/** Equal once photos are removed and key order is ignored. */
export function sameItineraryIgnoringPhotos(a: unknown, b: unknown): boolean {
  return canonical(withoutPhotos(a)) === canonical(withoutPhotos(b));
}

export function createItinerarySync(options: {
  tripId: string;
  initialVersion: number | null;
  fetchImpl?: typeof fetch;
}): ItinerarySync {
  let base = options.initialVersion;
  let tail: Promise<unknown> = Promise.resolve();
  // The contents of the latest saves whose outcome is unknown (no reply, or a
  // 5xx that may have come after the write committed), newest last.
  let unacked: unknown[] = [];
  const doFetch = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

  async function attempt(itinerary: unknown, sendBase: number | null): Promise<SaveResult> {
    let res: Response;
    try {
      res = await doFetch(`/api/trips/${options.tripId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itinerary, ...(sendBase !== null ? { baseItineraryVersion: sendBase } : {}) }),
      });
    } catch {
      return { kind: "failed", status: null };
    }

    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (res.ok) {
      const trip = (body?.data as Record<string, unknown> | undefined)?.trip ?? body?.trip;
      const version = readItineraryVersion((trip as { itinerary_version?: unknown } | undefined)?.itinerary_version);
      // Saved, but the reply was cut: the new version is unknown. Treated as
      // an unknown outcome, so the next save rebases on it instead of a
      // false conflict. (No base sent = an older page: nothing to track.)
      if (version === null && sendBase !== null) return { kind: "failed", status: null };
      return { kind: "saved", version };
    }

    if (res.status === 409 && body?.code === "ITINERARY_CONFLICT") {
      const version = readItineraryVersion(body.itineraryVersion);
      if (version !== null && Array.isArray(body.itinerary)) {
        const server = { itinerary: body.itinerary as ItineraryDay[], version };
        // The server already holds exactly this: nothing was lost.
        if (sameItineraryIgnoringPhotos(server.itinerary, itinerary)) return { kind: "saved", version };
        return { kind: "conflict", server };
      }
    }
    return { kind: "failed", status: res.status };
  }

  let epoch = 0;
  remember(options.tripId, base);

  return {
    baseVersion: () => base,

    adopt(version) {
      if (base !== null && version <= base) return false;
      base = version;
      remember(options.tripId, version);
      return true;
    },

    adoptWrite(version) {
      if (base !== null && version <= base) return false;
      base = version;
      remember(options.tripId, version);
      epoch++;
      return true;
    },

    reset(version) {
      base = version;
      remember(options.tripId, version);
      unacked = [];
      epoch++;
    },

    epoch: () => epoch,

    enqueue<T>(task: () => Promise<T>): Promise<T> {
      const run = tail.then(task);
      tail = run.catch(() => {});
      return run;
    },

    async send(payload, sendBase) {
      const itinerary = JSON.parse(payload) as unknown;
      let result = await attempt(itinerary, sendBase);
      if (result.kind === "conflict") {
        const server = result.server;
        if (
          (sendBase === null || server.version > sendBase) &&
          unacked.some((lost) => sameItineraryIgnoringPhotos(server.itinerary, lost))
        ) {
          // The newer version is this tab's own earlier save, whose reply was
          // lost, and this payload was built on top of it: send it once on it.
          unacked = [];
          result = await attempt(itinerary, server.version);
        }
      }
      if (result.kind === "failed" && (result.status === null || result.status >= 500)) {
        unacked = [...unacked, itinerary].slice(-3);
      } else if (result.kind !== "failed") {
        unacked = [];
      }
      return result;
    },
  };
}
