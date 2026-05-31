"use client";

/**
 * Client-side wrapper for opening external URLs from a Server Component.
 *
 * Server Components cannot call openExternal() directly (it's a client
 * function that probes window.Capacitor and dynamically imports
 * @capacitor/browser). Plain <a target="_blank"> is silently swallowed
 * inside the iOS Capacitor WKWebView — the click does nothing.
 *
 * Renders a real <a href target="_blank" rel="..."> so:
 *   - Google sees the rel attribute (critical for `sponsored nofollow`
 *     affiliate disclosure on iVisa CTAs — invisible `data-rel` risked
 *     a manual-action penalty), and the FCDO advisory authority signal
 *     via the link.
 *   - Middle-click / cmd-click / right-click "Copy link" / "Open in new
 *     tab" all work as users expect.
 *   - Screen readers announce it as a link, not a button.
 *
 * The onClick handler intercepts the navigation only inside the
 * Capacitor mobile shell (where target="_blank" is swallowed by the
 * iOS WKWebView) and routes through openExternal() instead. In the
 * regular browser the click is allowed through — the <a> navigates
 * natively and middle-click / modifier-click semantics are preserved.
 *
 * Day-4 bug fix: original implementation had no analytics call, so the
 * day-2 anchor→button swap silently killed PostHog click attribution
 * for every CTA migrated through this component (notably iVisa affiliate
 * clicks — 20% commission, 365-day cookie). The PostHog capture fires
 * on every click regardless of platform.
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

import type { MouseEvent, ReactNode } from "react";
import { openExternal } from "@/lib/native/external-link";
import { capture } from "@/lib/posthog";

interface ExternalLinkButtonProps {
  href: string;
  className?: string;
  children: ReactNode;
  /**
   * Rendered as the real <a rel="..."> attribute. Critical for SEO
   * disclosure on affiliate (sponsored) and outbound (nofollow) links.
   * Defaults to "noopener noreferrer" — the standard hardening for
   * target="_blank" — when the caller doesn't override it.
   */
  rel?: string;
  /**
   * Additional data-* attributes to spread onto the anchor. Useful for
   * preserving analytics hooks or tracking markers. Keys should already
   * include the "data-" prefix.
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
   * Optional aria-label override. Defaults to the link text content
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
  const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
    // Fire analytics first (same order as PartnerButton). Swallow any
    // PostHog error — never let instrumentation block the navigation.
    if (captureEvent) {
      try {
        void capture(captureEvent, { ...captureProps, url: href });
      } catch {
        // best-effort
      }
    }

    // Only intercept the navigation inside the Capacitor mobile shell,
    // where target="_blank" is silently swallowed by the WKWebView.
    // In a regular browser, let the <a> navigate natively so middle-
    // click, cmd/ctrl-click, "open in new tab" all keep working.
    //
    // Also bail out if the user is using a modifier-click or non-primary
    // button — those should always defer to the browser's default
    // behaviour (new tab, new window, download, etc.) even on native.
    if (
      e.defaultPrevented ||
      e.button !== 0 ||
      e.metaKey ||
      e.ctrlKey ||
      e.shiftKey ||
      e.altKey
    ) {
      return;
    }

    const cap = (
      window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }
    ).Capacitor;

    if (cap?.isNativePlatform?.()) {
      e.preventDefault();
      void openExternal(href);
    }
    // Otherwise: do nothing, let the <a target="_blank"> navigate.
  };

  return (
    <a
      href={href}
      target="_blank"
      rel={rel ?? "noopener noreferrer"}
      onClick={handleClick}
      className={className}
      aria-label={ariaLabel}
      {...dataAttrs}
    >
      {children}
    </a>
  );
}
