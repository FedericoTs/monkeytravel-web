"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { buildAuthCallbackUrl } from "@/lib/auth/callback-url";
import { GoogleLogo } from "@/components/auth/ProviderLogos";

/**
 * The invite page for an invite sent to a specific email, when the visitor
 * is not signed in as that email.
 *
 * It signs them in as the invited address and brings them back, so an
 * emailed invite works for someone without an account.
 *
 * Two states:
 * - signed out: email a sign-in link to the invited address (the page never
 *   learns the full address), or continue with Google;
 * - signed in as someone else: say so and offer to switch account.
 * Either way the trip details stay hidden until the right account is signed
 * in, same as before (the page's info-leak rule).
 */
interface InviteRecipientGateProps {
  token: string;
  tripTitle: string;
  /** "f•••o@example.com": enough to recognise your inbox, not to learn it. */
  maskedRecipient: string;
  /** The account currently signed in, when it is not the invited one. */
  signedInEmail: string | null;
}

export default function InviteRecipientGate({
  token,
  tripTitle,
  maskedRecipient,
  signedInEmail,
}: InviteRecipientGateProps) {
  const locale = useLocale();
  const t = useTranslations("common.invitePage");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "redirecting">("idle");
  const [error, setError] = useState<string | null>(null);

  const invitePath = `/invite/${token}`;

  const sendLink = async () => {
    setState("sending");
    setError(null);
    try {
      const res = await fetch(`/api/invites/${token}/sign-in-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale }),
      });
      if (!res.ok) {
        // The route explains in English for its logs; say it in the page's words.
        setError(t(res.status === 429 ? "errors.tooManyEmails" : res.status === 404 ? "errors.invalidTokenDesc" : "gate.sendFailed"));
        setState("idle");
        return;
      }
      setState("sent");
    } catch {
      setError(t("gate.sendFailed"));
      setState("idle");
    }
  };

  const continueWithGoogle = async () => {
    setState("redirecting");
    setError(null);
    try {
      const { error: oauthError } = await createClient().auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: buildAuthCallbackUrl(window.location.origin, { next: invitePath, locale }) },
      });
      if (oauthError) throw oauthError;
    } catch {
      setError(t("errors.signInFailed"));
      setState("idle");
    }
  };

  const switchAccount = async () => {
    setState("redirecting");
    await createClient().auth.signOut().catch(() => {});
    window.location.reload();
  };

  const busy = state === "sending" || state === "redirecting";
  const home = locale === "en" ? "/" : `/${locale}`;

  return (
    <div className="min-h-screen min-h-dvh bg-gradient-to-b from-slate-50 to-white flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <div className="w-14 h-14 mx-auto mb-5 rounded-full bg-orange-100 flex items-center justify-center">
          <svg className="w-7 h-7 text-orange-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        </div>

        <h1 className="text-2xl font-bold text-slate-900 mb-2 text-center text-balance">
          {t("gate.title", { trip: tripTitle })}
        </h1>

        {signedInEmail ? (
          <>
            <p className="text-slate-600 mb-6 text-center">
              {t("gate.wrongAccount", { current: signedInEmail, invited: maskedRecipient })}
            </p>
            <button
              type="button"
              onClick={switchAccount}
              disabled={busy}
              className="w-full px-6 py-3.5 bg-[var(--primary)] text-white rounded-xl font-medium hover:bg-[var(--primary)]/90 transition-colors disabled:opacity-50"
            >
              {t("gate.switchAccount")}
            </button>
          </>
        ) : state === "sent" ? (
          <div className="text-center p-6 bg-green-50 rounded-xl border border-green-200">
            <h2 className="font-semibold text-slate-900 mb-2">{t("checkYourEmail")}</h2>
            <p className="text-sm text-slate-600">{t("gate.sent", { email: maskedRecipient })}</p>
          </div>
        ) : (
          <>
            <p className="text-slate-600 mb-6 text-center">{t("gate.sentTo", { email: maskedRecipient })}</p>
            <div className="space-y-3">
              <button
                type="button"
                onClick={sendLink}
                disabled={busy}
                className="w-full px-6 py-3.5 bg-[var(--primary)] text-white rounded-xl font-medium hover:bg-[var(--primary)]/90 transition-colors disabled:opacity-50"
              >
                {state === "sending" ? t("gate.sending") : t("gate.emailMeALink")}
              </button>
              <button
                type="button"
                onClick={continueWithGoogle}
                disabled={busy}
                className="w-full flex items-center justify-center gap-3 px-6 py-3.5 bg-white border border-slate-200 rounded-xl font-medium text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50"
              >
                <GoogleLogo />
                {t("continueWithGoogle")}
              </button>
              <p className="text-xs text-slate-500 text-center">{t("gate.googleHint", { email: maskedRecipient })}</p>
            </div>
          </>
        )}

        {error && (
          <p role="alert" className="mt-4 text-sm text-red-700 text-center">
            {error}
          </p>
        )}

        <p className="mt-8 text-center">
          <a href={home} className="text-sm text-slate-500 hover:text-slate-700 underline">
            {t("createYourOwnTrip")}
          </a>
        </p>
      </div>
    </div>
  );
}
