"use client";

import { useTranslations } from "next-intl";
import { captureTripIntentSelected, type TripIntent } from "@/lib/posthog/events";

/**
 * Step 1's optional answers, below the destination and dates: backpacker
 * mode, shown only while it is on so it can be switched off, and who's
 * coming.
 */
export default function TripOptions({
  travelStyle,
  setTravelStyle,
  tripIntent,
  setTripIntent,
}: {
  travelStyle: "classic" | "backpacker";
  setTravelStyle: (style: "classic" | "backpacker") => void;
  tripIntent: TripIntent;
  setTripIntent: (intent: TripIntent) => void;
}) {
  const t = useTranslations("trips");
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

    {/* Who's coming? — captures whether the user is planning solo or
        with friends, the evidence for the group-vs-solo decision.
        Group also shows the invite hint below and puts the anonymous
        share button in crew mode. Option labels come from messages so
        every locale gets localized copy. */}
    <div className="order-last">
      <div className="text-sm font-medium text-slate-700 mb-2">
        {t("wizard.step1.whosComing")}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {(
          [
            { value: "solo", labelKey: "wizard.step1.justMe", emoji: "👤" },
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
                  ? "border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--primary-ink)]"
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
    </div>
    </>
  );
}
