"use client";

import { useEffect, useRef, useState } from "react";
import { usePendingSaveTripAction } from "@/components/ui/SaveTripModal";
import { trackShareLinkClicked } from "@/lib/analytics";
import { GUEST_LINK_KEY } from "@/lib/participants/link-trigger";
import { prefs } from "@/lib/platform/storage";
import { claimPendingTrip, readPendingClaim } from "@/lib/trips/anonymous-claim-client";
import { onClaimedTrip, readClaimedTrip } from "@/lib/trips/claimed-trip-signal";

/**
 * What arriving on a shared or public trip page leaves behind: the visit, the
 * followed link, the owner's referral code and, signed out on a share link, the
 * note that this browser may join or pay as a guest.
 */
export function useSharedTripVisit({
  tripId,
  viewSource,
  referralCode,
  shareToken,
  viewer,
  viewerLoading,
}: {
  tripId: string;
  viewSource?: "shared" | "public";
  referralCode: string | null;
  shareToken?: string;
  viewer: unknown;
  viewerLoading: boolean;
}): void {
  // Record the open. One row per session per trip per UTC day is the
  // database's rule (UNIQUE trip_id, session_id, viewed_on); this only has to
  // fire once per mount. Fire-and-forget with keepalive, like the
  // funnel-event beacon. Never blocks render, never throws.
  const viewRecordedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!viewSource) return;
    const key = `${tripId}:${viewSource}`;
    if (viewRecordedFor.current === key) return;
    viewRecordedFor.current = key;
    try {
      void fetch(`/api/trips/${tripId}/view`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: viewSource }),
        keepalive: true,
      });
    } catch {
      // analytics must never affect the visitor
    }
  }, [tripId, viewSource]);

  // Persist ?ref the same way /join/[code] does (localStorage key
  // "referral_code") so a visitor who signs up via the normal nav — not
  // the CTA — is still attributed to the owner. The signup page reads this
  // exact key. Guard: never overwrite an existing stored code with empty.
  useEffect(() => {
    if (referralCode) {
      try {
        localStorage.setItem("referral_code", referralCode);
      } catch {
        // localStorage unavailable (private mode / SSR edge) — the CTA's
        // ?ref query param still carries attribution, so non-fatal.
      }
    }
  }, [referralCode]);

  // Signed out, this browser may join or pay here as a guest: note it, so the
  // next sign-in hands that to the account (lib/participants/link-trigger).
  useEffect(() => {
    if (shareToken && !viewerLoading && !viewer) void prefs.set(GUEST_LINK_KEY, "1");
  }, [shareToken, viewerLoading, viewer]);

  // Track share link view for viral loop analytics
  useEffect(() => {
    trackShareLinkClicked({
      tripId,
      referrer: typeof document !== "undefined" ? document.referrer : undefined,
    });
  }, [tripId]);
}

/**
 * The save dialog, reopened with its date on the way back from signing in to save
 * this trip: the dialog stored what it was doing before sending the visitor away.
 */
export function useSharedTripSave({
  templateId,
  shareToken,
  publicSlug,
  viewer,
  viewerLoading,
}: {
  templateId?: string;
  shareToken?: string;
  publicSlug?: string;
  viewer: unknown;
  viewerLoading: boolean;
}) {
  const [showSaveModal, setShowSaveModal] = useState(false);
  const { getPending, clearPending } = usePendingSaveTripAction();
  const [resumedStartDate, setResumedStartDate] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (viewerLoading || !viewer) return;
    let cancelled = false;
    void getPending().then(async (pending) => {
      if (cancelled || !pending) return;
      const ours = templateId
        ? pending.templateId === templateId
        : shareToken
          ? pending.shareToken === shareToken
          : !!publicSlug && pending.publicSlug === publicSlug;
      if (!ours) return;
      await clearPending();
      setResumedStartDate(pending.startDate);
      setShowSaveModal(true);
    });
    return () => {
      cancelled = true;
    };
  }, [viewerLoading, viewer, templateId, shareToken, publicSlug, getPending, clearPending]);
  return { showSaveModal, setShowSaveModal, resumedStartDate };
}

/**
 * The sharer opening their own link: this browser still holds the claim token for
 * THIS trip. "Save to My Trips" would duplicate their own itinerary, so the page
 * offers the claim instead, and once the claim lands (announced by claimPendingTrip,
 * whoever called it) moves them onto the claimed trip in their account.
 */
export function useOwnerClaim({ shareToken, tripId, signedIn }: { shareToken?: string; tripId: string; signedIn: boolean }): boolean {
  const [ownerPending, setOwnerPending] = useState(false);
  useEffect(() => {
    let alive = true;
    void readPendingClaim().then((p) => {
      if (alive) setOwnerPending(!!shareToken && !!p && p.shareToken === shareToken);
    });
    return () => {
      alive = false;
    };
  }, [shareToken]);
  useEffect(() => {
    if (!ownerPending) return;
    const go = (id: string) => {
      // A full load: the claim lands on sign-in, and this page was rendered
      // for the signed-out sharer.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      if (id === tripId) window.location.assign(`/trips/${id}`);
    };
    const already = readClaimedTrip();
    if (already) go(already);
    return onClaimedTrip(go);
  }, [ownerPending, tripId]);
  // Signed in with this trip's claim still waiting: claim it from here too.
  // Signing up by email from the strip comes back to this page, and
  // AuthProvider also claims on sign-in; claimPendingTrip shares one request
  // with any other caller and announces the result, which moves the page onto
  // the trip (above).
  useEffect(() => {
    if (!ownerPending || !signedIn) return;
    void claimPendingTrip();
  }, [ownerPending, signedIn]);
  return ownerPending;
}
