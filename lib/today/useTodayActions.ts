"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";
import type { Activity } from "@/types";
import { TODAY_CHANGED_EVENT, TODAY_CHANNEL_OPTIONS, todayChannel, type TodayAction, type TodayActionType } from "./actions";
import { TODAY_REFRESH_GAP_MS, keepIfSame, throttledRefresh } from "./refresh-throttle";
import { freshness, readSignal } from "./freshness";

/**
 * The chip overlay for a live trip's Today — Live Trip Phase 3.3.
 *
 * Hydrates the active actions, then listens on the trip's Today broadcast so a
 * chip tapped by anyone appears on everyone's Today within seconds. Applying
 * and undoing go through the routes under `base` (the share link's, or the
 * members' /api/trips/[id]/today), which announce each change; this hook
 * re-fetches, along with `alsoRefresh` (the expense panel), at most every few
 * seconds (refresh-throttle), so every viewer converges on the server's truth.
 */
export interface TodayActionsApi {
  actions: TodayAction[];
  busy: boolean;
  error: string | null;
  apply: (input: { action_type: TodayActionType; day_number: number; activity?: Activity }) => Promise<void>;
  undo: (actionId: string) => Promise<void>;
}

export function useTodayActions(
  base: string,
  tripId: string,
  enabled: boolean,
  alsoRefresh?: () => Promise<void>,
): TodayActionsApi {
  const [actions, setActions] = useState<TodayAction[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const [fresh] = useState(freshness);

  const fetchActions = useCallback(async () => {
    const current = fresh.startRead();
    try {
      const res = await fetch(`${base}/today-actions`, { cache: "no-store", signal: readSignal() });
      if (!res.ok) return;
      const json = (await res.json()) as { data?: TodayAction[] } | TodayAction[];
      const list = Array.isArray(json) ? json : json.data;
      if (Array.isArray(list) && current()) setActions((prev) => keepIfSame(prev, list));
    } catch {
      // realtime will bring the next update; the overlay just stays put.
    }
  }, [base, fresh]);

  useEffect(() => {
    if (!enabled || !tripId) return;
    void fetchActions();
    const refresh = throttledRefresh(() => Promise.all([fetchActions(), alsoRefresh?.()]), TODAY_REFRESH_GAP_MS);
    const supabase = createClient();
    if (channelRef.current) supabase.removeChannel(channelRef.current);
    const channel = supabase
      .channel(todayChannel(tripId), TODAY_CHANNEL_OPTIONS)
      .on("broadcast", { event: TODAY_CHANGED_EVENT }, () => refresh.request())
      .subscribe();
    channelRef.current = channel;
    return () => {
      refresh.cancel();
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [enabled, tripId, fetchActions, alsoRefresh]);

  const post = useCallback(
    (body: Record<string, unknown>) =>
      fresh.write(async () => {
        const res = await fetch(`${base}/today-action`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j?.error?.message || j?.message || "That didn't work.");
        }
        const json = (await res.json()) as { data?: TodayAction[] } | TodayAction[];
        const list = Array.isArray(json) ? json : json.data;
        if (Array.isArray(list)) setActions(list);
      }),
    [base, fresh],
  );

  const apply = useCallback<TodayActionsApi["apply"]>(
    async ({ action_type, day_number, activity }) => {
      if (busy) return;
      setBusy(true);
      setError(null);
      try {
        await post({
          action_type,
          day_number,
          ...(activity?.id ? { activity_id: activity.id } : {}),
          ...(action_type === "swap" && activity
            ? { activity: { name: activity.name, type: activity.type, location: activity.location, address: activity.address } }
            : {}),
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "That didn't work.");
      } finally {
        setBusy(false);
      }
    },
    [busy, post],
  );

  const undo = useCallback<TodayActionsApi["undo"]>(
    async (actionId: string) => {
      if (busy) return;
      setBusy(true);
      setError(null);
      try {
        await post({ undo: true, action_id: actionId });
      } catch (e) {
        setError(e instanceof Error ? e.message : "That didn't work.");
      } finally {
        setBusy(false);
      }
    },
    [busy, post],
  );

  return { actions, busy, error, apply, undo };
}
