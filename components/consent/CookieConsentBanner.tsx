"use client";

/**
 * Cookie Consent Banner
 *
 * GDPR-compliant banner that appears on first visit.
 * Allows users to accept all, essential only, or customize settings.
 *
 * Mounts after a 1.5s delay so the hero LCP completes first. Caught
 * live in LIVE_AUDIT.md B4 — the banner was previously rendering
 * immediately, partially obscuring the hero CTAs on first paint AND
 * stealing main-thread budget that made the phone-mockup image take
 * 3-8s to appear. Per Gmail/Outlook bulk-sender deliverability research
 * the consent banner is at most ~1s of "delay" the user notices; this
 * trade-off prioritises perceived speed of the hero.
 *
 * IT WAS STILL OBSCURING THE HERO, JUST LATER (fixed 2026-09-01)
 * -------------------------------------------------------------
 * Delaying the mount postponed the overlap rather than removing it. On
 * desktop this was a 282px card pinned to the bottom, and the homepage hero
 * sits at roughly y=524. Measured with RAW clicks at the initial scroll
 * position — Playwright's .click() auto-scrolls, which moves the hero out from
 * under a fixed element and hides the bug entirely:
 *
 *     1280x800   destination field + "Plan my trip"  UNREACHABLE
 *     1280x720   UNREACHABLE
 *     1366x768   UNREACHABLE
 *     1440x900   fine
 *
 * i.e. broken on the three most common laptop shapes. A visitor lands, clicks
 * the field, types a destination, and nothing happens — with no visual cue
 * that the banner is modal, that reads as a broken site. The homepage converts
 * at 48.7% and is the highest-intent entry point in the funnel.
 *
 * Two things fix it, and BOTH are needed:
 *   1. pointer-events-none on the full-width wrapper (auto on the card), so
 *      the transparent gutter either side stops swallowing clicks.
 *   2. The layout is ONE ROW on md+ — text left, buttons right — instead of
 *      three stacked blocks plus a separate privacy line. That is what
 *      actually clears the hero; (1) alone fixed none of the three failing
 *      sizes, because what sat over the field was the card itself.
 *
 * "Customize" also now renders at EVERY width. It was `hidden sm:flex`, which
 * left mobile visitors with accept-all or essential-only and no granular
 * choice at all — the control is a legal requirement, not a nicety. The
 * privacy link moved inline for the same reason: it was desktop-only.
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useConsent } from "@/lib/consent";

export function CookieConsentBanner() {
  const t = useTranslations("consent");
  const { bannerStatus, acceptAll, acceptEssentialOnly, openSettings } =
    useConsent();
  // Defer the visible mount so the hero LCP finishes first. Without this
  // the banner competes with the hero phone image for main-thread + paint
  // priority and visibly delays both. 1.5s is long enough for typical
  // hero rendering, short enough that GDPR compliance still applies.
  const [readyToShow, setReadyToShow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setReadyToShow(true), 1500);
    return () => clearTimeout(timer);
  }, []);

  // Don't render if banner should be hidden, or while we're still in
  // the LCP-protection window.
  if (bannerStatus !== "visible" || !readyToShow) {
    return null;
  }

  return (
    // On mobile pin to TOP — many pages have a fixed-bottom action bar
    // (wizard Continue, save bar, sticky CTAs) that this banner used to
    // cover at z-9999. Top is reachable without obstructing primary
    // actions. On desktop keep at bottom (no fixed-bottom action bars).
    <div className="fixed top-0 left-0 right-0 sm:top-auto sm:bottom-0 z-[9999] p-3 sm:p-4 pointer-events-none animate-in slide-in-from-top sm:slide-in-from-bottom duration-300">
      <div className="max-w-5xl mx-auto pointer-events-auto">
        <div className="bg-white rounded-xl sm:rounded-2xl shadow-2xl border border-slate-200 p-3 sm:p-4 md:flex md:items-center md:gap-5">
          {/* Message */}
          <div className="flex items-start md:items-center gap-3 md:flex-1 md:min-w-0">
            {/* Icon — widest screens only; it is decoration, and dropping it
                below lg buys the row its horizontal space back. */}
            <div className="hidden lg:flex w-10 h-10 rounded-xl bg-[var(--primary)]/10 items-center justify-center flex-shrink-0">
              <svg
                className="w-5 h-5 text-[var(--primary-ink)]"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                />
              </svg>
            </div>

            <div className="min-w-0">
              <h3 className="text-sm sm:text-base font-bold text-[var(--foreground)] mb-0.5">
                {t("banner.title")}
              </h3>
              <p className="text-xs sm:text-sm text-slate-600 leading-snug line-clamp-2">
                {t("banner.description")}
              </p>
              {/* Kept OUT of the clamped paragraph above: clipped text would
                  make the privacy link unreachable, which is the opposite of
                  the point. */}
              <p className="text-[11px] sm:text-xs text-slate-500 mt-1">
                <button
                  onClick={openSettings}
                  className="text-[var(--primary-ink)] hover:underline font-medium"
                >
                  {t("banner.learnMore")}
                </button>
                <span className="mx-1.5 text-slate-300">·</span>
                <a
                  href="/privacy"
                  className="text-[var(--primary-ink)] hover:underline"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t("banner.privacyPolicy")}
                </a>
              </p>
            </div>
          </div>

          {/* Actions — inline with the message on md+, stacked below on mobile */}
          <div className="flex flex-row gap-2 mt-3 md:mt-0 md:flex-shrink-0">
            <button
              onClick={acceptEssentialOnly}
              className="flex-1 md:flex-none px-3 sm:px-4 py-2.5 rounded-lg sm:rounded-xl font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 transition-colors text-xs sm:text-sm whitespace-nowrap"
            >
              {t("banner.essentialOnly")}
            </button>
            <button
              onClick={openSettings}
              className="flex flex-1 md:flex-none px-3 sm:px-4 py-2.5 rounded-lg sm:rounded-xl font-semibold text-[var(--primary-ink)] border-2 border-[var(--primary)]/20 hover:border-[var(--primary)]/40 hover:bg-[var(--primary)]/5 transition-colors text-xs sm:text-sm items-center justify-center whitespace-nowrap"
            >
              {t("banner.customize")}
            </button>
            <button
              onClick={acceptAll}
              className="flex-1 md:flex-none px-3 sm:px-4 py-2.5 rounded-lg sm:rounded-xl font-semibold text-white bg-[var(--primary)] hover:bg-[var(--primary-dark)] transition-colors text-xs sm:text-sm shadow-lg shadow-[var(--primary)]/25 whitespace-nowrap"
            >
              {t("banner.acceptAll")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default CookieConsentBanner;
