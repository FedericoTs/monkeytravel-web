"use client";

import { useCallback, useEffect, useState } from "react";
import type { FeedEvent } from "./shared";

/**
 * The Today activity feed on the client — Live Trip Phase 3.5.
 *
 * Fetch on mount, then refetch on demand. No realtime channel of its own: the
 * chip actions already arrive over the trip_today_actions subscription that
 * TodayView owns (useTodayActions), and the money tables have no public read
 * path to subscribe to — so TodayView calls refetch() whenever those change
 * or an expense is added. That reuses one subscription instead of opening a
 * second, and still surfaces new joins on the next refetch or load.
 */
export interface TripFeedApi {
  events: FeedEvent[];
  refetch: () => void;
}

export function useTripFeed(shareToken: string, enabled: boolean): TripFeedApi {
  const [events, setEvents] = useState<FeedEvent[]>([]);

  const refetch = useCallback(() => {
    if (!enabled) return;
    void (async () => {
      try {
        const res = await fetch(`/api/shared/${shareToken}/feed`, { cache: "no-store" });
        if (!res.ok) return;
        const json = await res.json();
        const data = (json as { data?: { events?: FeedEvent[] } })?.data ?? json;
        const list = (data as { events?: FeedEvent[] })?.events;
        if (Array.isArray(list)) setEvents(list);
      } catch {
        // leave the last-known feed in place
      }
    })();
  }, [shareToken, enabled]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { events, refetch };
}
