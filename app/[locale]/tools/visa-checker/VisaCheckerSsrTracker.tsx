"use client";

/**
 * Day-4 bug fix (P3.10): tools_visa_checker_query PostHog event was
 * only fired from the form's onSubmit handler. SSR-rendered shared
 * links (?from=XX&to=YY — the architected primary SEO path) bypassed
 * the form entirely, so the funnel undercounted inbound conversions
 * from social shares, blog cross-links, and direct URL navigations.
 *
 * Fires once on mount when the page rendered with a query. The
 * `kind` prop distinguishes shared-link landings from form submits
 * so analytics can segment them cleanly:
 *   - kind=ssr  → shared-link landing (this component)
 *   - kind=form → user-submitted form  (VisaCheckerForm.onSubmit)
 *
 * Uses a ref guard so React 19 StrictMode double-mount in dev doesn't
 * double-fire the event in production (StrictMode is dev-only but
 * the guard costs nothing and matches the pattern used elsewhere).
 */

import { useEffect, useRef } from "react";
import { capture } from "@/lib/posthog";

interface Props {
  from: string;
  to: string;
  locale: string;
  hasResult: boolean;
}

export default function VisaCheckerSsrTracker({
  from,
  to,
  locale,
  hasResult,
}: Props) {
  const firedRef = useRef(false);

  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    try {
      void capture("tools_visa_checker_query", {
        from,
        to,
        locale,
        kind: "ssr",
        has_result: hasResult,
      });
    } catch {
      // best-effort; never let analytics throw past this component
    }
  }, [from, to, locale, hasResult]);

  return null;
}
