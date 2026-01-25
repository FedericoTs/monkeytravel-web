"use client";

/**
 * Cookie Consent Banner
 *
 * GDPR-compliant banner that appears on first visit.
 * Allows users to accept all, essential only, or customize settings.
 */

import { useTranslations } from "next-intl";
import { useConsent } from "@/lib/consent";

export function CookieConsentBanner() {
  const t = useTranslations("consent");
  const { bannerStatus, acceptAll, acceptEssentialOnly, openSettings } =
    useConsent();

  // Don't render if banner should be hidden
  if (bannerStatus !== "visible") {
    return null;
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 z-[9999] p-4 md:p-6 animate-in slide-in-from-bottom duration-300">
      <div className="max-w-4xl mx-auto">
        <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 p-5 md:p-6">
          {/* Content */}
          <div className="flex flex-col md:flex-row md:items-start gap-4">
            {/* Icon */}
            <div className="hidden md:flex w-12 h-12 rounded-xl bg-[var(--primary)]/10 items-center justify-center flex-shrink-0">
              <svg
                className="w-6 h-6 text-[var(--primary)]"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                />
              </svg>
            </div>

            {/* Text */}
            <div className="flex-1">
              <h3 className="text-lg font-bold text-[var(--foreground)] mb-2">
                {t("banner.title")}
              </h3>
              <p className="text-sm text-slate-600 leading-relaxed">
                {t("banner.description")}{" "}
                <button
                  onClick={openSettings}
                  className="text-[var(--primary)] hover:underline font-medium"
                >
                  {t("banner.learnMore")}
                </button>
              </p>
            </div>
          </div>

          {/* Buttons */}
          <div className="flex flex-col sm:flex-row gap-3 mt-5">
            <button
              onClick={acceptEssentialOnly}
              className="flex-1 px-5 py-3 rounded-xl font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 transition-colors text-sm"
            >
              {t("banner.essentialOnly")}
            </button>
            <button
              onClick={openSettings}
              className="flex-1 px-5 py-3 rounded-xl font-semibold text-[var(--primary)] border-2 border-[var(--primary)]/20 hover:border-[var(--primary)]/40 hover:bg-[var(--primary)]/5 transition-colors text-sm"
            >
              {t("banner.customize")}
            </button>
            <button
              onClick={acceptAll}
              className="flex-1 px-5 py-3 rounded-xl font-semibold text-white bg-[var(--primary)] hover:bg-[var(--primary-dark)] transition-colors text-sm shadow-lg shadow-[var(--primary)]/25"
            >
              {t("banner.acceptAll")}
            </button>
          </div>

          {/* Privacy link */}
          <p className="text-xs text-slate-500 mt-4 text-center">
            {t("banner.privacyNote")}{" "}
            <a
              href="/privacy"
              className="text-[var(--primary)] hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              {t("banner.privacyPolicy")}
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}

export default CookieConsentBanner;
