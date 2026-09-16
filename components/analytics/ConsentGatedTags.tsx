"use client";
/**
 * Third-party tags and the visitor's consent.
 *
 * WHAT WAS WRONG (measured 2026-09-01)
 * ------------------------------------
 * GA4 was mounted in app/layout.tsx gated only on the presence of
 * NEXT_PUBLIC_GA_MEASUREMENT_ID, and the Travelpayouts loader was mounted
 * unconditionally. Neither knew the consent banner existed. Against
 * production with a fresh profile:
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
 * TWO DECISIONS, DATED
 * --------------------
 * 2026-09-02, gate the MOUNT: GA4 and the affiliate loader were not mounted
 * until the visitor agreed, and no gtag('consent') call was made, because
 * Consent Mode still loads gtag.js and still sends cookieless pings before
 * consent. Measured cost over the next fortnight: GA4 fell from ~20% to ~11%
 * of real visitors, because 73% of visitors leave within four seconds and
 * never decide, and the ones who do accept at roughly 60%.
 *
 * 2026-09-16, Consent Mode v2 "advanced": Federico chose to take Google's
 * modelling. gtag.js now loads with every storage type DENIED (the default is
 * pushed from <head> by app/layout.tsx, before this component exists, via
 * lib/analytics/ga-consent.ts), sends cookieless pings until the visitor
 * accepts, and Google models the non-consented majority in its own reports.
 * Nothing is stored on the device before acceptance. The consented path is
 * unchanged, and the withdrawal path still deletes the identifiers Google set
 * while consent was granted. NEXT_PUBLIC_GA_CONSENT_MODE=gated restores the
 * 2026-09-02 behaviour without a code change.
 *
 * The affiliate loader stays gated on marketing consent: it has no
 * cookieless mode, and its four services are disabled at account level
 * anyway, so it currently carries privacy exposure for zero revenue.
 *
 * The banner's provider mounts inside the locale layout, below this
 * component's slot in the root layout, so this reads the stored record
 * directly and subscribes to the same `mt_consent_change` event the provider
 * dispatches, which makes it react the moment someone presses Accept All.
 *
 * NOT GATED, DELIBERATELY: Sentry. instrumentation-client.ts documents error
 * tracking as essential functionality, and already gates the two parts that
 * are not: performance sampling on analytics consent, session replay on
 * explicit sessionRecording consent. That is a defensible split, so it is left
 * exactly as it is.
 */

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { GoogleAnalytics } from "@next/third-parties/google";
import { CONSENT_CHANGE_EVENT } from "@/lib/consent";
import { loadLocalConsent } from "@/lib/consent/storage";
import type { ConsentState } from "@/lib/consent";
import {
  GA_CONSENT_DEFAULT,
  GA_CONSENT_WAIT_FOR_UPDATE_MS,
  gaConsentModeFromEnv,
  gaConsentParamsFor,
} from "@/lib/analytics/ga-consent";

const AffiliateScript = dynamic(() => import("@/components/AffiliateScript"));

type GtagWindow = Window & {
  dataLayer?: unknown[];
  gtag?: (...args: unknown[]) => void;
  __mtGaConsentDefault?: boolean;
};

/**
 * gtag reads consent commands as `arguments` objects pushed on the dataLayer,
 * so this must be a real function, never an arrow with a spread array.
 */
function gtagOn(w: GtagWindow) {
  if (w.gtag) return w.gtag;
  w.dataLayer = w.dataLayer || [];
  const gtag = function () {
    // eslint-disable-next-line prefer-rest-params
    (w.dataLayer as unknown[]).push(arguments);
  };
  w.gtag = gtag;
  return gtag;
}

/**
 * The head script in app/layout.tsx normally pushes the denied default before
 * anything else runs. If it did not (a render path without the nonce, dev),
 * push it here: before gtag.js loads, order on the dataLayer is all that
 * matters, and an update without a default is silently ignored by Google.
 */
function ensureConsentDefault(w: GtagWindow) {
  if (w.__mtGaConsentDefault) return;
  const gtag = gtagOn(w);
  gtag("consent", "default", { ...GA_CONSENT_DEFAULT, wait_for_update: GA_CONSENT_WAIT_FOR_UPDATE_MS });
  gtag("set", "ads_data_redaction", true);
  w.__mtGaConsentDefault = true;
}

function pushConsentUpdate(consent: ConsentState) {
  const w = window as GtagWindow;
  ensureConsentDefault(w);
  gtagOn(w)("consent", "update", gaConsentParamsFor(consent));
}

/**
 * Remove the identifiers Google already set.
 *
 * Without this, a visitor who accepts and later withdraws keeps the `_ga`
 * client id that was written while they were consenting, and anyone who
 * loaded the site before the 2026-09-02 fix is still carrying one.
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
  // null = not read yet. In gated mode nothing renders in that state, which
  // also keeps the server and first client paint identical.
  const [consent, setConsent] = useState<ConsentState | null>(null);
  const gaId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
  const gaMode = gaConsentModeFromEnv(process.env.NEXT_PUBLIC_GA_CONSENT_MODE);

  useEffect(() => {
    const apply = (next: ConsentState | null) => {
      setConsent(next);
      // A stored or fresh choice becomes a consent update. Before any choice
      // the head default (all denied) stands and gtag sends cookieless pings.
      if (gaId && gaMode === "advanced" && next) pushConsentUpdate(next);
    };
    apply(loadLocalConsent()?.consent ?? null);

    const onChange = (event: Event) => {
      const next = (event as CustomEvent<ConsentState>).detail ?? loadLocalConsent()?.consent ?? null;
      apply(next);
      if (next && !next.analytics) clearGoogleCookies();
    };

    window.addEventListener(CONSENT_CHANGE_EVENT, onChange);
    return () => window.removeEventListener(CONSENT_CHANGE_EVENT, onChange);
  }, [gaId, gaMode]);

  const mountGa = !!gaId && (gaMode === "advanced" || !!consent?.analytics);

  return (
    <>
      {mountGa && gaId ? <GoogleAnalytics gaId={gaId} nonce={nonce} /> : null}
      {/* Affiliate beacons are marketing, not analytics. Note the measured
          context: all four Travelpayouts services are disabled at account
          level, so these requests currently carry privacy exposure and page
          weight for zero revenue. */}
      {consent?.marketing ? <AffiliateScript nonce={nonce} /> : null}
    </>
  );
}

export default ConsentGatedTags;
