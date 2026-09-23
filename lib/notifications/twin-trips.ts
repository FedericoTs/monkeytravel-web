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
 *
 * A LOST REMINDER IS WORSE THAN A DUPLICATE. So a copy is only ever
 * suppressed once another copy has actually SENT the slot. While the chosen
 * copy is still pending, the others wait (see twinDecision), and if the
 * chosen copy then fails, one of them sends instead. Found in review of the
 * first version, which suppressed the others up front: had the chosen copy
 * then failed its own send, nobody would have received the email, and which
 * outcome happened depended on the order the rows ran in.
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
  /** When that row was sent, if it was. */
  slotSentAt?: string | null;
}

/** Titles are compared loosely: case, surrounding and repeated whitespace. */
export function normalizeTripTitle(title: string | null | undefined): string {
  return (title ?? "").toLowerCase().trim().replace(/\s+/g, " ");
}

/**
 * A "sent" row only counts if it was sent for THIS occurrence of the slot.
 * Twins share a start date, so they share the slot's scheduled time; a send
 * from well before it is a leftover from before the trip's dates moved, and
 * the person has not received this reminder for these dates.
 */
const SENT_FOR_THIS_DATE_WINDOW_MS = 24 * 60 * 60 * 1000;

function sentForThisDate(t: TwinCandidate, scheduledFor: string | null | undefined): boolean {
  if (t.slotStatus !== "sent") return false;
  if (!scheduledFor || !t.slotSentAt) return true;
  const sent = Date.parse(t.slotSentAt);
  const due = Date.parse(scheduledFor);
  if (!Number.isFinite(sent) || !Number.isFinite(due)) return true;
  return sent >= due - SENT_FOR_THIS_DATE_WINDOW_MS;
}

/**
 * Which copy of a twin set should send this slot. `trips` is every live trip
 * of the same owner with the same normalized title and start date, INCLUDING
 * the one being dispatched.
 *
 *   1. A twin that already sent this slot, for these dates, wins outright.
 *   2. Otherwise only copies that can still send it (a pending row) compete,
 *      and the most recently updated one wins. A copy with no row for the
 *      slot, or whose row was suppressed or failed, cannot win: if it did,
 *      nobody would send.
 *   3. Ties break on id so two overlapping cron runs agree.
 *
 * A trip that is not part of a twin set is always its own keeper.
 */
export function twinKeeper(
  currentId: string,
  trips: readonly TwinCandidate[],
  scheduledFor?: string | null
): string {
  const others = trips.filter((t) => t.id !== currentId);
  if (others.length === 0) return currentId;

  const alreadySent = others
    .filter((t) => sentForThisDate(t, scheduledFor))
    .sort((a, b) => a.id.localeCompare(b.id));
  if (alreadySent.length > 0) return alreadySent[0].id;

  const eligible = trips.filter((t) => t.id === currentId || t.slotStatus === "pending");
  if (eligible.length <= 1) return currentId;

  const ts = (t: TwinCandidate) => (t.updatedAt ? Date.parse(t.updatedAt) : 0) || 0;
  const ranked = [...eligible].sort((a, b) => ts(b) - ts(a) || b.id.localeCompare(a.id));
  return ranked[0].id;
}

export type TwinDecision =
  /** No twin, or this copy is the chosen one: carry on and send. */
  | { action: "send" }
  /** Another copy already sent this slot for these dates: this one is a duplicate. */
  | { action: "suppress"; keeperId: string }
  /** Another copy is chosen but has not sent yet: leave this row alone for now. */
  | { action: "wait"; keeperId: string };

/**
 * What the cron should do with the current row.
 *
 * `finalPass` is true on the cron's second pass over rows that waited: by
 * then the chosen copy has either sent (suppress) or failed / been suppressed
 * for its own reasons (so it is no longer eligible and this copy is chosen,
 * or another is). If the chosen copy is STILL pending on the final pass — it
 * was cut by the send cap or the row limit — this copy sends rather than wait
 * into staleness; when the chosen copy's turn comes, rule 1 makes it yield.
 * At least one always sends; in the normal run exactly one does.
 */
export function twinDecision(
  currentId: string,
  trips: readonly TwinCandidate[],
  scheduledFor: string | null | undefined,
  finalPass: boolean
): TwinDecision {
  const keeperId = twinKeeper(currentId, trips, scheduledFor);
  if (keeperId === currentId) return { action: "send" };
  const keeper = trips.find((t) => t.id === keeperId);
  if (keeper && sentForThisDate(keeper, scheduledFor)) return { action: "suppress", keeperId };
  if (finalPass) return { action: "send" };
  return { action: "wait", keeperId };
}
