"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import type { RouteStop } from "@/components/trips/MultiCityRouteBuilder";

/** What the phone's fixed Continue bar covers at the bottom of the screen, and a little air. */
const FOOTER_ROOM_PX = 120;

/**
 * Brings the offer into view when it arrives below what the screen shows (on
 * a phone it lands under the Continue bar), once, unless the traveller is
 * typing somewhere: it answers the dates they just set.
 */
function showWhenHidden(card: HTMLElement | null) {
  if (!card || typeof window === "undefined") return;
  const focused = document.activeElement;
  if (focused instanceof HTMLElement && focused.matches("input, textarea, select")) return;
  if (card.getBoundingClientRect().bottom <= window.innerHeight - FOOTER_ROOM_PX) return;
  const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  card.scrollIntoView?.({ block: "nearest", behavior: still ? "auto" : "smooth" });
}

/**
 * Under step 1's dates, for a destination typed as a whole country or region:
 * the places most travellers stay in for that many days, in order. It is what
 * Continue plans, as a trip through several cities; "Change the route" opens it
 * in the route builder first, and one place is the traveller's choice, a tap away.
 */
export default function RouteOffer({
  place,
  days,
  route,
  onTake,
  onKeep,
  keepDays,
}: {
  /** The destination as typed ("Thailand"). */
  place: string;
  days: number;
  route: RouteStop[];
  /** Takes the route now, into the route builder, to change before going on. */
  onTake: () => void;
  /** Plans the place as typed, as one place: the route is no longer what Continue plans. */
  onKeep: () => void;
  /** One place's most days, when the trip is longer: keeping one place shortens it to them, and the button says so. */
  keepDays?: number;
}) {
  const t = useTranslations("trips");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => showWhenHidden(ref.current), []);
  return (
    <div
      ref={ref}
      aria-live="polite"
      // Scrolled into view clear of the phone's fixed Continue bar.
      className="scroll-mb-32 rounded-[var(--radius-md)] border border-[var(--primary)]/15 bg-[var(--background-warm)] px-4 py-3"
    >
      <p className="text-sm font-medium text-slate-800">{t("wizard.routeOffer.title", { place, days })}</p>
      <ol className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-slate-700">
        {route.map((stop, i) => (
          <li key={`${i}-${stop.city}`} className="flex items-center gap-1.5">
            {i > 0 && (
              <span aria-hidden="true" className="text-slate-400">
                →
              </span>
            )}
            {t("wizard.routeOffer.stop", { city: stop.city, nights: stop.nights })}
          </li>
        ))}
      </ol>
      <p className="mt-1.5 text-xs text-slate-600">{t("wizard.routeOffer.continues")}</p>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <button
          type="button"
          onClick={onTake}
          className="inline-flex min-h-[40px] items-center rounded-[var(--radius-md)] border border-slate-300 bg-white px-3.5 text-sm font-medium text-[var(--foreground)] transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--foreground)]"
        >
          {t("wizard.routeOffer.take")}
        </button>
        <button
          type="button"
          onClick={onKeep}
          className="inline-flex min-h-[40px] items-center text-sm text-slate-700 underline underline-offset-2 hover:text-[var(--foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--foreground)]"
        >
          {keepDays ? t("wizard.routeOffer.keepFor", { place, days: keepDays }) : t("wizard.routeOffer.keep", { place })}
        </button>
      </div>
    </div>
  );
}
