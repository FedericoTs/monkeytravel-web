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
 * Usage from a Server Component:
 *   <ExternalLinkButton
 *     href={partnerUrl}
 *     className="inline-flex ..."
 *     rel="noopener sponsored nofollow"
 *   >
 *     Book on Partner
 *   </ExternalLinkButton>
 */

import type { ReactNode } from "react";
import { openExternal } from "@/lib/native/external-link";

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
}

export default function ExternalLinkButton({
  href,
  className,
  children,
  rel,
  dataAttrs,
}: ExternalLinkButtonProps) {
  return (
    <button
      type="button"
      onClick={() => {
        void openExternal(href);
      }}
      className={className}
      data-rel={rel}
      {...dataAttrs}
    >
      {children}
    </button>
  );
}
