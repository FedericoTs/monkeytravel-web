import { parseDigestDay } from "@/lib/notifications/digest";

/**
 * When the trip-notification queue sends its rows, and in what order. Used
 * by the scheduled-notifications cron.
 */

/**
 * How many days before departure each pre-trip slot is meant to arrive.
 *
 * Mirrors the offsets in enqueue_trip_notifications (latest definition:
 * supabase/migrations/20260902170000_enqueue_revives_suppressed_rows.sql).
 * The post-trip family is absent on purpose: those fire AFTER the trip and
 * cannot be overtaken by it.
 */
const PRE_TRIP_OFFSET_DAYS: Record<string, number> = {
  pack_early_14d: 14,
  visa_check_7d: 7,
  weather_3d: 3,
  confirm_1d: 1,
  morning_of: 0,
};

/**
 * How many days late each pre-trip slot may still go out. TOLERANCE IS PER
 * SLOT, because grace is only defensible while the copy stays TRUE. The cron
 * runs once daily at 07:00 UTC against slots stamped 06:00, so a single missed
 * run puts a row 24h behind, and whether that matters depends on what the row
 * says:
 *
 *   "Two weeks to go"          at 13 days   still true enough      -> 1 day
 *   "One week out"             at 6 days    still true enough      -> 1 day
 *   "Three days to Palermo"    at 2 days    close enough           -> 1 day
 *   "Tomorrow - final checks"  at 0 days    the trip is TODAY      -> 0 days
 *   "Travel day"               at -1 day    they already left      -> 0 days
 *
 * The last two name a specific imminent day, so a day's slip makes them false
 * rather than merely loose. A single global tolerance of one day would send
 * "Travel day" the morning after departure.
 */
const STALE_GRACE_DAYS: Record<string, number> = {
  pack_early_14d: 1,
  visa_check_7d: 1,
  weather_3d: 1,
  confirm_1d: 0,
  morning_of: 0,
};

/**
 * Is this row's moment gone?
 *
 * Every pre-trip subject line makes a claim about WHEN ("Two weeks to go",
 * "Three days to Palermo", "Travel day"), true only near the offset it was
 * queued for. A row that goes out late arrives WRONG, and confidently: "Three
 * days to Palermo" landing the day after someone got home.
 *
 * Silent while the queue is punctual; it catches rows released late after a
 * cron outage or a queue hold. To hold the queue, prefer
 * TRIP_NOTIFICATIONS_SEND_CAP=0: rows stay `pending` and need no repair
 * afterwards. A suppressed row comes back only when enqueue_trip_notifications
 * re-runs for its trip, which revives a suppressed row on conflict, never a
 * `sent` one (migration 20260902170000).
 *
 * Returns a reason string when the row should be suppressed, or null to send.
 */
export function staleReason(
  slot: string,
  tripStartDate: string,
  now: Date
): string | null {
  const intended = PRE_TRIP_OFFSET_DAYS[slot];
  if (intended === undefined) return null; // post-trip slot, or unknown

  const start = Date.parse(`${tripStartDate}T00:00:00Z`);
  if (Number.isNaN(start)) return null; // unusable dates are not this guard's problem

  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const daysUntilStart = Math.round((start - today) / 86_400_000);

  // How late is this row against the moment its copy describes? Positive =
  // late. `morning_of` (intended 0) is late the moment the trip has begun.
  const daysLate = intended - daysUntilStart;
  if (daysLate <= (STALE_GRACE_DAYS[slot] ?? 1)) return null;

  return `stale_${slot}_${daysLate}d_late`;
}

/**
 * The order rows are processed in when a run may not reach them all.
 *
 * TRIP_NOTIFICATIONS_SEND_CAP stops a run after N real sends and leaves the
 * rest `pending` for the next morning. Oldest-first is the wrong order under a
 * cap: rows that can wait a day ("One week out" is still true at six days)
 * would go first, and rows that cannot ("Tomorrow — final checks", "Travel
 * day", the evening-before digest) would be pushed to the next run, where
 * staleReason refuses them.
 *
 * So: rows with no grace first (they are wrong tomorrow), then the rest, each
 * group oldest-first. Post-trip followups make no claim about WHEN and go
 * last. Pure and stable, so a capped run spends its sends on the rows that
 * cannot wait.
 */
export function prioritizeDueRows<
  T extends { slot: string; scheduled_for: string },
>(rows: T[]): T[] {
  const urgency = (slot: string): number => {
    if (slot.startsWith("followup_")) return 2;
    // An evening-before digest is wrong by the next evening: zero grace.
    if (parseDigestDay(slot) !== null) return 0;
    return STALE_GRACE_DAYS[slot] ?? 1;
  };
  // On the departure morning `morning_of` and `in_trip_day_2` are due at the
  // same minute, and the one-email-per-trip-per-day rule lets only one out.
  // "Travel day" carries the day-1 plan the traveller needs first; the day-2
  // digest yields. Without this tie-break the winner would be insertion order.
  const digest = (slot: string): number => (parseDigestDay(slot) !== null ? 1 : 0);
  return rows
    .map((row, index) => ({ row, index, urgency: urgency(row.slot), digest: digest(row.slot) }))
    .sort(
      (a, b) =>
        a.urgency - b.urgency ||
        a.row.scheduled_for.localeCompare(b.row.scheduled_for) ||
        a.digest - b.digest ||
        a.index - b.index
    )
    .map((entry) => entry.row);
}

/**
 * The rate limit is one email per trip per CALENDAR DAY (UTC), not per
 * rolling 24 hours. The cron runs once a day at 07:00 UTC, so a rolling
 * window would see yesterday's send (07:00:30) from today's run (07:00:20) as
 * "within 24h" and suppress today's row, starving the in-trip digests, which
 * are daily by design. Stale rows are still refused by staleReason.
 */
export function rateLimitWindowStart(now: Date): string {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  ).toISOString();
}
