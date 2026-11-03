"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { trackWizardEvent } from "@/components/wizard/wizardEvents";
import type { ItineraryDraft } from "@/hooks/useItineraryDraft";
import { prefs } from "@/lib/platform/storage";
import { createClient } from "@/lib/supabase/client";
import { readPendingClaim } from "@/lib/trips/anonymous-claim-client";
import { readClaimedTrip } from "@/lib/trips/claimed-trip-signal";
import { applyDraft, type DraftTargets } from "@/lib/wizard/apply-draft";
import { decideDraftRestore } from "@/lib/wizard/draft-restore";
import { savedTripOf } from "@/lib/wizard/draft-saved-check";
import type { GeneratedItinerary, TripVibe } from "@/types";

/**
 * Bringing a stored draft back (hooks/useItineraryDraft.tsx keeps it): put
 * back without asking for a signed-in planner, offered in a banner to a
 * signed-out one, discarded when it is already one of their trips, and the
 * generation resumed when they came back from signing up to finish one.
 */
export function useDraftRestore({
  draft,
  hasDraft,
  isExpired,
  clearDraft,
  draftTargets,
  isAuthenticated,
  authUser,
  generatedItinerary,
  generating,
  savedTripId,
  destination,
  startDate,
  endDate,
  selectedVibes,
  locale,
  handleGenerate,
}: {
  draft: ItineraryDraft | null;
  hasDraft: boolean;
  /** The stored draft had expired (and is gone). */
  isExpired: boolean;
  clearDraft: () => void;
  /** Where a restored draft goes (lib/wizard/apply-draft.ts). */
  draftTargets: DraftTargets;
  isAuthenticated: boolean | null;
  authUser: User | null;
  generatedItinerary: GeneratedItinerary | null;
  generating: boolean;
  savedTripId: string | null;
  destination: string;
  startDate: string;
  endDate: string;
  selectedVibes: TripVibe[];
  locale: string;
  /** Generates the plan for the form on screen. */
  handleGenerate: () => unknown;
}) {
  const [showDraftRecovery, setShowDraftRecovery] = useState(false);
  const [draftAutoRestored, setDraftAutoRestored] = useState(false);

  // Handle pending generation after signup (when draft is restored).
  // The `pendingTripGeneration` flag lives in `prefs` because plain
  // localStorage gets evicted on iOS WebView under ITP / storage pressure.
  // The read is async, so we wrap it in an inner fn and gate the side
  // effect on the still-current cleanup state.
  useEffect(() => {
    // Only run if authenticated AND draft has been auto-restored
    if (!isAuthenticated || !draftAutoRestored) return;
    if (!destination || !startDate || !endDate || selectedVibes.length === 0) return;
    if (generating || generatedItinerary) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    (async () => {
      const pending = await prefs.get("pendingTripGeneration");
      if (cancelled || pending !== "true") return;
      await prefs.remove("pendingTripGeneration");
      // Small delay to ensure UI is ready and React state has propagated
      timer = setTimeout(() => {
        if (!cancelled) handleGenerate();
      }, 500);
    })();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, draftAutoRestored, destination, startDate, endDate, selectedVibes, generating, generatedItinerary]);

  // Is the draft's itinerary already one of this user's trips? Asked once per
  // draft, only while it could still be restored (signed in, nothing on
  // screen yet). decideDraftRestore waits for the answer and discards a draft
  // that is already saved instead of restoring it into a second insert.
  //
  // Except the plan this browser shared while signed out: signing in claims
  // it, so it can read as saved before or while the claim lands. That trip is
  // the plan coming back, adopted as the save (hooks/usePendingClaim.ts), not
  // a copy saved before.
  const draftCheckKey =
    isAuthenticated === true && authUser && draft?.generatedItinerary && !generatedItinerary && !draftAutoRestored
      ? `${authUser.id}:${draft.savedAt}`
      : null;
  const [draftSavedCheck, setDraftSavedCheck] = useState<{ key: string; saved: boolean } | null>(null);
  useEffect(() => {
    if (!draftCheckKey || !authUser || !draft?.generatedItinerary) return;
    let alive = true;
    const itinerary = draft.generatedItinerary;
    void (async () => {
      const shared = (await readPendingClaim())?.tripId ?? null;
      const savedId = await savedTripOf(createClient(), authUser.id, itinerary);
      const comingBack = savedId !== null && (savedId === shared || savedId === readClaimedTrip());
      if (alive) setDraftSavedCheck({ key: draftCheckKey, saved: savedId !== null && !comingBack });
    })();
    return () => {
      alive = false;
    };
  }, [draftCheckKey, authUser, draft]);
  const draftIsSavedTrip =
    draftSavedCheck && draftSavedCheck.key === draftCheckKey ? draftSavedCheck.saved : null;

  // Put a stored draft back into the wizard: the silent restore below and the
  // banner's Restore both come through here.
  const applyStoredDraft = useCallback(
    (stored: ItineraryDraft) => {
      applyDraft(stored, draftTargets);
      void trackWizardEvent("draft_restored", {
        destination: stored.destination,
        duration_days: stored.generatedItinerary?.days.length,
        locale,
      });
    },
    [draftTargets, locale]
  );

  // Check for unsaved draft on mount - AUTO-RESTORE it for a signed-in user.
  // The `pendingTripGeneration` flag lives in `prefs` (async on native
  // Capacitor) — wrap the read in an inner async fn and use `cancelled`
  // so we don't set state after unmount / dep change.
  useEffect(() => {
    if (!hasDraft || !draft || generatedItinerary || draftAutoRestored) return;
    // Auth is tri-state and is null on every first render. Returning here
    // rather than falling through is what makes the rest of this effect work:
    // isAuthenticated is in the dep array, so this re-runs the moment auth
    // resolves. Without the early return the first pass would latch
    // showDraftRecovery for a user who IS signed in, and the auto-restore
    // below would never get a turn.
    if (isAuthenticated === null) return;

    let cancelled = false;

    (async () => {
      // Check if we're coming back from auth with pending generation
      const hasPendingGeneration = (await prefs.get("pendingTripGeneration")) === "true";
      if (cancelled) return;

      // Decision in lib/wizard/draft-restore.ts, with the tri-state auth trap
      // pinned by unit tests. Restores for ANYONE signed in holding an unsaved
      // itinerary, not only the Save-modal path: `pendingTripGeneration` is
      // only written inside AuthPromptModal, so a planner who signed in through
      // the header, the login page or a magic link would otherwise come back
      // to a blank wizard with their itinerary unread in localStorage.
      const decision = decideDraftRestore({
        hasDraft,
        hasItineraryInDraft: !!draft.generatedItinerary,
        alreadyRestored: draftAutoRestored,
        itineraryOnScreen: !!generatedItinerary,
        isAuthenticated,
        savedTripId,
        pendingTripGeneration: hasPendingGeneration,
        draftIsSavedTrip,
      });

      if (decision === "discard") {
        // Already one of their trips: restoring it would insert it again.
        clearDraft();
        return;
      }
      if (decision === "auto-restore") {
        // Auto-restore the draft silently (no banner) for seamless post-auth experience.
        // Restore the itinerary too, not just the form: with no itinerary on
        // screen the pending-generation effect above re-runs handleGenerate()
        // and silently replaces the itinerary the user clicked Save on.
        applyStoredDraft(draft);
        setDraftAutoRestored(true);
        // Don't show the banner since we're auto-restoring — and close it if a
        // pass before auth resolved had already opened it.
        setShowDraftRecovery(false);
      } else if (decision === "offer-banner") {
        // Signed out: let them choose rather than restoring under them.
        setShowDraftRecovery(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [hasDraft, draft, generatedItinerary, draftAutoRestored, applyStoredDraft, isAuthenticated, savedTripId, draftIsSavedTrip, clearDraft]);

  // Handle draft restoration
  const handleRestoreDraft = () => {
    if (draft) {
      applyStoredDraft(draft);
      setShowDraftRecovery(false);
    }
  };

  // An expired draft is reported once per mount. useItineraryDraft has already
  // deleted it by the time this flag is readable, so this row is the only
  // record that a plan was lost to the TTL rather than abandoned.
  const draftExpiredReportedRef = useRef(false);
  useEffect(() => {
    if (!isExpired || draftExpiredReportedRef.current) return;
    draftExpiredReportedRef.current = true;
    void trackWizardEvent("draft_expired", { locale });
  }, [isExpired, locale]);

  // Handle draft discard
  const handleDiscardDraft = () => {
    clearDraft();
    setShowDraftRecovery(false);
  };

  return { showDraftRecovery, setShowDraftRecovery, draftAutoRestored, handleRestoreDraft, handleDiscardDraft };
}
