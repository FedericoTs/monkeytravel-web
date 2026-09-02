"use client";

import { useTranslations } from "next-intl";

/** The shape NewTripWizard's SEASONAL_POPULAR entries expose (flag emoji deliberately not read). */
export interface OneTapPlace {
  name: string;
  coords: { latitude: number; longitude: number };
  season: number[];
}

interface OneTapStartsProps {
  picks: OneTapPlace[];
  /**
   * null on the server and first client paint, set in the same effect that
   * reorders the picks — so the "In season" badge can never be part of a
   * hydration mismatch.
   */
  inSeasonMonth: number | null;
  onPick: (place: OneTapPlace, index: number) => void;
}

/** "Rome, Italy" → { city: "Rome", country: "Italy" }; a bare name keeps an empty country. */
export function splitPlaceName(name: string): { city: string; country: string } {
  const i = name.indexOf(", ");
  return i === -1 ? { city: name, country: "" } : { city: name.slice(0, i), country: name.slice(i + 2) };
}

/**
 * Six popular picks as genuine one-tap starts.
 *
 * The chips they replace set the destination and nothing else, so a tap left
 * Continue disabled and the visitor facing the date field; they also rendered
 * a flag emoji that Windows draws as the letters "IT" / "ES", and carried no
 * accessible name. These are real <button>s at the 44px target, named for
 * assistive tech, with the city as the primary text and the country beneath
 * it so "London, United Kingdom" never truncates at 375px. What a tap does
 * (destination + coords + pencilled flexible dates + focus to the date field)
 * lives in NewTripWizard.handleOneTapStart — this component is presentational.
 *
 * No coral text: --primary-ink is the brand coral at 2.68:1. Coral appears
 * only as the hover/focus border.
 */
export default function OneTapStarts({ picks, inSeasonMonth, onPick }: OneTapStartsProps) {
  const t = useTranslations("trips");
  return (
    <div className="mt-3">
      <p className="mb-2 text-xs font-medium text-slate-500">{t("wizard.step1.popularNow")}</p>
      <div role="group" aria-label={t("wizard.step1.popularNow")} className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {picks.map((place, index) => {
          const { city, country } = splitPlaceName(place.name);
          const inSeason = inSeasonMonth !== null && place.season.includes(inSeasonMonth);
          return (
            <button
              key={place.name}
              type="button"
              onClick={() => onPick(place, index)}
              aria-label={t("wizard.step1.picks.chipAria", { city, country })}
              className="inline-flex min-h-[44px] flex-col items-start justify-center rounded-[var(--radius-md)] border border-slate-200 bg-white px-3 py-2 text-left transition-colors hover:border-[var(--primary)] hover:bg-[var(--primary)]/5 active:bg-[var(--primary)]/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
            >
              <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm font-semibold text-slate-900">
                {city}
                {inSeason && (
                  <span className="rounded-full bg-[var(--accent)]/30 px-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--foreground)]">
                    {t("wizard.step1.picks.inSeason")}
                  </span>
                )}
              </span>
              {country && <span className="text-xs text-slate-500">{country}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
