"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";
import type { Activity } from "@/types";
import type { TodayAction, TodayActionType } from "./actions";

/**
 * The chip overlay for a live trip's Today — Live Trip Phase 3.3.
 *
 * Hydrates the active actions, then subscribes to trip_today_actions changes
 * (the same postgres_changes pattern as useActivityVotes) so a chip tapped by
 * anyone appears on everyone's Today within a second. Applying and undoing go
 * through the /shared/[token] routes (service role); this hook re-fetches on
 * any realtime event so every viewer converges on the server's truth.
 */
export interface TodayActionsApi {
  actions: TodayAction[];
  busy: boolean;
  error: string | null;
  apply: (input: { action_type: TodayActionType; day_number: number; activity?: Activity }) => Promise<void>;
  undo: (actionId: string) => Promise<void>;
}

export function useTodayActions(shareToken: string, tripId: string, enabled: boolean): TodayActionsApi {
  const [actions, setActions] = useState<TodayAction[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const base = `/api/shared/${shareToken}`;

  const fetchActions = useCallback(async () => {
    try {
      const res = await fetch(`${base}/today-actions`, { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as { data?: TodayAction[] } | TodayAction[];
      const list = Array.isArray(json) ? json : json.data;
      if (Array.isArray(list)) setActions(list);
    } catch {
      // realtime will bring the next update; the overlay just stays put.
    }
  }, [base]);

  useEffect(() => {
    if (!enabled || !tripId) return;
    void fetchActions();
    const supabase = createClient();
    if (channelRef.current) supabase.removeChannel(channelRef.current);
    const channel = supabase
      .channel(`trip-today:${tripId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "trip_today_actions", filter: `trip_id=eq.${tripId}` }, () => {
        void fetchActions();
      })
      .subscribe();
    channelRef.current = channel;
    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [enabled, tripId, fetchActions]);

  const post = useCallback(
    async (body: Record<string, unknown>) => {
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
    },
    [base],
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
