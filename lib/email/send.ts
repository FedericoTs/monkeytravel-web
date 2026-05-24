/**
 * Email send orchestrator.
 *
 * Sits between the application (notifications service, invite API) and
 * the low-level Resend client. Handles:
 *   - Template rendering (React Email → HTML + plain text)
 *   - Opt-out checks (users.notification_settings)
 *   - Suppression checks (previously bounced/complained)
 *   - email_log lifecycle: insert 'queued' → update 'sent'/'failed'/'skipped_*'
 *   - Idempotency dedupe (same source notification = single send)
 *
 * Every callable here returns a stable `SendOutcome` regardless of what
 * went wrong — the caller never has to wrap in try/catch. A failed email
 * is always less bad than a failed user-facing action.
 */

import { render } from "@react-email/render";
import { sendEmail } from "./client";
import { createAdminClient } from "@/lib/supabase/admin";
import InviteEmail, {
  inviteEmailText,
  type InviteEmailProps,
} from "./templates/Invite";
import VoteCastEmail, {
  voteCastEmailText,
  type VoteCastEmailProps,
} from "./templates/VoteCast";
import { buildUnsubscribeUrl, type UnsubKey } from "./unsubscribe";

export type EmailTemplate =
  | { id: "invite"; props: InviteEmailProps }
  | { id: "vote_cast"; props: VoteCastEmailProps };

/** Stable outcome shape. */
export interface SendOutcome {
  ok: boolean;
  /** What we did with this send attempt — drives email_log.status. */
  status:
    | "sent"
    | "skipped_no_key"
    | "skipped_disabled"
    | "skipped_suppressed"
    | "skipped_duplicate"
    | "failed";
  messageId?: string;
  error?: string;
}

interface DispatchOptions {
  /** Recipient email — lowercased + trimmed automatically. */
  recipientEmail: string;
  template: EmailTemplate;
  /**
   * For opt-out checks. If supplied, we look up the user's
   * notification_settings and apply the relevant per-type toggle.
   * Pass `null` for transactional sends (invites, account emails)
   * where opt-out doesn't apply.
   */
  recipientUserId: string | null;
  /**
   * Stable identifier from the source event (e.g. notification.id,
   * trip_invite.id). Same key = same logical send = dedupe.
   */
  idempotencyKey?: string;
  /** Extra metadata persisted to email_log.metadata. */
  metadata?: Record<string, unknown>;
}

const NOTIFICATION_SETTING_KEY: Record<EmailTemplate["id"], string | null> = {
  // Invites are transactional — no opt-out. The user being invited didn't
  // sign up for our notification settings UI; they should always get the
  // first invite.
  invite: null,
  // Vote-cast is collaboration — gated by emailNotifications + collabVotes
  vote_cast: "collabVotes",
};

/**
 * Per-template unsubscribe-key mapping. When we have a user_id AND the
 * unsubscribe secret is configured, the orchestrator mints a one-click
 * unsubscribe URL with this key and passes it into the template's
 * footer. Falsy = template doesn't get a tokenized link (still falls
 * back to /profile/notifications in the layout).
 */
const UNSUB_KEY: Record<EmailTemplate["id"], UnsubKey | null> = {
  invite: null, // transactional — recipient may not have an account yet
  vote_cast: "collabVotes",
};

/**
 * Dispatch one email. Renders, checks opt-out, logs, sends. Idempotent
 * across calls with the same idempotencyKey.
 */
export async function dispatchEmail(
  options: DispatchOptions
): Promise<SendOutcome> {
  const recipient = options.recipientEmail.trim().toLowerCase();
  const admin = createAdminClient();

  // 1. Idempotency check — if we already have a 'sent' or 'queued' row
  //    for this key, short-circuit. The partial unique index on
  //    email_log enforces this at the DB layer too; we check first to
  //    return the right outcome shape.
  if (options.idempotencyKey) {
    const { data: existing } = await admin
      .from("email_log")
      .select("id, status, message_id")
      .eq("idempotency_key", options.idempotencyKey)
      .in("status", ["sent", "queued"])
      .maybeSingle();
    if (existing) {
      return {
        ok: true,
        status: "skipped_duplicate",
        messageId: existing.message_id || undefined,
      };
    }
  }

  // 2. Suppression check — has this address previously bounced or
  //    complained? Never re-send to them.
  const { data: suppressed } = await admin
    .from("email_log")
    .select("id")
    .eq("recipient_email", recipient)
    .in("status", ["bounced", "complained"])
    .limit(1);
  if (suppressed && suppressed.length > 0) {
    await admin.from("email_log").insert({
      recipient_email: recipient,
      template_id: options.template.id,
      status: "skipped_suppressed",
      idempotency_key: options.idempotencyKey ?? null,
      metadata: options.metadata ?? {},
    });
    return { ok: true, status: "skipped_suppressed" };
  }

  // 3. Opt-out check (only for non-transactional templates and only when
  //    we have a recipient user). Transactional emails (invites) skip
  //    this — being explicitly invited overrides general opt-out.
  const settingKey = NOTIFICATION_SETTING_KEY[options.template.id];
  if (settingKey && options.recipientUserId) {
    const { data: prefs } = await admin
      .from("users")
      .select("notification_settings")
      .eq("id", options.recipientUserId)
      .maybeSingle();
    const ns = (prefs?.notification_settings ?? {}) as Record<string, unknown>;
    const emailMaster = ns.emailNotifications;
    const perType = ns[settingKey];
    const optedOut = emailMaster === false || perType === false;
    if (optedOut) {
      await admin.from("email_log").insert({
        recipient_email: recipient,
        template_id: options.template.id,
        status: "skipped_disabled",
        idempotency_key: options.idempotencyKey ?? null,
        metadata: options.metadata ?? {},
      });
      return { ok: true, status: "skipped_disabled" };
    }
  }

  // 4. Render the template. If this send is opt-out-able and we have
  //    both a user id and a configured unsubscribe secret, mint a one-
  //    click unsubscribe URL and inject it into the template props.
  let html: string;
  let text: string;
  let subject: string;
  try {
    let template = options.template;
    const unsubKey = UNSUB_KEY[options.template.id];
    if (
      unsubKey &&
      options.recipientUserId &&
      process.env.EMAIL_UNSUBSCRIBE_SECRET
    ) {
      try {
        const unsubscribeUrl = buildUnsubscribeUrl(
          options.recipientUserId,
          unsubKey
        );
        // Re-typed cast: we know the template props include
        // unsubscribeUrl (optional) for both currently-supported ids.
        template = {
          ...options.template,
          props: { ...options.template.props, unsubscribeUrl },
        } as EmailTemplate;
      } catch (signErr) {
        // Secret was set but signing threw — log and continue without
        // the tokenized URL (falls back to /profile/notifications).
        console.warn(
          "[email/send] unsubscribe URL mint failed, using fallback:",
          signErr instanceof Error ? signErr.message : signErr
        );
      }
    }

    const rendered = await renderTemplate(template);
    html = rendered.html;
    text = rendered.text;
    subject = rendered.subject;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Template render failed";
    await admin.from("email_log").insert({
      recipient_email: recipient,
      template_id: options.template.id,
      status: "failed",
      error: msg.slice(0, 500),
      idempotency_key: options.idempotencyKey ?? null,
      metadata: options.metadata ?? {},
    });
    return { ok: false, status: "failed", error: msg };
  }

  // 5. Insert 'queued' row before sending — gives us the row id to
  //    update with the messageId after the send returns.
  const { data: logRow } = await admin
    .from("email_log")
    .insert({
      recipient_email: recipient,
      template_id: options.template.id,
      status: "queued",
      idempotency_key: options.idempotencyKey ?? null,
      metadata: options.metadata ?? {},
    })
    .select("id")
    .single();

  // 6. Actually send. The client gracefully skips when RESEND_API_KEY
  //    is missing; we record that outcome distinctly.
  //
  //    RFC 8058 List-Unsubscribe headers — when we have a tokenized URL,
  //    we advertise one-click unsubscribe. Gmail Postmaster checks for
  //    these on bulk senders; their absence on marketing mail demotes
  //    inbox placement.
  const headers: Record<string, string> = {};
  const unsubKeyForHeaders = UNSUB_KEY[options.template.id];
  if (
    unsubKeyForHeaders &&
    options.recipientUserId &&
    process.env.EMAIL_UNSUBSCRIBE_SECRET
  ) {
    try {
      const unsubscribeUrl = buildUnsubscribeUrl(
        options.recipientUserId,
        unsubKeyForHeaders
      );
      headers["List-Unsubscribe"] = `<${unsubscribeUrl}>`;
      headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
    } catch {
      // Skip the header if signing fails — never block the send.
    }
  }

  const result = await sendEmail({
    to: recipient,
    subject,
    html,
    text,
    headers: Object.keys(headers).length > 0 ? headers : undefined,
    tags: [{ name: "template", value: options.template.id }],
  });

  // 7. Update the log row with the final status.
  if (logRow?.id) {
    if (result.ok && result.skipped === "no_key") {
      await admin
        .from("email_log")
        .update({ status: "skipped_no_key" })
        .eq("id", logRow.id);
      return { ok: true, status: "skipped_no_key" };
    }
    if (result.ok) {
      await admin
        .from("email_log")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          message_id: result.messageId ?? null,
        })
        .eq("id", logRow.id);
      return { ok: true, status: "sent", messageId: result.messageId };
    }
    await admin
      .from("email_log")
      .update({
        status: "failed",
        error: (result.error ?? "send failed").slice(0, 500),
      })
      .eq("id", logRow.id);
  }

  return {
    ok: false,
    status: "failed",
    error: result.error ?? "send failed",
  };
}

/**
 * Render a template to HTML + text + subject. Subject is template-specific
 * and built from the props (e.g. invite subject includes the destination
 * name to feel personal).
 */
async function renderTemplate(
  template: EmailTemplate
): Promise<{ html: string; text: string; subject: string }> {
  switch (template.id) {
    case "invite": {
      const html = await render(InviteEmail(template.props));
      const text = inviteEmailText(template.props);
      const subject = `${template.props.inviterName} invited you to plan ${template.props.tripDestination}`;
      return { html, text, subject };
    }
    case "vote_cast": {
      const html = await render(VoteCastEmail(template.props));
      const text = voteCastEmailText(template.props);
      const subject = `New feedback on your ${template.props.tripDestination} trip`;
      return { html, text, subject };
    }
  }
}
