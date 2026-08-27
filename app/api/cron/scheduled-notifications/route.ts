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
  type ContextBlock,
} from "@/lib/email/trip-context";
import {
  verifyRenderedEmail,
  blockingDefects,
  summarizeDefects,
} from "@/lib/email/verify-render";
import { isTripNotificationsEnabled } from "@/lib/notifications/scheduling";
import { resolveLocale, formatDateRange } from "@/lib/email/reminder-locale";

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

/**
 * Where the reminder copy actually lives in the assembled message tree.
 *
 * i18n.ts mounts each file under its own namespace, so common.json becomes
 * `common` and these strings sit at common.tripReminderEmail.*. Kept as one
 * constant because it is needed in two places and getting it wrong is silent
 * — see assertTranslated below for why that mattered.
 */
const REMINDER_NS = "common.tripReminderEmail";

/**
 * Post-trip copy lives in a sibling namespace, same file, same mounting
 * rule — so the `common.` prefix is just as load-bearing here.
 */
const FOLLOWUP_NS = "common.tripFollowupEmail";

/**
 * Headings for the per-trip enrichment blocks. Shared by both families —
 * "Day one" means the same thing whichever email it appears in.
 */
const CONTEXT_NS = "common.emailContext";

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
 * This is the canary control. The cascade has never run at volume — before
 * this week it reached 5 trips; it now covers 150 — so the first live run is
 * the first time this copy meets real inboxes at scale. Setting
 * TRIP_NOTIFICATIONS_SEND_CAP=5 lets that run land in a handful of inboxes,
 * be read, and either continue or be stopped, instead of committing to
 * everything due that morning.
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
 * getMessageFallback substitutes the full key path, so the mail still sends
 * with "tripReminderEmail.morning_of.heading" where the sentence should be.
 * That is exactly what reached real inboxes from 2026-06 until 2026-08-19,
 * subject line included, and two of those were opened. The try/catch above
 * never fired because nothing ever threw; the rows were marked `sent`.
 *
 * So the send path cannot trust the translator. A value still carrying
 * "tripReminderEmail." is a fallback, never copy — no real sentence contains
 * it — and it must fail loudly instead of being delivered.
 */
function assertTranslated(values: Record<string, string>): string | null {
  for (const [key, value] of Object.entries(values)) {
    // Both families are checked: the post-trip copy is loaded through the
    // same fallback-instead-of-throw translator, so it can fail the same
    // silent way the reminders did.
    if (
      value.includes("tripReminderEmail.") ||
      value.includes("tripFollowupEmail.")
    ) {
      return `${key} did not resolve (got "${value.slice(0, 80)}")`;
    }
  }
  return null;
}

/** Every slot the queue can hold — both lifecycle halves. */
type QueueSlot = TripReminderSlot | TripFollowupSlot;

/**
 * Shape of the trip row this route selects.
 *
 * Declared by hand because the generated Database types cannot describe a
 * select containing JSON paths (`trip_meta->>weather_note`, `itinerary->0`):
 * supabase-js falls back to GenericStringError for the whole row, and every
 * field access becomes an error. The jsonb-derived fields are `unknown` on
 * purpose — they are model-generated and lib/email/trip-context.ts validates
 * them rather than trusting a declaration.
 */
type TripEmailRow = {
  id: string;
  // title / start_date / end_date are NOT NULL in the trips schema.
  title: string;
  start_date: string;
  end_date: string;
  reminders_muted: boolean | null;
  weather_note: string | null;
  highlights: unknown;
  packing_suggestions: unknown;
  day1: unknown;
};

type SlotRow = {
  id: string;
  user_id: string;
  trip_id: string;
  slot: QueueSlot;
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
  let deferredByCap = 0;

  const cap = sendCap();

  for (const row of dueRows) {
    // Canary cap. Counts ACTUAL sends, not rows examined, so suppressions and
    // failures do not consume the budget — a cap of 5 means five real emails.
    // Remaining rows are left `pending` and untouched, so they go out on a
    // later run with no state to repair.
    if (cap !== null && sent >= cap) {
      deferredByCap = dueRows.length - (sent + skipped + failed);
      break;
    }
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
  row: SlotRow
): Promise<"sent" | "skipped" | "failed"> {
  // 2a. Load the trip — needed for destination + start_date + mute.
  //     We re-check `reminders_muted` here even though the enqueue RPC
  //     already gates: the user could have muted between enqueue and
  //     dispatch, and that mute must still be honoured.
  // The enrichment fields are selected as JSON PATHS, not whole columns.
  // trip_meta carries travel_distances (large, per-segment) and itinerary is
  // the entire multi-day plan; pulling either whole would move megabytes per
  // run for four short strings. `itinerary->0` is day one, which is the only
  // day any slot needs.
  const { data: tripRow, error: tripErr } = await svc
    .from("trips")
    .select(
      "id, title, start_date, end_date, reminders_muted, " +
        "weather_note:trip_meta->>weather_note, " +
        "highlights:trip_meta->highlights, " +
        "packing_suggestions:trip_meta->packing_suggestions, " +
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

  // See TripEmailRow: the JSON-path select defeats the generated types, so
  // the shape is asserted here, once, rather than at every field access.
  const trip = tripRow as unknown as TripEmailRow | null;

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

  // 2a-bis. EXIT CONDITION for the post-trip sequence.
  //
  // Loop 2 exists to re-engage people who planned one trip and went
  // quiet. The moment they plan another, it has done its job and every
  // remaining slot becomes noise — "Thinking about the next one?" landing
  // on someone who booked it last week is the single most obvious way
  // this feature could embarrass us.
  //
  // Checked at dispatch rather than at enqueue because the second trip
  // usually appears AFTER the sequence is queued; enqueue-time filtering
  // would miss exactly the case that matters.
  //
  // This doubles as the cross-trip rate limit: the per-trip 24h check
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

  // 2d. Resolve locale → load the slot-specific strings.
  //
  // The namespace MUST carry the `common.` prefix. i18n.ts assembles messages
  // keyed by FILE — `messages/<locale>/common.json` is mounted as the `common`
  // namespace — and tripReminderEmail lives at the top level of that file, so
  // the real path is common.tripReminderEmail.<slot>. Asking for
  // `tripReminderEmail.<slot>` resolves to nothing. (Compare
  // app/api/tools/packing-list/route.ts, which correctly uses
  // "tools.packingList.categories".)
  const locale = resolveLocale(user.preferred_language);
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

  // Where the post-trip CTA points. Only the +3d "How was X?" mail sends
  // them back to the trip itself; the later ones exist to start a NEW
  // trip, so pointing at the finished one would be a dead end.
  //
  // `slot` and not `utm_source`: a utm_* param on an internal link
  // overwrites the stored acquisition source, which is how you end up
  // attributing organic users to your own email.
  const ctaUrl = followup
    ? row.slot === "followup_return_3d"
      ? tripUrl
      : `${APP_URL}/trips/new?slot=${row.slot}`
    : tripUrl;

  // Resolve the copy BEFORE handing it to the mailer, so an unresolved key
  // can be caught while it is still just a string in memory.
  //
  // `destination` goes to BOTH, even though most slots only reference it in
  // the body. weather_3d is the exception — its heading is "Three days to
  // {destination}" in all four locales — and next-intl falls back to the key
  // path when a referenced placeholder is not supplied, so calling
  // t("heading") bare silently broke that one slot on its own, independently
  // of the namespace bug. Passing it unconditionally also means a translator
  // moving {destination} into another heading cannot break the mail; unused
  // values are ignored.
  const heading = t("heading", { destination });
  const body = t("body", { destination });
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
  let contextBlocks: ContextBlock[] = [];
  try {
    const ctxT = await getTranslations({ locale, namespace: CONTEXT_NS });
    contextBlocks = buildContextBlocks(
      row.slot,
      {
        weatherNote: trip.weather_note,
        highlights: trip.highlights,
        packingSuggestions: trip.packing_suggestions,
        day1: trip.day1,
      },
      {
        weather: ctxT("weather"),
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
    if (contextBlocks.some((b) => b.label.includes("emailContext."))) {
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
  const slot = row.slot;
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
    // shell (header/footer) matches and dispatchEmail skips the re-lookup.
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
          tripId: trip.id,
          contextBlocks,
          // This trip's own enrichment values — the corpus containment is
          // checked against. Anything rendered that is not in here came from
          // somewhere it should not have.
          ownStrings: ownEnrichmentStrings(trip),
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
