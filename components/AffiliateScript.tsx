"use client";

/**
 * Interaction-gated affiliate script loader.
 *
 * The Travelpayouts script was previously loaded via Next/Script with
 * `strategy="lazyOnload"` directly in app/layout.tsx. On long pages
 * (homepage), the browser never actually goes "idle" because of
 * continuous animations + scroll repaints — lazyOnload either takes
 * forever OR fires during a scroll and contributes to the deep-scroll
 * renderer hang caught live in LIVE_AUDIT F7.
 *
 * This component delays mounting the Script until ONE of:
 *   1. The user has scrolled (any interaction)
 *   2. 6 seconds have passed since mount (fallback so eventually-idle
 *      visitors still see affiliate links)
 *
 * Result: the script never competes with the LCP / above-the-fold paint,
 * and never fires synchronously with scroll repaints.
 */

import { useEffect, useState } from "react";
import Script from "next/script";

interface AffiliateScriptProps {
  /**
   * Per-request CSP nonce. Forwarded from the server `RootLayout` (which
   * reads it via `getNonce()`). Required when the nonce-based CSP is
   * enforced in production — without it the browser refuses to execute
   * the Travelpayouts loader script.
   */
  nonce?: string;
}

// The Travelpayouts loader only whitelists production hosts (marker 483997 =
// monkeytravel.app). On localhost / preview it 403s its entrypoint_config fetch
// and logs "config is not valid" ×4 on every page load — harmless but it
// pollutes local console/network traces during dev (UX10X Phase 0.4). Gate the
// whole component to production; prod is unaffected (already whitelisted → 200).
const AFFILIATE_ENABLED = process.env.NODE_ENV === "production";

export default function AffiliateScript({ nonce }: AffiliateScriptProps) {
  const [shouldLoad, setShouldLoad] = useState(false);

  useEffect(() => {
    if (!AFFILIATE_ENABLED) return;
    let didLoad = false;
    const load = () => {
      if (didLoad) return;
      didLoad = true;
      setShouldLoad(true);
      window.removeEventListener("scroll", load);
      window.removeEventListener("pointerdown", load);
      window.removeEventListener("keydown", load);
    };

    // Fire on first interaction.
    window.addEventListener("scroll", load, { passive: true, once: true });
    window.addEventListener("pointerdown", load, { passive: true, once: true });
    window.addEventListener("keydown", load, { once: true });

    // Fallback: load anyway after 6s of no interaction so the affiliate
    // network gets its impression on idle visitors.
    const timer = setTimeout(load, 6000);

    return () => {
      clearTimeout(timer);
      window.removeEventListener("scroll", load);
      window.removeEventListener("pointerdown", load);
      window.removeEventListener("keydown", load);
    };
  }, []);

  if (!shouldLoad) return null;

  return (
    <Script
      src="https://emrldco.com/NDgzOTk3.js?t=483997"
      strategy="lazyOnload"
      nonce={nonce}
    />
  );
}
