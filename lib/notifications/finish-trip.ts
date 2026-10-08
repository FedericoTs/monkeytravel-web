/**
 * "Finish your first trip": one email to a new account that still owns no
 * trip and has joined none, about a day after signup. A trigger on
 * public.users queues one account-level row (slot finish_trip_1d, trip_id
 * null) and the notifications cron hands it to sendFinishTripEmail.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { dispatchEmail } from "@/lib/email/send";
import { resolveLocale, type ReminderLocale } from "@/lib/email/reminder-locale";
import { verifyRenderedEmail, blockingDefects, summarizeDefects } from "@/lib/email/verify-render";

export const FINISH_TRIP_SLOT = "finish_trip_1d";

/** Where the copy lives: messages/<locale>/common.json mounts as `common`. */
export const FINISH_TRIP_NS = "common.finishTripEmail";

export type FinishTripTranslator = (key: string, values?: Record<string, string>) => string;

export interface FinishTripOutcome {
  status: "sent" | "suppressed" | "failed";
  reason: string;
  error?: string;
}

const LOCALE_PREFIX = /^\/(es|it|pt)(?:\/|$)/;

/**
 * The language to write in. preferred_language is not read: new accounts
 * hold the default there. Uses the locale prefix of the account's own page
 * views (a tie stays English), then the locale stamped at signup, then English.
 */
export function finishTripLocale(viewPaths: string[], signupLocale: unknown): ReminderLocale {
  if (viewPaths.length > 0) {
    const counts: Record<ReminderLocale, number> = { en: 0, es: 0, it: 0, pt: 0 };
    for (const path of viewPaths) {
      const match = LOCALE_PREFIX.exec(path);
      counts[match ? (match[1] as ReminderLocale) : "en"] += 1;
    }
    return (["es", "it", "pt"] as const).reduce<ReminderLocale>(
      (best, locale) => (counts[locale] > counts[best] ? locale : best),
      "en",
    );
  }
  return typeof signupLocale === "string" ? resolveLocale(signupLocale) : "en";
}

/** Longer free text is unlikely to be a place name. */
const MAX_DESTINATION_LENGTH = 60;

/**
 * The destination to prefill, from the account's own completed wizard step 1
 * (newest first). Only when every entry names the same place; none, or two
 * different places, prefill nothing.
 */
export function clearDestination(values: (string | null | undefined)[]): string | null {
  const names = values.map((v) => (v ?? "").replace(/\s+/g, " ").trim()).filter(Boolean);
  if (names.length === 0 || new Set(names.map((n) => n.toLowerCase())).size !== 1) return null;
  return names[0].length <= MAX_DESTINATION_LENGTH ? names[0] : null;
}

/** The planner in the email's language; `slot` lets the click be counted. */
export function finishTripCtaUrl(appUrl: string, locale: ReminderLocale, destination: string | null): string {
  const query = new URLSearchParams({ slot: FINISH_TRIP_SLOT });
  if (destination) query.set("destination", destination);
  return `${appUrl}${locale === "en" ? "" : `/${locale}`}/trips/new?${query}`;
}

/**
 * Decide and send one queued row. Any read that could hide a trip fails the
 * row instead of sending. The marketing opt-out and bounce suppression are
 * applied inside dispatchEmail.
 */
export async function sendFinishTripEmail(
  svc: SupabaseClient,
  row: { id: string; user_id: string },
  translatorFor: (locale: ReminderLocale) => Promise<FinishTripTranslator>,
): Promise<FinishTripOutcome> {
  const { data: auth, error: authErr } = await svc.auth.admin.getUserById(row.user_id);
  if (authErr) return { status: "failed", reason: "user_load_error", error: authErr.message };
  const user = auth?.user;
  if (!user?.email) return { status: "suppressed", reason: "no_email" };
  if (!user.email_confirmed_at) return { status: "suppressed", reason: "email_unconfirmed" };

  const countFor = (table: string) =>
    svc.from(table).select("id", { count: "exact", head: true }).eq("user_id", row.user_id);
  const [owned, collaborating, participating] = await Promise.all([
    countFor("trips"),
    countFor("trip_collaborators"),
    countFor("trip_participants"),
  ]);
  const readErr = owned.error ?? collaborating.error ?? participating.error;
  if (readErr) return { status: "failed", reason: "trip_read_error", error: readErr.message };
  if ((owned.count ?? 0) > 0) return { status: "suppressed", reason: "user_has_trip" };
  if ((collaborating.count ?? 0) + (participating.count ?? 0) > 0) {
    return { status: "suppressed", reason: "user_joined_trip" };
  }

  // Best effort: a failed read means English and no prefill.
  const [views, steps] = await Promise.all([
    svc.from("page_views").select("path").eq("user_id", row.user_id)
      .order("created_at", { ascending: false }).limit(50),
    svc.from("wizard_step_events").select("destination").eq("user_id", row.user_id).eq("step", "step_2_vibes")
      .order("created_at", { ascending: false }).limit(20),
  ]);
  const locale = finishTripLocale(
    ((views.data ?? []) as { path: string | null }[]).map((v) => v.path ?? ""),
    user.user_metadata?.locale,
  );
  const destination = clearDestination(((steps.data ?? []) as { destination: string | null }[]).map((s) => s.destination));

  let t: FinishTripTranslator;
  try {
    t = await translatorFor(locale);
  } catch (err) {
    return { status: "failed", reason: "i18n_load_error", error: err instanceof Error ? err.message : String(err) };
  }
  const copy = {
    heading: destination ? t("headingDestination", { destination }) : t("heading"),
    body: destination ? t("bodyDestination", { destination }) : t("body"),
    ctaLabel: t("cta"),
    signoff: t("signoff"),
  };
  // next-intl returns the key path for a missing message instead of throwing.
  const unresolved = Object.entries(copy).find(([, value]) => value.includes("finishTripEmail."));
  if (unresolved) return { status: "failed", reason: "i18n_load_error", error: `${unresolved[0]} did not resolve` };

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://monkeytravel.app";
  const ctaUrl = finishTripCtaUrl(appUrl, locale, destination);
  const result = await dispatchEmail({
    recipientEmail: user.email,
    recipientUserId: row.user_id,
    idempotencyKey: `finish_trip:${row.user_id}`,
    locale,
    template: { id: "finish_trip", props: { ...copy, ctaUrl } },
    metadata: { scheduled_notification_id: row.id, slot: FINISH_TRIP_SLOT },
    verify: ({ html, subject }) => {
      const defects = blockingDefects(verifyRenderedEmail({ subject, html, destination, ctaUrl, ownStrings: [] }));
      return defects.length ? { ok: false, reason: summarizeDefects(defects) } : { ok: true };
    },
  });
  if (!result.ok) return { status: "failed", reason: "dispatch_error", error: result.error };
  return result.status === "sent" ? { status: "sent", reason: "sent" } : { status: "suppressed", reason: result.status };
}
