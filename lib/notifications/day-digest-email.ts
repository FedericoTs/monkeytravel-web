/**
 * Sends an in-trip day digest for a queue row: tomorrow's plan, to the owner and
 * the trip's participants.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { getTranslations } from "next-intl/server";
import { dispatchEmail, type EmailTemplate } from "@/lib/email/send";
import { buildParticipantUnsubscribeUrl } from "@/lib/email/unsubscribe";
import { type ContextBlock } from "@/lib/email/trip-context";
import { verifyRenderedEmail, blockingDefects, summarizeDefects } from "@/lib/email/verify-render";
import { digestParticipantRecipients } from "@/lib/notifications/digest";
import { daySendUrl, digestDayUrl, tripDayDate } from "@/lib/trips/day-link";
import { dayRouteMapsUrl } from "@/lib/trips/maps-links";
import { resolveLocale } from "@/lib/email/reminder-locale";
import { isParticipantDigestEnabled } from "@/lib/participants/flag";
import { logReadError } from "@/lib/supabase/log-read-error";
import { type SlotRow, type TripEmailRow, assertTranslated, persistOutcome } from "./slot-row";

type Stop = Parameters<typeof dayRouteMapsUrl>[0][number];

/**
 * In-trip evening-before digest copy. One namespace, not per-slot: the digest
 * is one template parameterised by day number. Same `common.` mounting rule.
 */
const DIGEST_NS = "common.tripDayDigestEmail";
// A guest said they're going and gave their address, as in the plan email.
const GUEST_FOOTER_NS = "common.participantPlanEmail";

/**
 * Render + dispatch one in-trip day digest.
 *
 * Content is tomorrow's plan read straight from THIS trip's itinerary day K,
 * so cross-trip contamination is structurally impossible — but it still runs
 * the same verify gate (with the day's own strings as the corpus) so a future
 * refactor can't quietly introduce it. The "+N more" line is UI copy, not
 * trip data, so it is passed OUTSIDE the context block the gate inspects.
 */
export async function dispatchDayDigest(
  svc: ReturnType<typeof createAdminClient>,
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
  // Every stop of the day goes in the directions, including those past the list's cut.
  const routeUrl = dayRouteMapsUrl(
    rawActs.filter((a): a is Stop => !!a && typeof a === "object" && typeof (a as Stop).name === "string" && !!(a as Stop).name.trim())
  );

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
    guest?: { unsubscribeUrl: string; footerCopy: { reason: string; link: string } },
    groupSendUrl?: string,
  ): Promise<Awaited<ReturnType<typeof dispatchEmail>> | { ok: false; status: "failed"; error: string; i18n: true }> => {
    const heading = tr("heading", { day });
    const intro = tr("intro");
    const ctaLabel = tr("cta");
    const emptyLine = acts.length === 0 ? tr("empty", { day }) : undefined;
    const andMore = moreCount > 0 ? tr("andMore", { count: moreCount }) : undefined;
    const groupSend = groupSendUrl
      ? { text: tr("groupSend.text"), label: tr("groupSend.cta"), url: groupSendUrl }
      : undefined;
    const maps = routeUrl ? { label: tr("mapsCta"), url: routeUrl } : undefined;
    const unresolved = assertTranslated({
      heading,
      intro,
      ctaLabel,
      ...(emptyLine ? { emptyLine } : {}),
      ...(andMore ? { andMore } : {}),
      ...(groupSend ? { groupSendText: groupSend.text, groupSendLabel: groupSend.label } : {}),
      ...(maps ? { mapsLabel: maps.label } : {}),
    });
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
      props: { day, destination, heading, intro, blocks, emptyLine, andMore, ctaLabel, tripUrl: ctaUrl, locale: loc, groupSend, footerCopy: guest?.footerCopy, maps },
    };
    return dispatchEmail({
      recipientEmail: email,
      recipientUserId: userId,
      guestUnsubscribeUrl: guest?.unsubscribeUrl,
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
  // "Send tomorrow's plan to the group": for the owner, on trips not marked
  // solo, when there is a plan to send. Left out if the link can't be signed.
  let groupSendUrl: string | undefined;
  const sendDate = tripDayDate(trip.start_date, day);
  if (trip.trip_intent !== "solo" && shown.length > 0 && sendDate) {
    try {
      groupSendUrl = daySendUrl({ appUrl: APP_URL, locale, tripId: trip.id, date: sendDate, slot: row.slot });
    } catch (err) {
      console.warn("[cron/scheduled-notifs] group send link not signed", {
        id: row.id, error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  const result = await sendDigest(recipientEmail, row.user_id, locale, ownerT, ownerUrl, "", undefined, groupSendUrl);

  // Participant fan-out (off by default): also email the trip's
  // emailed participants. Best-effort and INDEPENDENT of the owner outcome
  // (owner may be suppressed while participants aren't). Resolved fresh from
  // trip_participants so a mid-trip joiner is covered; one trip-locale
  // translator for all of them; deep-linked to /shared/<token>. Suppression +
  // any signed-in participant's opt-out are enforced per send by dispatchEmail.
  if (isParticipantDigestEnabled() && trip.share_token) {
    try {
      const { data: parts } = logReadError("reminders: participants", await svc
        .from("trip_participants")
        .select("id, email, user_id, participant_cookie_id")
        .eq("trip_id", row.trip_id)
        // Not someone who said they're going on the public page: the email
        // carries the share link, and joining through it would confirm them.
        .neq("source", "public")
        .is("left_at", null)
        .not("email", "is", null));
      const recipients = digestParticipantRecipients(parts ?? [], recipientEmail);
      if (recipients.length > 0) {
        const partLocale = resolveLocale(trip.trip_locale);
        const partT = await getTranslations({ locale: partLocale, namespace: DIGEST_NS });
        const guestT = await getTranslations({ locale: partLocale, namespace: GUEST_FOOTER_NS });
        const footerCopy = { reason: guestT("footerReason"), link: guestT("footerLink") };
        const shareUrl = `${APP_URL}/shared/${trip.share_token}?slot=${row.slot}`;
        let sent = 0, skipped = 0, failed = 0;
        for (const r of recipients) {
          // A guest has no account to opt out from: their email carries a link
          // that stops this trip's digest, and is not sent without one.
          let guestUnsub: string | undefined;
          if (!r.userId) {
            try {
              guestUnsub = buildParticipantUnsubscribeUrl(r.participantId, APP_URL);
            } catch (err) {
              failed++;
              console.warn("[cron/scheduled-notifs] guest digest not sent: no unsubscribe link", {
                trip: row.trip_id, error: err instanceof Error ? err.message : String(err),
              });
              continue;
            }
          }
          const guest = guestUnsub ? { unsubscribeUrl: guestUnsub, footerCopy } : undefined;
          const pr = await sendDigest(r.email, r.userId, partLocale, partT, shareUrl, `:${r.key}`, guest);
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
