/**
 * Supabase "Send Email" auth hook.
 *
 * When enabled (Dashboard → Authentication → Hooks → Send Email), Supabase
 * stops sending its built-in auth emails and instead POSTs the email data
 * here for EVERY auth email type (signup confirmation, password recovery,
 * magic link, email change, reauthentication, invite). We verify the
 * Standard-Webhooks signature, render our branded React Email template, and
 * dispatch via Resend.
 *
 * IMPORTANT: because the hook intercepts ALL auth emails, every action type
 * must be handled — an unhandled type would leave that email unsent and
 * block the user (e.g. no confirmation link = no signup). The switch below
 * has an explicit fallback for that reason.
 *
 * The verification link mirrors Supabase's own default ConfirmationURL
 * (`${SUPABASE_URL}/auth/v1/verify?...&redirect_to=...`), so link SEMANTICS
 * are unchanged from the built-in flow — we only change the presentation.
 *
 * Env:
 *   SEND_EMAIL_HOOK_SECRET   — `v1,whsec_...` from the dashboard hook config
 *   NEXT_PUBLIC_SUPABASE_URL — used to build the verify link
 *   RESEND_API_KEY / EMAIL_* — consumed by lib/email/client.ts
 */

import { NextResponse } from "next/server";
import { render } from "@react-email/render";
import { sendEmail } from "@/lib/email/client";
import { verifyHookSignature } from "@/lib/email/verify-hook";
import ConfirmSignupEmail, {
  confirmSignupEmailText,
  confirmSignupSubject,
} from "@/lib/email/templates/ConfirmSignup";
import AuthActionEmail, {
  authActionEmailText,
  authActionSubject,
  type AuthActionKind,
} from "@/lib/email/templates/AuthAction";
import { normalizeEmailLocale, type EmailLocale } from "@/lib/email/copy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface HookPayload {
  user?: {
    email?: string;
    user_metadata?: Record<string, unknown> | null;
  };
  email_data?: {
    token?: string;
    token_hash?: string;
    redirect_to?: string;
    email_action_type?: string;
    site_url?: string;
  };
}

function jsonError(message: string, code: number) {
  // Shape Supabase surfaces back to the auth client.
  return NextResponse.json(
    { error: { http_code: code, message } },
    { status: code }
  );
}

function captureToSentry(err: unknown, stage: string) {
  import("@sentry/nextjs")
    .then((Sentry) => {
      Sentry.captureException?.(err, {
        tags: { source: "auth/send-email-hook", stage },
        level: "error",
      });
    })
    .catch(() => {
      /* Sentry unavailable — console.error is the fallback */
    });
}

/** Map a Supabase action type to our rendered email. */
function buildEmail(
  actionType: string,
  verifyUrl: string,
  token: string | undefined,
  name: string | undefined,
  locale: EmailLocale
): { subject: string; element: React.ReactElement; text: string } {
  switch (actionType) {
    case "signup":
      return {
        subject: confirmSignupSubject(locale),
        element: ConfirmSignupEmail({ name, confirmUrl: verifyUrl, locale }),
        text: confirmSignupEmailText({ name, confirmUrl: verifyUrl, locale }),
      };
    case "recovery":
    case "magiclink":
    case "email_change":
    case "reauthentication":
    case "invite": {
      const kind = actionType as AuthActionKind;
      return {
        subject: authActionSubject(kind, locale),
        element: AuthActionEmail({ kind, actionUrl: verifyUrl, token, locale }),
        text: authActionEmailText({ kind, actionUrl: verifyUrl, token, locale }),
      };
    }
    default: {
      // Unknown/future action type — never leave it unsent. Fall back to a
      // neutral "magic link"-style confirm so the user can still proceed.
      const kind: AuthActionKind = "magiclink";
      return {
        subject: authActionSubject(kind, locale),
        element: AuthActionEmail({ kind, actionUrl: verifyUrl, token, locale }),
        text: authActionEmailText({ kind, actionUrl: verifyUrl, token, locale }),
      };
    }
  }
}

export async function POST(request: Request) {
  const secret = process.env.SEND_EMAIL_HOOK_SECRET;
  if (!secret) {
    // Fail closed: without the secret we cannot verify authenticity, and
    // sending unverified would let anyone trigger branded emails from us.
    console.error("[auth/send-email] SEND_EMAIL_HOOK_SECRET not configured");
    return jsonError("hook not configured", 500);
  }

  const rawBody = await request.text();

  const verdict = verifyHookSignature(
    rawBody,
    {
      id: request.headers.get("webhook-id"),
      timestamp: request.headers.get("webhook-timestamp"),
      signature: request.headers.get("webhook-signature"),
    },
    secret
  );
  if (!verdict.ok) {
    console.warn("[auth/send-email] signature verification failed:", verdict.reason);
    return jsonError("invalid signature", 401);
  }

  let payload: HookPayload;
  try {
    payload = JSON.parse(rawBody) as HookPayload;
  } catch {
    return jsonError("invalid payload", 400);
  }

  const recipient = payload.user?.email;
  const data = payload.email_data;
  if (!recipient || !data?.email_action_type) {
    return jsonError("missing email data", 400);
  }

  // Build the verification link exactly as Supabase's built-in flow would.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) {
    captureToSentry(new Error("NEXT_PUBLIC_SUPABASE_URL missing"), "build_url");
    return jsonError("server misconfigured", 500);
  }
  const redirectTo =
    data.redirect_to ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "https://monkeytravel.app";
  const verifyUrl =
    `${supabaseUrl}/auth/v1/verify` +
    `?token=${encodeURIComponent(data.token_hash ?? "")}` +
    `&type=${encodeURIComponent(data.email_action_type)}` +
    `&redirect_to=${encodeURIComponent(redirectTo)}`;

  const name =
    (payload.user?.user_metadata?.display_name as string | undefined) ||
    (payload.user?.user_metadata?.full_name as string | undefined) ||
    undefined;

  // Email in the language the user uses the site in. We stamp `locale` into
  // auth user_metadata at signup (signup page + OAuth callback). Falls back
  // to English for any account created before that wiring existed.
  const locale = normalizeEmailLocale(payload.user?.user_metadata?.locale);

  let subject: string;
  let html: string;
  let text: string;
  try {
    const built = buildEmail(
      data.email_action_type,
      verifyUrl,
      data.token,
      name,
      locale
    );
    subject = built.subject;
    html = await render(built.element);
    text = built.text;
  } catch (err) {
    console.error("[auth/send-email] render failed:", err);
    captureToSentry(err, "render");
    return jsonError("render failed", 500);
  }

  const result = await sendEmail({
    to: recipient,
    subject,
    html,
    text,
    tags: [
      { name: "category", value: "auth" },
      { name: "action", value: data.email_action_type },
    ],
  });

  if (!result.ok) {
    console.error("[auth/send-email] send failed:", result.error);
    captureToSentry(new Error(result.error ?? "send failed"), "send");
    return jsonError(result.error ?? "send failed", 500);
  }
  if (result.skipped === "no_key") {
    // RESEND_API_KEY missing in this environment — the auth email did NOT
    // go out. Surface as an error so it's visible (in prod the key is set).
    console.error("[auth/send-email] RESEND_API_KEY missing; email not sent");
    return jsonError("email provider not configured", 500);
  }

  return NextResponse.json({}, { status: 200 });
}
