import type { SessionTripSnapshot } from "@/hooks/useSessionTripStack";
import { safeGet, safeRemove, safeSet } from "@/lib/safe-storage";
import { pendingClaimMatchesDraft, type PendingClaimDraftKey } from "@/lib/trips/pending-claim";
import type { PersistInput, SaveResult } from "@/lib/trips/persistTrip";
import { isSameDestination } from "@/lib/trips/sameDestination";
import { tripFormState } from "./answers";
import { sessionTripAnswers } from "./apply-draft";
import { interestsFromVibes } from "./interests";

/**
 * A signed-out planner who plans more than one place in a visit and signs in to save kept only the plan on screen:
 * the others lived in the tab's session tray (hooks/useSessionTripStack.ts) and were lost. When the save box opens,
 * the visit's other places are marked here; after the sign-in, once the plan on screen is saved, each is saved too.
 *
 * Kept: the newest plan of each place other than the one on screen, so a regenerated plan, the same place on other
 * dates, or the place written another way ("Lisbon" and "Lisbon, Portugal") is never a second trip, and no saved
 * trip shares a place with another of the visit: the database's double-save guard (same title and start date within
 * a minute reuses the row) can't then put one plan over another. Skipped: a place and dates the account already
 * holds (which also makes a reload's second run save nothing twice), and the plan a share made before signing in is
 * claiming.
 */

const KEY = "mt_keep_visit";
/** A mark this old is from another visit's sign-in. */
const MAX_AGE_MS = 2 * 60 * 60 * 1000;

/** A plan's place: as the planner typed it, and as the plan names it (the saved trip's title comes from the latter). */
type Place = { destination: string; itinerary?: { destination?: { name?: string } } | null };

/** One place, by either of its names: "Lisboa" typed and "Lisbon, Portugal" typed are both the plan's "Lisbon". */
function samePlace(a: Place, b: Place): boolean {
  const names = (p: Place) => [p.destination, p.itinerary?.destination?.name ?? ""];
  return names(a).some((x) => names(b).some((y) => isSameDestination(x, y)));
}

/** The newest plan of each place of the visit besides the one on screen, oldest first. */
export function otherPlacesOfVisit(trips: SessionTripSnapshot[], current: Place): SessionTripSnapshot[] {
  if (!current.destination.trim()) return [];
  const newest: SessionTripSnapshot[] = [];
  for (const trip of trips) {
    if (samePlace(trip, current)) continue;
    const at = newest.findIndex((kept) => samePlace(kept, trip));
    if (at < 0) newest.push(trip);
    else if (trip.createdAt >= newest[at].createdAt) newest[at] = trip;
  }
  return newest.sort((a, b) => a.createdAt - b.createdAt);
}

/** Mark the tray plans to keep once the planner signs in, in place of an earlier mark. */
export function markVisitToKeep(ids: string[], now = Date.now()): void {
  safeSet(KEY, JSON.stringify({ ids, at: now }), "session");
}

/** The tray plans marked to keep, or none when nothing (or nothing recent) is marked. */
export function visitToKeep(now = Date.now()): string[] {
  try {
    const raw = safeGet(KEY, "session");
    if (!raw) return [];
    const mark = JSON.parse(raw) as { ids?: unknown; at?: unknown };
    if (!Array.isArray(mark.ids) || typeof mark.at !== "number" || now - mark.at > MAX_AGE_MS) return [];
    return mark.ids.filter((id): id is string => typeof id === "string");
  } catch {
    return [];
  }
}

export function forgetVisitToKeep(): void {
  safeRemove(KEY, "session");
}

export interface KeepVisitDeps {
  userId: string;
  locale: string;
  /** The account already holds this place on these dates (lib/trips/recent-twin.ts). */
  isTwin: (userId: string, trip: { destination: string; startDate: string; endDate: string }) => Promise<boolean>;
  /** The plan a share made while signed out, which the sign-in claims (lib/trips/pending-claim.ts). */
  claimed: PendingClaimDraftKey | null;
  save: (input: PersistInput) => Promise<SaveResult>;
  attachCover: (tripId: string, destination: string, itinerary: PersistInput["itinerary"]) => Promise<void>;
  onError: (err: unknown) => void;
}

/** Save the marked tray plans in turn, each with its own answers; the plans saved. */
export async function keepVisitTrips(ids: string[], trips: SessionTripSnapshot[], deps: KeepVisitDeps): Promise<SessionTripSnapshot[]> {
  const kept: SessionTripSnapshot[] = [];
  for (const id of ids) {
    const trip = trips.find((t) => t.id === id);
    if (!trip || pendingClaimMatchesDraft(deps.claimed, trip)) continue;
    try {
      if (await deps.isTwin(deps.userId, trip)) continue;
      const formState = tripFormState(sessionTripAnswers(trip), { derivedInterests: interestsFromVibes(trip.vibes), locale: deps.locale });
      const { tripId } = await deps.save({ itinerary: trip.itinerary, formState });
      void deps.attachCover(tripId, formState.destination, trip.itinerary).catch(() => {});
      kept.push(trip);
    } catch (err) {
      deps.onError(err);
    }
  }
  return kept;
}
