"use client";

/**
 * Cookie Consent Banner
 *
 * GDPR-compliant banner that appears on first visit.
 * Allows users to accept all, essential only, or customize settings.
 *
 * It mounts once the page's own LCP is in (see readyToShow below), so it
 * never competes with the hero's first paint.
 *
 * IT MUST NEVER SIT ON THE PAGE'S PRIMARY ACTION
 * ----------------------------------------------
 * A fixed card over the field or button a visitor came for, with no cue that
 * the card is modal, reads as a broken site. Check it with RAW clicks at the
 * initial scroll position: Playwright's .click() auto-scrolls, which moves
 * the target out from under a fixed element and hides the problem.
 *
 * Two things keep the homepage hero clear, and BOTH are needed:
 *   1. pointer-events-none on the full-width wrapper (auto on the card), so
 *      the transparent gutter either side does not swallow clicks.
 *   2. ONE ROW on md+, text left and buttons right, instead of stacked
 *      blocks. What sits over the field is the card itself, so (1) alone does
 *      not clear it at the common laptop sizes (1280x800, 1280x720, 1366x768).
 *
 * "Customize" renders at EVERY width, and so does the inline privacy link:
 * the granular choice is a legal requirement, not a nicety.
 *
 * IT MINIMISES AFTER THE FIRST SCROLL OR INTERACTION
 * --------------------------------------------------
 * Even one row covers a primary action on some surfaces at the initial scroll
 * position: the wizard's inline Continue on desktop (no fixed footer there,
 * so the card sits on the form's last row), and on mobile the top of /trip
 * and /shared, where a top pin covers the trip title and the Back control for
 * every recipient of a shared link.
 *
 * Nothing non-essential loads before a choice, so the card does not need to
 * stay in the way to be compliant. After the visitor's first scroll, click or
 * key press OUTSIDE the card it minimises into
 * ConsentMiniBar, which carries both decisions at equal weight at every
 * width (see that file for what must not be "tidied up": the buttons are
 * unfilled on purpose). A click inside the card never minimises it, so the
 * e2e specs whose first action is "Essential only" are unaffected; Tab and
 * modifier keys are ignored so keyboard users can reach the buttons without
 * dismissing them. tests/e2e/consent-overlap.spec.ts guards all of this on
 * four surfaces at both viewports.
 *
 * PHONES OPEN ON THE BAR
 * ----------------------
 * Below 640px the tall top-pinned card would cover the menu and, on compact
 * headers, the page's heading. Phones get the compact ConsentMiniBar instead,
 * placed per screen by phoneBarOnTop() so it never covers the button the
 * visitor came for, and at the bottom once minimised. The full card is
 * desktop only.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { usePathname } from "next/navigation";
import { useConsent } from "@/lib/consent";
import { bannerVariantFor } from "@/lib/consent/consent-event-schema";
import { buildConsentEvent, sendConsentEvent } from "@/lib/consent/consent-event-client";
import { ConsentMiniBar } from "./ConsentMiniBar";

// Keys that move focus or modify other keys. A keyboard user tabbing towards
// the card's buttons must not dismiss the card on the way there.
const NAVIGATION_KEYS = new Set(["Tab", "Shift", "Control", "Alt", "Meta", "CapsLock"]);
// How far the page has to move before the card counts as "scrolled past".
const SCROLL_THRESHOLD_PX = 40;
// The phone bar is about 160px tall, up to 190px when its copy wraps.
const PHONE_BAR_SPACE_PX = 12 + 190;

/**
 * Where the phone bar goes on this screen: never over a button the visitor
 * came to press, and over the page's heading only when the bottom would cover
 * one (short screens). A brief cover of the nav is the cheapest of the three.
 */
function phoneBarOnTop(): boolean {
  const overlaps = (r: DOMRect, from: number, to: number) => r.bottom > from && r.top < to;
  const css = getComputedStyle(document.documentElement);
  const lift = Math.max(
    0,
    ...["--mt-bottom-bar-h", "--mt-nav-h", "--mt-sticky-cta-h"].map((v) => parseFloat(css.getPropertyValue(v)) || 0)
  );
  const bottomFrom = window.innerHeight - lift - PHONE_BAR_SPACE_PX;
  const h1 = document.querySelector("h1")?.getBoundingClientRect();
  const topCoversHeading = !!h1 && overlaps(h1, 0, PHONE_BAR_SPACE_PX);
  const bottomCoversAction = [...document.querySelectorAll("main a[href*='/trips/new'], main button")]
    .map((el) => el.getBoundingClientRect())
    .some((r) => r.width > 0 && overlaps(r, bottomFrom, window.innerHeight - lift));
  return !topCoversHeading || bottomCoversAction;
}

/**
 * ONE constant for both decisions, and it is a legal requirement rather than
 * a style preference.
 *
 * A filled "Accept All" beside a flat "Essential Only" is the
 * highlighted-button pattern EDPB Guidelines 03/2022 names directly, and it
 * is what the January 2022 CNIL decisions against Google (EUR 150M) and Meta
 * (EUR 60M) turned on: refusal must be as easy — and as visible — as
 * acceptance. Nearly every decision is made on this pair, so this is where an
 * asymmetry would matter.
 *
 * Keeping it as ONE string is the point: a single diffable constant is what
 * makes "the two buttons are identical" auditable, and it is the thing a
 * well-meaning future change ("the accept button lost its primary fill")
 * would otherwise quietly undo. Its padding, radius, font-size and
 * font-weight set the card's rendered height, which
 * tests/e2e/consent-overlap.spec.ts assertion 1 depends on.
 */
const CARD_DECISION_BTN =
  "flex-1 md:flex-none px-3 sm:px-4 py-2.5 rounded-lg sm:rounded-xl border border-slate-300 " +
  "bg-slate-100 hover:bg-slate-200 transition-colors font-semibold text-xs sm:text-sm " +
  "text-[var(--foreground)] whitespace-nowrap";

export function CookieConsentBanner() {
  const t = useTranslations("consent");
  const { bannerStatus, acceptAll, acceptEssentialOnly, openSettings } =
    useConsent();
  // /trips/new publishes its own fixed footer's height as --mt-footer-h (see
  // hooks/useCssVarHeight.ts); the bar sits above that footer on phones.
  const pathname = usePathname();
  const onWizard = /\/trips\/new(\/|$)/.test(pathname ?? "");
  // /trip/[slug] and /shared/[token] (both SharedTripView) publish their
  // fixed "Save this trip" bar's height as --mt-bottom-bar-h. That bar is
  // fixed at EVERY width, so the card sits above it at every width — never on
  // the primary action of a recipient's first visit.
  const onTripView = /\/(trip|shared)\/[^/]+/.test(pathname ?? "");
  // On the wizard, a trip or a shared trip the visitor is holding a plan, so
  // the card can say what the consent is FOR. Logged with every consent event
  // (consent_events.variant) so the two copies can be compared.
  const contextual = bannerVariantFor(pathname) === "contextual";
  // Client-only component (ConsentWrapper loads it with ssr:false).
  const [onPhone] = useState(() => window.matchMedia("(max-width: 639px)").matches);
  // Mount once the page's own LCP is in: at the load event (the hero
  // image is loaded by then) or after 1.5s, whichever comes first. Held
  // back longer, the card is itself the LCP on pages without a hero.
  const [readyToShow, setReadyToShow] = useState(
    () => typeof document !== "undefined" && document.readyState === "complete",
  );
  useEffect(() => {
    if (readyToShow) return;
    const show = () => setReadyToShow(true);
    const timer = setTimeout(show, 1500);
    window.addEventListener("load", show, { once: true });
    return () => {
      clearTimeout(timer);
      window.removeEventListener("load", show);
    };
  }, [readyToShow]);

  // Phones: top or bottom, decided per page after it has laid out and before
  // the bar shows, so it never jumps. The wizard and trip views publish bottom
  // bars the bar sits above.
  const [phoneTopFor, setPhoneTopFor] = useState<{ path: string; top: boolean } | null>(null);
  useEffect(() => {
    const path = pathname ?? "";
    if (!onPhone || !readyToShow || phoneTopFor?.path === path) return;
    const frame = requestAnimationFrame(() =>
      setPhoneTopFor({ path, top: !onWizard && !onTripView && phoneBarOnTop() })
    );
    return () => cancelAnimationFrame(frame);
  }, [onPhone, readyToShow, pathname, onWizard, onTripView, phoneTopFor]);

  // Minimised = the visitor has moved on (scrolled, or interacted with the
  // page outside the card) without choosing. Desktop shows a pill, mobile
  // shows nothing until the next navigation. See the header comment.
  // Keyed on the path, so a new page view asks again until a choice is made
  // without an effect that resets state on navigation.
  const [minimizedOnPath, setMinimizedOnPath] = useState<string | null>(null);
  const minimized = minimizedOnPath !== null && minimizedOnPath === (pathname ?? "");
  const setMinimized = useCallback(
    (value: boolean) => setMinimizedOnPath(value ? (pathname ?? "") : null),
    [pathname]
  );
  const cardRef = useRef<HTMLDivElement | null>(null);
  // One `shown` and at most one `minimized` per page view, whatever the card
  // does in between (the pill can bring it back).
  const shownForPath = useRef<string | null>(null);
  const minimizedForPath = useRef<string | null>(null);
  useEffect(() => {
    if (!minimized || minimizedForPath.current === pathname) return;
    minimizedForPath.current = pathname;
    sendConsentEvent(buildConsentEvent("minimized", null));
  }, [minimized, pathname]);
  useEffect(() => {
    if (bannerStatus !== "visible" || !readyToShow || minimized) return;
    if (shownForPath.current !== pathname) {
      shownForPath.current = pathname;
      sendConsentEvent(buildConsentEvent("shown", null));
    }
    const startY = window.scrollY;
    const onScroll = () => {
      if (Math.abs(window.scrollY - startY) > SCROLL_THRESHOLD_PX) {
        setMinimized(true);
      }
    };
    const onInteract = (event: Event) => {
      if (event instanceof KeyboardEvent && NAVIGATION_KEYS.has(event.key)) return;
      const target = event.target;
      if (target instanceof Node && cardRef.current?.contains(target)) return;
      // The phone's first view is the bar; a tap on it must not move it.
      if (target instanceof Element && target.closest("[data-consent-bar]")) return;
      setMinimized(true);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    // On the click, not the pointerdown: the minimised bar lands at the
    // bottom, and moving it while a finger is down would take the tap from
    // whatever it now covers.
    document.addEventListener("click", onInteract, true);
    document.addEventListener("keydown", onInteract, true);
    return () => {
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("click", onInteract, true);
      document.removeEventListener("keydown", onInteract, true);
    };
  }, [bannerStatus, readyToShow, minimized, pathname, setMinimized]);

  // Don't render if banner should be hidden, or while we're still in
  // the LCP-protection window.
  if (bannerStatus !== "visible" || !readyToShow) {
    return null;
  }

  // One element per placement (the key): a visible fixed bar whose top or
  // bottom changes is a layout shift even when a scroll moved it, while a
  // newly inserted one is not.
  if (minimized) {
    return <ConsentMiniBar key="bottom" onWizard={onWizard} />;
  }

  if (onPhone) {
    if (phoneTopFor?.path !== (pathname ?? "")) return null;
    const placement = phoneTopFor.top ? "top" : "bottom";
    return <ConsentMiniBar key={placement} onWizard={onWizard} placement={placement} origin="card" />;
  }

  return (
    // Phones never get here. At the bottom on every route; on /trip and
    // /shared above the save bar, which is fixed at every width. Still
    // position:fixed, so nothing shifts when it mounts 1.5s after load.
    <div
      className={
        onTripView
          ? "fixed left-0 right-0 bottom-[var(--mt-bottom-bar-h,0px)] z-[9999] p-3 sm:p-4 pointer-events-none animate-in slide-in-from-bottom duration-300"
          : "fixed left-0 right-0 bottom-0 z-[9999] p-3 sm:p-4 pointer-events-none animate-in slide-in-from-bottom duration-300"
      }
    >
      <div className="max-w-5xl mx-auto pointer-events-auto">
        <div
          ref={cardRef}
          data-testid="consent-card"
          className="bg-white rounded-xl sm:rounded-2xl shadow-2xl border border-slate-200 p-3 sm:p-4 md:flex md:items-center md:gap-5"
        >
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
                {t(contextual ? "banner.contextualTitle" : "banner.title")}
              </h3>
              <p className="text-xs sm:text-sm text-slate-600 leading-snug line-clamp-2">
                {t(contextual ? "banner.contextualDescription" : "banner.description")}
              </p>
              {/* Kept OUT of the clamped paragraph above: clipped text would
                  make the privacy link unreachable, which is the opposite of
                  the point. */}
              <p className="text-[11px] sm:text-xs text-slate-500 mt-1">
                <button
                  onClick={openSettings}
                  className="text-[var(--foreground)] underline underline-offset-2 font-medium"
                >
                  {t("banner.learnMore")}
                </button>
                <span className="mx-1.5 text-slate-300">·</span>
                <a
                  href="/privacy"
                  className="text-[var(--foreground)] underline underline-offset-2"
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
              onClick={() => acceptEssentialOnly("card")}
              data-testid="consent-reject"
              className={CARD_DECISION_BTN}
            >
              {t("banner.essentialOnly")}
            </button>
            <button
              onClick={openSettings}
              data-testid="consent-customize"
              className="flex flex-1 md:flex-none px-3 sm:px-4 py-2.5 rounded-lg sm:rounded-xl font-semibold text-[var(--foreground)] border-2 border-[var(--primary)]/20 hover:border-[var(--primary)]/40 hover:bg-[var(--primary)]/5 transition-colors text-xs sm:text-sm items-center justify-center whitespace-nowrap"
            >
              {t("banner.customize")}
            </button>
            <button
              onClick={() => acceptAll("card")}
              data-testid="consent-accept"
              className={CARD_DECISION_BTN}
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
