/**
 * The four in-trip chips — shared types and the pure overlay logic.
 * Live Trip plan, Phase 3.3.
 *
 * The chips never edit the owner's itinerary; they write rows that everyone
 * reads and this module OVERLAYS on today's activities:
 *   - running_late: shift the not-yet-done activities later by the summed
 *     minutes of the day's active running_late actions (capped);
 *   - skip: mark an activity skipped;
 *   - swap: attach a suggested nearby alternative to an activity;
 *   - done: mark the whole day (activity_id null) or one activity finished.
 *
 * Pure and unit-tested so the route, the hook and the view agree.
 */
import type { Activity } from "@/types";

export const TODAY_ACTION_TYPES = ["running_late", "skip", "swap", "done"] as const;
export type TodayActionType = (typeof TODAY_ACTION_TYPES)[number];

export function parseTodayActionType(value: unknown): TodayActionType | null {
  return typeof value === "string" && (TODAY_ACTION_TYPES as readonly string[]).includes(value)
    ? (value as TodayActionType)
    : null;
}

/** Minutes a single "running late" adds. Fixed so the chip stays one tap. */
export const RUNNING_LATE_STEP_MINUTES = 30;
/** Cap the summed shift so many taps can't push the day off the clock. */
export const RUNNING_LATE_CAP_MINUTES = 240;

export interface SwapSuggestion {
  name: string;
  why?: string;
}

/** A row from trip_today_actions, as the client sees it (no cookie ids). */
export interface TodayAction {
  id: string;
  day_number: number;
  action_type: TodayActionType;
  activity_id: string | null;
  payload: { minutes?: number; swap_to?: SwapSuggestion } | Record<string, unknown>;
  actor_name: string | null;
  actor_role: "owner" | "participant";
  /** True when this action is the current viewer's own (drives the undo control). */
  mine?: boolean;
  created_at: string;
  undone_at: string | null;
}

export function activeActions(actions: TodayAction[], dayNumber: number): TodayAction[] {
  return actions.filter((a) => a.undone_at === null && a.day_number === dayNumber);
}

/** The derived state the Today view renders for one activity. */
export interface ActivityOverlay {
  /** start_time shifted by running-late minutes, "HH:MM"; unchanged when no shift. */
  displayStartTime: string | undefined;
  skipped: boolean;
  skippedBy: string | null;
  done: boolean;
  swap: SwapSuggestion | null;
  swapBy: string | null;
}

function shiftHHMM(hhmm: string | undefined, minutes: number): string | undefined {
  if (!hhmm || minutes === 0) return hhmm;
  const m = hhmm.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return hhmm;
  let total = +m[1] * 60 + +m[2] + minutes;
  total = Math.max(0, Math.min(24 * 60 - 1, total));
  const h = Math.floor(total / 60);
  const mm = total % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/** Summed active running-late minutes for the day, capped. */
export function runningLateMinutes(actions: TodayAction[], dayNumber: number): number {
  const total = activeActions(actions, dayNumber)
    .filter((a) => a.action_type === "running_late")
    .reduce((sum, a) => sum + (typeof a.payload?.minutes === "number" ? a.payload.minutes : RUNNING_LATE_STEP_MINUTES), 0);
  return Math.min(RUNNING_LATE_CAP_MINUTES, total);
}

/** True when the whole day is marked done (a day-level `done` action). */
export function isDayDone(actions: TodayAction[], dayNumber: number): boolean {
  return activeActions(actions, dayNumber).some((a) => a.action_type === "done" && a.activity_id === null);
}

/**
 * Overlay for one activity, given the day's active actions. `shiftMinutes` is
 * passed in (compute once per day with runningLateMinutes) so the caller does
 * not recompute it per activity.
 */
export function overlayFor(
  activity: Activity,
  actions: TodayAction[],
  dayNumber: number,
  shiftMinutes: number,
): ActivityOverlay {
  const active = activeActions(actions, dayNumber).filter((a) => a.activity_id === activity.id && activity.id);
  const skip = active.find((a) => a.action_type === "skip");
  const done = active.find((a) => a.action_type === "done");
  const swap = active.find((a) => a.action_type === "swap");
  const swapTo = (swap?.payload?.swap_to ?? null) as SwapSuggestion | null;
  return {
    // A skipped or done activity keeps its original time; only pending ones shift.
    displayStartTime: skip || done ? activity.start_time : shiftHHMM(activity.start_time, shiftMinutes),
    skipped: !!skip,
    skippedBy: skip?.actor_name ?? null,
    done: !!done,
    swap: swapTo && swapTo.name ? swapTo : null,
    swapBy: swap?.actor_name ?? null,
  };
}

/**
 * A locale-agnostic descriptor for one feed line. The view turns `who` and
 * `key`+`params` into localized text (messages/<locale>/common.json →
 * today.feed.*), so the feed reads in the viewer's language, not English.
 */
export interface FeedDescriptor {
  who: { kind: "name" | "owner" | "someone"; name?: string };
  /** The message key under today.feed.* */
  key: "runningLate" | "skip" | "swap" | "swapNoName" | "doneActivity" | "doneDay";
  params: { activity?: string; minutes?: number; to?: string };
}

export function feedDescriptor(action: TodayAction, activityName: string | null): FeedDescriptor {
  const name = action.actor_name?.trim();
  const who: FeedDescriptor["who"] = name
    ? { kind: "name", name }
    : action.actor_role === "owner"
      ? { kind: "owner" }
      : { kind: "someone" };
  const activity = activityName ?? undefined;
  switch (action.action_type) {
    case "running_late":
      return { who, key: "runningLate", params: { minutes: typeof action.payload?.minutes === "number" ? action.payload.minutes : RUNNING_LATE_STEP_MINUTES } };
    case "skip":
      return { who, key: "skip", params: { activity } };
    case "swap": {
      const to = (action.payload?.swap_to as SwapSuggestion | undefined)?.name;
      return to ? { who, key: "swap", params: { activity, to } } : { who, key: "swapNoName", params: { activity } };
    }
    case "done":
      return action.activity_id ? { who, key: "doneActivity", params: { activity } } : { who, key: "doneDay", params: {} };
    default:
      return { who, key: "doneDay", params: {} };
  }
}
