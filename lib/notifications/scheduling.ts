/**
 * Server-only helper for enqueueing the per-trip pre-trip cascade.
 *
 * Wraps the SECURITY DEFINER `enqueue_trip_notifications(trip_id, user_id)`
 * RPC (see supabase/migrations/20260601_scheduled_notifications.sql). The
 * RPC is idempotent: re-running it for the same trip wipes any
 * still-pending rows and re-inserts based on the current start_date —
 * which is exactly what we want for both "first save" and "start_date
 * changed via PATCH".
 *
 * Failure mode: best-effort. A failed enqueue logs to console + Sentry
 * but never re-throws to the caller. The originating action (a trip
 * save / update) must always succeed even when the reminder queue is
 * sick — missing one reminder cascade is strictly worse than a 500 on
 * the wizard.
 *
 * CAUSALITY (callers)
 * -------------------
 * - lib/trips/persistTrip.ts:insertTrip   — fire-and-forget after first INSERT
 * - app/api/trips/[id]/route.ts PATCH     — when start_date changes
 * - app/api/trips/[id]/save/route.ts (future) — when reminders_muted toggles
 *
 * The env flag NEXT_PUBLIC_CALENDAR_EXPORT_ENABLED gates the entire
 * smart-notifications + calendar-export bundle. When false, this helper
 * is a no-op (no DB write, no logging churn) so the queue doesn't fill
 * up during a soft launch.
 */

import { createAdminClient } from "@/lib/supabase/admin";

interface EnqueueArgs {
  tripId: string;
  userId: string;
}

interface EnqueueResult {
  ok: boolean;
  /** Number of slots inserted (0-5). 0 == muted / no start_date / past. */
  scheduledCount?: number;
  reason?: "disabled" | "rpc_error" | "exception";
}

/**
 * Returns true when the calendar-export bundle (Add-to-Calendar sheet,
 * .ics download, Google sync) is live. Mirrors the EXPLORE_UGC_ENABLED
 * gate pattern — env-only, server-side, sync. Defaults to false so a
 * code merge alone does NOT turn the feature on (PRD: rollout via
 * Vercel env flip).
 */
export function isCalendarExportEnabled(): boolean {
  // Server-side check uses the same env var the client reads; on
  // Vercel both flavours of the var are populated from the same
  // dashboard entry. Default closed.
  return process.env.NEXT_PUBLIC_CALENDAR_EXPORT_ENABLED === "true";
}

/**
 * Returns true when the smart pre-trip notification cascade is live.
 *
 * Decoupled from the calendar-export flag (F1 spec) so we can flip
 * notifications on/off independently — e.g. enable .ics download
 * without yet committing to the email cascade, or kill-switch the
 * cascade after a Resend complaint spike without dropping the
 * calendar sheet UI.
 *
 * Back-compat: when NEXT_PUBLIC_TRIP_NOTIFICATIONS_ENABLED is unset
 * we fall back to NEXT_PUBLIC_CALENDAR_EXPORT_ENABLED so the existing
 * single-flag deployments keep working. Once the explicit flag is set
 * in Vercel (either "true" or "false"), it wins.
 */
export function isTripNotificationsEnabled(): boolean {
  const explicit = process.env.NEXT_PUBLIC_TRIP_NOTIFICATIONS_ENABLED;
  if (explicit === "true") return true;
  if (explicit === "false") return false;
  return isCalendarExportEnabled();
}

/**
 * Enqueue (or re-enqueue) the 5-slot pre-trip cascade for a trip.
 * Idempotent — callers can invoke after every save / PATCH without
 * worrying about duplicates.
 */
export async function scheduleTripNotifications(
  args: EnqueueArgs
): Promise<EnqueueResult> {
  // Browser-side leak guard. lib/trips/persistTrip.ts is called from the
  // client wizard (NewTripWizard.tsx → persistTrip → scheduleTripNotifications)
  // and reaching createAdminClient() in the browser throws "Missing Supabase
  // admin credentials" because SUPABASE_SERVICE_ROLE_KEY is server-only
  // (correctly never shipped to the client). This was Sentry JAVASCRIPT-NEXTJS-11.
  //
  // Notification scheduling is a server-side concern; a no-op in the browser
  // is safe because (a) the existing try/catch already absorbs RPC failures,
  // (b) authenticated saves go through API routes server-side and re-trigger
  // this path with admin creds available, and (c) anonymous trips don't have
  // a user_id to notify anyway.
  if (typeof window !== "undefined") {
    return { ok: true, scheduledCount: 0, reason: "disabled" };
  }

  if (!isTripNotificationsEnabled()) {
    return { ok: true, scheduledCount: 0, reason: "disabled" };
  }

  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("enqueue_trip_notifications", {
      p_trip_id: args.tripId,
      p_user_id: args.userId,
    });

    if (error) {
      // Best-effort: log + Sentry, but never re-throw to the wizard.
      console.error("[notifications/scheduling] enqueue RPC failed", {
        tripId: args.tripId,
        userId: args.userId,
        error: error.message,
      });
      void captureSchedulingError(error, {
        stage: "rpc_call",
        tripId: args.tripId,
        userId: args.userId,
      });
      return { ok: false, reason: "rpc_error" };
    }

    const count = typeof data === "number" ? data : 0;
    return { ok: true, scheduledCount: count };
  } catch (err) {
    console.error("[notifications/scheduling] enqueue exception", {
      tripId: args.tripId,
      userId: args.userId,
      error: err instanceof Error ? err.message : String(err),
    });
    void captureSchedulingError(err, {
      stage: "exception",
      tripId: args.tripId,
      userId: args.userId,
    });
    return { ok: false, reason: "exception" };
  }
}

/**
 * Lazy Sentry capture — never blocks. Same pattern as lib/email/send.ts
 * so we don't pull @sentry/nextjs into the cold-start path.
 */
function captureSchedulingError(
  err: unknown,
  context: { stage: string; tripId: string; userId: string }
): Promise<void> {
  return import("@sentry/nextjs")
    .then((Sentry) => {
      Sentry.captureException?.(err, {
        tags: {
          source: "notifications/scheduling",
          stage: context.stage,
        },
        extra: {
          trip_id: context.tripId,
          user_id: context.userId,
        },
        level: "error",
      });
    })
    .catch(() => {
      /* Sentry unavailable — console.error already covers it. */
    });
}
