"use client";

import { Fragment, type Dispatch, type SetStateAction } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import DayHeader, { DayBudget } from "@/components/trip/DayHeader";
import { DayRouteLink } from "@/components/trip/DayRouteLink";
import { DayTimeline } from "@/components/trip/DayTimeline";
import { PackedDayNote } from "@/components/trip/PackedDayNote";
import { MapToggle, ViewModeToggle } from "@/components/trip/ViewControls";
import { ResultBookingLinks, ResultPacking, ResultStats } from "@/components/wizard/ResultSections";
import type { DayTravelData } from "@/hooks/useTravelDistances";
import { useCurrency } from "@/lib/locale";
import { activityDomId } from "@/lib/trip/activity-dom-id";
import { dayBudgetLabel, showsDayBudget } from "@/lib/trip/day-budget";
import { lightenDayRequest } from "@/lib/trip/pace";
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

const MAP_SECTION_ID = "trip-overview";

// Dynamic import for TripMap to avoid SSR issues
const TripMap = dynamic(() => import("@/components/TripMap"), {
  ssr: false,
  loading: () => <MapLoadingFallback />,
});

/**
 * The plan on the result view: every day as cards or a timeline first, since
 * that's what was asked for, with the save banner after the first; then the map,
 * the trip's numbers and booking links, and the packing list. The view mode and
 * the map's visibility belong to the page, so a regenerate keeps them.
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
  onAskAssistant,
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
  /** Puts a question to the assistant above the plan. */
  onAskAssistant: (message: string) => void;
}) {
  const t = useTranslations("trips");
  const { convert: convertCurrency, format: formatCurrency } = useCurrency();
  return (
    <>
      {/* Day by Day with ActivityCards */}
      <div className="flex items-center justify-between gap-3 mb-4">
        <h2 className="hidden sm:block text-lg font-semibold text-slate-900">{t("wizard.result.dayByDay")}</h2>
        <div className="flex items-center gap-2 shrink-0">
          <ViewModeToggle
            value={resultViewMode}
            onChange={setResultViewMode}
            labels={{ cards: t("wizard.result.viewCards"), timeline: t("wizard.result.viewTimeline") }}
          />
          {/* The map is after the days now, so this takes you to it. */}
          <MapToggle
            labelled
            shown={false}
            onToggle={() => {
              setShowMap(true);
              document.getElementById(MAP_SECTION_ID)?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
            labels={{ show: t("wizard.result.showMap"), hide: t("wizard.result.hideMap") }}
          />
        </div>
      </div>
      <div className="space-y-8">
        {generatedItinerary.days.map((day, dayIndex) => (
          <Fragment key={day.day_number}>
            <div id={`day-${day.day_number}`} className="scroll-mt-24">
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
              <DayRouteLink activities={day.activities} surface="result" className="-mt-2 mb-2" />
              <PackedDayNote
                activities={day.activities}
                pace={pace}
                onLighten={() => onAskAssistant(lightenDayRequest(day.day_number, day.activities))}
                className="mb-3"
              />

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
            {/* Asks once there's a day to want to keep. */}
            {dayIndex === 0 && (
              <div className="hidden sm:block">
                <ValuePropositionBanner onSave={handleSaveTrip} isSaving={loading} variant="inline" />
              </div>
            )}
          </Fragment>
        ))}
      </div>


      {/* The map and the trip's numbers, after the days */}
      <div id={MAP_SECTION_ID} className="mt-10 mb-8 scroll-mt-24">
        <div className="flex items-center justify-between gap-3 mb-4">
          <h2 className="text-lg font-semibold text-slate-900">{t("wizard.result.tripOverview")}</h2>
          <MapToggle
            shown={showMap}
            onToggle={() => setShowMap((v) => !v)}
            labels={{ show: t("wizard.result.showMap"), hide: t("wizard.result.hideMap") }}
          />
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

      {generatedItinerary.trip_summary.packing_suggestions.length > 0 && (
        <ResultPacking items={generatedItinerary.trip_summary.packing_suggestions} />
      )}
    </>
  );
}
