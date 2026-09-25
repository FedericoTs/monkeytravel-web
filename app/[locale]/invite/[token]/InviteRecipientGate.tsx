"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { buildAuthCallbackUrl } from "@/lib/auth/callback-url";

/**
 * The invite page for an invite sent to a specific email, when the visitor
 * is not signed in as that email.
 *
 * Until 2026-09-24 this was an error screen: "Sign in with that email to view
 * and accept the invite", with one button, "Create Your Own Trip", and no
 * way to sign in. Every emailed invite to someone without an account stopped
 * there. Now it signs them in as the invited address and brings them back.
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
  /** "f•••o@gmail.com": enough to recognise your inbox, not to learn it. */
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
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || t("gate.sendFailed"));
      }
      setState("sent");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("gate.sendFailed"));
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
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errors.signInFailed"));
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
                <svg className="w-5 h-5" viewBox="0 0 24 24" aria-hidden="true">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                </svg>
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
