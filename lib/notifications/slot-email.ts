/**
 * Sends a pre-trip reminder or a post-trip follow-up for a queue row.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { getTranslations } from "next-intl/server";
import { dispatchEmail, type EmailTemplate } from "@/lib/email/send";
import type { TripReminderSlot } from "@/lib/email/templates/TripReminder";
import { TERMINAL_FOLLOWUP_SLOTS, type TripFollowupSlot } from "@/lib/email/templates/TripFollowup";
import { buildContextBlocks, FORECAST_SLOTS, type ContextBlock } from "@/lib/email/trip-context";
import {
  getTripForecast,
  forecastMessage,
  forecastLabel,
  tripLengthDays,
} from "@/lib/email/trip-forecast";
import { tripStartCoordinate } from "@/lib/email/trip-coordinates";
import { verifyRenderedEmail, blockingDefects, summarizeDefects } from "@/lib/email/verify-render";
import { didNotGoUrl, postTripCtaUrl } from "@/lib/email/followup-cta";
import { needAnswerUrls, reminderCtaUrl } from "@/lib/email/reminder-cta";
import { resolveLocale, formatDateRange, formatDayMonth } from "@/lib/email/reminder-locale";
import { sharesAsGroup } from "@/lib/wizard/answers";
import {
  type TripEmailRow,
  type SlotRow,
  isFollowupSlot,
  persistOutcome,
  assertTranslated,
} from "./slot-row";

/**
 * Where the reminder copy lives in the assembled message tree.
 *
 * i18n.ts mounts each messages file under its own namespace, so common.json
 * becomes `common` and these strings sit at common.tripReminderEmail.*: asking
 * for `tripReminderEmail.<slot>` resolves to nothing. One constant because two
 * lookups need it and a wrong path fails silently (see assertTranslated).
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

/**
 * The early reminders that also ask a group trip's organiser to add the
 * people coming, while nobody else has the plan: most organisers never open
 * the trip again after the day they make it, so the email is the second ask.
 */
const GROUP_ASK_SLOTS = new Set<string>(["pack_early_14d", "visa_check_7d"]);

/**
 * The reminders before the trip that end with its one question, "what do you
 * still need for this trip?" (lib/feedback/need.ts), until the owner answers
 * it. Not the morning of: by then it's too late to help.
 */
const NEED_ASK_SLOTS = new Set<string>(["pack_early_14d", "visa_check_7d", "weather_3d", "confirm_1d"]);

/**
 * Every enrichment string that legitimately belongs to this trip.
 *
 * The containment check compares each rendered line against these, so a line
 * from any other trip is caught before the email goes out. Built from the
 * VALUES rather than a JSON dump of the row — JSON.stringify escapes embedded
 * quotes, so a weather note containing one would never contain itself.
 */
export function ownEnrichmentStrings(trip: TripEmailRow): string[] {
  // Every day's stops, not day one's only: the travel-day email lists
  // tomorrow's plan too, and a line from this trip's own days is never a
  // line from another trip.
  const days = [trip.day1, ...(Array.isArray(trip.itinerary) ? trip.itinerary : [])];
  const activities = days.flatMap((day) => {
    const stops = (day as { activities?: unknown } | null | undefined)?.activities;
    return Array.isArray(stops) ? stops : [];
  });
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
 * A pre-trip reminder or a post-trip follow-up: its copy in the traveller's
 * language, the trip's enrichment, the send, and the row's outcome.
 */
export async function sendSlotEmail(
  svc: ReturnType<typeof createAdminClient>,
  row: SlotRow,
  trip: TripEmailRow,
  recipientEmail: string,
  locale: ReturnType<typeof resolveLocale>,
  domestic: boolean
): Promise<"sent" | "skipped" | "failed"> {
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

  // Where the CTA points: reminderCtaUrl (day 1 without sign-in, or the trip
  // if the link can't be signed) and postTripCtaUrl (return →
  // the answer "yes, I went", later slots → wizard), shared with the audit script
  // so it vets what ships. `slot`, not `utm_source`: a utm_* param on an internal
  // link overwrites the stored acquisition source.
  const followupLinks = { tripUrl, appUrl: APP_URL, userId: row.user_id, locale, tripId: trip.id };
  const ctaUrl = followup
    ? postTripCtaUrl(row.slot as TripFollowupSlot, followupLinks)
    : reminderCtaUrl(row.slot as TripReminderSlot, { appUrl: APP_URL, locale, tripId: trip.id, startDate: trip.start_date });

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
  // The post-trip body states when the trip ended; other bodies ignore it.
  const endDate = formatDayMonth(trip.end_date, locale);
  // A domestic trip reads the slot's bodyDomestic when the copy has one
  // (pack_early_14d and confirm_1d do); every other case reads body.
  const body =
    domestic && t.has("bodyDomestic")
      ? t("bodyDomestic", { destination })
      : t("body", { destination, endDate });
  // The reminder family shares ONE cta across all five slots, so it sits
  // at the namespace root. The followup family needs a different verb per
  // slot ("Open your trip" vs "Plan your next trip"), so its cta lives
  // inside the slot. Hence two different lookups, not an inconsistency.
  const ctaLabel = followup ? t("cta") : ctaT("cta");
  // The return email asks "did you go?", so it has a button for each answer.
  const noUrl = row.slot === "followup_return_3d" ? didNotGoUrl(followupLinks) : null;
  const secondCta = noUrl ? { label: t("ctaNo"), url: noUrl } : undefined;
  // Only terminal slots promise "this is the last one", and only they
  // render it. Resolved here so assertTranslated can vet it too.
  const finalNote =
    isFollowupSlot(row.slot) && TERMINAL_FOLLOWUP_SLOTS.has(row.slot)
      ? ctaT("finalNote")
      : undefined;

  // The group ask (GROUP_ASK_SLOTS): a trip for friends or a family with no
  // share link and no invite yet. Optional, so a failed read just leaves it out.
  let groupAsk: { text: string; label: string; url: string } | undefined;
  if (!followup && GROUP_ASK_SLOTS.has(row.slot) && sharesAsGroup(trip.trip_intent) && !trip.shared_at) {
    const { count, error } = await svc
      .from("trip_invites")
      .select("id", { count: "exact", head: true })
      .eq("trip_id", trip.id);
    if (!error && (count ?? 0) === 0) {
      groupAsk = {
        text: ctaT("groupAsk.text"),
        label: ctaT("groupAsk.cta"),
        url: `${APP_URL}/trips/${trip.id}?slot=${row.slot}&share=invite`,
      };
    }
  }

  // The one question (NEED_ASK_SLOTS), until the trip's owner has answered it.
  // Optional like the group ask: a failed read, or links that can't be signed,
  // leave it out and the reminder goes without it.
  let needAsk: { question: string; answers: { label: string; url: string }[] } | undefined;
  if (!followup && NEED_ASK_SLOTS.has(row.slot)) {
    const { data: answered, error } = await svc
      .from("user_feedback")
      .select("id")
      .eq("extra->>trip_id", trip.id)
      .not("extra->>need", "is", null)
      .limit(1);
    const urls =
      !error && (answered ?? []).length === 0
        ? needAnswerUrls(row.slot as TripReminderSlot, { appUrl: APP_URL, locale, tripId: trip.id, userId: row.user_id })
        : null;
    if (urls) {
      needAsk = {
        question: ctaT("needAsk.question"),
        answers: urls.map(({ need, url }) => ({ label: ctaT(`needAsk.${need}`), url })),
      };
    }
  }

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
        itinerary: trip.itinerary,
      },
      {
        weather: weatherLabel ?? ctxT("weather"),
        packing: ctxT("packing"),
        goingFor: ctxT("goingFor"),
        dayOne: ctxT("dayOne"),
        today: ctxT("today"),
        tomorrow: ctxT("tomorrow"),
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
    ...(secondCta ? { secondCtaLabel: secondCta.label } : {}),
    ...(finalNote ? { finalNote } : {}),
    ...(groupAsk ? { groupAskText: groupAsk.text, groupAskLabel: groupAsk.label } : {}),
    ...(needAsk
      ? {
          needAskQuestion: needAsk.question,
          ...Object.fromEntries(needAsk.answers.map((a, i) => [`needAskAnswer${i}`, a.label])),
        }
      : {}),
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
  // Digest slots (`in_trip_day_<K>`) go to dispatchDayDigest instead, so here
  // the slot is only ever pre-trip or followup. TS can't infer that, so restate
  // the invariant in the type.
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
          secondCta,
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
          tripUrl: ctaUrl,
          contextBlocks,
          ...(groupAsk ? { groupAsk } : {}),
          ...(needAsk ? { needAsk } : {}),
        },
      };

  const result = await dispatchEmail({
    recipientEmail,
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
          // The real CTA target: the trip or its day 1 for reminders, the
          // answer link for followup_return_3d, the wizard after it.
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
