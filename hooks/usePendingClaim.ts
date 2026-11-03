"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { capturePendingClaimBanner, type AuthPromptLocation } from "@/lib/posthog/events";
import { readPendingClaim, type PendingClaim } from "@/lib/trips/anonymous-claim-client";
import { readClaimedTrip } from "@/lib/trips/claimed-trip-signal";
import { pendingClaimMatchesDraft, shouldDeferAutoSave, type ClaimResolution } from "@/lib/trips/pending-claim";
import type { GeneratedItinerary } from "@/types";

/**
 * A plan this browser shared while signed out, and the claim that makes it
 * the account's trip on sign-in. The rule is in the comment below.
 */
export function usePendingClaim({
  destination,
  startDate,
  endDate,
  isAuthenticated,
  generatedItinerary,
  step,
  claimedTripId,
  setClaimedTripId,
  setSavedTripId,
  openKeepAuth,
}: {
  /** The trip on screen. */
  destination: string;
  startDate: string;
  endDate: string;
  isAuthenticated: boolean | null;
  generatedItinerary: GeneratedItinerary | null;
  step: number;
  /** The trip a signup claimed (hooks/useClaimedTrip.ts). */
  claimedTripId: string | null;
  setClaimedTripId: (id: string | null) => void;
  setSavedTripId: (id: string | null) => void;
  /** Opens the account dialog, with the plan kept for the way back. */
  openKeepAuth: (location: AuthPromptLocation) => void;
}) {
  // -- Pending anonymous share ----------------------------------------------
  // A signed-out planner who shared this itinerary minted an ownerless trip
  // row, and this browser holds its claim token. On sign-in TWO things would
  // persist the same itinerary: AuthProvider claims that row, and the
  // auto-save hook inserts a fresh one; the keep-it nudge on the share row
  // makes that collision routine.
  // Rule (lib/trips/pending-claim.ts): while the draft on screen matches the
  // shared trip and the claim is unresolved, auto-save waits; a claimed id is
  // adopted as THE saved trip; a released claim (expired, taken, no token)
  // hands persistence back to auto-save.
  const [pendingClaim, setPendingClaim] = useState<PendingClaim | null>(null);
  const [claimResolution, setClaimResolution] = useState<ClaimResolution>("none");
  const [adoptedTripId, setAdoptedTripId] = useState<string | null>(null);
  const [pendingClaimDismissed, setPendingClaimDismissed] = useState(false);
  // A share link minted in THIS session, shared by every AnonymousShareButton
  // on screen so only one ownerless trip is ever created.
  const [sessionShareUrl, setSessionShareUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void readPendingClaim().then((p) => {
      if (!alive || !p) return;
      setPendingClaim(p);
      setClaimResolution("unresolved");
    });
    return () => {
      alive = false;
    };
  }, []);
  const pendingMatchesDraft = pendingClaimMatchesDraft(pendingClaim, { destination, startDate, endDate });
  const deferAutoSave = shouldDeferAutoSave({ matches: pendingMatchesDraft, resolution: claimResolution });
  const adoptClaimedTrip = useCallback((id: string) => {
    setAdoptedTripId(id);
    setSavedTripId(id);
    setClaimedTripId(id);
    setClaimResolution("adopted");
    setPendingClaim(null);
  }, [setClaimedTripId, setSavedTripId]);
  // The claim can complete on either side (AuthProvider publishes the signal;
  // the wizard asks directly below). Whichever reports first wins.
  useEffect(() => {
    if (claimResolution !== "unresolved" || !pendingClaim || !pendingMatchesDraft) return;
    if (claimedTripId === pendingClaim.tripId) adoptClaimedTrip(claimedTripId);
  }, [claimedTripId, pendingClaim, pendingMatchesDraft, claimResolution, adoptClaimedTrip]);
  useEffect(() => {
    if (claimResolution !== "unresolved" || !pendingClaim || !pendingMatchesDraft || isAuthenticated !== true) return;
    let alive = true;
    const tripId = pendingClaim.tripId;
    if (readClaimedTrip() === tripId) {
      adoptClaimedTrip(tripId);
      return;
    }
    void import("@/lib/trips/anonymous-claim-client")
      .then(({ claimPendingTrip }) => claimPendingTrip())
      .then((id) => {
        if (!alive) return;
        if (id) adoptClaimedTrip(id);
        else if (readClaimedTrip() === tripId) adoptClaimedTrip(tripId);
        else {
          setClaimResolution("released");
          setPendingClaim(null);
        }
      })
      .catch(() => {
        if (!alive) return;
        setClaimResolution("released");
        setPendingClaim(null);
      });
    return () => {
      alive = false;
    };
  }, [claimResolution, pendingClaim, pendingMatchesDraft, isAuthenticated, adoptClaimedTrip]);
  const handleAnonShared = (pending: PendingClaim) => {
    // Every share button on screen adopts this one link. Minting twice would
    // create a second ownerless trip whose claim token the browser has
    // already overwritten, stranding the first and inflating the
    // anonymous-share counts the /admin panel reads.
    setSessionShareUrl(pending.shareUrl);
    setPendingClaim(pending);
    setClaimResolution("unresolved");
    setPendingClaimDismissed(false);
  };
  const showPendingClaimBanner =
    isAuthenticated === false && !!pendingClaim && !pendingClaimDismissed && !generatedItinerary && step === 1;
  const pendingSurfacedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!showPendingClaimBanner || !pendingClaim || pendingSurfacedRef.current === pendingClaim.tripId) return;
    pendingSurfacedRef.current = pendingClaim.tripId;
    void capturePendingClaimBanner({ action: "surfaced", destination: pendingClaim.destination, trip_id: pendingClaim.tripId });
  }, [showPendingClaimBanner, pendingClaim]);
  const handlePendingClaimAction = (action: "keep" | "open_link" | "dismissed") => {
    void capturePendingClaimBanner({ action, destination: pendingClaim?.destination, trip_id: pendingClaim?.tripId });
    if (action === "keep") openKeepAuth("pending_claim");
    if (action === "dismissed") setPendingClaimDismissed(true);
  };

  return {
    pendingClaim,
    deferAutoSave,
    adoptedTripId,
    sessionShareUrl,
    handleAnonShared,
    showPendingClaimBanner,
    handlePendingClaimAction,
  };
}
