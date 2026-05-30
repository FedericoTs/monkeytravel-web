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
  inviteSubject,
  type InviteEmailProps,
} from "./templates/Invite";
import VoteCastEmail, {
  voteCastEmailText,
  voteCastSubject,
  type VoteCastEmailProps,
} from "./templates/VoteCast";
import TripReminderEmail, {
  tripReminderEmailText,
  type TripReminderEmailProps,
} from "./templates/TripReminder";
import { buildUnsubscribeUrl, type UnsubKey } from "./unsubscribe";
import { normalizeEmailLocale, type EmailLocale } from "./copy";

export type EmailTemplate =
  | { id: "invite"; props: InviteEmailProps }
  | { id: "vote_cast"; props: VoteCastEmailProps }
  | { id: "trip_reminder"; props: TripReminderEmailProps };

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
  /**
   * True when the send went through but at least one email_log row failed
   * to persist (insert or final-status update). The transactional email is
   * still delivered — we never block a user-facing notification on logging
   * — but a reconciler should sweep the Resend audit log against email_log
   * to find these orphans. Set in the fail-open paths inside dispatchEmail.
   */
  needsReconciliation?: boolean;
}

/**
 * Best-effort Sentry capture. Lazily imported so a missing/failed Sentry
 * never breaks the email path. Mirrors the pattern in
 * lib/usage-limits/check.ts and lib/gemini.ts.
 */
function captureToSentry(
  err: unknown,
  context: { stage: string; recipient?: string; idempotencyKey?: string }
): void {
  import("@sentry/nextjs")
    .then((Sentry) => {
      Sentry.captureException?.(err, {
        tags: {
          source: "email/send",
          stage: context.stage,
        },
        extra: {
          recipient: context.recipient,
          idempotency_key: context.idempotencyKey,
        },
        level: "error",
      });
    })
    .catch(() => {
      /* Sentry not available — console.error is the fallback */
    });
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
  /**
   * Recipient UI language for the rendered template + shell. When omitted,
   * dispatchEmail resolves it from the recipient's users.preferred_language
   * (if recipientUserId is set), falling back to English. Callers that
   * already know the locale (e.g. the trip-reminder cron) can pass it to
   * skip the lookup; transactional sends to non-users (invites) can pass
   * the sender's locale.
   */
  locale?: EmailLocale;
}

const NOTIFICATION_SETTING_KEY: Record<EmailTemplate["id"], string | null> = {
  // Invites are transactional — no opt-out. The user being invited didn't
  // sign up for our notification settings UI; they should always get the
  // first invite.
  invite: null,
  // Vote-cast is collaboration — gated by emailNotifications + collabVotes
  vote_cast: "collabVotes",
  // Pre-trip cascade — gated by emailNotifications + tripReminders. The
  // tripReminders key is already populated at signup
  // (app/auth/callback/route.ts + app/[locale]/auth/signup/page.tsx);
  // we just honour it here. Read failure is fail-closed per cycle-7 #216.
  trip_reminder: "tripReminders",
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
  trip_reminder: "tripReminders",
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
    const { data: existing, error: idempErr } = await admin
      .from("email_log")
      .select("id, status, message_id")
      .eq("idempotency_key", options.idempotencyKey)
      .in("status", ["sent", "queued"])
      .maybeSingle();
    if (idempErr) {
      // FAIL CLOSED: if we can't confirm we haven't already sent, we must
      // not send again. Better to drop one transactional email than to
      // double-send (worse for deliverability reputation and user trust).
      console.error(
        "[email/send] idempotency read failed; refusing to send",
        idempErr
      );
      captureToSentry(idempErr, {
        stage: "idempotency_read",
        recipient,
        idempotencyKey: options.idempotencyKey,
      });
      return {
        ok: false,
        status: "failed",
        error: "idempotency check failed",
      };
    }
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
  const { data: suppressed, error: suppErr } = await admin
    .from("email_log")
    .select("id")
    .eq("recipient_email", recipient)
    .in("status", ["bounced", "complained"])
    .limit(1);
  if (suppErr) {
    // FAIL CLOSED: if we can't confirm the address isn't suppressed, we
    // refuse to send. Sending to a known-bounced/complained address torches
    // sender reputation across the entire domain — far worse than dropping
    // a single transactional email.
    console.error(
      "[email/send] suppression read failed; refusing to send",
      suppErr
    );
    captureToSentry(suppErr, {
      stage: "suppression_read",
      recipient,
      idempotencyKey: options.idempotencyKey,
    });
    return {
      ok: false,
      status: "failed",
      error: "suppression check failed",
    };
  }
  if (suppressed && suppressed.length > 0) {
    const { error: suppInsErr } = await admin.from("email_log").insert({
      recipient_email: recipient,
      template_id: options.template.id,
      status: "skipped_suppressed",
      idempotency_key: options.idempotencyKey ?? null,
      metadata: options.metadata ?? {},
    });
    if (suppInsErr) {
      // Audit-only insert — we still report the skip. The actionable
      // outcome (didn't send) is unchanged.
      console.error(
        "[email/send] skipped_suppressed audit log insert failed",
        suppInsErr
      );
      captureToSentry(suppInsErr, {
        stage: "log_insert_skipped_suppressed",
        recipient,
        idempotencyKey: options.idempotencyKey,
      });
    }
    return { ok: true, status: "skipped_suppressed" };
  }

  // Recipient language for the rendered template + shell. Caller-provided
  // locale wins; otherwise we read users.preferred_language (folded into the
  // opt-out lookup below to avoid an extra round-trip), then fall back to en.
  let recipientLocale: EmailLocale | undefined = options.locale;

  // 3. Opt-out check (only for non-transactional templates and only when
  //    we have a recipient user). Transactional emails (invites) skip
  //    this — being explicitly invited overrides general opt-out.
  const settingKey = NOTIFICATION_SETTING_KEY[options.template.id];
  if (settingKey && options.recipientUserId) {
    const { data: prefs, error: prefsErr } = await admin
      .from("users")
      .select("notification_settings, preferred_language")
      .eq("id", options.recipientUserId)
      .maybeSingle();
    if (prefsErr) {
      // FAIL CLOSED: if we can't read the recipient's notification_settings,
      // we have no way to honor their opt-out. Sending anyway risks emailing
      // a user who has explicitly disabled this notification type — worse
      // for trust + GDPR/CASL than dropping a single notification email.
      console.error(
        "[email/send] notification_settings read failed; refusing to send",
        prefsErr
      );
      captureToSentry(prefsErr, {
        stage: "notification_settings_read",
        recipient,
        idempotencyKey: options.idempotencyKey,
      });
      return {
        ok: false,
        status: "failed",
        error: "notification_settings_read_failed",
      };
    }
    if (!recipientLocale) {
      recipientLocale = normalizeEmailLocale(
        (prefs as { preferred_language?: unknown } | null)?.preferred_language
      );
    }
    const ns = (prefs?.notification_settings ?? {}) as Record<string, unknown>;
    const emailMaster = ns.emailNotifications;
    const perType = ns[settingKey];
    const optedOut = emailMaster === false || perType === false;
    if (optedOut) {
      const { error: disInsErr } = await admin.from("email_log").insert({
        recipient_email: recipient,
        template_id: options.template.id,
        status: "skipped_disabled",
        idempotency_key: options.idempotencyKey ?? null,
        metadata: options.metadata ?? {},
      });
      if (disInsErr) {
        // Audit-only insert — the actionable outcome (didn't send) is
        // unchanged. Logging failure must not flip a user opt-out into a
        // surprise send.
        console.error(
          "[email/send] skipped_disabled audit log insert failed",
          disInsErr
        );
        captureToSentry(disInsErr, {
          stage: "log_insert_skipped_disabled",
          recipient,
          idempotencyKey: options.idempotencyKey,
        });
      }
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

    // Inject the resolved recipient locale so the template + shared shell
    // (EmailLayout) render in the right language. Defaults to English.
    template = {
      ...template,
      props: { ...template.props, locale: recipientLocale ?? "en" },
    } as EmailTemplate;

    const rendered = await renderTemplate(template);
    html = rendered.html;
    text = rendered.text;
    subject = rendered.subject;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Template render failed";
    const { error: failInsErr } = await admin.from("email_log").insert({
      recipient_email: recipient,
      template_id: options.template.id,
      status: "failed",
      error: msg.slice(0, 500),
      idempotency_key: options.idempotencyKey ?? null,
      metadata: options.metadata ?? {},
    });
    if (failInsErr) {
      // The send already failed (render error) — we just couldn't audit
      // the failure. Surface to Sentry so we still see render failures
      // even when the audit table is sick.
      console.error(
        "[email/send] failed-template audit log insert failed",
        failInsErr
      );
      captureToSentry(failInsErr, {
        stage: "log_insert_failed_render",
        recipient,
        idempotencyKey: options.idempotencyKey,
      });
    }
    return { ok: false, status: "failed", error: msg };
  }

  // 5. Insert 'queued' row before sending — gives us the row id to
  //    update with the messageId after the send returns.
  //
  //    If this insert fails, we proceed with the send anyway (transactional
  //    email is more valuable than the audit trail) but stamp the outcome
  //    with needsReconciliation so a sweeper can match Resend's record of
  //    the send back to email_log.
  const { data: logRow, error: queuedInsErr } = await admin
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
  let needsReconciliation = false;
  if (queuedInsErr) {
    console.error(
      "[email/send] queued log insert failed; sending without audit row",
      queuedInsErr
    );
    captureToSentry(queuedInsErr, {
      stage: "log_insert_queued",
      recipient,
      idempotencyKey: options.idempotencyKey,
    });
    needsReconciliation = true;
  }

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

  // 7. Update the log row with the final status. If the queued insert
  //    failed earlier, logRow is undefined — we still report the true
  //    send outcome to the caller (the send already happened or didn't,
  //    independent of the audit row). The outcome is stamped with
  //    needsReconciliation so an out-of-band sweeper can stitch the
  //    Resend audit trail back to email_log.
  if (result.ok && result.skipped === "no_key") {
    if (logRow?.id) {
      const { error: updErr } = await admin
        .from("email_log")
        .update({ status: "skipped_no_key" })
        .eq("id", logRow.id);
      if (updErr) {
        console.error(
          "[email/send] skipped_no_key log update failed",
          updErr
        );
        captureToSentry(updErr, {
          stage: "log_update_skipped_no_key",
          recipient,
          idempotencyKey: options.idempotencyKey,
        });
        needsReconciliation = true;
      }
    }
    return {
      ok: true,
      status: "skipped_no_key",
      ...(needsReconciliation ? { needsReconciliation: true } : {}),
    };
  }

  if (result.ok) {
    if (logRow?.id) {
      const { error: updErr } = await admin
        .from("email_log")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          message_id: result.messageId ?? null,
        })
        .eq("id", logRow.id);
      if (updErr) {
        // The email already went out. We just can't mark it 'sent' in our
        // audit table. Stamp needsReconciliation so a sweeper can correct
        // the log from Resend's event stream.
        console.error(
          "[email/send] sent log update failed; email already delivered",
          updErr
        );
        captureToSentry(updErr, {
          stage: "log_update_sent",
          recipient,
          idempotencyKey: options.idempotencyKey,
        });
        needsReconciliation = true;
      }
    }
    return {
      ok: true,
      status: "sent",
      messageId: result.messageId,
      ...(needsReconciliation ? { needsReconciliation: true } : {}),
    };
  }

  // Send failed.
  if (logRow?.id) {
    const { error: updErr } = await admin
      .from("email_log")
      .update({
        status: "failed",
        error: (result.error ?? "send failed").slice(0, 500),
      })
      .eq("id", logRow.id);
    if (updErr) {
      console.error(
        "[email/send] failed log update failed",
        updErr
      );
      captureToSentry(updErr, {
        stage: "log_update_failed",
        recipient,
        idempotencyKey: options.idempotencyKey,
      });
      needsReconciliation = true;
    }
  }

  return {
    ok: false,
    status: "failed",
    error: result.error ?? "send failed",
    ...(needsReconciliation ? { needsReconciliation: true } : {}),
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
      const subject = inviteSubject(
        template.props.inviterName,
        template.props.tripDestination,
        template.props.locale
      );
      return { html, text, subject };
    }
    case "vote_cast": {
      const html = await render(VoteCastEmail(template.props));
      const text = voteCastEmailText(template.props);
      const subject = voteCastSubject(
        template.props.tripDestination,
        template.props.locale
      );
      return { html, text, subject };
    }
    case "trip_reminder": {
      // The cron route resolves the slot-specific subject in the
      // recipient's locale and passes it via props.heading — we mirror
      // it as the subject so the email subject + heading stay in sync.
      const html = await render(TripReminderEmail(template.props));
      const text = tripReminderEmailText(template.props);
      const subject = `${template.props.heading} — ${template.props.destination}`;
      return { html, text, subject };
    }
  }
}
