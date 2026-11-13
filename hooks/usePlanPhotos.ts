"use client";

import { useEffect, useMemo, useRef } from "react";
import type { Activity, GeneratedItinerary } from "@/types";
import { activityDomId } from "@/lib/trip/activity-dom-id";
import { isPlacePhoto, withFoundPhotos } from "@/lib/trips/keep-place-photos";

// When to ask for the photos found since the plan was shown.
const ASK_AFTER_MS = [5_000, 20_000];
const MAX_NAMES = 80;

/** Below the screen, or not on the page: a photo added there moves nothing being read. */
function belowScreen(activity: Activity): boolean {
  const box = document.getElementById(activityDomId(activity))?.getBoundingClientRect();
  return !box || box.top > window.innerHeight;
}

/**
 * A plan shows stock images where no free photo was known yet, and its places
 * are looked up on Wikimedia while it is on screen. Asks for the photos found
 * since, twice, and swaps them in for the stock images. Once per plan, by its
 * activities: the photos it gets don't start it again.
 */
export function usePlanPhotos(opts: {
  plan: GeneratedItinerary | null;
  destination: string;
  onPlan: (update: (prev: GeneratedItinerary | null) => GeneratedItinerary | null) => void;
}): void {
  const latest = useRef(opts);
  useEffect(() => {
    latest.current = opts;
  });
  const { plan, destination } = opts;
  const planKey = useMemo(
    () => (plan?.days ?? []).flatMap((day) => (day.activities ?? []).map((a) => a.id ?? "")).join(","),
    [plan]
  );

  useEffect(() => {
    if (!planKey || !destination.trim()) return;
    let cancelled = false;
    const ask = async () => {
      const standIns = (latest.current.plan?.days ?? [])
        .flatMap((day) => day.activities ?? [])
        .filter((a) => a.id && a.name && !isPlacePhoto(a.image_url))
        .slice(0, MAX_NAMES);
      if (cancelled || standIns.length === 0) return;
      try {
        const res = await fetch("/api/images/landmarks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ destination, names: standIns.map((a) => a.name) }),
        });
        const body = res.ok ? ((await res.json()) as { photos?: unknown[] }) : null;
        // A stand-in is swapped where it is; a stop showing no photo gets one only below the screen.
        const photos: Record<string, string> = {};
        standIns.forEach((a, i) => {
          const url = body?.photos?.[i];
          if (isPlacePhoto(url) && (a.image_url || belowScreen(a))) photos[a.id!] = url;
        });
        if (cancelled || Object.keys(photos).length === 0) return;
        latest.current.onPlan((prev) => (prev ? { ...prev, days: withFoundPhotos(prev.days, photos) } : prev));
      } catch {
        // Not found in time: the stock image stays.
      }
    };
    const timers = ASK_AFTER_MS.map((ms) => setTimeout(ask, ms));
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [planKey, destination]);
}
