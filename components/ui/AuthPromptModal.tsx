"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { prefs } from "@/lib/platform/storage";
import BaseModal from "@/components/ui/BaseModal";

interface AuthPromptModalProps {
  isOpen: boolean;
  onClose: () => void;
  destination: string;
  redirectPath?: string;
}

// Benefit icons with translation keys
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
  const t = useTranslations("common.authPrompt");
  const tButtons = useTranslations("common.buttons");
  const [isNavigating, setIsNavigating] = useState(false);

  const handleSignup = async () => {
    setIsNavigating(true);
    // Store intent to auto-generate after signup. `await` so the value
    // is durably persisted before we hand control to the router — the
    // native Capacitor backend is async, and we'd race the navigation
    // otherwise.
    await prefs.set("pendingTripGeneration", "true");
    router.push(`/auth/signup?redirect=${encodeURIComponent(redirectPath)}`);
  };

  const handleLogin = async () => {
    setIsNavigating(true);
    await prefs.set("pendingTripGeneration", "true");
    router.push(`/auth/login?redirect=${encodeURIComponent(redirectPath)}`);
  };

  // BaseModal provides role="dialog" + aria-modal + focus trap + Esc + scroll
  // lock. We keep the custom gradient header + white-on-gradient close button
  // by passing noPadding and showCloseButton={false} and rendering the layout
  // ourselves inside children.
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
      {/* Gradient Header */}
      <div className="bg-gradient-to-br from-[var(--primary)] to-[var(--primary)]/80 px-6 py-8 text-white text-center">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-white/20 backdrop-blur flex items-center justify-center">
          <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        </div>
        <h2 className="text-2xl font-bold mb-2">{t("title")}</h2>
        <p className="text-white/80">
          {t("subtitle", { destination })}
        </p>
      </div>

      {/* Benefits */}
      <div className="px-6 py-6">
        <div className="space-y-3 mb-6">
          {BENEFITS.map((benefit, index) => (
            <div key={index} className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={benefit.icon} />
                </svg>
              </div>
              <span className="text-slate-700">{t(`benefits.${benefit.key}`)}</span>
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="space-y-3">
          <button
            onClick={handleSignup}
            disabled={isNavigating}
            className="w-full bg-[var(--accent)] text-slate-900 py-3.5 rounded-xl font-semibold hover:bg-[var(--accent)]/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isNavigating ? (
              <>
                <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                {t("redirecting")}
              </>
            ) : (
              <>
                {t("createAccount")}
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </>
            )}
          </button>

          <button
            onClick={handleLogin}
            disabled={isNavigating}
            className="w-full border border-slate-300 text-slate-700 py-3 rounded-xl font-medium hover:bg-slate-50 transition-colors disabled:opacity-50"
          >
            {t("hasAccount")}
          </button>
        </div>

        {/* Trust indicators */}
        <div className="mt-6 pt-4 border-t border-slate-100">
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
      </div>

      {/* Close button — kept inline so it can sit on top of the gradient
          header with white styling. BaseModal's default close button is
          slate-on-white and wouldn't be visible against the gradient. */}
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
