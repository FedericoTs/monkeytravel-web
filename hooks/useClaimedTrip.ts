"use client";

import { useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { captureClaimedTripBanner } from "@/lib/posthog/events";
import { clearClaimedTrip, onClaimedTrip, readClaimedTrip } from "@/lib/trips/claimed-trip-signal";

/**
 * The trip a signup claimed (lib/trips/claimed-trip-signal.ts), for the
 * banner that offers it, and that banner's events.
 */
export function useClaimedTrip({
  isFreshSignup,
  authLoading,
  authUser,
}: {
  /** The visit is the first after creating an account. */
  isFreshSignup: boolean;
  authLoading: boolean;
  authUser: User | null;
}) {
  const [claimedTripId, setClaimedTripId] = useState<string | null>(null);

  // ── Claimed trip ──────────────────────────────────────────────────────────
  // AuthProvider claims a pending anonymous trip on SIGNED_IN and publishes
  // the id (lib/trips/claimed-trip-signal.ts). The two sides race — SIGNED_IN
  // usually fires during hydration, before this effect subscribes — so read
  // the stored id AND subscribe. The post-callback landing may emit SIGNED_IN
  // or INITIAL_SESSION, so a fresh signup also claims directly, once:
  // claimPendingTrip is idempotent (the token is removed on any terminal
  // outcome, kept only on 401).
  useEffect(() => {
    const stored = readClaimedTrip();
    if (stored) setClaimedTripId(stored);
    return onClaimedTrip((id) => setClaimedTripId(id));
  }, []);
  const directClaimFiredRef = useRef(false);
  useEffect(() => {
    if (!isFreshSignup || authLoading || !authUser || directClaimFiredRef.current) return;
    directClaimFiredRef.current = true;
    void import("@/lib/trips/anonymous-claim-client")
      .then(({ claimPendingTrip }) => claimPendingTrip())
      .then((id) => {
        if (id) setClaimedTripId(id);
      })
      .catch(() => undefined);
  }, [isFreshSignup, authLoading, authUser]);
  const claimedSurfacedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!claimedTripId || claimedSurfacedRef.current === claimedTripId) return;
    claimedSurfacedRef.current = claimedTripId;
    void captureClaimedTripBanner({ action: "surfaced", trip_id: claimedTripId });
  }, [claimedTripId]);
  const dismissClaimedTrip = (action: "opened" | "plan_another" | "dismissed") => {
    if (claimedTripId) void captureClaimedTripBanner({ action, trip_id: claimedTripId });
    clearClaimedTrip();
    setClaimedTripId(null);
  };

  return { claimedTripId, setClaimedTripId, dismissClaimedTrip };
}
