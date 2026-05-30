import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { getTranslations } from "next-intl/server";
import { dispatchEmail } from "@/lib/email/send";
import type { TripReminderSlot } from "@/lib/email/templates/TripReminder";
import { isTripNotificationsEnabled } from "@/lib/notifications/scheduling";

/**
 * Pre-trip reminder cron — sweeps `scheduled_notifications` and
 * dispatches the slot-specific email for any row whose
 * `scheduled_for <= NOW()` and `status='pending'`.
 *
 * Schedule: every 15 minutes via Vercel cron (see vercel.json). This
 * cadence is fine-grained enough to land each slot within 15 min of
 * its intended time without ever sending early, and coarse enough that
 * the queue (4-5 rows per trip × 1K trips/mo) drains comfortably under
 * the 60s function cap.
 *
 * Auth: CRON_SECRET via Bearer header — mirrors the existing
 * /api/cron/refresh-activity-index pattern. Without a secret env set
 * the route 401s defensively.
 *
 * Rate limit (PRD §"Resend complaint rate spike"): we cap to 1 email
 * per trip per 24h by suppressing a slot when ANY sibling slot for
 * the same trip went out in the last 24h. The first slot scheduled
 * out of order (e.g. trip booked T-2d → only `confirm_1d` +
 * `morning_of` get enqueued) still flows because no sibling has been
 * sent yet.
 *
 * Localisation (POST-MORTEM AWARENESS): the cron route lives outside
 * [locale]/, so request-bound next-intl helpers don't have a locale.
 * We resolve the recipient's preferred_language explicitly and pass
 * it to `getTranslations({ locale, namespace })`, mirroring the
 * pattern used by the static page builders.
 *
 * Failure mode: per-row failures are captured + the row flipped to
 * 'failed' with `last_error`. We never re-throw to Vercel — a single
 * failed dispatch must not skip the rest of the batch.
 *
 * CAUSALITY
 * ---------
 * - Enqueue: lib/notifications/scheduling.ts ← persistTrip.insertTrip
 *   + PATCH /api/trips/[id] (start_date change) + fork/duplicate.
 * - Email: lib/email/send.ts ← cycle-5 #206 + cycle-7 #216 hardening.
 * - Settings: users.notification_settings.tripReminders is the per-user
 *   per-type gate (fail-closed inside dispatchEmail).
 * - Per-trip mute: trips.reminders_muted blocks enqueue at the RPC
 *   layer; an already-pending row whose trip later gets muted is
 *   still picked up here — we re-check the flag below to be safe.
 */

// Maximum rows to process per invocation. With 5 slots/trip and
// 1K trips/mo, the queue rarely exceeds 30-40 due rows in a 15-min
// window. 200 leaves headroom for backlog after a cron outage.
const MAX_ROWS_PER_RUN = 200;

type SlotRow = {
  id: string;
  user_id: string;
  trip_id: string;
  slot: TripReminderSlot;
  scheduled_for: string;
};

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

/**
 * Normalise a stored preferred_language down to a supported locale.
 * Defaults to "en" — keeps the email going out even if the column has
 * an exotic / null value.
 */
function resolveLocale(raw: string | null | undefined): "en" | "it" | "es" {
  if (raw === "it" || raw === "es") return raw;
  return "en";
}

/**
 * Format a date range "Sep 1 – Sep 7" in the recipient's locale.
 * Falls back gracefully when end < start or either side is invalid.
 */
function formatDateRange(
  start: string,
  end: string | null,
  locale: "en" | "it" | "es"
): string {
  try {
    const s = new Date(start);
    if (Number.isNaN(s.getTime())) return "";
    const fmt = new Intl.DateTimeFormat(
      locale === "it" ? "it-IT" : locale === "es" ? "es-ES" : "en-US",
      { month: "short", day: "numeric" }
    );
    const startLabel = fmt.format(s);
    if (!end) return startLabel;
    const e = new Date(end);
    if (Number.isNaN(e.getTime()) || e.getTime() < s.getTime()) {
      return startLabel;
    }
    return `${startLabel} – ${fmt.format(e)}`;
  } catch {
    return "";
  }
}

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret) return unauthorized();
  if (auth !== `Bearer ${secret}`) return unauthorized();

  // Skip the entire sweep when the feature is disabled — protects
  // against accidental dispatches during a soft-launch / kill-switch
  // event. The RPC is also gated, so the queue will be empty anyway,
  // but the extra defence-in-depth is cheap. Reads
  // NEXT_PUBLIC_TRIP_NOTIFICATIONS_ENABLED (decoupled from the
  // calendar-export flag per F1 spec) with back-compat fallback.
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
  //    LIMIT caps the per-run blast radius.
  const { data: dueRowsRaw, error: dueErr } = await svc
    .from("scheduled_notifications")
    .select("id, user_id, trip_id, slot, scheduled_for")
    .eq("status", "pending")
    .lte("scheduled_for", new Date().toISOString())
    .order("scheduled_for", { ascending: true })
    .limit(MAX_ROWS_PER_RUN);

  if (dueErr) {
    console.error("[cron/scheduled-notifs] due-select failed:", dueErr);
    return NextResponse.json(
      { error: "due_select_failed", detail: dueErr.message },
      { status: 500 }
    );
  }

  const dueRows = (dueRowsRaw ?? []) as SlotRow[];
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

  for (const row of dueRows) {
    try {
      const outcome = await processRow(svc, row);
      if (outcome === "sent") sent++;
      else if (outcome === "skipped") skipped++;
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
  }

  const durationMs = Date.now() - startedAt;
  console.log("[cron/scheduled-notifs]", {
    stage: "dispatch_scheduled",
    due: dueRows.length,
    sent,
    skipped,
    failed,
    durationMs,
  });

  return NextResponse.json({
    success: true,
    due: dueRows.length,
    sent,
    skipped,
    failed,
    durationMs,
  });
}

/**
 * Process one due row: load context, check rate limit + mute, send
 * (or skip), persist outcome. Returns the bucket the row falls into.
 */
async function processRow(
  svc: ReturnType<typeof serviceClient>,
  row: SlotRow
): Promise<"sent" | "skipped" | "failed"> {
  // 2a. Load the trip — needed for destination + start_date + mute.
  //     We re-check `reminders_muted` here even though the enqueue RPC
  //     already gates: the user could have muted between enqueue and
  //     dispatch, and that mute must still be honoured.
  const { data: trip, error: tripErr } = await svc
    .from("trips")
    .select("id, title, start_date, end_date, reminders_muted")
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

  if (!trip) {
    // Trip got deleted between enqueue and now (FK CASCADE should have
    // killed the row but if we got here, treat as suppressed).
    await persistOutcome(svc, row.id, "suppressed", "trip_missing");
    return "skipped";
  }

  if (trip.reminders_muted) {
    await persistOutcome(svc, row.id, "suppressed", "trip_muted");
    return "skipped";
  }

  // 2b. Rate limit: 1 email per trip per 24h. We check sibling rows on
  //     the same trip whose status='sent' AND sent_at within the last
  //     24h. PRD §"Resend complaint rate spike from too many emails".
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: recent, error: recentErr } = await svc
    .from("scheduled_notifications")
    .select("id")
    .eq("trip_id", row.trip_id)
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
    await persistOutcome(svc, row.id, "suppressed", "rate_limit_sibling_24h");
    return "skipped";
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

  // 2d. Resolve locale → load the slot-specific strings from the
  //     tripReminderEmail namespace (en/it/es).
  const locale = resolveLocale(user.preferred_language);
  let t: Awaited<ReturnType<typeof getTranslations>>;
  try {
    t = await getTranslations({
      locale,
      namespace: `tripReminderEmail.${row.slot}`,
    });
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

  const ctaT = await getTranslations({
    locale,
    namespace: "tripReminderEmail",
  });

  // Strip trailing " Trip" suffix if present, so emails read
  // "Lisbon" not "Lisbon Trip — Lisbon Trip".
  const destination = (trip.title || "")
    .replace(/\s+Trip\s*$/i, "")
    .trim() || "your trip";

  const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://monkeytravel.app";
  const tripUrl = `${APP_URL}/trips/${trip.id}?slot=${row.slot}`;

  const result = await dispatchEmail({
    recipientEmail: user.email,
    recipientUserId: row.user_id,
    // Per-(trip, slot) idempotency — covers the (rare) case of two
    // overlapping cron runs grabbing the same row before status flips.
    idempotencyKey: `trip_reminder:${row.trip_id}:${row.slot}`,
    // Already resolved above for the translated body — pass it so the shared
    // shell (header/footer) matches and dispatchEmail skips the re-lookup.
    locale,
    template: {
      id: "trip_reminder",
      props: {
        slot: row.slot,
        destination,
        tripDates: formatDateRange(trip.start_date, trip.end_date, locale),
        heading: t("heading"),
        body: t("body", { destination }),
        ctaLabel: ctaT("cta"),
        tripUrl,
      },
    },
    metadata: {
      scheduled_notification_id: row.id,
      slot: row.slot,
      trip_id: row.trip_id,
    },
  });

  // 2e. Persist outcome. Any 'sent' / 'skipped_*' outcome from
  //     dispatchEmail means we did the right thing — flip status
  //     accordingly. 'failed' bubbles up as a failed row + last_error.
  if (result.ok) {
    if (result.status === "sent") {
      await svc
        .from("scheduled_notifications")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
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
  const { error: updErr } = await svc
    .from("scheduled_notifications")
    .update(patch)
    .eq("id", id);
  if (updErr) {
    console.error(
      "[cron/scheduled-notifs] outcome-update failed",
      { id, status, reason },
      updErr
    );
  }
}
