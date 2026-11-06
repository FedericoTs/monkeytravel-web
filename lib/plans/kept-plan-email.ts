import "server-only";
import { createHash } from "crypto";
import type { NextRequest } from "next/server";
import { getTranslations } from "next-intl/server";
import { createRateLimiter } from "@/lib/api/rate-limit";
import { dispatchEmail } from "@/lib/email/send";
import { formatDateRange, resolveLocale } from "@/lib/email/reminder-locale";
import { blockingDefects, summarizeDefects, verifyRenderedEmail } from "@/lib/email/verify-render";

/**
 * A kept plan's link (lib/plans/kept-plan.ts), by email, to the address someone
 * types. One email, and nothing after it. Anyone holding the plan can type any
 * address, and the place in a plan is text its maker sent, so the sends are
 * limited three ways and whatever reads like a link stays out of the email.
 */

export const KEPT_PLAN_SLOT = "kept_plan";
const NS = "common.keptPlanEmail";
const DAY_MS = 24 * 60 * 60_000;
const MAX_PLACE_LENGTH = 60;

const ipLimiter = createRateLimiter("kept-plan-email-ip", 10, 60 * 60_000);
const planLimiter = createRateLimiter("kept-plan-email-plan", 5, DAY_MS);
const addressLimiter = createRateLimiter("kept-plan-email-address", 3, DAY_MS);

const hashed = (value: string) => createHash("sha256").update(value).digest("hex");

/** Whether this request may email this plan to this address now. Spends one of each allowance. */
export async function mayEmailKeptPlan(request: NextRequest, token: string, email: string): Promise<boolean> {
  if (!(await ipLimiter.check(request)).allowed) return false;
  if (!(await planLimiter.check(request, token)).allowed) return false;
  // Hashed, because the limiter's keys are stored.
  return (await addressLimiter.check(request, hashed(email))).allowed;
}

/** The place to name in the email, or null when the text reads like a link, an address or a sentence. */
export function placeForEmail(text: unknown): string | null {
  if (typeof text !== "string") return null;
  const place = text.split(",")[0].replace(/\s+/g, " ").trim();
  if (!place || place.length > MAX_PLACE_LENGTH) return null;
  return /[/@:]|www\.|\.[a-z]{2,}(\s|$)/i.test(place) ? null : place;
}

/** What the email says of the plan, as app/api/plans/[token]/email reads it. */
export interface PlanForEmail {
  start_date: unknown;
  end_date: unknown;
  /** The place in the plan's itinerary. */
  name: unknown;
  destination: unknown;
}

interface KeptPlanEmailArgs {
  token: string;
  email: string;
  /** The page's language. */
  locale: string | null;
}

/** Sends the plan's link. Never throws; what happened is the return value. */
export async function sendKeptPlanEmail(plan: PlanForEmail, args: KeptPlanEmailArgs): Promise<string> {
  try {
    const locale = resolveLocale(args.locale);
    const t = await getTranslations({ locale, namespace: NS });
    const place = placeForEmail(plan.name) ?? placeForEmail(plan.destination);
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://monkeytravel.app";
    const prefix = locale === "en" ? "" : `/${locale}`;
    // The token stays in the fragment, as in every link to a kept plan (keptPlanLink).
    const planUrl = `${appUrl}${prefix}/trips/new?slot=${KEPT_PLAN_SLOT}#plan=${args.token}`;
    const outcome = await dispatchEmail({
      recipientEmail: args.email,
      recipientUserId: null,
      idempotencyKey: `kept_plan:${hashed(`${args.token}:${args.email}`)}`,
      locale,
      template: {
        id: "kept_plan",
        props: {
          heading: place ? t("heading", { destination: place }) : t("headingNoPlace"),
          dates: formatDateRange(String(plan.start_date), plan.end_date as string | null, locale),
          intro: t("intro"),
          ctaLabel: t("cta"),
          planUrl,
          footerReason: t("footerReason"),
          footerLink: t("footerLink"),
          unsubscribeUrl: `${appUrl}${prefix}/privacy`,
          locale,
        },
      },
      metadata: { slot: KEPT_PLAN_SLOT },
      verify: ({ html, subject }) => {
        const defects = blockingDefects(
          verifyRenderedEmail({ subject, html, destination: place, ctaUrl: planUrl, ownStrings: [] }),
        );
        return defects.length ? { ok: false, reason: summarizeDefects(defects) } : { ok: true };
      },
    });
    return outcome.status;
  } catch (err) {
    console.error("[kept-plan-email] not sent:", err instanceof Error ? err.message : err);
    return "error";
  }
}
