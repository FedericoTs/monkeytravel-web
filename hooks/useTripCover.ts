"use client";

import { useCallback, useState } from "react";
import { useChanged } from "./useChanged";

/**
 * The trip hero's cover photo: the one stored on the trip, else one the hero
 * looks up. On the owner's visit a looked-up photo is kept and stored on the
 * trip, so later visits skip the lookup (cost and reliability).
 */
export function useTripCover({
  tripId,
  storedUrl,
  isOwner,
}: {
  tripId: string;
  /** The cover stored on the trip, if any. */
  storedUrl: string | null | undefined;
  isOwner: boolean;
}) {
  // Cache the resolved cover URL across re-renders so the hero
  // doesn't re-fetch after the first PATCH lands. We seed from props
  // (DB value) and overwrite on the persist callback fire-and-forget.
  const [coverImageUrl, setCoverImageUrl] = useState<string | null | undefined>(
    storedUrl
  );
  // Re-seed whenever the inbound trip changes (route param flip etc.).
  if (useChanged(`${tripId}:${storedUrl}`)) setCoverImageUrl(storedUrl);
  // Persist a freshly-resolved cover image back to the trip row so later
  // visits skip the Google Places fetch (cost and reliability). Only the
  // owner persists it. Fire-and-forget — if the PATCH fails the in-memory
  // state still keeps the hero visible for this session.
  const handleCoverImageFetched = useCallback(
    (fetchedUrl: string) => {
      if (!isOwner) return;
      if (!fetchedUrl) return;
      // Optimistically update local state so the hero stops flickering
      // through future re-renders.
      setCoverImageUrl(fetchedUrl);
      // Fire-and-forget PATCH — failure here is a non-event (next visit
      // will just re-fetch). Don't await; don't toast on error.
      fetch(`/api/trips/${tripId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cover_image_url: fetchedUrl }),
      }).catch((err) => {
        console.warn("[trip-cover] persist failed", err);
      });
    },
    [isOwner, tripId]
  );

  return { coverImageUrl, handleCoverImageFetched };
}
