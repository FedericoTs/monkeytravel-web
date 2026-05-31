"use client";

/**
 * Client-side wrapper for opening external URLs from a Server Component.
 *
 * Server Components cannot call openExternal() directly (it's a client
 * function that probes window.Capacitor and dynamically imports
 * @capacitor/browser). Plain <a target="_blank"> is silently swallowed
 * inside the iOS Capacitor WKWebView — the click does nothing.
 *
 * Renders a <button> styled like a link. The caller is responsible for
 * the visual treatment via className (no implicit styling here — we
 * want to be a drop-in replacement for the <a> it replaces).
 *
 * Day-4 bug fix: original implementation had no analytics call, so the
 * day-2 anchor→button swap silently killed PostHog click attribution
 * for every CTA migrated through this component (notably iVisa affiliate
 * clicks — 20% commission, 365-day cookie). Autocapture cannot recover
 * the URL because <button> has no href. Mirror PartnerButton's pattern:
 * accept an optional capture event name + props, fire before openExternal.
 *
 * Usage from a Server Component:
 *   <ExternalLinkButton
 *     href={partnerUrl}
 *     className="inline-flex ..."
 *     rel="noopener sponsored nofollow"
 *     captureEvent="tools_visa_checker_external_click"
 *     captureProps={{ kind: "ivisa", from, to }}
 *   >
 *     Book on Partner
 *   </ExternalLinkButton>
 */

import type { ReactNode } from "react";
import { openExternal } from "@/lib/native/external-link";
import { capture } from "@/lib/posthog";

interface ExternalLinkButtonProps {
  href: string;
  className?: string;
  children: ReactNode;
  /**
   * Preserved from the original <a rel="..."> attribute. Rendered as
   * data-rel so the intent stays in the DOM for crawlers/inspection,
   * even though <button> ignores rel.
   */
  rel?: string;
  /**
   * Additional data-* attributes to spread onto the button. Useful for
   * preserving analytics hooks or tracking markers from the original
   * <a>. Keys should already include the "data-" prefix.
   */
  dataAttrs?: Record<string, string>;
  /**
   * Optional PostHog event name fired before openExternal. Omit for
   * non-tracked links (e.g. one-off info links). When present, the
   * captureProps are merged with `{ url: href }` and sent to PostHog.
   */
  captureEvent?: string;
  /**
   * Structured props for the capture event. Keep keys snake_case to
   * match the rest of the PostHog event vocabulary.
   */
  captureProps?: Record<string, unknown>;
  /**
   * Optional aria-label override. Defaults to the button text content
   * but overrideable for screen-reader clarity when the children
   * include emoji or icons.
   */
  ariaLabel?: string;
}

export default function ExternalLinkButton({
  href,
  className,
  children,
  rel,
  dataAttrs,
  captureEvent,
  captureProps,
  ariaLabel,
}: ExternalLinkButtonProps) {
  const handleClick = () => {
    // Fire analytics first (same order as PartnerButton). Swallow any
    // PostHog error — never let instrumentation block the navigation.
    if (captureEvent) {
      try {
        void capture(captureEvent, { ...captureProps, url: href });
      } catch {
        // best-effort
      }
    }
    void openExternal(href);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className={className}
      data-rel={rel}
      aria-label={ariaLabel}
      {...dataAttrs}
    >
      {children}
    </button>
  );
}
