/**
 * The Today activity feed — Live Trip plan, Phase 3.5.
 *
 * "Ana is going · Marco skipped lunch · dinner swapped" — one chronological
 * stream merged from two sources (participant joins and the chip actions of
 * 3.3). This is what makes N people re-open a live trip: they can see it's
 * alive.
 *
 * The two sources live in service-role-only or public tables with different
 * shapes, so the server (lib/feed/snapshot.ts) normalizes them into FeedEvent
 * rows; this module holds the shared type, the sort, the locale-agnostic
 * describe (the view localizes), and relative-time — all pure and tested.
 */

export type FeedKind = "join" | "running_late" | "skip" | "swap" | "done";

export interface FeedEvent {
  id: string;
  kind: FeedKind;
  /** ISO timestamp of the event. */
  at: string;
  actorName: string | null;
  actorIsOwner: boolean;
  /** Activity the event refers to, resolved server-side, when any. */
  activityName: string | null;
  /** running_late */
  minutes?: number;
  /** swap */
  swapTo?: string | null;
}

/** Newest first, with a stable tiebreak on id so equal timestamps don't reorder. */
export function sortFeed(events: FeedEvent[]): FeedEvent[] {
  return [...events].sort((a, b) => {
    if (a.at !== b.at) return a.at < b.at ? 1 : -1;
    return a.id < b.id ? 1 : -1;
  });
}

const ICONS: Record<FeedKind, string> = {
  join: "🙋",
  running_late: "⏰",
  skip: "⏭️",
  swap: "🔄",
  done: "✓",
};
export function feedIcon(kind: FeedKind): string {
  return ICONS[kind];
}

/** The message key + params for one event. */
export interface FeedDescriptor {
  who: { kind: "name" | "owner" | "someone"; name?: string };
  /** today.feed.<key> */
  key: "join" | "runningLate" | "skip" | "swap" | "swapNoName" | "doneActivity" | "doneDay";
  params: { activity?: string; minutes?: number; to?: string };
}

export function describeFeedEvent(e: FeedEvent): FeedDescriptor {
  const who: FeedDescriptor["who"] = e.actorName?.trim()
    ? { kind: "name", name: e.actorName.trim() }
    : e.actorIsOwner
      ? { kind: "owner" }
      : { kind: "someone" };
  const activity = e.activityName ?? undefined;
  switch (e.kind) {
    case "join":
      return { who, key: "join", params: {} };
    case "running_late":
      return { who, key: "runningLate", params: { minutes: e.minutes ?? 30 } };
    case "skip":
      return { who, key: "skip", params: { activity } };
    case "swap":
      return e.swapTo ? { who, key: "swap", params: { activity, to: e.swapTo } } : { who, key: "swapNoName", params: { activity } };
    case "done":
      return activity ? { who, key: "doneActivity", params: { activity } } : { who, key: "doneDay", params: {} };
  }
}

export type RelativeUnit = "now" | "minute" | "hour" | "day";

/** Coarse relative time for the feed: {value, unit}; "now" under a minute. */
export function relativeTime(iso: string, now: Date = new Date()): { value: number; unit: RelativeUnit } {
  const then = new Date(iso).getTime();
  const diffMs = now.getTime() - then;
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return { value: 0, unit: "now" };
  if (min < 60) return { value: min, unit: "minute" };
  const hours = Math.floor(min / 60);
  if (hours < 24) return { value: hours, unit: "hour" };
  return { value: Math.floor(hours / 24), unit: "day" };
}
