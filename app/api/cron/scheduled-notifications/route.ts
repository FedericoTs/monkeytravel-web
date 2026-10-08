import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { getTranslations } from "next-intl/server";
import { dispatchEmail, type EmailTemplate } from "@/lib/email/send";
import type { TripReminderSlot } from "@/lib/email/templates/TripReminder";
import {
  TERMINAL_FOLLOWUP_SLOTS,
  type TripFollowupSlot,
} from "@/lib/email/templates/TripFollowup";
import {
  buildContextBlocks,
  FORECAST_SLOTS,
  type ContextBlock,
} from "@/lib/email/trip-context";
import {
  getTripForecast,
  forecastMessage,
  forecastLabel,
  tripLengthDays,
} from "@/lib/email/trip-forecast";
import { tripStartCoordinate } from "@/lib/email/trip-coordinates";
import {
  verifyRenderedEmail,
  blockingDefects,
  summarizeDefects,
} from "@/lib/email/verify-render";
import { isTripNotificationsEnabled } from "@/lib/notifications/scheduling";
import { parseDigestDay, digestStaleReason, digestParticipantRecipients } from "@/lib/notifications/digest";
import { postTripCtaUrl } from "@/lib/email/followup-cta";
import { digestDayUrl } from "@/lib/trips/day-link";
import { resolveLocale, formatDateRange } from "@/lib/email/reminder-locale";
import { retryTransient } from "@/lib/notifications/retry";
import { domesticTripVerdict } from "@/lib/notifications/domestic-trip";
import { normalizeTripTitle, twinDecision, type TwinCandidate } from "@/lib/notifications/twin-trips";
import { FINISH_TRIP_NS, FINISH_TRIP_SLOT, sendFinishTripEmail } from "@/lib/notifications/finish-trip";

/**
 * Trip email cron: sweeps `scheduled_notifications` and dispatches the
 * slot's email (pre-trip reminder, in-trip day digest or post-trip followup)
 * for every row with `status='pending'` and `scheduled_for <= NOW()`.
 *
 * Schedule: once a day at 07:00 UTC (vercel.json). Every slot is stamped
 * 06:00 UTC so it is due at that day's run. The run must finish inside the
 * 60s function limit.
 *
 * Auth: CRON_SECRET as a Bearer token, as in /api/cron/refresh-activity-index.
 * With no secret set the route 401s.
 *
 * Rate limit: one email per trip per UTC calendar day, to keep the Resend
 * complaint rate down. A slot is suppressed when any row of the same trip
 * (or of its twin copies) was sent today; see rateLimitWindowStart.
 *
 * Localisation: the route lives outside [locale]/, so request-bound next-intl
 * helpers have no locale. The recipient's preferred_language is resolved
 * explicitly and passed to `getTranslations({ locale, namespace })`, as the
 * static page builders do.
 *
 * Failure mode: a failing row is flipped to 'failed' with `last_error`.
 * Nothing is re-thrown to Vercel: one failed dispatch must not skip the rest
 * of the batch.
 *
 * CAUSALITY
 * ---------
 * - Enqueue: the trips_enqueue_notifications AFTER INSERT trigger for every
 *   new trip with a user_id, plus lib/notifications/scheduling.ts from PATCH
 *   /api/trips/[id] (date or mute change), fork and duplicate.
 * - Email: lib/email/send.ts (dispatchEmail).
 * - The one account-level slot (finish_trip_1d, no trip) is queued by a
 *   trigger on public.users and decided in lib/notifications/finish-trip.ts.
 * - Settings: users.notification_settings gates each send inside
 *   dispatchEmail (tripReminders for reminders and digests,
 *   marketingNotifications for followups and the finish-trip email),
 *   fail-closed on a read error.
 * - Per-trip mute: trips.reminders_muted blocks enqueue at the RPC layer; a
 *   row already pending when the trip is muted still reaches this route, so
 *   the flag is re-checked below.
 */

// Rows one run may process: bounds the work against the 60s function limit
// while leaving room for a backlog after a missed run.
const MAX_ROWS_PER_RUN = 200;

/**
 * Where the reminder copy lives in the assembled message tree.
 *
 * i18n.ts mounts each messages file under its own namespace, so common.json
 * becomes `common` and these strings sit at common.tripReminderEmail.*. One
 * constant because two lookups need it and a wrong path fails silently (see
 * assertTranslated).
 */
const REMINDER_NS = "common.tripReminderEmail";

/**
 * Post-trip copy lives in a sibling namespace, same file, same mounting
 * rule — so the `common.` prefix is just as load-bearing here.
 */
const FOLLOWUP_NS = "common.tripFollowupEmail";

/**
 * In-trip evening-before digest copy. One namespace, not per-slot: the digest
 * is one template parameterised by day number. Same `common.` mounting rule.
 */
const DIGEST_NS = "common.tripDayDigestEmail";

/**
 * Also send the in-trip digest to the trip's emailed participants. OFF by
 * default, and a separate switch from the owner cascade so the participant
 * fan-out is a deliberate, watchable rollout (its sends are not counted by
 * TRIP_NOTIFICATIONS_SEND_CAP, which counts owner queue rows). Server-only:
 * only this cron reads it. Suppression and any signed-in participant's
 * opt-out are still honoured per send inside dispatchEmail.
 */
function isParticipantDigestEnabled(): boolean {
  return process.env.PARTICIPANT_DIGEST_ENABLED === "true";
}

/**
 * Headings for the per-trip enrichment blocks. Shared by both families —
 * "Day one" means the same thing whichever email it appears in.
 */
const CONTEXT_NS = "common.emailContext";

/**
 * Slots whose copy depends on whether the trip leaves the traveller's
 * country (lib/notifications/domestic-trip.ts). visa_check_7d is skipped
 * outright on a domestic trip; the other two swap to a body that does not
 * mention the passport.
 */
const DOMESTIC_AWARE_SLOTS = new Set<string>(["visa_check_7d", "pack_early_14d", "confirm_1d"]);

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

/** A queue row belongs to the post-trip family iff its slot says so. */
function isFollowupSlot(slot: QueueSlot): slot is TripFollowupSlot {
  return slot.startsWith("followup_");
}

/**
 * Every enrichment string that legitimately belongs to this trip.
 *
 * The containment check compares each rendered line against these, so a line
 * from any other trip is caught before the email goes out. Built from the
 * VALUES rather than a JSON dump of the row — JSON.stringify escapes embedded
 * quotes, so a weather note containing one would never contain itself.
 */
function ownEnrichmentStrings(trip: TripEmailRow): string[] {
  const day1 = trip.day1 as { activities?: unknown } | null | undefined;
  const activities = Array.isArray(day1?.activities) ? day1.activities : [];
  return [
    typeof trip.weather_note === "string" ? trip.weather_note : "",
    ...(Array.isArray(trip.highlights) ? trip.highlights : []),
    ...(Array.isArray(trip.packing_suggestions) ? trip.packing_suggestions : []),
    ...activities.flatMap((a: unknown) => {
      if (!a || typeof a !== "object") return [];
      const act = a as Record<string, unknown>;
      return [act.name, act.start_time, act.time_slot];
    }),
  ]
    .filter((s): s is string => typeof s === "string")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Optional cap on how many emails ONE cron run may actually send.
 *
 * The canary control: TRIP_NOTIFICATIONS_SEND_CAP=5 lets a run land in a
 * handful of inboxes, be read, and either continue or be stopped, instead of
 * committing to everything due that morning.
 *
 * Rows over the cap stay `pending` and untouched, so they simply go out on a
 * later run — nothing is dropped, and no state has to be repaired afterwards.
 * Unset means no cap, which is the steady state.
 */
function sendCap(): number | null {
  const raw = process.env.TRIP_NOTIFICATIONS_SEND_CAP;
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  // A malformed cap must not silently mean "unlimited" — that would turn a
  // typo into a full send. Anything unparseable is treated as 0: send
  // nothing, and say so loudly in the response.
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/**
 * Reject a string that is really an unresolved message key.
 *
 * next-intl does NOT throw on a missing message. Its default onError logs and
 * getMessageFallback substitutes the full key path, so the mail would still
 * send with "tripReminderEmail.morning_of.heading" where the sentence should
 * be, and the try/catch around getTranslations would never fire.
 *
 * So the send path cannot trust the translator. A value still carrying
 * "tripReminderEmail." is a fallback, never copy — no real sentence contains
 * it — and it must fail loudly instead of being delivered.
 */
function assertTranslated(values: Record<string, string>): string | null {
  for (const [key, value] of Object.entries(values)) {
    // All three families are checked: each is loaded through the same
    // fallback-instead-of-throw translator.
    if (
      value.includes("tripReminderEmail.") ||
      value.includes("tripFollowupEmail.") ||
      value.includes("tripDayDigestEmail.")
    ) {
      return `${key} did not resolve (got "${value.slice(0, 80)}")`;
    }
  }
  return null;
}

/** Every slot the queue can hold — the pre-trip cascade, the post-trip
 * followups, the in-trip per-day digests (in_trip_day_<K>) and the
 * account-level finish-trip email. */
type QueueSlot =
  | TripReminderSlot
  | TripFollowupSlot
  | `in_trip_day_${number}`
  | typeof FINISH_TRIP_SLOT;

/**
 * Shape of the trip row this route selects.
 *
 * Declared by hand because the select string in processRow is built by
 * concatenation, so supabase-js sees a plain `string`, cannot parse it, and
 * types the whole row as GenericStringError. The JSON-valued fields are
 * `unknown` on purpose — they are model-generated and
 * lib/email/trip-context.ts validates them rather than trusting a declaration.
 */
type TripEmailRow = {
  id: string;
  // title / start_date / end_date are NOT NULL in the trips schema.
  title: string;
  start_date: string;
  end_date: string;
  reminders_muted: boolean | null;
  status: string | null;
  deleted_at: string | null;
  itinerary: unknown;
  weather_note: string | null;
  highlights: unknown;
  packing_suggestions: unknown;
  day1: unknown;
  // For the participant digest fan-out: participants open the trip at
  // /shared/<token>, and their language is best-guessed from the trip.
  share_token: string | null;
  trip_locale: string | null;
};

type SlotRow = {
  id: string;
  user_id: string;
  trip_id: string;
  slot: QueueSlot;
  scheduled_for: string;
};

/** A due row as read. A DB CHECK keeps trip_id null for FINISH_TRIP_SLOT only. */
type DueRow = Omit<SlotRow, "trip_id"> & { trip_id: string | null };

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase env missing for cron");
  return createServiceClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret) return unauthorized();
  if (auth !== `Bearer ${secret}`) return unauthorized();

  // Kill switch: skip the whole sweep when the feature is disabled. This is
  // the switch that controls sending: the AFTER INSERT trigger fills the queue
  // whatever the flag says, and rows stay `pending` while it is off. Reads
  // NEXT_PUBLIC_TRIP_NOTIFICATIONS_ENABLED, falling back to
  // NEXT_PUBLIC_CALENDAR_EXPORT_ENABLED when unset.
  if (!isTripNotificationsEnabled()) {
    return NextResponse.json({
      success: true,
      skipped: "feature_disabled",
      durationMs: 0,
    });
  }

  const svc = serviceClient();
  const startedAt = Date.now();

  // 1. Fetch due rows. ORDER BY scheduled_for keeps the oldest-first;
  //    LIMIT caps the per-run blast radius. prioritizeDueRows() then moves
  //    the rows that cannot wait a day to the front: the order matters once
  //    a send cap is in play (see its note).
  //    Retried on a transient failure: the cron runs once a day, so a failed
  //    SELECT loses the whole run, and by the next run many rows are stale.
  //    See lib/notifications/retry.ts.
  const { data: dueRowsRaw, error: dueErr } = await retryTransient(
    () =>
      svc
        .from("scheduled_notifications")
        .select("id, user_id, trip_id, slot, scheduled_for")
        .eq("status", "pending")
        .lte("scheduled_for", new Date().toISOString())
        .order("scheduled_for", { ascending: true })
        .limit(MAX_ROWS_PER_RUN),
    {
      onRetry: (failedAttempt, message) =>
        console.warn("[cron/scheduled-notifs] due-select retry", { failedAttempt, message }),
    }
  );

  if (dueErr) {
    console.error("[cron/scheduled-notifs] due-select failed:", dueErr);
    return NextResponse.json(
      { error: "due_select_failed", detail: dueErr.message },
      { status: 500 }
    );
  }

  const dueRows = prioritizeDueRows((dueRowsRaw ?? []) as DueRow[]);
  if (dueRows.length === 0) {
    return NextResponse.json({
      success: true,
      due: 0,
      sent: 0,
      skipped: 0,
      failed: 0,
      durationMs: Date.now() - startedAt,
    });
  }

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  let deferredByCap = 0;

  const cap = sendCap();

  // Rows that are a twin copy of a trip whose chosen copy has not sent yet.
  // They are left untouched in the first pass and decided in a second, once
  // the chosen copy has sent (duplicate: suppress) or failed (send this one).
  // See lib/notifications/twin-trips.ts: a lost reminder is worse than a
  // duplicate, so no copy is suppressed before another has actually sent.
  const waitingTwins: SlotRow[] = [];

  const runRow = async (row: DueRow, finalPass: boolean): Promise<void> => {
    try {
      const outcome =
        row.slot === FINISH_TRIP_SLOT
          ? await processFinishTripRow(svc, row)
          : await processRow(svc, row as SlotRow, finalPass);
      if (outcome === "sent") sent++;
      else if (outcome === "skipped") skipped++;
      else if (outcome === "deferred") waitingTwins.push(row as SlotRow);
      else failed++;
    } catch (err) {
      failed++;
      console.error("[cron/scheduled-notifs] row exception", {
        id: row.id,
        error: err instanceof Error ? err.message : String(err),
      });
      // Best-effort failure persist so we don't keep retrying a poison row.
      await svc
        .from("scheduled_notifications")
        .update({
          status: "failed",
          last_error:
            err instanceof Error
              ? err.message.slice(0, 500)
              : String(err).slice(0, 500),
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
    }
  };

  for (const row of dueRows) {
    // Canary cap. Counts ACTUAL sends, not rows examined, so suppressions and
    // failures do not consume the budget — a cap of 5 means five real emails.
    // Remaining rows are left `pending` and untouched, so they go out on a
    // later run with no state to repair.
    if (cap !== null && sent >= cap) {
      deferredByCap = dueRows.length - (sent + skipped + failed + waitingTwins.length);
      break;
    }
    await runRow(row, false);
  }

  // Final pass over the twins that waited. Same cap: a waiting row the cap
  // cuts stays pending, exactly like any other row the cap leaves behind.
  const waiting = waitingTwins.splice(0, waitingTwins.length);
  for (const row of waiting) {
    if (cap !== null && sent >= cap) {
      deferredByCap += 1;
      continue;
    }
    await runRow(row, true);
  }

  const durationMs = Date.now() - startedAt;
  // Never let a cap truncate silently — a run that sent 5 of 40 must not read
  // like a run that had 5 to send. Both the log and the response say so.
  console.log("[cron/scheduled-notifs]", {
    stage: "dispatch_scheduled",
    due: dueRows.length,
    sent,
    skipped,
    failed,
    ...(cap !== null ? { cap, deferredByCap } : {}),
    durationMs,
  });

  return NextResponse.json({
    success: true,
    due: dueRows.length,
    sent,
    skipped,
    failed,
    durationMs,
    ...(cap !== null
      ? {
          cap,
          deferredByCap,
          note: `TRIP_NOTIFICATIONS_SEND_CAP=${cap} is set — ${deferredByCap} due row(s) left pending for a later run. Unset it to resume normal sending.`,
        }
      : {}),
  });
}

/**
 * Process one due row: load context, check rate limit + mute, send
 * (or skip), persist outcome. Returns the bucket the row falls into.
 */
async function processRow(
  svc: ReturnType<typeof serviceClient>,
  row: SlotRow,
  finalPass = false
): Promise<"sent" | "skipped" | "failed" | "deferred"> {
  // 2a. Load the trip — needed for destination + start_date + mute.
  //     We re-check `reminders_muted` here even though the enqueue RPC
  //     already gates: the user could have muted between enqueue and
  //     dispatch, and that mute must still be honoured.
  // trip_meta is selected as JSON PATHS, not whole: it carries
  // travel_distances (large, per-segment) and only a few short strings are
  // needed. The whole itinerary is selected because the domestic check, the
  // forecast coordinate and the day digest read it; `itinerary->0` (day one)
  // feeds the enrichment blocks.
  const { data: tripRow, error: tripErr } = await svc
    .from("trips")
    .select(
      "id, title, start_date, end_date, reminders_muted, status, deleted_at, itinerary, share_token, " +
        "weather_note:trip_meta->>weather_note, " +
        "highlights:trip_meta->highlights, " +
        "packing_suggestions:trip_meta->packing_suggestions, " +
        "trip_locale:trip_meta->>locale, " +
        "day1:itinerary->0"
    )
    .eq("id", row.trip_id)
    .maybeSingle();

  if (tripErr) {
    console.error("[cron/scheduled-notifs] trip-load failed", {
      id: row.id,
      error: tripErr.message,
    });
    await persistOutcome(svc, row.id, "failed", "trip_load_error", tripErr.message);
    return "failed";
  }

  // See TripEmailRow: the concatenated select defeats type inference, so
  // the shape is asserted here, once, rather than at every field access.
  const trip = tripRow as unknown as TripEmailRow | null;

  if (!trip) {
    // Trip got deleted between enqueue and now (FK CASCADE should have
    // killed the row but if we got here, treat as suppressed).
    await persistOutcome(svc, row.id, "suppressed", "trip_missing");
    return "skipped";
  }

  if (trip.deleted_at) {
    // Trips are soft-deleted: the row stays, so the CASCADE above never fires,
    // and the service client bypasses the RLS that hides tombstones.
    // soft_delete_trip() parks the trip's pending rows at delete time; this
    // catches any row that slips past it.
    await persistOutcome(svc, row.id, "suppressed", "trip_deleted");
    return "skipped";
  }

  if (trip.reminders_muted) {
    await persistOutcome(svc, row.id, "suppressed", "trip_muted");
    return "skipped";
  }

  // A cancelled trip must never generate mail — not a countdown to it, and
  // not a "How was it?" afterwards. Checked HERE and not only at enqueue for
  // the same reason reminders_muted is: cancelling happens AFTER the trip was
  // created and its cascade queued.
  //
  // Only 'cancelled' is treated as a stop signal. 'planning' is the DEFAULT
  // status and means only that nobody touched a control most users never
  // see; gating on 'confirmed' would silence most legitimate reminders.
  if (trip.status === "cancelled") {
    await persistOutcome(svc, row.id, "suppressed", "trip_cancelled");
    return "skipped";
  }

  // A reminder whose moment has passed is not late, it is WRONG. See
  // staleReason() for the reasoning and the tolerance. The in-trip digest is a
  // per-day slot, so its moment ("Tomorrow: Day K") is relative to day K, not
  // to the trip start — it needs its own guard.
  const digestDay = parseDigestDay(row.slot);
  const stale =
    digestDay !== null
      ? digestStaleReason(digestDay, trip.start_date, new Date())
      : staleReason(row.slot, trip.start_date, new Date());
  if (stale) {
    console.warn("[cron/scheduled-notifs] suppressing a reminder whose moment passed", {
      id: row.id,
      slot: row.slot,
      startDate: trip.start_date,
      reason: stale,
    });
    await persistOutcome(svc, row.id, "suppressed", stale);
    return "skipped";
  }

  // 2a-twin. One reminder per real trip, not per saved copy.
  //
  // People regenerate a trip and save the result without deleting the first,
  // so the same trip (owner, title, start date) can exist two or three times,
  // each with its own cascade. See lib/notifications/twin-trips.ts for which
  // copy wins. FAIL OPEN: a read error sends as if there were no twins. A
  // duplicate is a nuisance; a lost reminder is what this loop exists to
  // prevent.
  //
  // The one-email-a-day limit below counts the whole twin set, not just this
  // trip id: on departure morning "Travel day" and the day-2 digest are due at
  // once on every copy, and a per-id limit would let an abandoned copy's
  // digest out after the chosen copy sent "Travel day".
  let rateLimitTripIds: string[] = [row.trip_id];
  if (trip.start_date) {
    const twins = await loadTwins(svc, row, trip);
    if (twins) {
      rateLimitTripIds = twins.map((t) => t.id);
      const decision = twinDecision(row.trip_id, twins, row.scheduled_for, finalPass);
      if (decision.action === "suppress") {
        await persistOutcome(svc, row.id, "suppressed", `twin_trip:${decision.keeperId}`);
        return "skipped";
      }
      if (decision.action === "wait") return "deferred";
    }
  }

  // 2a-bis. EXIT CONDITION for the post-trip sequence.
  //
  // The sequence exists to re-engage people who planned one trip and went
  // quiet. The moment they plan another, it has done its job and every
  // remaining slot becomes noise — "Thinking about the next one?" landing
  // on someone who booked it last week.
  //
  // Checked at dispatch rather than at enqueue because the second trip
  // usually appears AFTER the sequence is queued; enqueue-time filtering
  // would miss exactly the case that matters.
  //
  // This doubles as the cross-trip rate limit: the per-trip daily check
  // below cannot see siblings on a DIFFERENT trip, so without this a
  // two-trip user could receive a pre-trip reminder for one and a
  // post-trip followup for the other on the same morning.
  if (isFollowupSlot(row.slot)) {
    const { count: tripCount, error: countErr } = await svc
      .from("trips")
      .select("id", { count: "exact", head: true })
      .eq("user_id", row.user_id)
      .is("deleted_at", null);

    if (countErr) {
      // Fail closed. If we cannot establish that they are still
      // one-and-done, we must not market to them.
      await persistOutcome(
        svc,
        row.id,
        "failed",
        "trip_count_read_error",
        countErr.message
      );
      return "failed";
    }
    if ((tripCount ?? 0) > 1) {
      await persistOutcome(svc, row.id, "suppressed", "user_has_new_trip");
      return "skipped";
    }
  }

  // 2b. Rate limit: 1 email per trip per calendar day (UTC). We check
  //     sibling rows on the same trip whose status='sent' AND sent_at is
  //     today. Calendar day, not rolling 24h: see rateLimitWindowStart.
  //     Twin copies of one trip share the limit (rateLimitTripIds, above).
  const since = rateLimitWindowStart(new Date());
  const { data: recent, error: recentErr } = await svc
    .from("scheduled_notifications")
    .select("id")
    .in("trip_id", rateLimitTripIds)
    .eq("status", "sent")
    .gte("sent_at", since)
    .limit(1);

  if (recentErr) {
    // Fail closed — if we can't confirm the rate-limit window, don't
    // send. Better to drop one cascade slot than to spam.
    console.error("[cron/scheduled-notifs] rate-limit read failed", {
      id: row.id,
      error: recentErr.message,
    });
    await persistOutcome(svc, row.id, "failed", "rate_limit_read_error", recentErr.message);
    return "failed";
  }
  if (recent && recent.length > 0) {
    await persistOutcome(svc, row.id, "suppressed", "rate_limit_sibling_same_day");
    return "skipped";
  }

  // 2b-bis. The visa check is for leaving the country. A trip inside the
  // traveller's own country gets no such reminder.
  //
  // Where the person is: the country on their most recent page view (the
  // profile home-country field is almost always empty). Where they are going:
  // the country at the end of the itinerary's activity addresses, written by
  // Google Places. Decided at dispatch, against the itinerary and the latest
  // page view as they are when the email goes out.
  //
  // FAIL OPEN: domesticTripVerdict says domestic only when every readable
  // address is in the viewer's country; an unknown viewer, an unreadable
  // itinerary or a read error sends the reminder.
  //
  // Two more slots read the same verdict: "Two weeks to go" tells everyone
  // to check their passport is valid and "Tomorrow" lists "passport on you".
  // Inside the traveller's own country those lines are the same mistake in
  // a quieter voice, so both slots carry a domestic body without them.
  let domestic = false;
  if (DOMESTIC_AWARE_SLOTS.has(row.slot)) {
    let viewerCountry: string | null = null;
    try {
      const { data: lastView } = await svc
        .from("page_views")
        .select("country_code")
        .eq("user_id", row.user_id)
        .not("country_code", "is", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      viewerCountry = (lastView as { country_code?: string | null } | null)?.country_code ?? null;
    } catch {
      viewerCountry = null;
    }
    const verdict = domesticTripVerdict(viewerCountry, trip.itinerary);
    domestic = verdict.domestic;
    if (verdict.domestic && row.slot === "visa_check_7d") {
      console.log("[cron/scheduled-notifs] visa check skipped: trip is inside the traveller's country", {
        id: row.id,
        trip_id: row.trip_id,
        country: verdict.viewerCountry,
        addresses: verdict.addresses,
        resolved: verdict.resolved,
      });
      await persistOutcome(svc, row.id, "suppressed", `domestic_trip:${verdict.viewerCountry}`);
      return "skipped";
    }
  }
  // 2c. Load the recipient — need email + preferred_language.
  const { data: user, error: userErr } = await svc
    .from("users")
    .select("email, preferred_language")
    .eq("id", row.user_id)
    .maybeSingle();

  if (userErr) {
    await persistOutcome(svc, row.id, "failed", "user_load_error", userErr.message);
    return "failed";
  }
  if (!user?.email) {
    await persistOutcome(svc, row.id, "suppressed", "no_email");
    return "skipped";
  }

  // 2d. Resolve locale → load the slot-specific strings.
  //
  // The namespace MUST carry the `common.` prefix. i18n.ts assembles messages
  // keyed by FILE — `messages/<locale>/common.json` is mounted as the `common`
  // namespace — so the real path is common.tripReminderEmail.<slot>. Asking
  // for `tripReminderEmail.<slot>` resolves to nothing.
  const locale = resolveLocale(user.preferred_language);

  // In-trip day digest: its content is tomorrow's plan pulled straight from
  // this trip's itinerary, its copy is one namespace (not per-slot), and its
  // template is trip_day_digest. Self-contained — returns before the
  // reminder/followup rendering below.
  if (digestDay !== null) {
    return await dispatchDayDigest(svc, row, trip, user.email, locale, digestDay);
  }

  const followup = isFollowupSlot(row.slot);
  const rootNs = followup ? FOLLOWUP_NS : REMINDER_NS;

  let t: Awaited<ReturnType<typeof getTranslations>>;
  let ctaT: Awaited<ReturnType<typeof getTranslations>>;
  try {
    t = await getTranslations({ locale, namespace: `${rootNs}.${row.slot}` });
    ctaT = await getTranslations({ locale, namespace: rootNs });
  } catch (err) {
    await persistOutcome(
      svc,
      row.id,
      "failed",
      "i18n_load_error",
      err instanceof Error ? err.message : String(err)
    );
    return "failed";
  }

  // Strip trailing " Trip" suffix if present, so emails read
  // "Lisbon" not "Lisbon Trip — Lisbon Trip".
  const destination = (trip.title || "")
    .replace(/\s+Trip\s*$/i, "")
    .trim() || "your trip";

  const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://monkeytravel.app";
  const tripUrl = `${APP_URL}/trips/${trip.id}?slot=${row.slot}`;

  // Where the CTA points. Reminders → the trip; the post-trip family →
  // postTripCtaUrl (followup_return_3d → the feedback survey, the later slots
  // → the wizard) — shared with the audit + test-send scripts so the three
  // can't drift. `slot`, not `utm_source`: a utm_* param on an internal link
  // overwrites the stored acquisition source.
  const ctaUrl = followup
    ? postTripCtaUrl(row.slot as TripFollowupSlot, { tripUrl, appUrl: APP_URL, userId: row.user_id, locale })
    : tripUrl;

  // Resolve the copy BEFORE handing it to the mailer, so an unresolved key
  // can be caught while it is still just a string in memory.
  //
  // `destination` goes to BOTH, even though most slots only reference it in
  // the body: weather_3d's heading is "Three days to {destination}", and
  // next-intl falls back to the key path when a referenced placeholder is not
  // supplied. Passing it unconditionally also means a translator moving
  // {destination} into another heading cannot break the mail; unused values
  // are ignored.
  const heading = t("heading", { destination });
  // A domestic trip reads the slot's bodyDomestic when the copy has one
  // (pack_early_14d and confirm_1d do); every other case reads body.
  const body =
    domestic && t.has("bodyDomestic") ? t("bodyDomestic", { destination }) : t("body", { destination });
  // The reminder family shares ONE cta across all five slots, so it sits
  // at the namespace root. The followup family needs a different verb per
  // slot ("Open your trip" vs "Plan your next trip"), so its cta lives
  // inside the slot. Hence two different lookups, not an inconsistency.
  const ctaLabel = followup ? t("cta") : ctaT("cta");
  // Only terminal slots promise "this is the last one", and only they
  // render it. Resolved here so assertTranslated can vet it too.
  const finalNote =
    isFollowupSlot(row.slot) && TERMINAL_FOLLOWUP_SLOTS.has(row.slot)
      ? ctaT("finalNote")
      : undefined;

  // Per-trip enrichment. Built from data the generator already wrote, so
  // this adds no Gemini or Places call. Best-effort by design: a slot with
  // nothing to show renders no block, and a whole family of trips missing
  // trip_meta must not stop their reminders going out.
  // Real forecast, from Open-Meteo via the trip's own coordinates. Never
  // trip_meta.weather_note, which is invented — see lib/email/trip-context.ts.
  // Every failure path returns null and the block is simply omitted.
  let forecastLine: string | undefined;
  let weatherLabel: string | undefined;

  let contextBlocks: ContextBlock[] = [];
  try {
    const ctxT = await getTranslations({ locale, namespace: CONTEXT_NS });

    // Only two slots render a weather block, so only those two pay for the
    // lookup. Gated on the exported set rather than a local list, so it cannot
    // fall out of step with the switch that consumes it.
    const coord = FORECAST_SLOTS.has(row.slot)
      ? tripStartCoordinate(trip.itinerary)
      : null;
    if (coord) {
      const fc = await getTripForecast({
        latitude: coord.latitude,
        longitude: coord.longitude,
        startDate: trip.start_date,
        endDate: trip.end_date,
      });
      if (fc) {
        const msg = forecastMessage(fc);
        forecastLine = ctxT(msg.key, msg.values);
        // The heading has to state the scope: at 14 days out the horizon
        // reaches only the first day or two of the trip, and the default
        // heading would present that as the whole thing.
        const lbl = forecastLabel(
          fc,
          tripLengthDays(trip.start_date, trip.end_date)
        );
        weatherLabel = lbl.values ? ctxT(lbl.key, lbl.values) : ctxT(lbl.key);
      }
    }
    contextBlocks = buildContextBlocks(
      row.slot,
      {
        forecastLine,
        highlights: trip.highlights,
        packingSuggestions: trip.packing_suggestions,
        day1: trip.day1,
      },
      {
        weather: weatherLabel ?? ctxT("weather"),
        packing: ctxT("packing"),
        goingFor: ctxT("goingFor"),
        dayOne: ctxT("dayOne"),
        today: ctxT("today"),
        yourHighlights: ctxT("yourHighlights"),
      }
    );
    // A label that fell back to its key path would render as
    // "emailContext.dayOne" above a list. Drop the enrichment rather than
    // ship that — the email is complete without it.
    if (
      contextBlocks.some(
        (b) =>
          b.label.includes("emailContext.") ||
          (b.note ?? "").includes("emailContext.")
      )
    ) {
      console.warn("[cron/scheduled-notifs] context labels unresolved", { locale });
      contextBlocks = [];
    }
  } catch (err) {
    console.warn("[cron/scheduled-notifs] context build failed; sending without", {
      id: row.id,
      error: err instanceof Error ? err.message : String(err),
    });
    contextBlocks = [];
  }

  const unresolved = assertTranslated({
    heading,
    body,
    ctaLabel,
    ...(finalNote ? { finalNote } : {}),
  });
  if (unresolved) {
    // Deliberately a failure, not a degraded send. The row stays visible as
    // `failed` with the reason, and once the copy is fixed it can be retried
    // — which is strictly better than a delivered email full of key paths.
    await persistOutcome(svc, row.id, "failed", "i18n_load_error", unresolved);
    return "failed";
  }

  // Bound to a local so the type guard narrows it — narrowing a property
  // access across the object literal below is fragile, and getting it
  // wrong here means the wrong consent key gates the send.
  //
  // Digest slots (`in_trip_day_<K>`) are handled and returned above, so by
  // here the slot is only ever pre-trip or followup. TS can't infer that from
  // the separate `digestDay` early-return, so restate the invariant in the type.
  const slot = row.slot as TripReminderSlot | TripFollowupSlot;
  const template: EmailTemplate = isFollowupSlot(slot)
    ? {
        id: "trip_followup",
        props: {
          slot,
          destination,
          heading,
          body,
          ctaLabel,
          ctaUrl,
          finalNote,
          contextBlocks,
        },
      }
    : {
        id: "trip_reminder",
        props: {
          slot,
          destination,
          tripDates: formatDateRange(trip.start_date, trip.end_date, locale),
          heading,
          body,
          ctaLabel,
          tripUrl,
          contextBlocks,
        },
      };

  const result = await dispatchEmail({
    recipientEmail: user.email,
    recipientUserId: row.user_id,
    // Per-(trip, slot) idempotency — covers the (rare) case of two
    // overlapping cron runs grabbing the same row before status flips.
    // Prefixed by family so a reminder and a followup on the same trip
    // can never collide on the same key.
    idempotencyKey: `${template.id}:${row.trip_id}:${slot}`,
    // Already resolved above for the translated body — pass it so the shared
    // shell (header/footer) renders in the same language.
    locale,
    template,
    metadata: {
      scheduled_notification_id: row.id,
      slot,
      trip_id: row.trip_id,
    },
    // Last-line gate, run on the rendered output before anything leaves.
    // Shared with scripts/audit-queued-emails.mts so the pre-deploy audit and
    // the live send path can never disagree about what "correct" means.
    verify: ({ html, subject }) => {
      const defects = blockingDefects(
        verifyRenderedEmail({
          subject,
          html,
          destination,
          // The real CTA target: the trip for reminders, the feedback survey
          // for followup_return_3d, the wizard for the later followup slots.
          ctaUrl,
          contextBlocks,
          // This trip's own enrichment values — the corpus containment is
          // checked against. Anything rendered that is not in here came from
          // somewhere it should not have.
          // The forecast line must be included or containment blocks it: it
          // is derived from this trip's coordinates and dates, but it does
          // not appear anywhere in the trip row. Omitting it here would make
          // the gate reject every weather-bearing email.
          ownStrings: [
            ...ownEnrichmentStrings(trip),
            ...(forecastLine ? [forecastLine] : []),
          ],
        })
      );
      return defects.length
        ? { ok: false, reason: summarizeDefects(defects) }
        : { ok: true };
    },
  });

  // 2e. Persist outcome. Any 'sent' / 'skipped_*' outcome from
  //     dispatchEmail means we did the right thing — flip status
  //     accordingly. 'failed' bubbles up as a failed row + last_error.
  if (result.ok) {
    if (result.status === "sent") {
      // The email HAS gone out by this point. If this flip does not land the
      // row stays `pending` and the next run retries it; only dispatchEmail's
      // idempotency key (email_log) then stands between the recipient and a
      // second copy. So the result is checked and logged loudly.
      const { data: marked, error: markError } = await svc
        .from("scheduled_notifications")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id)
        .select("id");

      if (markError || !marked?.length) {
        console.error(
          "[cron/scheduled-notifs] SENT BUT NOT MARKED — this row will resend",
          { id: row.id, slot: row.slot, error: markError?.message ?? "matched no rows" }
        );
      }
      return "sent";
    }
    // skipped_disabled / skipped_suppressed / skipped_duplicate /
    // skipped_no_key — all map to 'suppressed' with reason = status.
    await persistOutcome(svc, row.id, "suppressed", result.status);
    return "skipped";
  }

  await persistOutcome(svc, row.id, "failed", "dispatch_error", result.error);
  return "failed";
}

/**
 * The finish-trip email belongs to an account, not a trip, so none of the
 * trip checks above apply. finish-trip.ts decides and sends; this records it.
 */
async function processFinishTripRow(
  svc: ReturnType<typeof serviceClient>,
  row: DueRow
): Promise<"sent" | "skipped" | "failed"> {
  const outcome = await sendFinishTripEmail(svc, row, (locale) =>
    getTranslations({ locale, namespace: FINISH_TRIP_NS })
  );
  await persistOutcome(svc, row.id, outcome.status, outcome.reason, outcome.error);
  if (outcome.status === "sent") return "sent";
  return outcome.status === "failed" ? "failed" : "skipped";
}

/**
 * Render + dispatch one in-trip day digest.
 *
 * Content is tomorrow's plan read straight from THIS trip's itinerary day K,
 * so cross-trip contamination is structurally impossible — but it still runs
 * the same verify gate (with the day's own strings as the corpus) so a future
 * refactor can't quietly introduce it. The "+N more" line is UI copy, not
 * trip data, so it is passed OUTSIDE the context block the gate inspects.
 */
async function dispatchDayDigest(
  svc: ReturnType<typeof serviceClient>,
  row: SlotRow,
  trip: TripEmailRow,
  recipientEmail: string,
  locale: Awaited<ReturnType<typeof resolveLocale>>,
  day: number
): Promise<"sent" | "skipped" | "failed"> {
  const destination = (trip.title || "").replace(/\s+Trip\s*$/i, "").trim() || "your trip";

  // Pull day K out of the itinerary.
  const days = Array.isArray(trip.itinerary) ? (trip.itinerary as unknown[]) : [];
  const dayObj = days.find(
    (d): d is Record<string, unknown> =>
      !!d && typeof d === "object" && Number((d as Record<string, unknown>).day_number) === day
  );
  const dayTitle =
    dayObj && typeof dayObj.title === "string" && dayObj.title.trim() ? dayObj.title.trim() : "";
  const rawActs = dayObj && Array.isArray(dayObj.activities) ? (dayObj.activities as unknown[]) : [];
  const acts = rawActs
    .filter((a): a is Record<string, unknown> => !!a && typeof a === "object")
    .map((a) => ({
      name: typeof a.name === "string" ? a.name.trim() : "",
      time:
        typeof a.start_time === "string"
          ? a.start_time.trim()
          : typeof a.time_slot === "string"
            ? a.time_slot.trim()
            : "",
    }))
    .filter((a) => a.name);

  const MAX_ACTIVITIES = 5;
  const shown = acts.slice(0, MAX_ACTIVITIES);
  const moreCount = acts.length - shown.length;

  const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://monkeytravel.app";
  // The day plan is trip data — locale-independent — so it and the containment
  // corpus are built once; only the copy, CTA target and recipient vary below.
  const ownStrings = [dayTitle, ...acts.flatMap((a) => [a.name, a.time])].filter(Boolean);

  // Render + dispatch one digest for a recipient/locale/CTA. Reused for the
  // owner and each emailed participant. Returns the dispatch outcome, or a
  // synthetic failure when a string won't resolve (assertTranslated).
  const sendDigest = async (
    email: string,
    userId: string | null,
    loc: Awaited<ReturnType<typeof resolveLocale>>,
    tr: Awaited<ReturnType<typeof getTranslations>>,
    ctaUrl: string,
    idemSuffix: string,
  ): Promise<Awaited<ReturnType<typeof dispatchEmail>> | { ok: false; status: "failed"; error: string; i18n: true }> => {
    const heading = tr("heading", { day });
    const intro = tr("intro");
    const ctaLabel = tr("cta");
    const emptyLine = acts.length === 0 ? tr("empty", { day }) : undefined;
    const andMore = moreCount > 0 ? tr("andMore", { count: moreCount }) : undefined;
    const unresolved = assertTranslated({ heading, intro, ctaLabel, ...(emptyLine ? { emptyLine } : {}), ...(andMore ? { andMore } : {}) });
    if (unresolved) return { ok: false, status: "failed", error: unresolved, i18n: true };
    // Tomorrow's plan as ONE context block: label = the day's title (not
    // containment-checked), items = activities (name + time, which ARE — and
    // come from this trip, so they pass).
    const blocks: ContextBlock[] =
      shown.length > 0
        ? [{ label: dayTitle || heading, items: shown.map((a) => ({ text: a.name, meta: a.time || undefined })) }]
        : [];
    const template: EmailTemplate = {
      id: "trip_day_digest",
      props: { day, destination, heading, intro, blocks, emptyLine, andMore, ctaLabel, tripUrl: ctaUrl, locale: loc },
    };
    return dispatchEmail({
      recipientEmail: email,
      recipientUserId: userId,
      idempotencyKey: `${template.id}:${row.trip_id}:${row.slot}${idemSuffix}`,
      locale: loc,
      template,
      metadata: { scheduled_notification_id: row.id, slot: row.slot, trip_id: row.trip_id, ...(idemSuffix ? { participant_key: idemSuffix.slice(1) } : {}) },
      verify: ({ html, subject }) => {
        const defects = blockingDefects(
          verifyRenderedEmail({ subject, html, destination, ctaUrl, contextBlocks: blocks, ownStrings })
        );
        return defects.length ? { ok: false, reason: summarizeDefects(defects) } : { ok: true };
      },
    });
  };

  // Owner send — drives the queue row's status.
  let ownerT: Awaited<ReturnType<typeof getTranslations>>;
  try {
    ownerT = await getTranslations({ locale, namespace: DIGEST_NS });
  } catch (err) {
    await persistOutcome(svc, row.id, "failed", "i18n_load_error", err instanceof Error ? err.message : String(err));
    return "failed";
  }
  // The owner's button opens that day's plan without sign-in (lib/trips/day-link.ts).
  const ownerUrl = digestDayUrl({ appUrl: APP_URL, locale, tripId: trip.id, startDate: trip.start_date, day, slot: row.slot });
  const result = await sendDigest(recipientEmail, row.user_id, locale, ownerT, ownerUrl, "");

  // Participant fan-out (off by default): also email the trip's
  // emailed participants. Best-effort and INDEPENDENT of the owner outcome
  // (owner may be suppressed while participants aren't). Resolved fresh from
  // trip_participants so a mid-trip joiner is covered; one trip-locale
  // translator for all of them; deep-linked to /shared/<token>. Suppression +
  // any signed-in participant's opt-out are enforced per send by dispatchEmail.
  if (isParticipantDigestEnabled() && trip.share_token) {
    try {
      const { data: parts } = await svc
        .from("trip_participants")
        .select("email, user_id, participant_cookie_id")
        .eq("trip_id", row.trip_id)
        .is("left_at", null)
        .not("email", "is", null);
      const recipients = digestParticipantRecipients(parts ?? [], recipientEmail);
      if (recipients.length > 0) {
        const partLocale = resolveLocale(trip.trip_locale);
        const partT = await getTranslations({ locale: partLocale, namespace: DIGEST_NS });
        const shareUrl = `${APP_URL}/shared/${trip.share_token}?slot=${row.slot}`;
        let sent = 0, skipped = 0, failed = 0;
        for (const r of recipients) {
          const pr = await sendDigest(r.email, r.userId, partLocale, partT, shareUrl, `:${r.key}`);
          if (pr.ok && pr.status === "sent") sent++;
          else if (pr.ok) skipped++;
          else failed++;
        }
        console.log("[cron/scheduled-notifs] digest fan-out to participants", {
          trip: row.trip_id, slot: row.slot, recipients: recipients.length, sent, skipped, failed,
        });
      }
    } catch (err) {
      console.warn("[cron/scheduled-notifs] digest participant fan-out failed", {
        id: row.id, error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (result.ok) {
    if (result.status === "sent") {
      const { data: marked, error: markError } = await svc
        .from("scheduled_notifications")
        .update({ status: "sent", sent_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", row.id)
        .select("id");
      if (markError || !marked?.length) {
        console.error("[cron/scheduled-notifs] DIGEST SENT BUT NOT MARKED — this row will resend", {
          id: row.id,
          slot: row.slot,
          error: markError?.message ?? "matched no rows",
        });
      }
      return "sent";
    }
    await persistOutcome(svc, row.id, "suppressed", result.status);
    return "skipped";
  }

  await persistOutcome(svc, row.id, "failed", "i18n" in result ? "i18n_load_error" : "dispatch_error", result.error);
  return "failed";
}

/**
 * The owner's live twins of this trip (same normalized title and start date,
 * this trip included) with each one's row status for the slot, or null when
 * there are no twins or a read failed (caller sends as if there were no
 * twins). Two small reads, and only for trips with a start date.
 */
async function loadTwins(
  svc: ReturnType<typeof serviceClient>,
  row: SlotRow,
  trip: { title: string | null; start_date: string | null }
): Promise<TwinCandidate[] | null> {
  const { data: sameDay, error: tripsErr } = await svc
    .from("trips")
    .select("id, title, updated_at, status")
    .eq("user_id", row.user_id)
    .eq("start_date", trip.start_date as string)
    .is("deleted_at", null)
    .limit(20);
  if (tripsErr) {
    console.warn("[cron/scheduled-notifs] twin read failed, sending", { id: row.id, error: tripsErr.message });
    return null;
  }
  const key = normalizeTripTitle(trip.title);
  const twins = ((sameDay ?? []) as { id: string; title: string | null; updated_at: string | null; status: string | null }[])
    .filter((t) => t.status !== "cancelled" && normalizeTripTitle(t.title) === key);
  if (twins.length < 2) return null;

  const { data: slotRows, error: slotErr } = await svc
    .from("scheduled_notifications")
    .select("trip_id, status, sent_at")
    .in("trip_id", twins.map((t) => t.id))
    .eq("slot", row.slot);
  if (slotErr) {
    console.warn("[cron/scheduled-notifs] twin slot read failed, sending", { id: row.id, error: slotErr.message });
    return null;
  }
  const rowByTrip = new Map<string, { status: string; sent_at: string | null }>();
  for (const r of (slotRows ?? []) as { trip_id: string; status: string; sent_at: string | null }[]) {
    // A trip holds one row per slot; if it somehow holds more, "sent" wins.
    if (rowByTrip.get(r.trip_id)?.status !== "sent") rowByTrip.set(r.trip_id, r);
  }
  return twins.map((t) => ({
    id: t.id,
    updatedAt: t.updated_at,
    slotStatus: rowByTrip.get(t.id)?.status ?? null,
    slotSentAt: rowByTrip.get(t.id)?.sent_at ?? null,
  }));
}

async function persistOutcome(
  svc: ReturnType<typeof serviceClient>,
  id: string,
  status: "sent" | "suppressed" | "failed",
  reason: string,
  error?: string
): Promise<void> {
  const patch: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString(),
  };
  if (status === "sent") patch.sent_at = new Date().toISOString();
  if (status === "suppressed") patch.skipped_reason = reason.slice(0, 200);
  if (status === "failed") {
    patch.skipped_reason = reason.slice(0, 200);
    if (error) patch.last_error = error.slice(0, 500);
  }
  // A sent row is final. Without this guard, a second overlapping cron run
  // that reaches the same row gets "skipped_duplicate" back from the email
  // idempotency check and rewrites the row from 'sent' to 'suppressed' — and
  // a twin copy waiting on that row then sees no sent copy and sends the
  // email again under its own idempotency key.
  const { error: updErr } = await svc
    .from("scheduled_notifications")
    .update(patch)
    .eq("id", id)
    .neq("status", "sent");
  if (updErr) {
    console.error(
      "[cron/scheduled-notifs] outcome-update failed",
      { id, status, reason },
      updErr
    );
  }
}
