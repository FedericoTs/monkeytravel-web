import "server-only";
import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getTranslations } from "next-intl/server";
import { createRateLimiter } from "@/lib/api/rate-limit";
import { dispatchEmail, type EmailTemplate } from "@/lib/email/send";
import { buildParticipantUnsubscribeUrl } from "@/lib/email/unsubscribe";
import { formatDateRange, resolveLocale } from "@/lib/email/reminder-locale";
import { blockingDefects, summarizeDefects, verifyRenderedEmail } from "@/lib/email/verify-render";
import { getTripDestination } from "@/lib/trips/destination";
import { isParticipantDigestEnabled } from "./flag";

/**
 * "Here's the plan" (lib/email/templates/ParticipantPlan.tsx) for an address
 * someone gives on a trip's share link. Anyone holding the link can type any
 * address, so it goes once per address per trip, and only so many an hour
 * from one network and a day for one trip.
 */

export const PLAN_EMAIL_SLOT = "participant_plan";
const NS = "common.participantPlanEmail";

const ipLimiter = createRateLimiter("shared-plan-email-ip", 10, 60 * 60_000);
const tripLimiter = createRateLimiter("shared-plan-email-trip", 20, 24 * 60 * 60_000);

/** Whether this request may email a trip's plan now. Spends one of each allowance. */
export async function mayEmailPlan(request: NextRequest, tripId: string): Promise<boolean> {
  const { allowed } = await ipLimiter.check(request);
  if (!allowed) return false;
  return (await tripLimiter.check(request, tripId)).allowed;
}

interface PlanEmailArgs {
  tripId: string;
  shareToken: string;
  participantId: string;
  email: string;
  /** The page's language; the trip's when absent. */
  locale: string | null;
}

/** Sends the plan email. Never throws; what happened is the return value, for the log. */
export async function sendParticipantPlanEmail(admin: SupabaseClient, args: PlanEmailArgs): Promise<string> {
  try {
    const { data: trip } = await admin
      .from("trips")
      .select("title, start_date, end_date, destination:trip_meta->>destination, trip_locale:trip_meta->>locale")
      .eq("id", args.tripId)
      .maybeSingle();
    if (!trip) return "no_trip";
    // "You said you're going" is wrong once the trip is over.
    const today = new Date().toISOString().slice(0, 10);
    if (typeof trip.end_date === "string" && trip.end_date.slice(0, 10) < today) return "trip_over";

    // The footer link stops this trip's emails; none is sent without it.
    let unsubscribeUrl: string;
    try {
      unsubscribeUrl = buildParticipantUnsubscribeUrl(args.participantId);
    } catch {
      return "no_unsubscribe_link";
    }

    // The daily plan is promised only when it is queued for this trip and goes to participants.
    let digest = false;
    if (isParticipantDigestEnabled()) {
      const { data: queued } = await admin
        .from("scheduled_notifications")
        .select("id")
        .eq("trip_id", args.tripId)
        .like("slot", "in_trip_day_%")
        .eq("status", "pending")
        .limit(1);
      digest = (queued?.length ?? 0) > 0;
    }

    const locale = resolveLocale(args.locale ?? (trip.trip_locale as string | null));
    const t = await getTranslations({ locale, namespace: NS });
    const destination = getTripDestination({
      title: trip.title as string | null,
      trip_meta: { destination: (trip.destination as string | null) ?? undefined },
    });
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://monkeytravel.app";
    const planUrl = `${appUrl}${locale === "en" ? "" : `/${locale}`}/shared/${args.shareToken}?slot=${PLAN_EMAIL_SLOT}`;
    const template: EmailTemplate = {
      id: "participant_plan",
      props: {
        heading: t("heading", { destination }),
        dates: typeof trip.start_date === "string" ? formatDateRange(trip.start_date, trip.end_date as string | null, locale) : "",
        intro: t("intro"),
        ...(digest ? { digestLine: t("digest") } : {}),
        ctaLabel: t("cta"),
        planUrl,
        footerReason: t("footerReason"),
        footerLink: t("footerLink"),
        locale,
      },
    };
    const outcome = await dispatchEmail({
      recipientEmail: args.email,
      recipientUserId: null,
      guestUnsubscribeUrl: unsubscribeUrl,
      idempotencyKey: `participant_plan:${args.tripId}:${args.email}`,
      locale,
      template,
      metadata: { trip_id: args.tripId, participant_id: args.participantId, slot: PLAN_EMAIL_SLOT },
      verify: ({ html, subject }) => {
        const defects = blockingDefects(
          verifyRenderedEmail({ subject, html, destination, ctaUrl: planUrl, ownStrings: [] }),
        );
        return defects.length ? { ok: false, reason: summarizeDefects(defects) } : { ok: true };
      },
    });
    return outcome.status;
  } catch (err) {
    console.error("[plan-email] not sent:", err instanceof Error ? err.message : err);
    return "error";
  }
}
