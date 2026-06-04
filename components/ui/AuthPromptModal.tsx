"use client";

/**
 * Save-trip auth wall — magic-link-first.
 *
 * 2026-06-04 redesign: the previous flow funneled anon-result viewers into
 * /auth/signup (full account + password). 4 days of post-instrumentation
 * data showed 0 saves from anon users despite ~30% step_1 → result
 * conversion — the auth wall at peak intent was the leak.
 *
 * New shape:
 *   1. Single email field + "Email me the link" — Supabase signInWithOtp.
 *      Returning users get logged in; new users get an account auto-created
 *      on magic-link click. Either way the trip draft is restored via
 *      `pendingTripGeneration` + the existing useItineraryDraft helper.
 *   2. Tiny "Prefer a password?" link kicks back to the legacy signup/login
 *      pages for users who insist.
 *
 * Why magic-link as the primary: lifts post-result conversion 2-3x in
 * studies (Layla, Roam Around, Mindtrip all do this). One field vs three,
 * no password to invent, works on mobile keyboards.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { prefs } from "@/lib/platform/storage";
import { createClient } from "@/lib/supabase/client";
import BaseModal from "@/components/ui/BaseModal";

interface AuthPromptModalProps {
  isOpen: boolean;
  onClose: () => void;
  destination: string;
  redirectPath?: string;
}

const BENEFITS = [
  { icon: "M13 10V3L4 14h7v7l9-11h-7z", key: "aiPowered" },
  { icon: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z", key: "saveEdit" },
  { icon: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z", key: "realTime" },
] as const;

export default function AuthPromptModal({
  isOpen,
  onClose,
  destination,
  redirectPath = "/trips/new",
}: AuthPromptModalProps) {
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations("common.authPrompt");
  const tButtons = useTranslations("common.buttons");

  const [email, setEmail] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [linkSent, setLinkSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isNavigating, setIsNavigating] = useState(false);

  // signInWithOtp lands the user back at /auth/callback?next=<redirectPath>.
  // The callback's PKCE branch (app/auth/callback/route.ts:60) handles both
  // brand-new email (auto-creates the account) and returning users (login).
  // Then the wizard's existing draft-restore effect at NewTripWizard.tsx
  // sees pendingTripGeneration=true and resumes the save into the now-
  // authenticated session.
  const handleSendMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed || isSending) return;

    setIsSending(true);
    setError(null);

    try {
      // Persist the intent BEFORE we redirect through email — once the
      // user clicks the link, the wizard remounts and reads this flag to
      // know it should auto-resume the save.
      await prefs.set("pendingTripGeneration", "true");

      const supabase = createClient();
      // emailRedirectTo must be an absolute URL — Supabase rejects paths.
      // We rebuild from window.origin (client-side only) and inject the
      // locale prefix so /auth/callback runs in the right locale shell.
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      const localePrefix = locale === "en" ? "" : `/${locale}`;
      const callbackUrl = `${origin}${localePrefix}/auth/callback?next=${encodeURIComponent(redirectPath)}`;

      const { error: otpError } = await supabase.auth.signInWithOtp({
        email: trimmed,
        options: {
          emailRedirectTo: callbackUrl,
          shouldCreateUser: true,
        },
      });

      if (otpError) throw otpError;
      setLinkSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("magicLink.failed"));
    } finally {
      setIsSending(false);
    }
  };

  // Legacy paths — kept as escape hatches for users who insist on
  // password auth or already have an account they want to sign into
  // without waiting for an email.
  const handlePasswordSignup = async () => {
    setIsNavigating(true);
    await prefs.set("pendingTripGeneration", "true");
    router.push(`/auth/signup?redirect=${encodeURIComponent(redirectPath)}`);
  };

  const handleLogin = async () => {
    setIsNavigating(true);
    await prefs.set("pendingTripGeneration", "true");
    router.push(`/auth/login?redirect=${encodeURIComponent(redirectPath)}`);
  };

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      usePortal
      maxWidth="max-w-md"
      showCloseButton={false}
      noPadding
      animation="scale"
      ariaLabel={t("title")}
      className="shadow-2xl"
    >
      {/* Gradient header */}
      <div className="bg-gradient-to-br from-[var(--primary)] to-[var(--primary)]/80 px-6 py-8 text-white text-center">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-white/20 backdrop-blur flex items-center justify-center">
          <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d={linkSent
                ? "M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                : "M13 10V3L4 14h7v7l9-11h-7z"}
            />
          </svg>
        </div>
        <h2 className="text-2xl font-bold mb-2">
          {linkSent ? t("magicLink.sentTitle") : t("title")}
        </h2>
        <p className="text-white/80">
          {linkSent
            ? t("magicLink.sentSubtitle", { email })
            : t("subtitle", { destination })}
        </p>
      </div>

      {/* Body */}
      <div className="px-6 py-6">
        {linkSent ? (
          // Success state — no benefits, no extra CTAs. Just confirm + offer
          // a "use a different email" escape if they typo'd.
          <div className="text-center space-y-4">
            <p className="text-slate-600 text-sm">{t("magicLink.checkInbox")}</p>
            <button
              type="button"
              onClick={() => {
                setLinkSent(false);
                setEmail("");
                setError(null);
              }}
              className="text-sm text-[var(--primary)] hover:underline"
            >
              {t("magicLink.useDifferent")}
            </button>
          </div>
        ) : (
          <>
            {/* Benefits — kept short so the email field is above the fold */}
            <div className="space-y-2.5 mb-5">
              {BENEFITS.map((benefit, index) => (
                <div key={index} className="flex items-center gap-3">
                  <div className="w-7 h-7 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                    <svg
                      className="w-3.5 h-3.5 text-green-600"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d={benefit.icon}
                      />
                    </svg>
                  </div>
                  <span className="text-sm text-slate-700">
                    {t(`benefits.${benefit.key}`)}
                  </span>
                </div>
              ))}
            </div>

            {/* Magic-link form — primary action */}
            <form onSubmit={handleSendMagicLink} className="space-y-3">
              <label htmlFor="auth-prompt-email" className="sr-only">
                {t("magicLink.emailLabel")}
              </label>
              <input
                id="auth-prompt-email"
                type="email"
                autoComplete="email"
                inputMode="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t("magicLink.emailPlaceholder")}
                disabled={isSending || isNavigating}
                className="w-full px-4 py-3 rounded-xl border border-slate-300 focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 outline-none transition-colors disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={isSending || isNavigating || !email.trim()}
                className="w-full bg-[var(--accent)] text-slate-900 py-3.5 rounded-xl font-semibold hover:bg-[var(--accent)]/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isSending ? (
                  <>
                    <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    {t("magicLink.sending")}
                  </>
                ) : (
                  <>
                    {t("magicLink.send")}
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>
                  </>
                )}
              </button>
              {error && (
                <p className="text-sm text-rose-600" role="alert">
                  {error}
                </p>
              )}
            </form>

            {/* Secondary path — password auth */}
            <div className="mt-5 pt-4 border-t border-slate-100 text-center space-y-1.5">
              <button
                type="button"
                onClick={handlePasswordSignup}
                disabled={isSending || isNavigating}
                className="text-sm text-slate-500 hover:text-slate-700 transition-colors disabled:opacity-50"
              >
                {t("preferPassword")}
              </button>
              <div>
                <button
                  type="button"
                  onClick={handleLogin}
                  disabled={isSending || isNavigating}
                  className="text-sm text-slate-500 hover:text-slate-700 transition-colors disabled:opacity-50"
                >
                  {t("hasAccount")}
                </button>
              </div>
            </div>

            {/* Trust strip */}
            <div className="mt-5 pt-4 border-t border-slate-100">
              <div className="flex items-center justify-center gap-4 text-xs text-slate-500">
                <div className="flex items-center gap-1">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                  {t("trust.secure")}
                </div>
                <div className="flex items-center gap-1">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  {t("trust.free")}
                </div>
                <div className="flex items-center gap-1">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {t("trust.quick")}
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Close button — sits over the gradient header */}
      <button
        onClick={onClose}
        aria-label={tButtons("closeModal")}
        className="absolute top-4 right-4 text-white/70 hover:text-white transition-colors z-10"
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </BaseModal>
  );
}
