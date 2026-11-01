import type { Activity, ItineraryDay } from "@/types";

/**
 * A change the trip assistant or the concierge proposes, waiting for the
 * traveller's confirm: what `POST /api/ai/assistant` returns in
 * `pendingChange` (preview mode) and what the concierge's proposal carries.
 * Discriminated on `type`.
 *
 * add_day and apply_draft are the structural actions: one new day, or a
 * multi-day draft that revises days and may add new ones, in one write.
 */
export type PendingChange =
  | {
      type: "replace";
      oldActivity: Activity;
      newActivity: Activity;
      dayNumber: number;
      reason?: string;
    }
  | {
      type: "add";
      newActivity: Activity;
      dayNumber: number;
      reason?: string;
    }
  | {
      /**
       * P2 (2026-08): produced by the in-trip concierge's edit channel
       * ("we're behind — drop something"). The result-page assistant still
       * never previews removals; /apply has always supported them.
       */
      type: "remove";
      oldActivity: Activity;
      dayNumber: number;
      reason?: string;
    }
  | {
      type: "adjust_duration";
      activity: { id: string; name: string; type: string };
      oldDuration: number;
      newDuration: number;
      dayNumber: number;
      reason?: string;
    }
  | {
      type: "reorder";
      dayNumber: number;
      activities: { id: string; name: string; time: string; timeSlot: string }[];
      reason?: string;
    }
  | {
      type: "add_day";
      /** The fully generated new day (IDs + coordinates already stamped). */
      day: ItineraryDay;
      dayNumber: number;
      /** trips.end_date after the append (moves in the same /apply write). */
      newEndDate?: string;
      /** end_date before the append — powers a consistent undo. */
      previousEndDate?: string;
      reason?: string;
    }
  | {
      type: "apply_draft";
      /** Revised replacement days, then any new days, persisted in ONE /apply write. */
      days: ItineraryDay[];
      changedDayNumbers: number[];
      /** Current days the draft didn't cover — they stay untouched. */
      unmappedDayNumbers?: number[];
      /** trips.end_date once the new days are added (moves in the same /apply write). */
      newEndDate?: string;
      /** end_date before them — powers a consistent undo. */
      previousEndDate?: string;
      reason?: string;
    }
  | {
      /**
       * P2 Stage C (concierge): push days dayNumber..lastDayNumber
       * `shiftByDays` days later — the cancelled-flight primitive.
       */
      type: "shift_days";
      dayNumber: number;
      shiftByDays: number;
      lastDayNumber: number;
      newLastDate?: string;
      reason?: string;
    };

/** The body `POST /api/ai/assistant/apply` takes for one change. */
export type ApplyBody = {
  tripId: string;
  /** Lets the transcript record that the proposal was taken up. */
  conversationId?: string | null;
  /** The change's day; for a multi-day draft, its first changed day. */
  dayNumber: number;
} & (
  | { changeType: "replace"; oldActivity: Activity; newActivity: Activity }
  | { changeType: "add"; newActivity: Activity }
  | { changeType: "remove"; oldActivity: Activity }
  | { changeType: "adjust_duration"; activity: { id: string; name: string; type: string }; oldDuration: number; newDuration: number }
  | { changeType: "reorder"; activities: Extract<PendingChange, { type: "reorder" }>["activities"] }
  | { changeType: "add_day"; day: ItineraryDay }
  | { changeType: "apply_draft"; days: ItineraryDay[] }
  | { changeType: "shift_days"; shiftByDays: number }
);

/**
 * The /apply body for a change. The assistant panel and the concierge both
 * build it here, so each change type carries the fields the route reads.
 */
export function buildApplyBody(
  change: PendingChange,
  context: { tripId: string; conversationId?: string | null },
): ApplyBody {
  const base = {
    tripId: context.tripId,
    ...(context.conversationId !== undefined ? { conversationId: context.conversationId } : {}),
  };
  switch (change.type) {
    case "replace":
      return { ...base, changeType: "replace", dayNumber: change.dayNumber, oldActivity: change.oldActivity, newActivity: change.newActivity };
    case "add":
      return { ...base, changeType: "add", dayNumber: change.dayNumber, newActivity: change.newActivity };
    case "remove":
      return { ...base, changeType: "remove", dayNumber: change.dayNumber, oldActivity: change.oldActivity };
    case "adjust_duration":
      return {
        ...base,
        changeType: "adjust_duration",
        dayNumber: change.dayNumber,
        activity: change.activity,
        oldDuration: change.oldDuration,
        newDuration: change.newDuration,
      };
    case "reorder":
      return { ...base, changeType: "reorder", dayNumber: change.dayNumber, activities: change.activities };
    case "add_day":
      return { ...base, changeType: "add_day", dayNumber: change.dayNumber, day: change.day };
    case "apply_draft":
      return { ...base, changeType: "apply_draft", dayNumber: change.changedDayNumbers[0] ?? 1, days: change.days };
    case "shift_days":
      return { ...base, changeType: "shift_days", dayNumber: change.dayNumber, shiftByDays: change.shiftByDays };
    default: {
      const unknown: never = change;
      throw new Error(`No /apply body for change ${JSON.stringify(unknown)}`);
    }
  }
}
