/**
 * In-trip evening-before digest — Live Trip plan, Phase 4.1.
 *
 * One digest per trip day (from day 2 on): "Tomorrow: Day 3 — Alfama. Lunch
 * 13:00 …", deep-linked to Today. It is the re-open trigger for the ~7.8 days
 * of a trip, so that Today mode doesn't rely on the traveller remembering.
 *
 * DELIVERY MODEL (decided 2026-09-06). The notifications cron runs ONCE daily
 * at 07:00 UTC (vercel.json). A slot stamped for "19:00 trip-local" would not
 * be due at that run and would slip to the next day — the exact 22h-lag bug the
 * pre-trip cascade already fixed by stamping 06:00 UTC, below the cron hour
 * (see 20260827120000). So the digest for day K is stamped 06:00 UTC on the
 * trip-local calendar day BEFORE day K, i.e. it is a reliable ~1-day-ahead
 * heads-up delivered by the same 07:00 UTC run — not literally 19:00 local.
 * True evening-local delivery would need an hourly cron; that's a separate
 * infra call.
 *
 * This module is PURE (no imports) so the migration's SQL, the cron dispatcher
 * and the probe can all be checked against the same arithmetic. The migration
 * `enqueue_trip_day_digests` mirrors digestScheduledForUtc / digestDayCount;
 * `reminder-i18n`-style tests pin the copy separately.
 */

/** Slot values are `in_trip_day_<K>` where K is the trip day the digest is about. */
export const DIGEST_SLOT_PREFIX = "in_trip_day_";

/**
 * The longest trip we enqueue digests for. The multi-city wizard caps trips at
 * 21 days; bounding here keeps the slot-CHECK regex finite and stops a bad
 * end_date from queueing hundreds of rows. Days past the cap simply get no
 * digest.
 */
export const DIGEST_MAX_DAY = 21;

/** 06:00 UTC — the proven slot hour, strictly below the 07:00 UTC cron. */
export const DIGEST_SLOT_HOUR_UTC = 6;

export function digestSlot(day: number): string {
  return `${DIGEST_SLOT_PREFIX}${day}`;
}

/** The trip day a digest slot is about, or null if the slot isn't a digest. */
export function parseDigestDay(slot: string): number | null {
  if (!slot.startsWith(DIGEST_SLOT_PREFIX)) return null;
  const n = Number.parseInt(slot.slice(DIGEST_SLOT_PREFIX.length), 10);
  return Number.isInteger(n) && n >= 2 ? n : null;
}

/** Parse a YYYY-MM-DD date to a UTC-midnight epoch ms, or null. */
function parseYmdUtc(ymd: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd);
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  return Number.isNaN(t) ? null : t;
}

const DAY_MS = 86_400_000;

/**
 * Number of trip days from start_date..end_date inclusive, clamped to
 * [0, DIGEST_MAX_DAY]. Digests run for days 2..N, so a 1-day trip gets none.
 */
export function digestDayCount(startDate: string, endDate: string | null): number {
  const s = parseYmdUtc(startDate);
  if (s === null) return 0;
  const e = endDate ? parseYmdUtc(endDate) : s;
  if (e === null || e < s) return 0;
  const days = Math.round((e - s) / DAY_MS) + 1;
  return Math.max(0, Math.min(DIGEST_MAX_DAY, days));
}

/**
 * When the digest for day K is stamped: 06:00 UTC on the trip-local calendar
 * day before day K, i.e. start_date + (K-2) days. Returns an ISO string, or
 * null for an unusable date / K < 2.
 */
export function digestScheduledForUtc(startDate: string, day: number): string | null {
  const s = parseYmdUtc(startDate);
  if (s === null || day < 2) return null;
  return new Date(s + (day - 2) * DAY_MS + DIGEST_SLOT_HOUR_UTC * 3_600_000).toISOString();
}

export interface PlannedDigest {
  day: number;
  slot: string;
  scheduledForUtc: string;
}

/**
 * Every digest to enqueue for a trip: days 2..N whose stamp is still in the
 * future (a trip created mid-stay doesn't backfill past days). Mirrors the
 * WHERE clause of the enqueue RPC.
 */
export function plannedDigests(
  startDate: string,
  endDate: string | null,
  now: Date = new Date(),
): PlannedDigest[] {
  const n = digestDayCount(startDate, endDate);
  const out: PlannedDigest[] = [];
  for (let day = 2; day <= n; day++) {
    const iso = digestScheduledForUtc(startDate, day);
    if (iso && Date.parse(iso) > now.getTime()) {
      out.push({ day, slot: digestSlot(day), scheduledForUtc: iso });
    }
  }
  return out;
}

/**
 * Has the digest's moment passed? "Tomorrow: Day K" is only true before day K
 * begins. If a missed cron run delivers it on day K (or later) it is wrong —
 * suppress it, exactly as the pre-trip guard suppresses a late "Travel day".
 * Returns a reason string to suppress, or null to send.
 */
export function digestStaleReason(day: number, startDate: string, now: Date): string | null {
  const s = parseYmdUtc(startDate);
  if (s === null) return null; // unusable dates aren't this guard's problem
  const dayKDate = s + (day - 1) * DAY_MS;
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (todayUtc >= dayKDate) {
    const late = Math.round((todayUtc - dayKDate) / DAY_MS);
    return `stale_in_trip_day_${day}_${late}d_late`;
  }
  return null;
}
