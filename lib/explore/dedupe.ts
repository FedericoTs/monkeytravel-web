/**
 * /explore feed hygiene — collapse duplicates before the page is cut.
 *
 * Measured 2026-09-05 on the 55 feed-eligible trips: one fork was listed
 * next to its parent, and 8 rows were extra copies of the same
 * (title, author, duration) — the same trip published twice, or saved
 * and re-published. Both read as a broken feed to a visitor. Live Trip
 * plan, Phase 1.4.
 *
 * Two passes, both order-preserving (the input arrives ranked, so "first"
 * means "highest ranked"):
 *   1. one trip per lineage — `parent_trip_id ?? id`. The original wins
 *      over a fork of it when both are present, whatever their ranks: the
 *      fork is derivative, and showing both is the bug.
 *   2. one trip per (normalised title, author, duration in days).
 *
 * Pure and small on purpose so it can be unit-tested (dedupe.vitest.ts)
 * and so the route stays a thin mapping layer.
 */

export interface FeedRowLike {
  id: string;
  user_id: string | null;
  parent_trip_id?: string | null;
  title: string;
  start_date: string;
  end_date: string;
}

export function durationDaysOf(row: Pick<FeedRowLike, "start_date" | "end_date">): number {
  const start = new Date(row.start_date).getTime();
  const end = new Date(row.end_date).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
}

export function dedupeFeedRows<T extends FeedRowLike>(rows: T[]): T[] {
  // Pass 1 — lineage. A Map keeps a key's original position on overwrite,
  // so promoting the parent into a fork's slot keeps the feed order stable.
  const byLineage = new Map<string, T>();
  for (const row of rows) {
    const key = row.parent_trip_id ?? row.id;
    const kept = byLineage.get(key);
    if (!kept) {
      byLineage.set(key, row);
    } else if (row.parent_trip_id == null && kept.parent_trip_id != null) {
      byLineage.set(key, row);
    }
  }

  // Pass 2 — same title, same author, same length.
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of byLineage.values()) {
    const key = [
      row.title.trim().toLowerCase().replace(/\s+/g, " "),
      row.user_id ?? "",
      durationDaysOf(row),
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}
