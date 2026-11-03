"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { reportBoundaryError } from "@/lib/observability/report-boundary-error";
import { Link } from "@/lib/i18n/routing";

const TONES = {
  rose: { badge: "bg-rose-50", icon: "text-rose-500" },
  amber: { badge: "bg-amber-50", icon: "text-amber-500" },
} as const;

export interface RouteErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/**
 * The branded card a route's error boundary shows: try again, go home, and the
 * error id support can match to the Sentry event. The error is reported under
 * `errorType`, with its digest and raw stack.
 */
export default function RouteError({
  error,
  reset,
  errorType,
  messages,
  tone,
}: RouteErrorProps & {
  errorType: string;
  /** Where its title, body, retry, home and errorId strings are. */
  messages: "common.errorPage" | "common.shared.loadError";
  tone: keyof typeof TONES;
}) {
  const t = useTranslations(messages);
  useEffect(() => {
    reportBoundaryError(error, errorType);
  }, [error, errorType]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <div className="max-w-md text-center">
        <div className={`w-16 h-16 mx-auto mb-4 rounded-full ${TONES[tone].badge} flex items-center justify-center`}>
          <svg className={`w-8 h-8 ${TONES[tone].icon}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"
            />
          </svg>
        </div>
        <h1 className="text-xl font-semibold text-slate-900 mb-2">{t("title")}</h1>
        <p className="text-slate-500 mb-6">{t("body")}</p>
        <div className="flex gap-3 justify-center">
          <button
            onClick={reset}
            className="px-5 py-2.5 bg-[var(--primary)] text-white rounded-lg font-medium text-sm hover:opacity-90 transition-opacity"
          >
            {t("retry")}
          </button>
          <Link
            href="/"
            className="px-5 py-2.5 bg-white text-[var(--primary-ink)] border border-slate-200 rounded-lg font-medium text-sm hover:bg-slate-50 transition-colors"
          >
            {t("home")}
          </Link>
        </div>
        {error.digest && (
          <p className="mt-6 text-xs text-slate-500">
            {t("errorId", { digest: error.digest })}
          </p>
        )}
      </div>
    </div>
  );
}
