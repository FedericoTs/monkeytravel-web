"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/lib/i18n/routing";

/**
 * The form's sticky header: the way back (to the trips list once signed in)
 * and the step progress.
 */
export default function WizardHeader({
  isAuthenticated,
  step,
  totalSteps,
}: {
  isAuthenticated: boolean | null;
  step: number;
  totalSteps: number;
}) {
  const t = useTranslations("trips");
  return (
    <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-lg border-b border-slate-200">
      <div className="max-w-2xl mx-auto px-4 py-4 flex items-center justify-between">
        <Link
          href={isAuthenticated ? "/trips" : "/"}
          className="flex items-center gap-1.5 text-slate-600 hover:text-slate-900 px-2 py-1.5 -ml-2 rounded-lg hover:bg-slate-100 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          <span className="hidden sm:inline">{t("wizard.back")}</span>
        </Link>
        <div className="flex items-center gap-2">
          {Array.from({ length: totalSteps }).map((_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i + 1 <= step ? "bg-[var(--primary)] w-8" : "bg-slate-200 w-4"
              }`}
            />
          ))}
        </div>
        {/* Keyed by step: a browser translating the page would keep the old number otherwise. */}
        <div key={step} className="text-sm text-slate-500">
          {step}/{totalSteps}
        </div>
      </div>
    </header>
  );
}
