import { createHash } from "crypto";
import { NextRequest } from "next/server";
import { supabase } from "@/lib/supabase";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { isValidEmail, normalizeEmail } from "@/lib/validation";
import { createRateLimiter } from "@/lib/api/rate-limit";
import { sendEmail } from "@/lib/email/client";
import { ADMIN_EMAILS } from "@/lib/admin";

const limiter = createRateLimiter("contact", 5, 60 * 60 * 1000);
const ALLOWED_TOPICS = new Set(["support", "partnership", "press", "feedback", "other"]);

// Domains we flag as VIP in the subject line so an inbox glance is enough
// to spot a partner-quality lead. Add freely — false positives are harmless.
// Triggered by 2026-05-28: Hostelworld contact arrived and we had no
// notification path, no admin UI. This is the minimum guardrail until
// the proper /admin Messages tab ships.
const VIP_DOMAINS = new Set([
  "hostelworld.com",
  "booking.com",
  "booking.holdings",
  "expedia.com",
  "expediagroup.com",
  "airbnb.com",
  "amadeus.com",
  "amadeus.net",
  "travelpayouts.com",
  "tripadvisor.com",
  "hostelz.com",
  "agoda.com",
  "trip.com",
  "kayak.com",
  "skyscanner.net",
  "skyscanner.com",
  "google.com",
  "anthropic.com",
  "openai.com",
  "vercel.com",
  "supabase.com",
  "supabase.io",
  "resend.com",
  "stripe.com",
  // Add VC / press domains as they show up
]);

export async function POST(request: NextRequest) {
  try {
    const { allowed } = await limiter.check(request);
    if (!allowed) {
      return errors.rateLimit("Too many contact submissions. Please try again later.");
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return errors.badRequest("Invalid request body");
    }

    const { name, email, topic, message, locale } = body as Record<string, unknown>;

    if (typeof name !== "string" || name.trim().length === 0 || name.length > 200) {
      return errors.badRequest("Invalid name");
    }
    if (typeof email !== "string" || !isValidEmail(email)) {
      return errors.badRequest("Invalid email");
    }
    if (typeof topic !== "string" || !ALLOWED_TOPICS.has(topic)) {
      return errors.badRequest("Invalid topic");
    }
    if (typeof message !== "string" || message.trim().length < 10 || message.length > 5000) {
      return errors.badRequest("Invalid message");
    }

    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      "";
    const ipHash = ip ? createHash("sha256").update(ip).digest("hex").slice(0, 32) : null;

    const { data, error } = await supabase
      .from("contact_messages")
      .insert({
        name: name.trim().slice(0, 200),
        email: normalizeEmail(email),
        topic,
        message: message.trim().slice(0, 5000),
        locale: typeof locale === "string" ? locale.slice(0, 8) : null,
        user_agent: request.headers.get("user-agent")?.slice(0, 500) ?? null,
        referer: request.headers.get("referer")?.slice(0, 500) ?? null,
        ip_hash: ipHash,
      })
      .select("id")
      .single();

    if (error) {
      console.error("[Contact] Supabase error:", error);
      return errors.internal("Failed to send message. Please try again.", "Contact");
    }

    // Fire-and-forget admin notification. Never block the user response on
    // the email — if Resend is down or RESEND_API_KEY is missing, the row
    // is still safely persisted and visible via SQL. Worst case = silent
    // skip + console log (handled inside sendEmail).
    void notifyAdmins({
      id: data.id,
      name: name.trim(),
      email: normalizeEmail(email),
      topic,
      message: message.trim(),
      locale: typeof locale === "string" ? locale : null,
      referer: request.headers.get("referer") ?? null,
    }).catch((err) => {
      console.error("[Contact] Admin notify failed (non-fatal):", err);
    });

    return apiSuccess({ id: data.id }, { status: 201 });
  } catch (error) {
    console.error("[Contact] Error:", error);
    return errors.internal("An unexpected error occurred", "Contact");
  }
}

// --- Admin notification ---------------------------------------------------
//
// Sends one email per admin in ADMIN_EMAILS, prefixed [VIP] when the
// sender's domain matches a known partner / press / vendor domain. Plain
// HTML, no template (keep this dependency-light — it's a guardrail, not
// a marketing surface). The proper /admin Messages tab will eventually
// replace the need for this email by surfacing the row in the UI.
async function notifyAdmins(payload: {
  id: string;
  name: string;
  email: string;
  topic: string;
  message: string;
  locale: string | null;
  referer: string | null;
}): Promise<void> {
  const domain = payload.email.split("@")[1]?.toLowerCase() ?? "";
  const isVip = VIP_DOMAINS.has(domain);
  const vipTag = isVip ? "[VIP] " : "";

  const subject = `${vipTag}[${payload.topic}] ${payload.name} — monkeytravel contact`;

  // Minimal escape — name/email/message are user-supplied + go into HTML.
  const esc = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
      ${isVip ? `<div style="background: #fff7ed; border: 1px solid #fdba74; border-radius: 8px; padding: 12px 16px; margin-bottom: 16px; color: #9a3412;"><strong>⚡ VIP domain</strong>: ${esc(domain)}</div>` : ""}
      <h2 style="margin: 0 0 8px; color: #0f172a;">New contact: ${esc(payload.name)}</h2>
      <p style="margin: 0 0 16px; color: #64748b; font-size: 14px;">
        <strong>Topic:</strong> ${esc(payload.topic)}<br/>
        <strong>From:</strong> <a href="mailto:${esc(payload.email)}" style="color: #0a4b73;">${esc(payload.email)}</a><br/>
        ${payload.locale ? `<strong>Locale:</strong> ${esc(payload.locale)}<br/>` : ""}
        ${payload.referer ? `<strong>Page:</strong> ${esc(payload.referer)}<br/>` : ""}
      </p>
      <div style="background: #f8fafc; border-left: 3px solid #0a4b73; padding: 16px; border-radius: 4px; white-space: pre-wrap; color: #1e293b;">${esc(payload.message)}</div>
      <p style="margin-top: 24px; font-size: 12px; color: #94a3b8;">
        Message ID: <code>${esc(payload.id)}</code><br/>
        Reply directly to this email — your reply goes to ${esc(payload.email)}.
      </p>
    </div>
  `;

  const text =
    `${isVip ? `[VIP domain: ${domain}]\n\n` : ""}` +
    `New contact from ${payload.name} <${payload.email}>\n` +
    `Topic: ${payload.topic}\n` +
    (payload.locale ? `Locale: ${payload.locale}\n` : "") +
    (payload.referer ? `Page: ${payload.referer}\n` : "") +
    `\n---\n${payload.message}\n---\n\n` +
    `Message ID: ${payload.id}\n` +
    `Reply to this email to respond directly.`;

  // Send to each admin in parallel. We override replyTo so the admin can
  // hit "Reply" and go straight to the user (not back to noreply@).
  await Promise.allSettled(
    ADMIN_EMAILS.map((to) =>
      sendEmail({
        to,
        subject,
        html,
        text,
        headers: { "Reply-To": payload.email },
        tags: [
          { name: "type", value: "contact_admin_notification" },
          { name: "topic", value: payload.topic },
          ...(isVip ? [{ name: "vip", value: domain }] : []),
        ],
      }),
    ),
  );
}
