"use client";

/**
 * Root locale error boundary.
 *
 * Before this file existed (2026-05-28), any uncaught render error on any
 * /[locale]/* route fell through to Next's default global-error screen —
 * no branding, no recovery CTA, no Sentry tag. Only `/[locale]/shared/[token]`
 * had its own error.tsx.
 *
 * This boundary catches everything else (homepage, /trips, /explore,
 * /profile, blog, tools, destinations, etc.) and:
 *   - Reports to Sentry with `errorType: "locale-root-error"` tag so
 *     production crashes can be grouped + searched.
 *   - Shows the user a branded "try again / go home" recovery card.
 *   - Surfaces the error.digest so support can correlate user reports
 *     to Sentry events.
 *
 * Locale-scoped (not /app/error.tsx) so we have access to next-intl's
 * routing helpers — keeps the "Go home" link locale-aware. The few
 * places where finer-grained recovery is wanted (e.g. /shared/[token])
 * keep their own error.tsx alongside the route.
 */

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import { Link } from "@/lib/i18n/routing";

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function LocaleError({ error, reset }: ErrorProps) {
  useEffect(() => {
    Sentry.captureException(error, {
      tags: { errorType: "locale-root-error" },
    });
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <div className="max-w-md text-center">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-rose-50 flex items-center justify-center">
          <svg
            className="w-8 h-8 text-rose-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"
            />
          </svg>
        </div>
        <h1 className="text-xl font-semibold text-slate-900 mb-2">
          Something went wrong
        </h1>
        <p className="text-slate-500 mb-6">
          We hit an unexpected error loading this page. The team has been
          notified — please try again or head back home.
        </p>
        <div className="flex gap-3 justify-center">
          <button
            onClick={reset}
            className="px-5 py-2.5 bg-[var(--primary)] text-white rounded-lg font-medium text-sm hover:opacity-90 transition-opacity"
          >
            Try again
          </button>
          <Link
            href="/"
            className="px-5 py-2.5 bg-white text-[var(--primary)] border border-slate-200 rounded-lg font-medium text-sm hover:bg-slate-50 transition-colors"
          >
            Go home
          </Link>
        </div>
        {error.digest && (
          <p className="mt-6 text-xs text-slate-400">
            Error ID: {error.digest}
          </p>
        )}
      </div>
    </div>
  );
}
