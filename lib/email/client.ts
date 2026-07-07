/**
 * Resend client wrapper.
 *
 * STRATEGY: this module *never* throws if RESEND_API_KEY is absent. Instead
 * it logs the would-be send to console and writes a `status='skipped_no_key'`
 * row to email_log. That means we can:
 *
 *   1. Ship the entire email scaffold to prod before the user signs up
 *      for Resend / verifies DNS. The codepath is exercised on every
 *      invite + notification, and deliverability tracking populates from
 *      day one — even if 100% of those rows are 'skipped_no_key' for now.
 *
 *   2. Flip a single env var (RESEND_API_KEY) and have email "just work"
 *      with zero code changes. The DNS verification + sending-domain
 *      setup is on the user's side; the application side is ready.
 *
 *   3. Keep dev/preview deployments from accidentally sending to real
 *      addresses: pre-prod environments won't have the key.
 *
 * To actually turn on email:
 *   1. Sign up at resend.com
 *   2. Verify monkeytravel.app as a sending domain (3 DNS records)
 *   3. Add RESEND_API_KEY to Vercel env vars (or wherever)
 *   4. Set EMAIL_FROM and EMAIL_REPLY_TO too (see below)
 */

import { Resend } from "resend";

const apiKey = process.env.RESEND_API_KEY;

// EMAIL_FROM defaults to a safe placeholder. Resend will REFUSE sends from
// unverified domains, so this never silently sends from the wrong From: line.
const FROM = process.env.EMAIL_FROM || "MonkeyTravel <noreply@monkeytravel.app>";
const REPLY_TO = process.env.EMAIL_REPLY_TO || "hello@monkeytravel.app";

const client = apiKey ? new Resend(apiKey) : null;

export interface SendInput {
  to: string;
  subject: string;
  html: string;
  /**
   * Plain-text fallback. Required for deliverability — spam filters
   * heavily penalise HTML-only emails. The send helper auto-derives it
   * from the React Email template via render({plainText:true}).
   */
  text: string;
  /**
   * Headers to include. Use List-Unsubscribe for RFC 8058 one-click
   * compliance on marketing emails.
   */
  headers?: Record<string, string>;
  /** Optional tag for Resend analytics dashboard grouping. */
  tags?: Array<{ name: string; value: string }>;
  /** Override the default sender (e.g. a founder persona for research outreach). */
  from?: string;
  /** Override the default Reply-To (e.g. a monitored inbox for replies). */
  replyTo?: string;
}

export interface SendResult {
  ok: boolean;
  messageId?: string;
  /** Why we skipped (set when ok=true && no messageId). */
  skipped?: "no_key";
  error?: string;
}

/**
 * Low-level send. Returns a structured result rather than throwing —
 * callers always want to log the outcome to email_log regardless of
 * success/failure.
 *
 * Does NOT touch the database. The send orchestrator (lib/email/send.ts)
 * wraps this with email_log writes + idempotency + opt-out checks.
 */
export async function sendEmail(input: SendInput): Promise<SendResult> {
  if (!client) {
    // No API key configured. Log + return a "skipped" result so the
    // orchestrator can record it in email_log without firing a send.
    if (process.env.NODE_ENV !== "test") {
      console.log("[email/client] SKIPPED (no RESEND_API_KEY):", {
        to: input.to,
        subject: input.subject,
      });
    }
    return { ok: true, skipped: "no_key" };
  }

  try {
    const result = await client.emails.send({
      from: input.from || FROM,
      to: input.to,
      replyTo: input.replyTo || REPLY_TO,
      subject: input.subject,
      html: input.html,
      text: input.text,
      headers: input.headers,
      tags: input.tags,
    });

    if (result.error) {
      return { ok: false, error: result.error.message };
    }
    return { ok: true, messageId: result.data?.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Send failed";
    return { ok: false, error: msg };
  }
}

/**
 * Helper for routes that want to gate UI features on whether the email
 * pipeline is actually operational. Don't use this for security decisions
 * (a misconfigured key still appears "ready") — just for "should we show
 * the email-invite tab in the share modal?" type checks.
 */
export function isEmailConfigured(): boolean {
  return apiKey !== undefined && apiKey.length > 0;
}
