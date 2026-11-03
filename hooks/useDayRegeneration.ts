"use client";

import { useCallback, useState, type Dispatch, type SetStateAction } from "react";
import { useTranslations } from "next-intl";
import { useToast } from "@/components/ui/Toast";
import { ensureActivityIds } from "@/lib/utils/activity-id";
import { readItineraryVersion } from "@/lib/trips/itinerary-sync";
import type { ItineraryDay } from "@/types";

/**
 * Per-day regeneration: replaces all activities of a single day with a
 * fresh generation that takes the surrounding days as context, steered by
 * what the traveller wrote in the dialog (sent as `instructions`). Confirmed
 * in the dialog; once the new day arrives, pushed to the undo stack and
 * swapped in. `regeneratingDayNumber` is the day in flight.
 */
export function useDayRegeneration({
  tripId,
  pushUndo,
  runItineraryWrite,
  adoptDayWrite,
  setRenderEpoch,
  setSaveError,
}: {
  tripId: string;
  pushUndo: (action: string) => void;
  /** Runs a server write in the save queue (useItinerarySync). */
  runItineraryWrite: <T>(task: () => Promise<T>, options?: { keepsLocalEdits?: boolean }) => Promise<T>;
  /** Takes a day the server stored, on top of version `from` as `to` (useItinerarySync). */
  adoptDayWrite: (splice: (it: ItineraryDay[]) => ItineraryDay[], from: number | null, to: number | null) => Promise<void>;
  setRenderEpoch: Dispatch<SetStateAction<number>>;
  setSaveError: (message: string | null) => void;
}) {
  const t = useTranslations("trips");
  const { addToast } = useToast();
  // Tracks which day_number is currently being replaced.
  const [regeneratingDayNumber, setRegeneratingDayNumber] = useState<number | null>(null);

  const handleDayRegenerate = useCallback(
    async (dayNumber: number, instructions?: string) => {
      setRegeneratingDayNumber(dayNumber);
      try {
        // In the queue: pending edits are saved first, and the version the
        // server returns is adoptable only if nothing else wrote in between.
        await runItineraryWrite(async () => {
          const response = await fetch("/api/ai/regenerate-day", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              tripId,
              dayNumber,
              ...(instructions?.trim() ? { instructions: instructions.trim().slice(0, 500) } : {}),
            }),
          });

          if (!response.ok) {
            let msg = "Failed to regenerate day";
            try {
              const errBody = await response.json();
              if (errBody?.error?.message) msg = errBody.error.message;
              else if (typeof errBody?.error === "string") msg = errBody.error;
            } catch {
              /* ignore parse error */
            }
            // The server's text is English; the status picks the message shown.
            throw Object.assign(new Error(msg), { status: response.status });
          }

          const data = await response.json();
          // apiSuccess wraps payloads as { data: {...} } in some helpers; tolerate both.
          const payload = data?.day ? data : data?.data ?? {};
          const newDay = payload.day as ItineraryDay | undefined;
          if (!newDay) throw new Error("Empty response from server");

          const day = ensureActivityIds([newDay])[0];
          const splice = (it: ItineraryDay[]) => it.map((d) => (d.day_number === dayNumber ? day : d));
          const from = readItineraryVersion(payload.fromVersion);
          const to = readItineraryVersion(payload.itineraryVersion);
          // Undo is offered once there is a new day: a refused or failed
          // attempt leaves nothing to undo, and the redo stack as it was.
          // The step holds the plan as it was when the day was asked for.
          pushUndo(`Regenerate Day ${dayNumber}`);
          await adoptDayWrite(splice, from, to);
        }, { keepsLocalEdits: true });
        // Bump the version counter so the day's children re-mount cleanly.
        setRenderEpoch((v) => v + 1);
        addToast(t('detail.regenerateDay.done', { number: dayNumber }), "success");
      } catch (error) {
        console.error("Error regenerating day:", error);
        const status = (error as { status?: number } | null)?.status;
        const msg =
          status === 429
            ? t('detail.regenerateDay.limit')
            : status === 409
              ? t('detail.regenerateDay.busy')
              : t('detail.regenerateDay.failed', { number: dayNumber });
        setSaveError(msg);
        addToast(msg, "error");
      } finally {
        setRegeneratingDayNumber(null);
      }
    },
    [pushUndo, runItineraryWrite, addToast, t, tripId, adoptDayWrite, setSaveError, setRenderEpoch]
  );

  return { regeneratingDayNumber, handleDayRegenerate };
}
