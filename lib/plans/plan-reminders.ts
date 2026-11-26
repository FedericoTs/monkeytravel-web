import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getTranslations } from "next-intl/server";
import { dispatchEmail } from "@/lib/email/send";
import { formatDateRange, resolveLocale } from "@/lib/email/reminder-locale";
import { buildPlanReminderUnsubscribeUrl } from "@/lib/email/unsubscribe";
import { placeForEmail, planEmailCheck, type PlanForEmail } from "@/lib/plans/kept-plan-email";
import {
  PLAN_REMINDER_DAY,
  dueReminder,
  planKeptUntil,
  reminderIsOver,
  type PlanReminderSlot,
} from "@/lib/plans/plan-reminder-dates";

/**
 * Reminders before a kept plan's trip, for a planner with no account who ticked "remind me" when the plan was
 * emailed to them (app/api/plans/[token]/email). The tick is a plan_reminders row: the address, when it was ticked
 * and which words it answered. The row goes from the trip's first day, at once from any reminder's stop link
 * (app/api/unsubscribe), or with its plan. Nothing but these reminders is ever sent from it.
 */

/** The words the tick answered (trips.wizard.kept.remindWeek and remindDay): new words, a new version. */
export const PLAN_REMINDER_CONSENT = "v1";
const NS = "common.planReminderEmail";
/** Rows one run reads: far above what a day brings, and well inside the function's time limit. */
const MAX_ROWS_PER_RUN = 500;
/** What a send can end as that means "don't try this one again". */
const DONE_WITH: ReadonlySet<string> = new Set(["sent", "skipped_duplicate", "skipped_suppressed"]);

interface KeepArgs {
  token: string;
  email: string;
  locale: string | null;
  start: unknown;
  end: unknown;
}

/**
 * Keeps the tick for this plan and address, and the plan's link through the trip. Ticked again, it is the same row,
 * its time and words renewed. The row's id, or null when it couldn't be kept.
 */
export async function keepPlanReminder(admin: SupabaseClient, args: KeepArgs): Promise<string | null> {
  const { data, error } = await admin
    .from("plan_reminders")
    .upsert(
      {
        kept_token: args.token,
        email: args.email,
        locale: args.locale,
        consent_version: PLAN_REMINDER_CONSENT,
        consented_at: new Date().toISOString(),
      },
      { onConflict: "kept_token,email" },
    )
    .select("id")
    .single();
  const id = (data as { id?: unknown } | null)?.id;
  if (error || typeof id !== "string") {
    console.error("[plan-reminders] tick not kept:", error?.message ?? "no row");
    return null;
  }
  await keepPlanThroughTrip(admin, args.token, args.start, args.end);
  return id;
}

/** The plan's link stays until two weeks after the trip; an expiry already later is left alone. */
async function keepPlanThroughTrip(admin: SupabaseClient, token: string, start: unknown, end: unknown) {
  const until = planKeptUntil(start, end);
  if (!until) return;
  const { error } = await admin.from("kept_plans").update({ expires_at: until }).eq("token", token).lt("expires_at", until);
  if (error) console.error("[plan-reminders] plan's link not kept through the trip:", error.message);
}

/** Deletes a tick: its address and everything kept with it. Whether there was one; throws when the database fails. */
export async function stopPlanReminder(admin: SupabaseClient, reminderId: string): Promise<{ applied: boolean }> {
  const { data, error } = await admin.from("plan_reminders").delete().eq("id", reminderId).select("id");
  if (error) {
    console.error("[unsubscribe] plan reminder delete failed:", error.message);
    throw new Error("Failed to update preferences");
  }
  return { applied: Array.isArray(data) && data.length > 0 };
}

interface ReminderRow {
  id: string;
  kept_token: string;
  email: string;
  locale: string | null;
  sent_slots: string[] | null;
  consented_at: string;
}

interface ReminderPlan extends PlanForEmail {
  token: string;
}

export interface ReminderRun {
  sent: number;
  failed: number;
  removed: number;
}

/**
 * One day's run: each reminder due today goes once, and the addresses whose trip has begun, or whose plan is gone
 * or has no chosen dates, are deleted. Throws when the rows can't be read; a failed send stays due while its window
 * lasts.
 */
export async function sendDuePlanReminders(admin: SupabaseClient, today: string): Promise<ReminderRun> {
  const run: ReminderRun = { sent: 0, failed: 0, removed: 0 };
  const { data: rows, error } = await admin
    .from("plan_reminders")
    .select("id, kept_token, email, locale, sent_slots, consented_at")
    .order("consented_at")
    .limit(MAX_ROWS_PER_RUN);
  if (error) throw new Error(`plan reminders not read: ${error.message}`);
  const reminders = (rows ?? []) as ReminderRow[];
  if (reminders.length === 0) return run;

  const { data: planRows, error: planError } = await admin
    .from("kept_plans")
    .select(
      "token, start_date:plan->>startDate, end_date:plan->>endDate, flexible:plan->>flexibleDates, name:plan->itinerary->destination->>name, destination:plan->>destination",
    )
    .in("token", [...new Set(reminders.map((r) => r.kept_token))]);
  if (planError) throw new Error(`their plans not read: ${planError.message}`);
  const plans = new Map(((planRows ?? []) as ReminderPlan[]).map((plan) => [plan.token, plan]));

  const over: string[] = [];
  for (const row of reminders) {
    const plan = plans.get(row.kept_token);
    if (!plan || plan.flexible === "true" || reminderIsOver(plan.start_date, today)) {
      over.push(row.id);
      continue;
    }
    const sent = row.sent_slots ?? [];
    const slot = dueReminder(plan.start_date, row.consented_at.slice(0, 10), today, sent);
    if (!slot) continue;
    const status = await sendPlanReminderEmail(plan, row, slot);
    if (!DONE_WITH.has(status)) {
      run.failed++;
      continue;
    }
    if (status === "sent") run.sent++;
    const { error: markError } = await admin
      .from("plan_reminders")
      .update({ sent_slots: [...sent, slot] })
      .eq("id", row.id);
    if (markError) console.error("[plan-reminders] sent but not marked:", markError.message);
  }

  if (over.length > 0) {
    const { error: deleteError } = await admin.from("plan_reminders").delete().in("id", over);
    if (deleteError) console.error("[plan-reminders] finished ones not deleted:", deleteError.message);
    else run.removed = over.length;
  }
  return run;
}

/** One reminder, in the language the tick was given in. Never throws; what happened is the return value. */
async function sendPlanReminderEmail(plan: ReminderPlan, row: ReminderRow, slot: PlanReminderSlot): Promise<string> {
  try {
    const locale = resolveLocale(row.locale);
    const t = await getTranslations({ locale, namespace: NS });
    const place = placeForEmail(plan.name) ?? placeForEmail(plan.destination);
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://monkeytravel.app";
    const prefix = locale === "en" ? "" : `/${locale}`;
    // The token stays in the fragment, as in every link to a kept plan (keptPlanLink).
    const planUrl = `${appUrl}${prefix}/trips/new?slot=${slot}#plan=${row.kept_token}`;
    const day = slot === PLAN_REMINDER_DAY;
    const outcome = await dispatchEmail({
      recipientEmail: row.email,
      recipientUserId: null,
      guestUnsubscribeUrl: buildPlanReminderUnsubscribeUrl(row.id, appUrl),
      idempotencyKey: `${slot}:${row.id}`,
      locale,
      template: {
        id: "plan_reminder",
        props: {
          heading: place
            ? t(day ? "dayHeading" : "weekHeading", { destination: place })
            : t(day ? "dayHeadingNoPlace" : "weekHeadingNoPlace"),
          dates: formatDateRange(String(plan.start_date), plan.end_date as string | null, locale),
          intro: t(day ? "dayIntro" : "weekIntro"),
          ctaLabel: t("cta"),
          planUrl,
          footerReason: t("footerReason"),
          footerLink: t("footerLink"),
          locale,
        },
      },
      metadata: { slot },
      verify: planEmailCheck(place, planUrl),
    });
    return outcome.status;
  } catch (err) {
    console.error("[plan-reminders] not sent:", err instanceof Error ? err.message : err);
    return "error";
  }
}
