"use client";

/**
 * Third-party tags that must not fire until the visitor has agreed.
 *
 * WHAT WAS WRONG
 * --------------
 * GA4 was mounted in app/layout.tsx gated only on the presence of
 * NEXT_PUBLIC_GA_MEASUREMENT_ID, and the Travelpayouts loader was mounted
 * unconditionally. Neither knew the consent banner existed. Measured against
 * production on 2026-09-01 with a fresh profile:
 *
 *   BEFORE any consent choice, banner still on screen:
 *     3 GA4 requests, 1 doubleclick request, and the persistent cookies
 *     `_ga` + `_ga_VDJ39DLTNX` already written. window.dataLayer contained no
 *     gtag('consent', ...) call at all.
 *   AFTER clicking "Essential Only" (analytics:false, marketing:false):
 *     7 Travelpayouts requests.
 *   AFTER a further navigation, with analytics:false stored:
 *     4 more GA4 requests.
 *
 * So every visitor was assigned a persistent Google identifier before
 * consenting, and the ones who explicitly declined were tracked anyway. A
 * banner that does not govern the tags is worse than no banner: it tells the
 * visitor something untrue.
 *
 * WHY GATE THE MOUNT RATHER THAN USE CONSENT MODE
 * -----------------------------------------------
 * Google Consent Mode still loads gtag.js and still sends cookieless pings
 * before consent. Not mounting at all is the stronger guarantee and it matches
 * how PostHog is already handled in lib/analytics/consent-aware-init.ts. The
 * cost is losing Google's consent-mode modelling, which is a marketing
 * trade-off, not a correctness one.
 *
 * WHY THIS COMPONENT EXISTS INSTEAD OF useConsent()
 * -------------------------------------------------
 * ConsentWrapper (which supplies ConsentProvider) is mounted in
 * app/[locale]/layout.tsx — a CHILD of the root layout where these tags live.
 * Calling useConsent() here throws "must be used within a ConsentProvider".
 * So this reads the stored record directly and subscribes to the same
 * `mt_consent_change` event the provider dispatches, which makes it react the
 * moment someone presses Accept All.
 *
 * NOT GATED, DELIBERATELY: Sentry. instrumentation-client.ts documents error
 * tracking as essential functionality, and already gates the two parts that
 * are not — performance sampling on analytics consent, session replay on
 * explicit sessionRecording consent. That is a defensible split, so it is left
 * exactly as it is.
 */

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { GoogleAnalytics } from "@next/third-parties/google";
import { CONSENT_CHANGE_EVENT } from "@/lib/consent";
import { loadLocalConsent } from "@/lib/consent/storage";
import type { ConsentState } from "@/lib/consent";

const AffiliateScript = dynamic(() => import("@/components/AffiliateScript"));

/**
 * Remove the identifiers Google already set.
 *
 * Without this, a visitor who accepts and later withdraws keeps the `_ga`
 * client id that was written while they were consenting — and anyone who
 * loaded the site before this fix is still carrying one right now.
 */
function clearGoogleCookies() {
  if (typeof document === "undefined") return;
  const host = window.location.hostname;
  // Cookies were set on the registrable domain, so clear both that and the
  // exact host; a wrong-domain delete silently does nothing.
  const domains = [host, `.${host}`, `.${host.split(".").slice(-2).join(".")}`];
  for (const raw of document.cookie.split(";")) {
    const name = raw.split("=")[0]?.trim();
    if (!name || !/^(_ga|_gid|_gcl)/.test(name)) continue;
    for (const domain of domains) {
      document.cookie = `${name}=; Max-Age=0; path=/; domain=${domain}`;
    }
    document.cookie = `${name}=; Max-Age=0; path=/`;
  }
}

export function ConsentGatedTags({ nonce }: { nonce?: string }) {
  // null = not read yet. Nothing renders in that state, which also keeps the
  // server and first client paint identical.
  const [consent, setConsent] = useState<ConsentState | null>(null);

  useEffect(() => {
    const read = () => setConsent(loadLocalConsent()?.consent ?? null);
    read();

    const onChange = (event: Event) => {
      const next = (event as CustomEvent<ConsentState>).detail ?? null;
      setConsent(next ?? loadLocalConsent()?.consent ?? null);
      if (next && !next.analytics) clearGoogleCookies();
    };

    window.addEventListener(CONSENT_CHANGE_EVENT, onChange);
    return () => window.removeEventListener(CONSENT_CHANGE_EVENT, onChange);
  }, []);

  const gaId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

  return (
    <>
      {gaId && consent?.analytics ? (
        <GoogleAnalytics gaId={gaId} nonce={nonce} />
      ) : null}
      {/* Affiliate beacons are marketing, not analytics. Note the measured
          context: all four Travelpayouts services are disabled at account
          level, so these requests currently carry privacy exposure and page
          weight for zero revenue. */}
      {consent?.marketing ? <AffiliateScript nonce={nonce} /> : null}
    </>
  );
}

export default ConsentGatedTags;
