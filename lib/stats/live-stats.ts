import type { PublicStats } from "./public-stats";

/** The planner pages with a figure of their own; the rest show the last 30 days. */
export type StatsFocus = "group" | "solo" | "short";

export type LiveStatKey = "plans" | "plans30d" | "group" | "solo" | "short" | "activities" | "speed";

export interface LiveStat {
  key: LiveStatKey;
  value: number;
  /** "+" when the value is a floor, "s" for measured seconds. */
  unit: "+" | "s";
}

/** Rounds down to a figure that reads as a floor: 4,004 → 4,000, 1,213 → 1,200, 883 → 800, 20,253 → 20,000. */
export function honestFloor(n: number): number {
  if (n >= 10_000) return Math.floor(n / 1000) * 1000;
  if (n >= 100) return Math.floor(n / 100) * 100;
  return Math.floor(n / 10) * 10;
}

/** Below these a figure advertises how small it is rather than proving anything. */
const MIN = { plans: 1000, recent: 300, activities: 5000 };

const SEGMENTS: Record<StatsFocus, (s: PublicStats) => number> = {
  group: (s) => s.groupPlans,
  solo: (s) => s.soloPlans,
  short: (s) => s.shortPlans,
};

/**
 * What a planner page shows, in order: plans all time, the page's own segment
 * (or the last 30 days), activities on saved itineraries, and the measured
 * median time to a plan. A figure under its floor is left out.
 */
export function pickLiveStats(stats: PublicStats, focus?: StatsFocus): LiveStat[] {
  const picked: LiveStat[] = [];
  if (stats.plans >= MIN.plans) picked.push({ key: "plans", value: honestFloor(stats.plans), unit: "+" });

  const segment = focus ? SEGMENTS[focus](stats) : 0;
  if (focus && segment >= MIN.recent) picked.push({ key: focus, value: honestFloor(segment), unit: "+" });
  else if (stats.plans30d >= MIN.recent) picked.push({ key: "plans30d", value: honestFloor(stats.plans30d), unit: "+" });

  if (stats.activities >= MIN.activities) picked.push({ key: "activities", value: honestFloor(stats.activities), unit: "+" });

  const seconds = stats.medianPlanSeconds;
  if (seconds !== null && seconds >= 5 && seconds <= 120) picked.push({ key: "speed", value: Math.round(seconds), unit: "s" });

  return picked;
}
