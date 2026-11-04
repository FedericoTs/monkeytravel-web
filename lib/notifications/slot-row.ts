/**
 * A row of the scheduled_notifications queue as the cron handles it: its slot, the
 * trip it is about, and how its outcome is written back.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import type { TripReminderSlot } from "@/lib/email/templates/TripReminder";
import { type TripFollowupSlot } from "@/lib/email/templates/TripFollowup";
import { FINISH_TRIP_SLOT } from "@/lib/notifications/finish-trip";

/** A queue row belongs to the post-trip family iff its slot says so. */
export function isFollowupSlot(slot: QueueSlot): slot is TripFollowupSlot {
  return slot.startsWith("followup_");
}

/**
 * Reject a string that is really an unresolved message key.
 *
 * next-intl does NOT throw on a missing message. Its default onError logs and
 * getMessageFallback substitutes the full key path, so the mail would still
 * send with "tripReminderEmail.morning_of.heading" where the sentence should
 * be, and the try/catch around getTranslations would never fire.
 *
 * So the send path cannot trust the translator. A value still carrying
 * "tripReminderEmail." is a fallback, never copy — no real sentence contains
 * it — and it must fail loudly instead of being delivered.
 */
export function assertTranslated(values: Record<string, string>): string | null {
  for (const [key, value] of Object.entries(values)) {
    // All three families are checked: each is loaded through the same
    // fallback-instead-of-throw translator.
    if (
      value.includes("tripReminderEmail.") ||
      value.includes("tripFollowupEmail.") ||
      value.includes("tripDayDigestEmail.")
    ) {
      return `${key} did not resolve (got "${value.slice(0, 80)}")`;
    }
  }
  return null;
}

/** Every slot the queue can hold — the pre-trip cascade, the post-trip
 * followups, the in-trip per-day digests (in_trip_day_<K>) and the
 * account-level finish-trip email. */
type QueueSlot =
  | TripReminderSlot
  | TripFollowupSlot
  | `in_trip_day_${number}`
  | typeof FINISH_TRIP_SLOT;

/**
 * Shape of the trip row the cron selects (processRow, in
 * app/api/cron/scheduled-notifications/route.ts).
 *
 * Declared by hand because that select string is built by
 * concatenation, so supabase-js sees a plain `string`, cannot parse it, and
 * types the whole row as GenericStringError. The JSON-valued fields are
 * `unknown` on purpose — they are model-generated and
 * lib/email/trip-context.ts validates them rather than trusting a declaration.
 */
export type TripEmailRow = {
  id: string;
  // title / start_date / end_date are NOT NULL in the trips schema.
  title: string;
  start_date: string;
  end_date: string;
  created_at: string;
  reminders_muted: boolean | null;
  status: string | null;
  deleted_at: string | null;
  itinerary: unknown;
  weather_note: string | null;
  highlights: unknown;
  packing_suggestions: unknown;
  day1: unknown;
  // For the participant digest fan-out: participants open the trip at
  // /shared/<token>, and their language is best-guessed from the trip.
  share_token: string | null;
  trip_locale: string | null;
  // The group ask: who the trip is for, and whether a share link exists.
  trip_intent: string | null;
  shared_at: string | null;
  // The dates the planner pencilled in, if it did (lib/trips/pencilled-dates.ts).
  dates_pencilled: unknown;
};

export type SlotRow = {
  id: string;
  user_id: string;
  trip_id: string;
  slot: QueueSlot;
  scheduled_for: string;
};

export async function persistOutcome(
  svc: ReturnType<typeof createAdminClient>,
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
  // A sent row is final. Without this guard, a second overlapping cron run
  // that reaches the same row gets "skipped_duplicate" back from the email
  // idempotency check and rewrites the row from 'sent' to 'suppressed' — and
  // a twin copy waiting on that row then sees no sent copy and sends the
  // email again under its own idempotency key.
  const { error: updErr } = await svc
    .from("scheduled_notifications")
    .update(patch)
    .eq("id", id)
    .neq("status", "sent");
  if (updErr) {
    console.error(
      "[cron/scheduled-notifs] outcome-update failed",
      { id, status, reason },
      updErr
    );
  }
}
