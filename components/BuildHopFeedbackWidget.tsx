"use client";

/**
 * BuildHop's feedback widget for the launch listing
 * (https://buildhop.io/discover/monkeytravel-6a52cf38-01c1-4cb9-9420-4a901acb64f5).
 * Lets visitors who found us via BuildHop leave feedback without leaving the
 * site.
 *
 * `strategy="lazyOnload"` mirrors the plain `async` attribute BuildHop's own
 * embed snippet specifies — non-blocking, loaded once the page is otherwise
 * idle. Unlike AffiliateScript.tsx this has no custom interaction-gating:
 * that component's gating exists to work around a scroll-hang bug specific
 * to the Travelpayouts loader (LIVE_AUDIT F7), not a general pattern every
 * third-party script needs.
 */

import Script from "next/script";

interface BuildHopFeedbackWidgetProps {
  /** Per-request CSP nonce — see AffiliateScript.tsx for why this is required. */
  nonce?: string;
}

export default function BuildHopFeedbackWidget({ nonce }: BuildHopFeedbackWidgetProps) {
  return (
    <Script
      src="https://buildhop.io/feedback-widget.js"
      data-launch-id="6a52cf38-01c1-4cb9-9420-4a901acb64f5"
      strategy="lazyOnload"
      nonce={nonce}
    />
  );
}
