"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { captureSharePromptVariantShown } from "@/lib/posthog/events";

const ShareAfterSaveModal = dynamic(
  () => import("@/components/trip/ShareAfterSaveModal"),
  { ssr: false }
);

/**
 * The share ask, moved off the save moment (spec C1).
 *
 * It used to fire in the wizard the instant the row was inserted — asking the
 * user to send friends an itinerary they had not read yet. Measured: 82 of 100
 * savers saw it and 85% skipped. Nothing had earned the ask.
 *
 * Now it waits until the user has demonstrably looked at the trip, on the trip
 * page itself, and only for the owner of a trip that has no link yet.
 *
 * WHY A SEPARATE COMPONENT. TripDetailClient is 3,000 lines; adding four
 * pieces of gating state to it would be another thing to trip over later.
 * Everything here is self-contained and renders null until it decides to fire.
 */

const DWELL_MS = 25_000;
const SCROLL_PX = 600;

const dismissKey = (tripId: string) => `share_prompt_dismissed:${tripId}`;

interface Props {
  tripId: string;
  tripTitle: string;
  tripDays: number;
  destination: string;
  isOwner: boolean;
  /** From trip_meta.trip_intent. Absent = the user never answered. */
  tripIntent?: "solo" | "group";
  /** Mirrors EXPLORE_UGC_ENABLED so the publish tick isn't offered when /explore is off. */
  exploreUgcEnabled?: boolean;
  isAnchored?: boolean;
  onManageCollaborators: () => void;
  onPublish?: () => Promise<void> | void;
}

export default function SharePromptOnTrip({
  tripId,
  tripTitle,
  tripDays,
  destination,
  isOwner,
  tripIntent,
  exploreUgcEnabled = false,
  isAnchored = false,
  onManageCollaborators,
  onPublish,
}: Props) {
  const [eligible, setEligible] = useState(false);
  const [engaged, setEngaged] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  // Report the variant at most once per mount, even across re-renders.
  const reportedRef = useRef(false);

  // --- eligibility: owner, not already shared, not previously dismissed -----
  useEffect(() => {
    if (!isOwner) return;
    // Dismissal is per TRIP and persistent, not per session. Saying "not now"
    // once should not mean being asked again on the same trip tomorrow.
    try {
      if (localStorage.getItem(dismissKey(tripId))) return;
    } catch {
      // Private mode / storage disabled — fall through and allow the prompt.
      // Over-asking once is a smaller harm than never asking at all.
    }

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/trips/${tripId}/share`);
        if (!res.ok) return; // can't tell → stay quiet rather than nag wrongly
        const data = await res.json();
        // A trip that already has a link doesn't need this prompt; the user
        // has already done the thing we're about to ask for.
        if (!cancelled && !data?.shareToken && !data?.shareUrl) setEligible(true);
      } catch {
        /* network blip — stay quiet */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOwner, tripId]);

  // --- engagement gate: scrolled into the plan, or dwelled long enough ------
  useEffect(() => {
    if (!eligible || engaged) return;

    const onScroll = () => {
      if (window.scrollY > SCROLL_PX) setEngaged(true);
    };
    // Fires for someone who lands mid-page (restored scroll position).
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    const timer = setTimeout(() => setEngaged(true), DWELL_MS);

    return () => {
      window.removeEventListener("scroll", onScroll);
      clearTimeout(timer);
    };
  }, [eligible, engaged]);

  // Derived, not mirrored into state: setting `open` from an effect trips
  // react-hooks/set-state-in-effect and buys nothing — visibility is a pure
  // function of "engaged and not yet dismissed".
  const open = engaged && !dismissed;

  useEffect(() => {
    if (!open || reportedRef.current) return;
    reportedRef.current = true;
    // Which copy branch this user actually saw. Without it the group-vs-solo
    // framing is unreadable — we would know the outcome but not which ask
    // produced it.
    captureSharePromptVariantShown({
      trip_id: tripId,
      intent: tripIntent ?? "unspecified",
      surface: "trip_detail",
    });
  }, [open, tripId, tripIntent]);

  const handleClose = () => {
    setDismissed(true);
    try {
      localStorage.setItem(dismissKey(tripId), "1");
    } catch {
      /* storage disabled — the in-memory `open:false` still holds for this visit */
    }
  };

  if (!open) return null;

  return (
    <ShareAfterSaveModal
      isOpen={open}
      onClose={handleClose}
      onInvite={onManageCollaborators}
      onPublish={exploreUgcEnabled ? onPublish : undefined}
      isAnchored={isAnchored}
      tripId={tripId}
      tripTitle={tripTitle}
      tripDays={tripDays}
      destination={destination}
      tripIntent={tripIntent ?? "unspecified"}
    />
  );
}
