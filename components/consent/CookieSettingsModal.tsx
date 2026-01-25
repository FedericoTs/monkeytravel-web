"use client";

/**
 * Cookie Settings Modal
 *
 * Detailed consent management modal with category toggles.
 * Allows granular control over each consent category.
 */

import { useTranslations } from "next-intl";
import { useConsent, CONSENT_CATEGORIES, ConsentCategory } from "@/lib/consent";

export function CookieSettingsModal() {
  const t = useTranslations("consent");
  const {
    consent,
    bannerStatus,
    updateCategory,
    acceptAll,
    acceptEssentialOnly,
    closeSettings,
  } = useConsent();

  // Don't render if modal should be hidden
  if (bannerStatus !== "settings_open") {
    return null;
  }

  const handleSaveSettings = () => {
    // Settings are already saved on toggle, just close
    closeSettings();
  };

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={closeSettings}
      />

      {/* Modal */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-hidden animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[var(--primary)]/10 flex items-center justify-center">
              <svg
                className="w-5 h-5 text-[var(--primary)]"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                />
              </svg>
            </div>
            <h2 className="text-lg font-bold text-[var(--foreground)]">
              {t("settings.title")}
            </h2>
          </div>
          <button
            onClick={closeSettings}
            className="p-2 rounded-lg hover:bg-slate-100 transition-colors"
            aria-label={t("settings.close")}
          >
            <svg
              className="w-5 h-5 text-slate-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="p-5 overflow-y-auto max-h-[calc(90vh-180px)]">
          <p className="text-sm text-slate-600 mb-5">
            {t("settings.description")}
          </p>

          {/* Categories */}
          <div className="space-y-4">
            {CONSENT_CATEGORIES.map((category) => (
              <ConsentCategoryToggle
                key={category.id}
                categoryId={category.id}
                isEnabled={consent[category.id]}
                isRequired={category.required}
                services={category.services}
                translationKey={category.translationKey}
                onToggle={(enabled) =>
                  !category.required &&
                  updateCategory(
                    category.id as Exclude<ConsentCategory, "essential">,
                    enabled
                  )
                }
              />
            ))}
          </div>

          {/* Privacy link */}
          <p className="text-xs text-slate-500 mt-6">
            {t("settings.moreInfo")}{" "}
            <a
              href="/privacy"
              className="text-[var(--primary)] hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              {t("settings.privacyPolicy")}
            </a>
          </p>
        </div>

        {/* Footer */}
        <div className="flex flex-col sm:flex-row gap-3 p-5 border-t border-slate-200 bg-slate-50">
          <button
            onClick={acceptEssentialOnly}
            className="flex-1 px-4 py-2.5 rounded-xl font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 transition-colors text-sm"
          >
            {t("settings.rejectAll")}
          </button>
          <button
            onClick={handleSaveSettings}
            className="flex-1 px-4 py-2.5 rounded-xl font-medium text-[var(--primary)] border-2 border-[var(--primary)]/30 hover:border-[var(--primary)] hover:bg-[var(--primary)]/5 transition-colors text-sm"
          >
            {t("settings.saveSettings")}
          </button>
          <button
            onClick={acceptAll}
            className="flex-1 px-4 py-2.5 rounded-xl font-medium text-white bg-[var(--primary)] hover:bg-[var(--primary-dark)] transition-colors text-sm"
          >
            {t("settings.acceptAll")}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Individual consent category toggle
 */
function ConsentCategoryToggle({
  categoryId,
  isEnabled,
  isRequired,
  services,
  translationKey,
  onToggle,
}: {
  categoryId: string;
  isEnabled: boolean;
  isRequired: boolean;
  services: string[];
  translationKey: string;
  onToggle: (enabled: boolean) => void;
}) {
  const t = useTranslations("consent");

  return (
    <div
      className={`p-4 rounded-xl border-2 transition-colors ${
        isEnabled
          ? "border-[var(--primary)]/30 bg-[var(--primary)]/5"
          : "border-slate-200 bg-white"
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-[var(--foreground)]">
              {t(`categories.${translationKey}.title`)}
            </h3>
            {isRequired && (
              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-200 text-slate-600">
                {t("settings.required")}
              </span>
            )}
          </div>
          <p className="text-sm text-slate-600 mt-1">
            {t(`categories.${translationKey}.description`)}
          </p>
          {/* Services list */}
          <div className="flex flex-wrap gap-1.5 mt-2">
            {services.map((service) => (
              <span
                key={service}
                className="px-2 py-0.5 rounded text-xs bg-slate-100 text-slate-600"
              >
                {service}
              </span>
            ))}
          </div>
        </div>

        {/* Toggle */}
        <button
          type="button"
          role="switch"
          aria-checked={isEnabled}
          aria-label={t(`categories.${translationKey}.title`)}
          disabled={isRequired}
          onClick={() => onToggle(!isEnabled)}
          className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
            isEnabled ? "bg-[var(--primary)]" : "bg-slate-300"
          }`}
        >
          <span
            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
              isEnabled ? "translate-x-5" : "translate-x-0"
            }`}
          />
        </button>
      </div>
    </div>
  );
}

export default CookieSettingsModal;
