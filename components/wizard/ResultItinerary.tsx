"use client";

import type { Dispatch, SetStateAction } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import DayHeader, { DayBudget } from "@/components/trip/DayHeader";
import { DayTimeline } from "@/components/trip/DayTimeline";
import { MapToggle, ViewModeToggle } from "@/components/trip/ViewControls";
import { ResultBookingLinks, ResultPacking, ResultStats } from "@/components/wizard/ResultSections";
import type { DayTravelData } from "@/hooks/useTravelDistances";
import { useCurrency } from "@/lib/locale";
import { activityDomId } from "@/lib/trip/activity-dom-id";
import { dayBudgetLabel, showsDayBudget } from "@/lib/trip/day-budget";
import type { GeneratedItinerary } from "@/types";

// The card's loading box, sized like the live card so a slow chunk shows a
// skeleton instead of a shift (the wizard page warms these chunks during
// generation): 363px at 375w, 324px at 1280w. The card is SHORTER on desktop
// despite its taller image (h-40 vs h-32) because the description wraps to
// fewer lines. Re-measure before touching either number: a placeholder of the
// WRONG height creates a shift instead of preventing one.
const ActivityCardSkeleton = () => (
  <div
    className="h-[363px] sm:h-[324px] w-full rounded-xl bg-slate-100 animate-pulse"
    aria-hidden="true"
  />
);
const ActivityCard = dynamic(() => import("@/components/ActivityCard"), {
  ssr: false,
  loading: () => <ActivityCardSkeleton />,
});
const ValuePropositionBanner = dynamic(() => import("@/components/trip/ValuePropositionBanner"), { ssr: false });

// Localized loading fallback for the lazy map. It renders inside the
// NextIntlClientProvider tree (it replaces TripMap in place while the chunk
// loads), so useTranslations resolves; an inline literal at module scope
// can't reach the translation context and would render raw English.
function MapLoadingFallback() {
  const t = useTranslations("trips");
  return (
    <div className="h-[350px] bg-slate-100 rounded-xl animate-pulse flex items-center justify-center">
      <span className="text-slate-500">{t("detail.loadingMap")}</span>
    </div>
  );
}

// Dynamic import for TripMap to avoid SSR issues
const TripMap = dynamic(() => import("@/components/TripMap"), {
  ssr: false,
  loading: () => <MapLoadingFallback />,
});

/**
 * The plan on the result view: the map with the view controls, the trip's
 * numbers and booking links, the save banner, every day as cards or a
 * timeline, and the packing list. The view mode and the map's visibility
 * belong to the page, so a regenerate keeps them.
 */
export default function ResultItinerary({
  generatedItinerary,
  fullDestination,
  pace,
  resultViewMode,
  setResultViewMode,
  showMap,
  setShowMap,
  travelData,
  travelLoading,
  handleSaveTrip,
  loading,
}: {
  generatedItinerary: GeneratedItinerary;
  /** "City, Country", for the map. */
  fullDestination: string;
  pace: string;
  resultViewMode: "cards" | "timeline";
  setResultViewMode: (mode: "cards" | "timeline") => void;
  showMap: boolean;
  setShowMap: Dispatch<SetStateAction<boolean>>;
  /** The timeline's travel legs, by day number. */
  travelData: Map<number, DayTravelData>;
  travelLoading: boolean;
  handleSaveTrip: () => void;
  /** The manual save is under way. */
  loading: boolean;
}) {
  const t = useTranslations("trips");
  const { convert: convertCurrency, format: formatCurrency } = useCurrency();
  return (
    <>
      {/* Interactive Map + View Controls */}
      <div className="mb-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold text-slate-900">{t("wizard.result.tripOverview")}</h2>
            {/*
              No subtitle: destination.weather_note is unsourced model prose
              that contradicts itself across trips, and this slot reads as a
              fact about the trip. There is no real forecast to show either —
              the trip is not saved yet and is usually months out, beyond any
              forecast horizon — so it states nothing rather than stating
              something invented.
            */}
          </div>

          {/* View-mode + map toggles, for parity with
              /trips/template/[id]. Cards is the dense rich view; Timeline
              is a vertical-rail compact view for skim-reading. */}
          <div className="flex items-center gap-2 self-start sm:self-auto shrink-0">
            <ViewModeToggle
              value={resultViewMode}
              onChange={setResultViewMode}
              labels={{ cards: t("wizard.result.viewCards"), timeline: t("wizard.result.viewTimeline") }}
            />

            <MapToggle
              shown={showMap}
              onToggle={() => setShowMap((v) => !v)}
              labels={{ show: t("wizard.result.showMap"), hide: t("wizard.result.hideMap") }}
            />
          </div>
        </div>

        {showMap && (
          <TripMap
            days={generatedItinerary.days}
            destination={fullDestination}
            className="h-[350px]"
            onActivityClick={(activity) => {
              // Map pin click → scroll to the matching activity. The
              // InfoWindow "View Details" button calls this; the card and
              // the timeline row both carry activityDomId() as their id.
              const el = document.getElementById(activityDomId(activity));
              if (el) {
                el.scrollIntoView({ behavior: "smooth", block: "start" });
                el.classList.add("ring-2", "ring-[var(--primary)]");
                setTimeout(() => {
                  el.classList.remove("ring-2", "ring-[var(--primary)]");
                }, 2000);
              }
            }}
          />
        )}
      </div>

      <ResultStats itinerary={generatedItinerary} pace={pace} />

      {generatedItinerary.booking_links && <ResultBookingLinks links={generatedItinerary.booking_links} />}

      {/* Value Proposition Banner - Positioned before schedule to encourage save */}
      <div className="mb-8 hidden sm:block">
        <ValuePropositionBanner
          onSave={handleSaveTrip}
          isSaving={loading}
          variant="inline"
        />
      </div>

      {/* Day by Day with ActivityCards */}
      <div className="space-y-8">
        {generatedItinerary.days.map((day) => (
          <div key={day.day_number} id={`day-${day.day_number}`} className="scroll-mt-24">
            <DayHeader dayNumber={day.day_number} title={t("wizard.result.dayLabel", { n: day.day_number })} theme={day.theme}>
              {showsDayBudget(day) && (
                <DayBudget
                  label={t("wizard.result.dailyBudget")}
                  value={dayBudgetLabel(
                    day,
                    { convert: convertCurrency, format: formatCurrency },
                    t("activity.free"),
                    generatedItinerary.trip_summary.currency
                  )}
                />
              )}
            </DayHeader>

            {/* Activities — Cards or Timeline view */}
            {resultViewMode === "cards" ? (
              <div className="grid gap-4">
                {day.activities.map((activity, idx) => (
                  // disableAutoFetch: auto-fetch pays a Text Search Pro call per
                  // expanded card. Photos load on tap here, as on the detail and
                  // shared views.
                  <ActivityCard
                    key={idx}
                    activity={activity}
                    index={idx}
                    currency={generatedItinerary.trip_summary.currency}
                    showGallery={true}
                    disableAutoFetch={true}
                  />
                ))}
              </div>
            ) : (
              <DayTimeline
                day={day}
                travel={travelData.get(day.day_number)}
                travelLoading={travelLoading}
                pace={pace}
                currency={generatedItinerary.trip_summary.currency}
              />
            )}
          </div>
        ))}
      </div>

      {generatedItinerary.trip_summary.packing_suggestions.length > 0 && (
        <ResultPacking items={generatedItinerary.trip_summary.packing_suggestions} />
      )}
    </>
  );
}
