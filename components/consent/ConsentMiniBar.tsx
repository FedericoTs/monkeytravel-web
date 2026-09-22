"use client";

/**
 * The minimised consent state, carrying both decisions.
 *
 * WHY THIS REPLACED THE PILL
 * --------------------------
 * Measured over the seven days to 2026-09-22: 4,636 banner impressions,
 * 3,215 (69%) minimised without a decision, 1,193 (26%) left without
 * interacting at all, and 228 decisions — 141 accept, 85 essential only,
 * 2 in the modal. A 4.9% decision rate.
 *
 * The card withdraws after 40px of scroll, which on a blog article (2,375 of
 * those 4,636 impressions) happens within a second of arriving. What it left
 * behind was a dead end: a desktop-only "Cookie settings" pill that cost a
 * click before any choice was even visible, and below 640px nothing at all
 * for the rest of the page view — on a site whose traffic is mostly mobile.
 * The only way back was the footer's Cookie Settings, several screens away.
 *
 * So the minimised state now carries the decision itself, at every
 * breakpoint. One tap decides, from either direction.
 *
 * WHAT IS DELIBERATE HERE, AND MUST SURVIVE EDITS
 * -----------------------------------------------
 * - **The two buttons share one class constant and neither is filled.** They
 *   are cells of one `grid-cols-2`, so they are identical in width by
 *   construction and grow together when a longer locale label wraps. A coral
 *   "Accept all" beside a flat "Essential only" is the EDPB 03/2022
 *   highlighted-button pattern, and DESIGN.md's coral-button exception is for
 *   THE primary action of a page, which a consent choice is not. "The accept
 *   button is missing its primary fill" is the most likely well-meaning
 *   regression here; it is not missing, it is removed.
 * - **Refusal is first in the DOM and first visually.** A later layout tweak
 *   must not reorder them.
 * - **`miniPurposes` is never clamped.** This is a layer where consent can be
 *   given, so it names what "Accept all" grants; a `line-clamp` cuts the
 *   "nothing loads until you choose" clause first, and worst in es/it/pt.
 * - **No dismiss control.** The bar ends on a decision, identically from
 *   either side. A "×" that suppressed it would make refusal the expensive
 *   option again, in a subtler way.
 * - **Left-anchored, content-width, with a fixed 92px right gutter.** The
 *   BuildHop launcher is `position: fixed` bottom-right at z-index
 *   2147483000 (app/globals.css) — that stacking contest cannot be won, only
 *   the geometry. Bottom-left is the corner the old pill already proved free.
 * - **`max()` of the published bar heights, not their sum.** `--mt-nav-h`,
 *   `--mt-bottom-bar-h` and `--mt-sticky-cta-h` are all `fixed bottom-0`
 *   siblings: on /shared the save bar and the mobile nav overlap rather than
 *   stack, so the tallest governs the clearance. Summing them floats the bar
 *   up the screen. `--mt-footer-h` is scoped to the wizard and to max-sm,
 *   because that footer is `sm:relative` on desktop yet still publishes a
 *   height.
 */

import { useTranslations } from "next-intl";
import { useConsent } from "@/lib/consent";

/**
 * ONE constant for both decisions. See the header: this is what makes
 * "the two buttons are identical" auditable in a diff.
 */
const MINI_BTN =
  "min-h-[44px] w-full inline-flex items-center justify-center rounded-xl " +
  "border border-slate-300 bg-white px-2 text-[13px] font-semibold " +
  "text-[var(--foreground)] leading-tight text-center " +
  "hover:bg-slate-50 active:bg-slate-100 transition-colors";

export function ConsentMiniBar({ onWizard }: { onWizard: boolean }) {
  const t = useTranslations("consent");
  const { acceptAll, acceptEssentialOnly, openSettings } = useConsent();

  const bottom = onWizard
    ? "max-sm:bottom-[calc(var(--mt-footer-h,96px)+0.75rem)] sm:bottom-4"
    : "bottom-[calc(max(var(--mt-bottom-bar-h,0px),var(--mt-nav-h,0px),var(--mt-sticky-cta-h,0px),env(safe-area-inset-bottom,0px))+0.75rem)]";

  return (
    <div
      className={
        "fixed z-[9999] pointer-events-none left-3 sm:left-4 " +
        "w-[min(300px,calc(100vw-6.5rem))] sm:w-[320px] " +
        bottom
      }
    >
      <div
        className="pointer-events-auto rounded-2xl bg-white border border-slate-200 shadow-[0_8px_30px_rgba(45,52,54,0.12)] p-2.5"
        role="region"
        aria-label={t("banner.miniAria")}
        data-testid="consent-mini"
      >
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold text-[var(--foreground)]">
            {t("banner.miniTitle")}
          </p>
          <button
            type="button"
            onClick={openSettings}
            data-testid="consent-mini-options"
            className="min-h-[44px] inline-flex items-center px-1 -my-1 text-[11px] text-[var(--foreground)] underline underline-offset-2"
          >
            {t("banner.miniOptions")}
          </button>
        </div>

        <p className="mt-1 text-[11px] leading-snug text-[var(--foreground-muted)]">
          {t("banner.miniPurposes")}
        </p>

        <div className="mt-2 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => acceptEssentialOnly("mini")}
            data-testid="consent-mini-reject"
            className={MINI_BTN}
          >
            {t("banner.essentialOnly")}
          </button>
          <button
            type="button"
            onClick={() => acceptAll("mini")}
            data-testid="consent-mini-accept"
            className={MINI_BTN}
          >
            {t("banner.acceptAll")}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConsentMiniBar;
