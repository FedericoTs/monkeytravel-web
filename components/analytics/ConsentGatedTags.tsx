"use client";
/**
 * Third-party tags and the visitor's consent: the banner governs what loads.
 * A banner that does not govern the tags tells the visitor something untrue.
 *
 * GA4 runs in Consent Mode v2 "advanced": gtag.js loads with every storage
 * type DENIED (the default is pushed from <head> by app/layout.tsx, before
 * this component exists, via lib/analytics/ga-consent.ts), sends cookieless
 * pings until the visitor accepts, and Google models the non-consented
 * majority in its own reports. Nothing is stored on the device before
 * acceptance, and withdrawing consent deletes the identifiers Google set
 * while it was granted. NEXT_PUBLIC_GA_CONSENT_MODE=gated instead mounts GA4
 * only after acceptance, without a code change.
 *
 * The affiliate loader stays gated on marketing consent: it has no
 * cookieless mode, and its four services are disabled at account level
 * anyway, so it carries privacy exposure for no revenue.
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
import Script from "next/script";
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
 * client id that was written while they were consenting.
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

/**
 * gtag.js plus the two calls Google's snippet makes before it loads. They run
 * from bundled code rather than an inline script, so the tag needs no nonce
 * and no hash under either CSP; the dataLayer order (consent default, js,
 * config) is the same as with the snippet. The 190 KB tag is fetched only
 * after the page has loaded: the queued dataLayer commands wait for it.
 */
function GaTag({ gaId }: { gaId: string }) {
  useEffect(() => {
    const gtag = gtagOn(window as GtagWindow);
    gtag("js", new Date());
    gtag("config", gaId);
  }, [gaId]);
  return <Script src={`https://www.googletagmanager.com/gtag/js?id=${gaId}`} strategy="lazyOnload" />;
}

export function ConsentGatedTags() {
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
      {mountGa && gaId ? <GaTag gaId={gaId} /> : null}
      {/* Affiliate beacons are marketing, not analytics. Note the measured
          context: all four Travelpayouts services are disabled at account
          level, so these requests currently carry privacy exposure and page
          weight for zero revenue. */}
      {consent?.marketing ? <AffiliateScript /> : null}
    </>
  );
}

export default ConsentGatedTags;
