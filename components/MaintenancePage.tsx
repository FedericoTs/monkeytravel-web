"use client";

import { useTranslations } from "next-intl";

interface MaintenancePageProps {
  title?: string;
  message?: string;
}

export default function MaintenancePage({
  title,
  message,
}: MaintenancePageProps) {
  const t = useTranslations("common.maintenance");
  const displayTitle = title || t("title");
  const displayMessage = message || t("message");
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex flex-col items-center justify-center p-6">
      {/* Logo */}
      <div className="mb-8">
        <img
          src="/images/logo.png"
          alt="MonkeyTravel"
          className="h-16 w-16 mx-auto"
        />
      </div>

      {/* Main Card */}
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl border border-slate-200 p-8 text-center">
        {/* Icon */}
        <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-amber-100 flex items-center justify-center">
          <svg
            className="w-10 h-10 text-amber-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
        </div>

        {/* Title */}
        <h1 className="text-2xl font-bold text-slate-900 mb-4">{displayTitle}</h1>

        {/* Message */}
        <p className="text-slate-600 leading-relaxed mb-6">{displayMessage}</p>

        {/* Divider */}
        <div className="w-16 h-1 bg-[var(--primary)] mx-auto mb-6 rounded-full" />

        {/* Status */}
        <div className="flex items-center justify-center gap-2 text-sm text-slate-500">
          <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
          <span>{t("workingOnIt")}</span>
        </div>
      </div>

      {/* Footer */}
      <div className="mt-8 text-center">
        <p className="text-sm text-slate-400">
          {t("questions")}{" "}
          <a
            href="mailto:support@monkeytravel.app"
            className="text-[var(--primary)] hover:underline"
          >
            {t("contactSupport")}
          </a>
        </p>
      </div>

      {/* Decorative elements */}
      <div className="fixed top-0 left-0 w-64 h-64 bg-[var(--primary)]/5 rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2" />
      <div className="fixed bottom-0 right-0 w-64 h-64 bg-[var(--accent)]/10 rounded-full blur-3xl translate-x-1/2 translate-y-1/2" />
    </div>
  );
}
