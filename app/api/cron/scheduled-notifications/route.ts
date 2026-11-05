import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTranslations } from "next-intl/server";
import { isTripNotificationsEnabled } from "@/lib/notifications/scheduling";
import { parseDigestDay, digestStaleReason } from "@/lib/notifications/digest";
import { prioritizeDueRows, rateLimitWindowStart, staleReason } from "@/lib/notifications/queue";
import { stillPencilled } from "@/lib/trips/pencilled-dates";
import { tripEmailLocale } from "@/lib/email/reminder-locale";
import { retryTransient } from "@/lib/notifications/retry";
import { domesticTripVerdict } from "@/lib/notifications/domestic-trip";
import {
  normalizeTripTitle,
  twinDecision,
  type TwinCandidate,
} from "@/lib/notifications/twin-trips";
import {
  FINISH_TRIP_NS,
  FINISH_TRIP_SLOT,
  sendFinishTripEmail,
} from "@/lib/notifications/finish-trip";
import { cameBack, cameBackFrom, loadEngagement } from "@/lib/notifications/followup-engagement";
import { logWriteError } from "@/lib/supabase/log-write-error";
import { logReadError } from "@/lib/supabase/log-read-error";
import { refuseUnlessCron } from "@/lib/api/cron-auth";
import {
  type SlotRow,
  persistOutcome,
  type TripEmailRow,
  isFollowupSlot,
} from "@/lib/notifications/slot-row";
import { sendSlotEmail } from "@/lib/notifications/slot-email";
import { dispatchDayDigest } from "@/lib/notifications/day-digest-email";

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
 * helpers have no locale. The email's language is resolved explicitly
 * (tripEmailLocale) and passed to `getTranslations({ locale, namespace })`, as the
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
 * - Email: lib/notifications/slot-email.ts (reminders and follow-ups) and
 *   day-digest-email.ts (digests) write it; lib/email/send.ts (dispatchEmail)
 *   sends it.
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
 * Slots whose copy depends on whether the trip leaves the traveller's
 * country (lib/notifications/domestic-trip.ts). visa_check_7d is skipped
 * outright on a domestic trip; the other two swap to a body that does not
 * mention the passport.
 */
const DOMESTIC_AWARE_SLOTS = new Set<string>(["visa_check_7d", "pack_early_14d", "confirm_1d"]);

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

/** A due row as read. A DB CHECK keeps trip_id null for FINISH_TRIP_SLOT only. */
type DueRow = Omit<SlotRow, "trip_id"> & { trip_id: string | null };

export async function GET(request: NextRequest) {
  const refused = refuseUnlessCron(request);
  if (refused) return refused;

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

  const svc = createAdminClient();
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
      logWriteError("cron/scheduled-notifs: mark failed", await svc
        .from("scheduled_notifications")
        .update({
          status: "failed",
          last_error:
            err instanceof Error
              ? err.message.slice(0, 500)
              : String(err).slice(0, 500),
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id));
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
  svc: ReturnType<typeof createAdminClient>,
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
      "id, title, start_date, end_date, created_at, reminders_muted, status, is_archived, deleted_at, itinerary, share_token, shared_at, " +
        "weather_note:trip_meta->>weather_note, " +
        "highlights:trip_meta->highlights, " +
        "packing_suggestions:trip_meta->packing_suggestions, " +
        "trip_locale:trip_meta->>locale, " +
        "trip_intent:trip_meta->>trip_intent, " +
        "dates_pencilled:trip_meta->dates_pencilled, " +
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

  // An archived trip has been put away. Rows not yet due wait, so a trip
  // restored in time gets the rest of its mail.
  if (trip.is_archived) {
    await persistOutcome(svc, row.id, "suppressed", "trip_archived");
    return "skipped";
  }

  // Dates the planner pencilled in are a placeholder, not a departure: no
  // countdown, digest or "How was it?" for them. Choosing dates ends this
  // (the dates stop matching) and the date change re-queues the cascade.
  if (stillPencilled(trip.dates_pencilled, trip.start_date, trip.end_date)) {
    await persistOutcome(svc, row.id, "suppressed", "dates_pencilled");
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
      const { data: lastView } = logReadError("reminders: viewer country", await svc
        .from("page_views")
        .select("country_code")
        .eq("user_id", row.user_id)
        .not("country_code", "is", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle());
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

  // 2c-bis. The post-trip follow-ups go only to people who came back after
  // making the trip (lib/notifications/followup-engagement.ts). Fails closed
  // like the trip count above: if it cannot be read, no marketing.
  if (isFollowupSlot(row.slot)) {
    const from = cameBackFrom(trip.created_at);
    let returned = false;
    if (from) {
      try {
        returned = cameBack(from, await loadEngagement(svc, row.user_id, user.email, from));
      } catch (err) {
        const message = (err as { message?: string } | null)?.message ?? String(err);
        await persistOutcome(svc, row.id, "failed", "engagement_read_error", message);
        return "failed";
      }
    }
    if (!returned) {
      await persistOutcome(svc, row.id, "suppressed", "no_engagement");
      return "skipped";
    }
  }

  // 2d. The traveller's language, whichever email this row is.
  const locale = tripEmailLocale(user.preferred_language, trip.trip_locale);

  // In-trip day digest: its content is tomorrow's plan pulled straight from
  // this trip's itinerary, its copy is one namespace (not per-slot), and its
  // template is trip_day_digest.
  if (digestDay !== null) {
    return await dispatchDayDigest(svc, row, trip, user.email, locale, digestDay);
  }

  return sendSlotEmail(svc, row, trip, user.email, locale, domestic);
}

/**
 * The finish-trip email belongs to an account, not a trip, so none of the
 * trip checks above apply. finish-trip.ts decides and sends; this records it.
 */
async function processFinishTripRow(
  svc: ReturnType<typeof createAdminClient>,
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
 * The owner's live twins of this trip (same normalized title and start date,
 * this trip included) with each one's row status for the slot, or null when
 * there are no twins or a read failed (caller sends as if there were no
 * twins). Two small reads, and only for trips with a start date.
 */
async function loadTwins(
  svc: ReturnType<typeof createAdminClient>,
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
