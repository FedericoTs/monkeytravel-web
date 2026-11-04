"use client";

import { useTranslations } from "next-intl";
import DestinationAutocomplete, { type PlacePrediction } from "@/components/ui/DestinationAutocomplete";
import OneTapStarts, { type OneTapPlace } from "@/components/wizard/OneTapStarts";
import type { TripWizardFieldInteractedEvent } from "@/lib/posthog/events";
import { DESTINATION_ALLOWLIST, DESTINATION_MAX_LENGTH } from "@/lib/trips/request-limits";
import type { TripSentence } from "@/lib/wizard/trip-sentence";

/** A month's name in the page's language, capitalised for a chip ("Marzo"). */
function monthName(month: number, locale: string): string {
  const name = new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2000, month - 1, 15)));
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * Step 1's destination: the autocomplete, the server's two destination rules
 * as inline warnings, the card showing how a one-sentence trip was read, and
 * the popular picks while the field is empty. Hidden, not unmounted, while the
 * route builder stands in for it on a multi-city trip.
 */
export default function DestinationField({
  multiCityMode,
  destination,
  setDestination,
  trackFieldInteraction,
  handleDestinationSelect,
  expressTrip,
  locale,
  popularPicks,
  inSeasonMonth,
  handleOneTapStart,
}: {
  multiCityMode: boolean;
  destination: string;
  setDestination: (value: string) => void;
  trackFieldInteraction: (field: TripWizardFieldInteractedEvent["field"]) => void;
  handleDestinationSelect: (prediction: PlacePrediction) => void;
  /** The field read as a whole trip, or null. */
  expressTrip: TripSentence | null;
  locale: string;
  popularPicks: OneTapPlace[];
  inSeasonMonth: number | null;
  handleOneTapStart: (place: OneTapPlace, index: number) => void;
}) {
  const t = useTranslations("trips");
  return (
    <div className={multiCityMode ? "hidden" : undefined}>
      <div
        id="wizard-destination-label"
        className="text-sm font-medium text-slate-700 mb-2"
      >
        {t("wizard.step1.destinationLabel")}
      </div>
      <DestinationAutocomplete
        value={destination}
        onChange={(v) => {
          trackFieldInteraction("destination_autocomplete");
          setDestination(v);
        }}
        onSelect={(p) => {
          trackFieldInteraction("destination_autocomplete");
          handleDestinationSelect(p);
        }}
        placeholder={t("wizard.step1.placeholder")}
        // A11y: wire visible "Destination" header to the
        // <input> so screen readers announce "Destination, edit" with
        // context instead of bare "edit". aria-required reflects that
        // this is a required wizard field.
        ariaLabelledBy="wizard-destination-label"
        ariaRequired
        // No autoFocus: on mobile it auto-opens the suggestions
        // dropdown over the popular-destination pills below, so a tap
        // meant for a pill lands on a suggestion. Users can still tap
        // the input to reveal the autocomplete dropdown.
      />

      {/* Inline allowlist warning — same character set the server
          enforces (DESTINATION_ALLOWLIST). Shown the
          moment the input goes invalid instead of letting the user
          fill the whole form and fail at generate. */}
      {!expressTrip && destination.length >= 2 && !DESTINATION_ALLOWLIST.test(destination) && (
        <p role="alert" className="mt-2 text-xs font-medium text-red-600">
          {t("wizard.step1.destinationInvalidChars")}
        </p>
      )}

      {/* Too long is the other half of the same server rule.
          Deliberately NOT a maxLength on the input: silent truncation
          would pass both the allowlist and the bound, and generate a
          confident itinerary for whatever the first 100 characters
          happened to spell. */}
      {!expressTrip && destination.length > DESTINATION_MAX_LENGTH && (
        <p role="alert" className="mt-2 text-xs font-medium text-red-600">
          {t("wizard.step1.destinationTooLong")}
        </p>
      )}

      {/* What a one-sentence trip was read as, before it is planned
          (the footer button plans it). */}
      {expressTrip && (
        <div className="mt-3 rounded-2xl border border-[var(--primary)]/25 bg-[var(--background-warm)] p-4" aria-live="polite">
          <p className="text-sm font-semibold text-[var(--foreground)]">{t("wizard.express.title")}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {[
              expressTrip.destination,
              t("wizard.express.days", { count: expressTrip.days ?? 5 }),
              ...(expressTrip.month ? [monthName(expressTrip.month, locale)] : []),
              ...expressTrip.vibes.map((v) => t(`vibes.${v}.label`)),
            ].map((label) => (
              <span
                key={label}
                className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-[var(--foreground)] ring-1 ring-[var(--foreground)]/10"
              >
                {label}
              </span>
            ))}
          </div>
          <p className="mt-2 text-xs text-[var(--foreground-muted)]">{t("wizard.express.hint")}</p>
        </div>
      )}

      {/* Popular destinations — real demand-ranked (distinct planning
          sessions), season-reordered. */}
      {!destination && (
        <OneTapStarts
          picks={popularPicks}
          inSeasonMonth={inSeasonMonth}
          onPick={handleOneTapStart}
        />
      )}
    </div>
  );
}
