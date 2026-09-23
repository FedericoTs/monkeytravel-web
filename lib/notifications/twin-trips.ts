/**
 * Twin trips: one reminder per real trip, not one per saved copy.
 *
 * WHY (2026-09-23)
 * People regenerate a trip and save the result without deleting the first
 * one, so they end up with two or three live trips that are the same trip:
 * same owner, same destination title, same start date. Each copy carries its
 * own reminder cascade, and the per-trip rate limit cannot see the siblings.
 * Measured on the queue: 19 of 217 reminders sent since 16 Sep (8.8%) were
 * extra copies, reaching 7 of 59 recipients — "Two weeks to go — Sedona" went
 * out three times at 07:00:59, 07:01:00 and 07:01:08; a Bari traveller got
 * every in-trip digest twice a day for six days. 111 pending rows due in the
 * next 30 days sat on trips with a live twin.
 *
 * The decision is made at DISPATCH, per slot, with the state as it is at that
 * moment — not at enqueue — so deleting the kept copy later simply lets the
 * next slot go out from whichever twin is left.
 */

export interface TwinCandidate {
  id: string;
  /** trips.updated_at — the copy the person touched last is the one they use. */
  updatedAt: string | null;
  /**
   * Status of this trip's scheduled_notifications row for the slot being
   * dispatched, or null when the trip has no row for it.
   */
  slotStatus: string | null;
}

/** Titles are compared loosely: case, surrounding and repeated whitespace. */
export function normalizeTripTitle(title: string | null | undefined): string {
  return (title ?? "").toLowerCase().trim().replace(/\s+/g, " ");
}

/**
 * Which copy of a twin set sends this slot. `trips` is every live trip of the
 * same owner with the same normalized title and start date, INCLUDING the one
 * being dispatched. Returns the id of the trip that should send; the caller
 * suppresses its row when that id is not its own.
 *
 *   1. A twin that already SENT this slot wins outright — the person has the
 *      email, so every other copy is a duplicate.
 *   2. Otherwise only copies that can still send it (a pending row) compete,
 *      and the most recently updated one wins. A copy with no row for the
 *      slot, or whose row was already suppressed or failed, cannot win: if it
 *      did, nobody would send.
 *   3. Ties break on id so two overlapping cron runs agree.
 *
 * A trip that is not part of a twin set (one candidate, or none eligible) is
 * always its own keeper — this function never stops a lone trip's email.
 */
export function twinKeeper(currentId: string, trips: readonly TwinCandidate[]): string {
  const others = trips.filter((t) => t.id !== currentId);
  if (others.length === 0) return currentId;

  const alreadySent = others
    .filter((t) => t.slotStatus === "sent")
    .sort((a, b) => a.id.localeCompare(b.id));
  if (alreadySent.length > 0) return alreadySent[0].id;

  const eligible = trips.filter((t) => t.id === currentId || t.slotStatus === "pending");
  if (eligible.length <= 1) return currentId;

  const ts = (t: TwinCandidate) => (t.updatedAt ? Date.parse(t.updatedAt) : 0) || 0;
  const ranked = [...eligible].sort((a, b) => ts(b) - ts(a) || b.id.localeCompare(a.id));
  return ranked[0].id;
}
