"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import { captureTripIntentSelected, type TripIntent } from "@/lib/posthog/events";
import { CHILD_AGE_BANDS, childAgeBands, type ChildAgeBand } from "@/lib/wizard/answers";

/**
 * Step 1's optional answers, below the destination and dates: backpacker
 * mode, shown only while it is on so it can be switched off, who's coming,
 * and for a family the children's ages.
 */
export default function TripOptions({
  travelStyle,
  setTravelStyle,
  tripIntent,
  setTripIntent,
  childrenAges,
  setChildrenAges,
}: {
  travelStyle: "classic" | "backpacker";
  setTravelStyle: (style: "classic" | "backpacker") => void;
  tripIntent: TripIntent;
  setTripIntent: (intent: TripIntent) => void;
  childrenAges: ChildAgeBand[];
  setChildrenAges: (ages: ChildAgeBand[]) => void;
}) {
  const t = useTranslations("trips");
  const agesLabelId = useId();
  return (
    <>
    {/* Backpacker Mode toggle, shown only while the mode is already
        active: few sessions use it, and on the highest-abandon screen
        it would be the biggest block. The mode arrives with a restored
        draft or session-tray snapshot; here it can be switched off. */}
    {travelStyle === "backpacker" && (
    <div className="order-last">
      <button
        type="button"
        onClick={() => setTravelStyle("classic")}
        aria-pressed
        className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-xl border-2 border-emerald-500 bg-emerald-50 text-emerald-800 text-sm font-medium transition-all"
      >
        <span className="flex items-center gap-2">
          <span className="text-lg" aria-hidden>🎒</span>
          <span>{t("wizard.step1.backpackerModeOn")}</span>
        </span>
        <span className="text-xs opacity-80">{t("wizard.step1.backpackerModeSummary")}</span>
      </button>
      <p className="text-xs text-emerald-700 mt-2 pl-1">
        {t("wizard.step1.backpackerModeNote")}
      </p>
    </div>
    )}

    {/* Who's coming? — one person, a couple, a family or friends, which
        shapes the plan's places. Friends also shows the invite hint below;
        friends and a family put the anonymous share button in crew mode.
        Two by two, so the four fit a phone's width. Option labels come
        from messages so every locale gets localized copy. */}
    <div className="order-last">
      <div className="text-sm font-medium text-slate-700 mb-2">
        {t("wizard.step1.whosComing")}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {(
          [
            { value: "solo", labelKey: "wizard.step1.justMe", emoji: "👤" },
            { value: "couple", labelKey: "wizard.step1.couple", emoji: "💑" },
            { value: "family", labelKey: "wizard.step1.family", emoji: "👨‍👩‍👧" },
            { value: "group", labelKey: "wizard.step1.withFriends", emoji: "👥" },
          ] as const
        ).map((opt) => {
          const isSelected = tripIntent === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                const changed =
                  tripIntent !== "unspecified" &&
                  tripIntent !== opt.value;
                setTripIntent(opt.value);
                captureTripIntentSelected({
                  intent: opt.value,
                  changed,
                });
              }}
              // Selected state: /10 fill + primary-colored text, a
              // clear "this is picked" affordance (a /5 fill is
              // barely visible).
              className={`relative flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 text-sm font-medium transition-all ${
                isSelected
                  ? "border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--foreground)]"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
              }`}
              aria-pressed={isSelected}
            >
              {/* The emoji is dimmed (opacity-70) when unselected. */}
              <span
                className={`text-lg ${isSelected ? "" : "opacity-70"}`}
                aria-hidden
              >
                {opt.emoji}
              </span>
              <span>{t(opt.labelKey)}</span>
            </button>
          );
        })}
      </div>
      {tripIntent === "group" && (
        <p className="text-xs text-slate-500 mt-2">
          {/* Say what happens next, never "coming soon":
              invite-after-generation already works. */}
          {t("wizard.step1.withFriendsHint")}
        </p>
      )}
      {/* A family's children's ages, several at once: the plan fits its
          days to them (naps and early dinners, playgrounds, teen outings).
          Kept youngest first whatever order they're tapped in. */}
      {tripIntent === "family" && (
        <div role="group" aria-labelledby={agesLabelId} className="mt-3">
          <div id={agesLabelId} className="text-sm font-medium text-slate-700 mb-2">
            {t("wizard.step1.ages.label")} <span className="font-normal text-slate-500">{t("wizard.step1.ages.optional")}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {CHILD_AGE_BANDS.map((band) => {
              const picked = childrenAges.includes(band);
              return (
                <button
                  key={band}
                  type="button"
                  aria-pressed={picked}
                  onClick={() =>
                    setChildrenAges(picked ? childrenAges.filter((b) => b !== band) : childAgeBands([...childrenAges, band]))
                  }
                  className={`min-h-[44px] px-4 py-2 rounded-xl border-2 text-sm font-medium transition-all ${
                    picked
                      ? "border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--foreground)]"
                      : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                  }`}
                >
                  {t(`wizard.step1.ages.${band}`)}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-slate-500 mt-2">{t("wizard.step1.ages.hint")}</p>
        </div>
      )}
    </div>
    </>
  );
}
