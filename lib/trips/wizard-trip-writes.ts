import { createClient } from "@/lib/supabase/client";
import {
  attachCoverImage,
  deleteTrip,
  insertTrip,
  updateTrip,
  type PersistInput,
  type SaveResult,
} from "@/lib/trips/persistTrip";

/**
 * One id per wizard MOUNT, written into every trip the mount inserts, so a
 * duplicate insert can be diagnosed: different mount ids mean a remount
 * (reload/second tab, where a fresh insert is correct); the same mount id means
 * the saved-trip ref was lost inside one mount (a real bug).
 */
export function newWizardMountId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    // Older Safari has crypto but not randomUUID. A collision here costs a
    // slightly ambiguous diagnostic, nothing user-facing, so a cheap fallback
    // beats pulling in a dependency.
    : `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** What one mounted wizard writes to the database, each call with a fresh browser client. */
export function wizardTripWrites(mountId: string) {
  return {
    saveTrip: async (input: PersistInput): Promise<SaveResult> => {
      const supabase = createClient();
      // Local session read, not a network getUser(): the RPC enforces
      // auth.uid() under RLS regardless, and a network pre-check would turn any
      // auth hiccup into a hard failure of the save that nobody could see. The
      // error names its cause so Sentry can group it.
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) throw new Error("auto-save: no client session");
      return insertTrip(supabase, input, session.user.id, { arm: "auto", mountId });
    },

    saveTripManually: (input: PersistInput, userId: string): Promise<SaveResult> =>
      insertTrip(createClient(), input, userId, { arm: "manual", mountId }),

    updateTrip: async (tripId: string, input: PersistInput): Promise<void> => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      return updateTrip(supabase, tripId, input, user.id);
    },

    deleteTrip: (tripId: string): Promise<void> => deleteTrip(createClient(), tripId),

    attachCoverImage: (tripId: string, destination: string): Promise<void> =>
      attachCoverImage(createClient(), tripId, destination),
  };
}
