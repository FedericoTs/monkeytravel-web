/**
 * POST /api/webhooks/resend
 *
 * Receives Resend's delivery-event webhooks (bounces, complaints, opens)
 * and reflects them into the email_log table so subsequent sends can
 * suppress already-bounced/complained addresses (see lib/email/send.ts
 * step 2 — suppression read).
 *
 * Why this exists (task #218): without this endpoint, lib/email/send.ts
 * never learns that a recipient bounced, so we'd keep emailing dead
 * addresses indefinitely. Two bounces per 100 sends gets the entire
 * sending domain throttled by Gmail/Outlook; one complaint per 1000
 * permanently flags the sender. Bounce/complaint tracking is the
 * single biggest deliverability lever once volume scales.
 *
 * Resend uses Svix-style webhook signatures (HMAC-SHA256 over
 * `${svix-id}.${svix-timestamp}.${raw-body}` with the secret's base64
 * payload). We verify in-process — no `svix` dependency.
 *
 * Setup checklist (done outside this file):
 *   1. Generate a secret: in Resend dashboard → Webhooks → Add endpoint.
 *      Use https://monkeytravel.app/api/webhooks/resend as the URL.
 *      Subscribe to: email.bounced, email.complained, email.opened,
 *      contact.updated, contact.deleted.
 *   2. Copy the secret (format: whsec_<base64>) → Vercel env
 *      `RESEND_WEBHOOK_SECRET` for production.
 *   3. (Optional) Same secret for preview deployments if you want
 *      bounce tracking in staging.
 *
 * Events we handle:
 *   email.bounced     → set status='bounced',    bounced_at=NOW()
 *   email.complained  → set status='complained', complained_at=NOW()
 *                       AND notification_settings.marketingNotifications=false
 *                       (a spam complaint is a hard, cross-channel opt-out)
 *   email.opened      → set opened_at=NOW() if not set
 *   contact.updated   → if unsubscribed, set notification_settings
 *   contact.deleted     .marketingNotifications=false — mirrors a native
 *                       Resend unsubscribe into our DB so app-path sends
 *                       honour it too (single source of truth).
 *
 * Events we ack but ignore: email.sent, email.delivered, email.delivery_delayed,
 * email.clicked. We already track sent at dispatch time; delayed isn't
 * actionable; clicks aren't in scope.
 *
 * Always returns 200 unless the signature itself fails (401), so Resend
 * doesn't retry forever on schema/logic mismatches. Errors are captured
 * to Sentry for follow-up.
 */

import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";

const WEBHOOK_SECRET = process.env.RESEND_WEBHOOK_SECRET;

/**
 * Verify a Svix-style signature. Returns true if any of the comma-separated
 * `v1,...` signatures in the header matches our HMAC.
 *
 * Spec: https://docs.svix.com/receiving/verifying-payloads/how-manual
 *   signed_content = `${svix_id}.${svix_timestamp}.${body}`
 *   expected = base64(hmacSha256(secret_bytes, signed_content))
 *   header   = "v1,<expected> v1,<old_secret_expected>"
 *
 * We do constant-time comparison to avoid timing attacks. Multiple
 * signatures in the header are tested in turn (Svix supports secret
 * rotation by including both old and new HMACs).
 */
function verifySvixSignature(
  rawBody: string,
  svixId: string,
  svixTimestamp: string,
  svixSignatureHeader: string,
  secret: string
): boolean {
  // Svix secret format: whsec_<base64-encoded-bytes>
  const secretParts = secret.split("_");
  if (secretParts.length !== 2 || secretParts[0] !== "whsec") {
    console.error(
      "[resend-webhook] RESEND_WEBHOOK_SECRET must be in whsec_<base64> format"
    );
    return false;
  }
  let secretBytes: Buffer;
  try {
    secretBytes = Buffer.from(secretParts[1], "base64");
  } catch {
    console.error(
      "[resend-webhook] RESEND_WEBHOOK_SECRET base64 portion failed to decode"
    );
    return false;
  }

  const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`;
  const expectedSignature = createHmac("sha256", secretBytes)
    .update(signedContent)
    .digest("base64");

  // Header can carry multiple "v1,sig" pairs separated by spaces. Try each.
  const presented = svixSignatureHeader.split(" ");
  for (const sig of presented) {
    const [version, value] = sig.split(",");
    if (version !== "v1" || !value) continue;
    // timingSafeEqual requires equal-length buffers; bail early on mismatch.
    const presentedBuf = Buffer.from(value, "base64");
    const expectedBuf = Buffer.from(expectedSignature, "base64");
    if (presentedBuf.length !== expectedBuf.length) continue;
    if (timingSafeEqual(presentedBuf, expectedBuf)) {
      return true;
    }
  }
  return false;
}

/**
 * Webhook payload shape (the subset we read). Resend mirrors Svix's
 * envelope: `{ type, created_at, data }`. We type only what we read
 * to keep the surface small.
 */
interface ResendWebhookPayload {
  type:
    | "email.sent"
    | "email.delivered"
    | "email.bounced"
    | "email.complained"
    | "email.opened"
    | "email.clicked"
    | "email.delivery_delayed"
    | "contact.updated"
    | "contact.deleted"
    | string;
  data?: {
    email_id?: string;
    to?: string[];
    // contact.* events carry the contact's own email + opt-out flag
    email?: string;
    unsubscribed?: boolean;
    [k: string]: unknown;
  };
}

/**
 * Mirror a marketing opt-out into OUR source of truth
 * (users.notification_settings.marketingNotifications=false) so the app's own
 * send path honours a Resend-side unsubscribe/complaint too. Without this the
 * two channels disagree and an app-path send could re-email someone who
 * unsubscribed via a Resend email. Read-modify-write is fine at webhook
 * volume; we merge so every other notification preference is preserved.
 */
async function optOutMarketing(
  admin: ReturnType<typeof createAdminClient>,
  email: string
): Promise<{ ok: boolean; alreadyOff?: boolean; reason?: string }> {
  const e = email.toLowerCase().trim();
  if (!e) return { ok: false, reason: "empty email" };
  const { data: user, error } = await admin
    .from("users")
    .select("id, notification_settings")
    .ilike("email", e)
    .maybeSingle();
  if (error) return { ok: false, reason: error.message };
  if (!user) return { ok: false, reason: "no matching user" };
  const ns = (user.notification_settings ?? {}) as Record<string, unknown>;
  if (ns.marketingNotifications === false) return { ok: true, alreadyOff: true };
  const { error: updErr } = await admin
    .from("users")
    .update({ notification_settings: { ...ns, marketingNotifications: false } })
    .eq("id", user.id);
  if (updErr) return { ok: false, reason: updErr.message };
  return { ok: true };
}

export async function POST(request: NextRequest) {
  // Read the raw body BEFORE parsing — Svix signs the exact bytes, so we
  // must use the same string for verification AND JSON.parse.
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch (err) {
    console.error("[resend-webhook] failed to read body", err);
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  // Signature verification — fail closed if the secret isn't configured
  // so an unconfigured webhook can't silently accept unsigned payloads
  // from a forgery attempt.
  if (!WEBHOOK_SECRET) {
    console.error(
      "[resend-webhook] RESEND_WEBHOOK_SECRET not set — rejecting webhook"
    );
    return NextResponse.json({ error: "not configured" }, { status: 503 });
  }

  const svixId = request.headers.get("svix-id");
  const svixTimestamp = request.headers.get("svix-timestamp");
  const svixSignature = request.headers.get("svix-signature");
  if (!svixId || !svixTimestamp || !svixSignature) {
    return NextResponse.json(
      { error: "missing svix headers" },
      { status: 401 }
    );
  }

  // Reject replays: Svix recommends rejecting messages older than 5 min.
  const tsSec = Number(svixTimestamp);
  if (!Number.isFinite(tsSec)) {
    return NextResponse.json(
      { error: "invalid svix-timestamp" },
      { status: 401 }
    );
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - tsSec) > 5 * 60) {
    console.warn(
      "[resend-webhook] rejecting stale webhook",
      { svixId, tsSec, nowSec }
    );
    return NextResponse.json({ error: "stale" }, { status: 401 });
  }

  const isValid = verifySvixSignature(
    rawBody,
    svixId,
    svixTimestamp,
    svixSignature,
    WEBHOOK_SECRET
  );
  if (!isValid) {
    console.warn("[resend-webhook] invalid signature", { svixId });
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  // Parse the validated payload.
  let payload: ResendWebhookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch (err) {
    console.error("[resend-webhook] JSON parse failed after sig pass", err);
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const eventType = payload.type;
  const messageId = payload.data?.email_id ?? null;
  const recipients = Array.isArray(payload.data?.to) ? payload.data!.to! : [];

  // Always log the event arrival so we can debug missing updates later.
  // Vercel log search keys on the prefix.
  console.log(
    "[resend-webhook]",
    JSON.stringify({
      type: eventType,
      message_id: messageId,
      recipients_count: recipients.length,
      svix_id: svixId,
    })
  );

  // Map event → status update. Anything we don't handle gets an
  // acknowledged 200 so Resend doesn't retry. We intentionally do NOT
  // throw for unknown types — Resend adds new event types over time and
  // we don't want each addition to look like an outage in their dashboard.
  const admin = createAdminClient();

  // Native Resend unsubscribe (one-click / List-Unsubscribe) and contact
  // deletion arrive as contact.* events, not email.* — mirror the opt-out
  // into notification_settings so app-path sends honour it too. (Requires
  // the webhook subscription to include contact.updated / contact.deleted.)
  if (eventType === "contact.updated" || eventType === "contact.deleted") {
    const contactEmail =
      typeof payload.data?.email === "string" ? payload.data.email : null;
    const unsubscribed =
      eventType === "contact.deleted" || payload.data?.unsubscribed === true;
    if (contactEmail && unsubscribed) {
      const r = await optOutMarketing(admin, contactEmail);
      if (!r.ok) {
        console.error("[resend-webhook] contact opt-out sync failed", r.reason);
      }
      return NextResponse.json({ recorded: "marketing_opt_out", ...r });
    }
    return NextResponse.json({ ok: true, ignored: eventType });
  }

  // Map email.* event → email_log status update.
  let targetStatus: "bounced" | "complained" | null = null;
  let openedOnly = false;
  switch (eventType) {
    case "email.bounced":
      targetStatus = "bounced";
      break;
    case "email.complained":
      targetStatus = "complained";
      break;
    case "email.opened":
      openedOnly = true;
      break;
    default:
      // Acknowledge silently — sent/delivered/clicked/etc.
      return NextResponse.json({ ok: true, ignored: eventType });
  }

  // A spam complaint is the strongest opt-out signal there is: stop ALL
  // marketing to this address across every channel, not just suppress this
  // one message. Mirror it into notification_settings immediately.
  if (targetStatus === "complained") {
    for (const recipient of recipients) {
      const r = await optOutMarketing(admin, recipient);
      if (!r.ok && !r.alreadyOff) {
        console.error(
          "[resend-webhook] complaint opt-out sync failed",
          recipient,
          r.reason
        );
      }
    }
  }

  // Resolve the email_log row. Prefer message_id (set by sendEmail) since
  // it's a 1:1 match with Resend's email_id. Fall back to a recipient +
  // status='sent' match for backward compatibility — older rows may pre-
  // date message_id population.

  try {
    if (openedOnly) {
      // Best-effort open tracking. Only update if message_id matches AND
      // opened_at is currently null (don't overwrite an earlier open).
      if (messageId) {
        const { error } = await admin
          .from("email_log")
          .update({ opened_at: new Date().toISOString() })
          .eq("message_id", messageId)
          .is("opened_at", null);
        if (error) {
          console.error(
            "[resend-webhook] opened_at update failed",
            error
          );
        }
      }
      return NextResponse.json({ ok: true, recorded: "opened" });
    }

    // Bounce or complaint — flip the row's status and timestamp the event.
    // This drives the suppression check at the top of dispatchEmail; once
    // status is 'bounced' or 'complained' any future send to the same
    // address is short-circuited with skipped_suppressed.
    const updateColumn = targetStatus === "bounced" ? "bounced_at" : "complained_at";
    const updateValue = new Date().toISOString();

    if (messageId) {
      const { data: updated, error: updErr } = await admin
        .from("email_log")
        .update({ status: targetStatus, [updateColumn]: updateValue })
        .eq("message_id", messageId)
        .select("id, recipient_email");
      if (updErr) {
        console.error(
          "[resend-webhook] status update failed",
          updErr
        );
      } else if (updated && updated.length > 0) {
        return NextResponse.json({
          ok: true,
          recorded: targetStatus,
          rows: updated.length,
        });
      }
    }

    // Fallback: synthesize a row keyed on the recipient so future sends
    // honor suppression even when we don't have a matching log row (e.g.
    // pre-webhook-era message, or message_id mismatch). One row per
    // recipient + event type — duplicate inserts are benign.
    if (recipients.length > 0) {
      const inserts = recipients.map((recipient) => ({
        recipient_email: recipient.toLowerCase().trim(),
        template_id: "unknown",
        status: targetStatus!,
        message_id: messageId,
        [updateColumn]: updateValue,
        metadata: { source: "resend-webhook", svix_id: svixId },
      }));
      const { error: insErr } = await admin.from("email_log").insert(inserts);
      if (insErr) {
        console.error(
          "[resend-webhook] suppression row insert failed",
          insErr
        );
      }
    }

    return NextResponse.json({
      ok: true,
      recorded: targetStatus,
      via: "fallback",
    });
  } catch (err) {
    console.error("[resend-webhook] unexpected error", err);
    // 200 anyway — Resend retries on 5xx, but the error is in our logs +
    // Sentry. A retry storm against a broken handler would just amplify
    // the problem. Better to drop one event than to flood.
    try {
      const Sentry = await import("@sentry/nextjs");
      Sentry.captureException(err, {
        tags: { source: "resend-webhook", event_type: eventType },
        extra: { svix_id: svixId, message_id: messageId },
      });
    } catch {
      /* Sentry unavailable */
    }
    return NextResponse.json({ ok: true, error: "internal" });
  }
}
