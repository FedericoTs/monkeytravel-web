/**
 * Push notification dispatcher (Phase B1).
 *
 * Single entry point for "send this notification to this user across
 * all of their active devices, log the result, suppress any tokens
 * that bounced." Call from anywhere — the existing notification
 * service, cron jobs, webhooks — without caring about APNs vs FCM.
 *
 * Architecture:
 *
 *   1. Look up active (non-suppressed) device tokens for the user
 *      via service-role Supabase client. (Caller's user-scoped
 *      client can't read other users' tokens; the dispatcher needs
 *      admin perms.)
 *   2. Split by platform (ios → APNs, android → FCM).
 *   3. Parallel send via Promise.allSettled — one device failing
 *      doesn't take down the rest.
 *   4. Suppress any token that returned a terminal error (single
 *      UPDATE with `IN (...)` for atomicity).
 *   5. Write a single push_log row with the aggregate sent/bounce
 *      counts.
 *   6. Return a DispatchResult for the caller's ack response.
 *
 * Failure modes:
 *   - Missing env (APNs not configured, FCM not configured) →
 *     skip that platform's tokens with skippedSuppressed counted.
 *     The function still returns ok if at least one platform
 *     succeeded for at least one device.
 *   - Supabase read failure → returns ok:false with error.
 *   - All devices bounced → returns ok:false with bounceCount>0.
 *
 * The dispatcher does NOT throw. All error paths return a
 * DispatchResult so callers can log + carry on. Pushing is
 * best-effort by definition — if it fails, the email + in-app bell
 * notifications still went through.
 */

import { createClient as createServiceClient } from "@supabase/supabase-js";
import { sendApns, isApnsConfigured } from "./apns";
import { sendFcm, isFcmConfigured } from "./fcm";
import type {
  NotificationPayload,
  DispatchResult,
  DeviceTokenRow,
} from "./types";

/**
 * Lazy service-role client. Cached at module scope so we don't
 * re-construct on every dispatch; the supabase-js client is cheap
 * but allocates a few hundred bytes of internal state per instance.
 *
 * Untyped Database — the repo doesn't ship generated types yet, so
 * .insert/.update return `never` for unknown tables. We cast at use
 * sites with `as never` (the supabase-js v2 type-system narrowing)
 * — runtime is unaffected, validation still happens via the explicit
 * payload shape we pass in.
 */
let cachedServiceClient: ReturnType<typeof createServiceClient> | null = null;
function getServiceClient(): ReturnType<typeof createServiceClient> {
  if (cachedServiceClient) return cachedServiceClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "Supabase service-role client unavailable (missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)"
    );
  }
  cachedServiceClient = createServiceClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cachedServiceClient;
}

/**
 * Send the given notification to every active device the user owns.
 *
 * Idempotency: each call inserts one push_log row. Multiple calls
 * with the same userId+notificationType+payload produce multiple
 * rows. If you need de-dup, hash the payload + check before calling.
 */
export async function dispatchPush(
  userId: string,
  payload: NotificationPayload
): Promise<DispatchResult> {
  const result: DispatchResult = {
    notificationType: payload.type,
    userId,
    sentCount: 0,
    bounceCount: 0,
    skippedSuppressed: 0,
    ok: false,
  };

  let supabase: ReturnType<typeof getServiceClient>;
  try {
    supabase = getServiceClient();
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    return result;
  }

  // Pull active tokens. The partial index device_tokens_user_id_active_idx
  // covers this exact query.
  const { data: tokens, error: tokensError } = await supabase
    .from("device_tokens")
    .select("id, user_id, token, platform, app_version, locale, created_at, last_seen_at, suppressed_at")
    .eq("user_id", userId)
    .is("suppressed_at", null);

  if (tokensError) {
    result.error = `device_tokens read failed: ${tokensError.message}`;
    return result;
  }

  if (!tokens || tokens.length === 0) {
    // No active devices — return ok:false with zero counts. Caller
    // can log this for funnel analysis ("X% of users have no
    // active push token") without treating it as an error.
    result.ok = false;
    result.error = "no_active_devices";
    return result;
  }

  // Skip platforms with no provider configured. Better to be loud
  // about it in the log so deploy-time misconfig is caught.
  const apnsReady = isApnsConfigured();
  const fcmReady = isFcmConfigured();

  // Per-platform parallel send. Collect the per-token outcome so we
  // can both (a) suppress terminally-failed tokens in one UPDATE and
  // (b) count totals for push_log.
  const sendPromises = (tokens as DeviceTokenRow[]).map(async (row) => {
    if (row.platform === "ios") {
      if (!apnsReady) {
        return { row, ok: false, terminal: false, skipped: true, reason: "apns_not_configured" };
      }
      const r = await sendApns(row.token, payload);
      return { row, ...r, skipped: false };
    }
    if (row.platform === "android") {
      if (!fcmReady) {
        return { row, ok: false, terminal: false, skipped: true, reason: "fcm_not_configured" };
      }
      const r = await sendFcm(row.token, payload);
      return { row, ...r, skipped: false };
    }
    // Unrecognized platform — defensive.
    return { row, ok: false, terminal: false, skipped: true, reason: `unknown_platform: ${row.platform}` };
  });

  const settled = await Promise.allSettled(sendPromises);

  const terminalIds: string[] = [];
  for (const outcome of settled) {
    if (outcome.status === "rejected") {
      // Should never happen — sendApns/sendFcm catch their own errors
      // and return a result object. Belt-and-braces: count as bounce.
      result.bounceCount += 1;
      continue;
    }
    const { row, ok, terminal, skipped } = outcome.value;
    if (skipped) {
      result.skippedSuppressed += 1;
      continue;
    }
    if (ok) {
      result.sentCount += 1;
    } else {
      result.bounceCount += 1;
      if (terminal) terminalIds.push(row.id);
    }
  }

  // Atomic batch-suppress. One UPDATE for all terminally-failed
  // tokens beats N round-trips when a large user's devices all
  // bounce at once (rare but real — user signed out everywhere).
  if (terminalIds.length > 0) {
    const { error: suppressError } = await supabase
      .from("device_tokens")
      // `as never` works around the unprovided Database type — the
      // base supabase-js client narrows .update/.insert to `never`
      // for unknown tables. Runtime is unaffected; the payload shape
      // matches the migration's column definitions.
      .update({ suppressed_at: new Date().toISOString() } as never)
      .in("id", terminalIds);
    if (suppressError) {
      // Don't fail the dispatch over this — we already sent the
      // successes. Log so it shows up in Sentry.
      // eslint-disable-next-line no-console
      console.error(
        "[push.dispatch] failed to suppress bounced tokens:",
        suppressError
      );
    }
  }

  // Single push_log row aggregating this dispatch attempt. Same
  // `as never` cast rationale as above — see the comment on the
  // suppressed_at update.
  const { error: logError } = await supabase.from("push_log").insert({
    user_id: userId,
    notification_type: payload.type,
    payload: payload as unknown as Record<string, unknown>,
    sent_count: result.sentCount,
    bounce_count: result.bounceCount,
  } as never);
  if (logError) {
    // eslint-disable-next-line no-console
    console.error("[push.dispatch] push_log insert failed:", logError);
  }

  result.ok = result.sentCount > 0;
  return result;
}

/**
 * Convenience helper: send to a specific list of user IDs (e.g. all
 * collaborators on a trip). Returns per-user results. Sequential
 * because each user's dispatch is itself parallel across their
 * devices — going parallel here would spike concurrent APNs/FCM
 * requests beyond what the providers throttle to.
 *
 * For very large user sets (>50), prefer a queue (Vercel cron +
 * task table). This helper is for the common <10-user collab cases.
 */
export async function dispatchPushToUsers(
  userIds: string[],
  payload: NotificationPayload
): Promise<DispatchResult[]> {
  const results: DispatchResult[] = [];
  for (const userId of userIds) {
    results.push(await dispatchPush(userId, payload));
  }
  return results;
}
