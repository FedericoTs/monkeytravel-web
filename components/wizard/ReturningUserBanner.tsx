"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/lib/i18n/routing";

/**
 * Step 1's welcome back for a signed-in planner who already has trips: their
 * trips, or carry on with a new one.
 */
export default function ReturningUserBanner({ onDismiss }: { onDismiss: () => void }) {
  const t = useTranslations("trips");
  return (
    <div className="mb-6 p-4 bg-gradient-to-r from-[var(--primary)]/5 to-[var(--secondary)]/5 border border-[var(--primary)]/20 rounded-xl">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-[var(--primary)]/10 flex items-center justify-center flex-shrink-0">
          <svg className="w-5 h-5 text-[var(--primary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
          </svg>
        </div>
        <div className="flex-1">
          <h3 className="font-semibold text-slate-900">{t("wizard.returningUser.welcomeBack")}</h3>
          <p className="text-sm text-slate-600 mt-1">
            {t("wizard.returningUser.subtitle")}
          </p>
          <div className="flex items-center gap-3 mt-3">
            <Link
              href="/trips"
              className="px-4 py-2 bg-[var(--primary)] text-white text-sm font-medium rounded-lg hover:bg-[var(--primary)]/90 transition-colors"
            >
              {t("wizard.returningUser.goToMyTrips")}
            </Link>
            <button
              onClick={onDismiss}
              className="px-4 py-2 text-slate-600 text-sm font-medium hover:text-slate-900 transition-colors"
            >
              {t("wizard.returningUser.startNewTrip")}
            </button>
          </div>
        </div>
        <button
          onClick={onDismiss}
          className="p-1 text-slate-500 hover:text-slate-600 transition-colors"
          aria-label={t("wizard.returningUser.dismiss")}
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
