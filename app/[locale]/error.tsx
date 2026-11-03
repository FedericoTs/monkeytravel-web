"use client";

/**
 * Root locale error boundary.
 *
 * Without it an uncaught render error on a /[locale]/* route falls through to
 * Next's default global-error screen: no branding, no recovery CTA, no Sentry
 * tag. It catches everything but /[locale]/shared/[token], which has its own.
 *
 * Locale-scoped (not /app/error.tsx) so the "Go home" link stays
 * locale-aware.
 */

import RouteError, { type RouteErrorProps } from "@/components/RouteError";

export default function LocaleError(props: RouteErrorProps) {
  return <RouteError {...props} errorType="locale-root-error" messages="common.errorPage" tone="rose" />;
}
