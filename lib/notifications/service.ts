/**
 * Server-only notification service.
 *
 * Two entry points:
 *   - enqueueNotification(): writes a row to `notifications`. Called from
 *     API routes that detect events (vote cast, proposal created, etc.).
 *     Always uses the service-role client because the table's RLS forbids
 *     client-side inserts (anyone can't fabricate a notification for
 *     someone else).
 *   - listNotifications(): user-scoped read used by the bell dropdown.
 *
 * Failure mode: enqueue is best-effort. If the insert fails we log + swallow
 * so the originating API request doesn't 500. A missed bell ping is a
 * worse-than-zero outcome but it's strictly better than failing the vote.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { dispatchEmail } from "@/lib/email/send";
import { dispatchPush } from "@/lib/push/dispatch";
import type {
  NotificationPayload as PushPayload,
  NotificationType as PushNotificationType,
} from "@/lib/push/types";
import type {
  NotificationPayload,
  NotificationRow,
  NotificationType,
} from "./types";

interface EnqueueArgs {
  userId: string;
  notification: NotificationPayload;
}

/**
 * Insert a notification for `userId`. Always succeeds from the caller's
 * perspective — internal errors are logged and swallowed so we never break
 * the originating user action (e.g. a vote should not 500 because a bell
 * ping failed).
 */
export async function enqueueNotification({
  userId,
  notification,
}: EnqueueArgs): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: inserted, error } = await admin
      .from("notifications")
      .insert({
        user_id: userId,
        type: notification.type,
        payload: notification.data,
      })
      .select("id")
      .single();
    if (error) {
      console.error("[notifications] enqueue failed", {
        userId,
        type: notification.type,
        error: error.message,
      });
      return;
    }

    // Fire-and-forget email dispatch. Right now only collab_vote has an
    // email template (more land as we build them). The dispatch helper
    // self-skips if no template / opted-out / no API key.
    void dispatchEmailForNotification({
      notificationId: inserted?.id,
      userId,
      notification,
    });

    // Fire-and-forget push dispatch. Self-skips if push not configured
    // (APNS_* / FCM_* env unset) or user has no active devices. Same
    // best-effort pattern as email — never fails the upstream action
    // for a missing tap notification.
    void dispatchPushForNotification({
      userId,
      notification,
    });
  } catch (err) {
    console.error("[notifications] enqueue exception", {
      userId,
      type: notification.type,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * For a freshly-inserted notification row, look up the recipient's email
 * + display name and dispatch the corresponding template (if any). Best-
 * effort — failures log but never re-throw to the originating route.
 */
async function dispatchEmailForNotification(args: {
  notificationId: string | undefined;
  userId: string;
  notification: NotificationPayload;
}): Promise<void> {
  // Only collab_vote has an email template at the moment. Adding more
  // types here is a 5-line patch + a new template file.
  if (args.notification.type !== "collab_vote") return;

  try {
    const admin = createAdminClient();
    const { data: profile } = await admin
      .from("users")
      .select("email, display_name, preferred_language")
      .eq("id", args.userId)
      .maybeSingle();

    // No email on file (rare — only happens for users we created from a
    // social-only signup without ever capturing email). Nothing to do.
    if (!profile?.email) return;

    const data = args.notification.data;
    const APP_URL =
      process.env.NEXT_PUBLIC_APP_URL || "https://monkeytravel.app";

    await dispatchEmail({
      recipientEmail: profile.email,
      recipientUserId: args.userId,
      idempotencyKey: args.notificationId
        ? `notification:${args.notificationId}`
        : undefined,
      template: {
        id: "vote_cast",
        props: {
          voterName: data.voter_name,
          tripTitle: "", // We don't have the trip title in the payload; fall back to destination
          tripDestination: data.trip_id, // payload doesn't carry destination; safe fallback
          voteType:
            data.vote_type === "up"
              ? "love"
              : data.vote_type === "down"
                ? "no"
                : "love",
          activityLabel: data.activity_label,
          tripUrl: `${APP_URL}${data.href || `/trips/${data.trip_id}/edit`}`,
        },
      },
      metadata: { notification_id: args.notificationId },
    });
  } catch (err) {
    console.error("[notifications] email dispatch exception", {
      notificationId: args.notificationId,
      userId: args.userId,
      type: args.notification.type,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * For a freshly-inserted notification row, fan out to push if the user
 * has any active iOS/Android device tokens. Maps the existing
 * notification payload shape to the push wire format (title, body,
 * data.url) — per-type because the user-facing copy differs by
 * notification type and we want push messages to read naturally, not
 * mechanically.
 *
 * Best-effort. Logs + swallows; never re-throws into the originating
 * route. Self-skips if isApnsConfigured() + isFcmConfigured() both
 * return false (no env wired), if user has no active devices, or if
 * the notification type is one we haven't decided to push yet.
 *
 * Adding a new notification type → add a case to the switch below
 * + ensure the corresponding NotificationType literal is in
 * lib/push/types.ts. The push types stay narrower than the bell
 * types intentionally: not everything that warrants a bell ping
 * warrants a phone buzz.
 */
async function dispatchPushForNotification(args: {
  userId: string;
  notification: NotificationPayload;
}): Promise<void> {
  try {
    const APP_URL =
      process.env.NEXT_PUBLIC_APP_URL || "https://monkeytravel.app";
    // Map (bell type → push payload). Returns null for bell types we
    // don't push (e.g. system messages — those are read in-app, no
    // value buzzing the user's phone).
    let push: PushPayload | null = null;
    switch (args.notification.type) {
      case "collab_vote": {
        const d = args.notification.data;
        push = {
          // Reuse the bell type as the push type — they're the same
          // event from the user's POV. Add a matching literal to
          // lib/push/types.ts when a new bell type starts pushing.
          type: "collab_activity_added" as PushNotificationType,
          title: `${d.voter_name} voted`,
          body: `${d.vote_type === "up" ? "👍" : "👎"} on "${d.activity_label}"`,
          sound: "default",
          data: {
            url: d.href ?? `/trips/${d.trip_id}/edit`,
            tripId: d.trip_id,
          },
        };
        break;
      }
      case "collab_proposal": {
        const d = args.notification.data;
        push = {
          type: "collab_activity_added" as PushNotificationType,
          title: `${d.proposer_name} proposed an activity`,
          body: `Day ${d.day_number}: ${d.proposed_activity}`,
          sound: "default",
          data: {
            url: d.href ?? `/trips/${d.trip_id}/edit`,
            tripId: d.trip_id,
          },
        };
        break;
      }
      case "invite_accepted": {
        const d = args.notification.data;
        push = {
          type: "collab_activity_added" as PushNotificationType,
          title: `${d.collaborator_name} joined your trip`,
          body: "They can now view + edit the itinerary.",
          sound: "default",
          data: {
            url: d.href ?? `/trips/${d.trip_id}`,
            tripId: d.trip_id,
          },
        };
        break;
      }
      case "anon_vote": {
        // Crew Loop: an anonymous share-link visitor cast their first vote
        // on this trip. Same push shape as collab_vote — the owner-facing
        // story is identical ("someone reacted to your plan").
        const d = args.notification.data;
        push = {
          type: "collab_activity_added" as PushNotificationType,
          title: d.tripName
            ? `New crew vote on ${d.tripName}`
            : "New crew vote on your trip",
          body: `${d.voterName ?? "Someone"} voted ${d.voteType === "up" ? "👍" : "👎"} on your shared itinerary`,
          sound: "default",
          data: {
            url: d.href ?? `/trips/${d.tripId}`,
            tripId: d.tripId,
          },
        };
        break;
      }
      // collab_comment, trip_shared, system → bell-only for now.
      // Adding push is one switch case + a new literal in push/types.
      default:
        return;
    }

    if (!push) return;

    const result = await dispatchPush(args.userId, push);
    if (!result.ok && result.error && result.error !== "no_active_devices") {
      // Log non-trivial failures. "no_active_devices" is expected for
      // every web-only user — silent.
      console.warn("[notifications] push dispatch incomplete", {
        userId: args.userId,
        type: args.notification.type,
        error: result.error,
        sent: result.sentCount,
        bounce: result.bounceCount,
      });
    }
  } catch (err) {
    console.error("[notifications] push dispatch exception", {
      userId: args.userId,
      type: args.notification.type,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

interface ListOptions {
  /** Include rows the user has marked read. Default false (unread only). */
  includeRead?: boolean;
  /** Max rows. Default 20, max 100. */
  limit?: number;
}

interface ListResult {
  notifications: NotificationRow[];
  unreadCount: number;
}

/**
 * List the calling user's notifications + their unread count. Returns the
 * empty list (not an error) for anonymous callers — keeps the bell UI
 * trivial on the client side.
 */
export async function listNotifications(
  options: ListOptions = {}
): Promise<ListResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { notifications: [], unreadCount: 0 };
  }

  const limit = Math.min(100, Math.max(1, options.limit ?? 20));

  let query = supabase
    .from("notifications")
    .select("*")
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (!options.includeRead) {
    query = query.is("read_at", null);
  }

  const [{ data: rows, error }, { count: unreadCount, error: countErr }] =
    await Promise.all([
      query,
      supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .is("deleted_at", null)
        .is("read_at", null),
    ]);

  if (error || countErr) {
    console.error("[notifications] list failed", {
      userId: user.id,
      error: error?.message ?? countErr?.message,
    });
    return { notifications: [], unreadCount: 0 };
  }

  return {
    notifications: (rows ?? []) as NotificationRow[],
    unreadCount: unreadCount ?? 0,
  };
}

/**
 * Mark a single notification read. RLS ensures the row must belong to the
 * calling user.
 */
export async function markRead(id: string): Promise<{ ok: boolean }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false };

  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) {
    console.error("[notifications] markRead failed", id, error.message);
    return { ok: false };
  }
  return { ok: true };
}

/**
 * Mark every unread notification for the calling user as read in one shot
 * — used by the "Mark all read" button at the top of the dropdown.
 */
export async function markAllRead(): Promise<{ ok: boolean; updated: number }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, updated: 0 };

  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("notifications")
    .update({ read_at: nowIso })
    .eq("user_id", user.id)
    .is("read_at", null)
    .select("id");

  if (error) {
    console.error("[notifications] markAllRead failed", error.message);
    return { ok: false, updated: 0 };
  }
  return { ok: true, updated: data?.length ?? 0 };
}

/**
 * Re-export the type names for callers that only need the discriminator
 * without pulling in the full payload union.
 */
export type { NotificationType };
