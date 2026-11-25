/**
 * need_10d: the pre-trip reminders' one question, "what do you still need for
 * this trip?" (lib/feedback/need.ts), as an email of its own ten days before
 * the trip, with the trip in its subject. It is asked once per person, not
 * once per trip, so these rules decide at send time whether a queued row still
 * goes. The row is queued by enqueue_need_ask (the *_need_question_email.sql
 * migration) and sent by ./slot-email.ts.
 */

import type { createAdminClient } from "@/lib/supabase/admin";
import { isMarketingOptedOut } from "@/lib/email/preferences";
import { needAnswerUrls } from "@/lib/email/reminder-cta";
import type { NeedAnswer } from "@/lib/feedback/need";
import { daysUntilStart } from "./queue";

type Svc = ReturnType<typeof createAdminClient>;

export const NEED_EMAIL_SLOT = "need_10d" as const;

/**
 * Days before the start it may still go: queued for ten, three either side.
 * Earlier means the date moved after the row was queued; later, the reminders
 * still to come ask the same question. The lower end is where
 * STALE_GRACE_DAYS.need_10d in ./queue.ts ends too.
 */
export const NEED_EMAIL_DAYS = { min: 7, max: 13 } as const;

/** Its email_log idempotency key: one per person, whichever trip asks. */
export function needEmailKey(userId: string): string {
  return `need_ask:${userId}`;
}

/**
 * Whether the trip's owner has answered the one question. The read the
 * reminders make before ending with it, so the email and the block agree.
 */
export async function tripNeedAnswered(
  svc: Svc,
  tripId: string
): Promise<{ answered: boolean; error?: string }> {
  const { data, error } = await svc
    .from("user_feedback")
    .select("id")
    .eq("extra->>trip_id", tripId)
    .not("extra->>need", "is", null)
    .limit(1);
  if (error) return { answered: false, error: error.message };
  return { answered: (data ?? []).length > 0 };
}

export type NeedEmailVerdict =
  | { send: true; answers: { need: NeedAnswer; url: string }[] }
  | { send: false; status: "suppressed" | "failed"; reason: string; error?: string };

/**
 * Whether a due need_10d row goes, with its signed one-tap answers when it
 * does. It never goes without them: the email is the question.
 *
 * Suppressed when the trip is outside NEED_EMAIL_DAYS, when the links can't be
 * signed, when the trip already has an answer, when the person has had this
 * email before (about any trip), or when they said no to marketing. A read
 * that fails fails the row instead: an extra question is never worth a send
 * nobody can vouch for.
 */
export async function needEmailVerdict(
  svc: Svc,
  row: { user_id: string },
  trip: { id: string; start_date: string },
  links: { appUrl: string; locale: string },
  now: Date
): Promise<NeedEmailVerdict> {
  const days = daysUntilStart(trip.start_date, now);
  if (days === null || days < NEED_EMAIL_DAYS.min || days > NEED_EMAIL_DAYS.max) {
    return { send: false, status: "suppressed", reason: "dates_moved" };
  }

  const answers = needAnswerUrls(NEED_EMAIL_SLOT, { ...links, tripId: trip.id, userId: row.user_id });
  if (!answers) return { send: false, status: "suppressed", reason: "links_unsigned" };

  const answered = await tripNeedAnswered(svc, trip.id);
  if (answered.error) {
    return { send: false, status: "failed", reason: "answer_read_error", error: answered.error };
  }
  if (answered.answered) return { send: false, status: "suppressed", reason: "trip_answered" };

  // Once per person. The queue's sent rows are the record read here: they stay
  // as long as the trip does, deleted or not, and they hold a send whose
  // email_log row was never written. dispatchEmail's own check on
  // needEmailKey covers the other way round, a send whose row was never
  // marked sent.
  const { data: asked, error: askedError } = await svc
    .from("scheduled_notifications")
    .select("id")
    .eq("user_id", row.user_id)
    .eq("slot", NEED_EMAIL_SLOT)
    .eq("status", "sent")
    .limit(1);
  if (askedError) {
    return { send: false, status: "failed", reason: "asked_read_error", error: askedError.message };
  }
  if ((asked ?? []).length > 0) return { send: false, status: "suppressed", reason: "already_asked" };

  // A question for us, not a reminder about their trip. dispatchEmail gates
  // trip_reminder on emailNotifications and tripReminders only, so the
  // marketing switch is read here.
  const { data: user, error: userError } = await svc
    .from("users")
    .select("notification_settings")
    .eq("id", row.user_id)
    .maybeSingle();
  if (userError) {
    return { send: false, status: "failed", reason: "settings_read_error", error: userError.message };
  }
  const settings = (user as { notification_settings?: unknown } | null)?.notification_settings;
  if (isMarketingOptedOut(settings)) {
    return { send: false, status: "suppressed", reason: "marketing_opted_out" };
  }

  return { send: true, answers };
}
