"use client";

import type { Dispatch, SetStateAction } from "react";
import { useTranslations } from "next-intl";
import VibeSelector from "@/components/trip/VibeSelector";
import { DIETS, dietsFrom, type Diet } from "@/lib/trips/diet";
import { MUST_DOS_MAX, MUST_DO_MAX_LENGTH, REQUIREMENTS_MAX } from "@/lib/trips/request-limits";
import { mustDoItem, withMustDo } from "@/lib/wizard/must-dos";
import { BUDGET_TIERS, TRIP_PACES, type TripVibe, type BudgetTier, type TripPace } from "@/types";

// Budget tier styling - labels/descriptions come from translations
const BUDGET_TIER_STYLES = {
  budget: {
    color: "text-green-600",
    bgColor: "bg-green-50",
    borderColor: "border-green-500",
  },
  balanced: {
    color: "text-blue-600",
    bgColor: "bg-blue-50",
    borderColor: "border-blue-500",
  },
  premium: {
    color: "text-amber-600",
    bgColor: "bg-amber-50",
    borderColor: "border-amber-500",
  },
} as const;


/**
 * Step 2 of the wizard: the vibes (required), the wishes, the diets, and the
 * folded advanced preferences (budget, pace, requirements). Every answer and
 * the fold's state belong to the page, so going back to step 1 and on again
 * keeps them, and Start Over clears them.
 */
export default function PreferencesStep({
  destination,
  selectedVibes,
  handleVibesChange,
  vibesSuggested = false,
  mustDos,
  setMustDos,
  mustDoInput,
  setMustDoInput,
  dietary,
  setDietary,
  showAdvancedPrefs,
  setShowAdvancedPrefs,
  budgetTier,
  setBudgetTier,
  pace,
  setPace,
  requirements,
  setRequirements,
}: {
  destination: string;
  selectedVibes: TripVibe[];
  handleVibesChange: (vibes: TripVibe[]) => void;
  /** The vibes are the season's suggestion, not yet the traveller's pick. */
  vibesSuggested?: boolean;
  mustDos: string[];
  setMustDos: Dispatch<SetStateAction<string[]>>;
  /** A wish being typed, not added yet. */
  mustDoInput: string;
  setMustDoInput: (value: string) => void;
  dietary: Diet[];
  setDietary: Dispatch<SetStateAction<Diet[]>>;
  showAdvancedPrefs: boolean;
  setShowAdvancedPrefs: (open: boolean) => void;
  budgetTier: BudgetTier;
  setBudgetTier: (tier: BudgetTier) => void;
  pace: TripPace;
  setPace: (pace: TripPace) => void;
  requirements: string;
  setRequirements: (value: string) => void;
}) {
  const t = useTranslations("trips");
  const tDiet = useTranslations("common.onboarding.dietary");
  // Enter, a comma, or tapping away (so a phone doesn't lose it) adds the typed wish.
  const addTypedMustDo = () => {
    const item = mustDoItem(mustDoInput);
    if (!item) return;
    setMustDos((prev) => withMustDo(prev, item));
    setMustDoInput("");
  };
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-1 sm:mb-2">
          {t("wizard.step2.title")}
        </h1>
        <p className="text-slate-600">
          {t("wizard.step2.subtitle", { destination })}
        </p>
      </div>

      {/* Vibes — required.
          onVibesChange uses the memoized handleVibesChange from
          above so the VibeSelector's React.memo can short-circuit
          on parent re-renders. */}
      <VibeSelector
        selectedVibes={selectedVibes}
        onVibesChange={handleVibesChange}
        maxVibes={3}
        suggested={vibesSuggested}
      />

      {/* Must-do wishlist — visible, first-class, on step 2 ON
          PURPOSE: step 1 is the fragile funnel gate, step 2 is past
          it. Undated wishes, unlike the date-pinned anchors. */}
      <div>
        <label htmlFor="must-do-input" className="block text-sm font-medium text-slate-700 mb-1">
          {t("wizard.step2.mustDos.title")}{" "}
          <span className="font-normal text-slate-500">{t("wizard.step2.mustDos.optional")}</span>
        </label>
        <p className="text-xs text-slate-500 mb-2">{t("wizard.step2.mustDos.hint")}</p>
        {mustDos.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {mustDos.map((item) => (
              <span
                key={item}
                className="inline-flex items-center gap-1.5 rounded-full bg-[var(--primary)]/10 px-3 py-1.5 text-sm font-medium text-[var(--foreground)]"
              >
                {item}
                <button
                  type="button"
                  onClick={() => setMustDos((prev) => prev.filter((m) => m !== item))}
                  aria-label={t("wizard.step2.mustDos.remove", { item })}
                  className="text-[var(--foreground-muted)] hover:text-[var(--foreground)] min-h-[24px] min-w-[24px]"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        {mustDos.length < MUST_DOS_MAX && (
          <input
            id="must-do-input"
            type="text"
            value={mustDoInput}
            maxLength={MUST_DO_MAX_LENGTH}
            onChange={(e) => setMustDoInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                addTypedMustDo();
              }
            }}
            onBlur={addTypedMustDo}
            placeholder={t("wizard.step2.mustDos.placeholder")}
            className="w-full px-4 py-3 rounded-xl border border-slate-300 focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 outline-none transition-colors text-sm"
          />
        )}
      </div>

      {/* Diet: every place to eat in the plan must suit the ones picked. */}
      <div role="group" aria-labelledby="diet-label">
        <p id="diet-label" className="text-sm font-medium text-slate-700 mb-1">
          {tDiet("title")}{" "}
          <span className="font-normal text-slate-500">{t("wizard.step2.mustDos.optional")}</span>
        </p>
        <p className="text-xs text-slate-500 mb-2">{tDiet("subtitle")}</p>
        <div className="flex flex-wrap gap-2">
          {DIETS.map((diet) => {
            const picked = dietary.includes(diet);
            return (
              <button
                key={diet}
                type="button"
                aria-pressed={picked}
                onClick={() =>
                  setDietary((prev) => dietsFrom(picked ? prev.filter((d) => d !== diet) : [...prev, diet]))
                }
                className={`min-h-[40px] rounded-full border-2 px-3.5 text-sm font-medium transition-colors ${
                  picked
                    ? "border-[var(--primary)] bg-[var(--primary)]/5 text-slate-900"
                    : "border-slate-200 text-slate-600 hover:border-slate-300"
                }`}
              >
                {tDiet(`options.${diet === "gluten-free" ? "glutenFree" : diet}.label`)}
              </button>
            );
          })}
        </div>
      </div>

      {/* Collapsible Advanced Preferences */}
      <div className="border-t border-slate-200 pt-4">
        <button
          onClick={() => setShowAdvancedPrefs(!showAdvancedPrefs)}
          className="flex items-center justify-between w-full text-left py-2 text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors min-h-[44px]"
        >
          <span className="flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
            </svg>
            {t("wizard.step2.customize")}
            {!showAdvancedPrefs && (
              <span className="text-xs text-slate-500 font-normal">{t("wizard.step2.customizeDefaults")}</span>
            )}
          </span>
          <svg className={`w-5 h-5 transition-transform ${showAdvancedPrefs ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {showAdvancedPrefs && (
          <div className="space-y-6 mt-4 animate-in slide-in-from-top-2">
            {/* Budget */}
            <div>
              <div className="text-sm font-medium text-slate-700 mb-3">{t("budget.title")}</div>
              <div className="grid grid-cols-3 gap-2 sm:gap-3">
                {BUDGET_TIERS.map((tierId) => {
                  const styles = BUDGET_TIER_STYLES[tierId];
                  return (
                    <button
                      key={tierId}
                      onClick={() => setBudgetTier(tierId)}
                      className={`p-3 sm:p-4 rounded-xl border-2 text-center sm:text-left transition-all min-h-[48px] ${
                        budgetTier === tierId
                          ? `${styles.borderColor} ${styles.bgColor}`
                          : "border-slate-200 hover:border-slate-300"
                      }`}
                    >
                      <div className={`font-semibold text-sm sm:text-base ${styles.color}`}>{t(`budget.${tierId}.label`)}</div>
                      <div className="text-xs text-slate-500 mt-0.5 hidden sm:block">{t(`budget.${tierId}.range`)}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Pace */}
            <div>
              <div className="text-sm font-medium text-slate-700 mb-3">{t("pace.title")}</div>
              <div className="grid grid-cols-3 gap-2 sm:gap-3">
                {TRIP_PACES.map((paceId) => (
                  <button
                    key={paceId}
                    onClick={() => setPace(paceId)}
                    className={`p-3 sm:p-4 rounded-xl border-2 text-center sm:text-left transition-all min-h-[48px] ${
                      pace === paceId
                        ? "border-[var(--primary)] bg-[var(--primary)]/5"
                        : "border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    <div className="font-semibold text-sm sm:text-base text-slate-900">{t(`pace.${paceId}.label`)}</div>
                    <div className="text-xs text-slate-500 mt-0.5 hidden sm:block">{t(`pace.${paceId}.description`)}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Special Requirements */}
            <div>
              <label htmlFor="trip-requirements" className="block text-sm font-medium text-slate-700 mb-2">
                {t("requirements.title")} <span className="font-normal text-slate-500">({t("requirements.hint").split(" - ")[0]})</span>
              </label>
              <textarea
                id="trip-requirements"
                value={requirements}
                onChange={(e) => setRequirements(e.target.value.slice(0, REQUIREMENTS_MAX))}
                placeholder={t("requirements.placeholder")}
                rows={2}
                maxLength={REQUIREMENTS_MAX}
                className="w-full px-4 py-3 rounded-xl border border-slate-300 focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 outline-none transition-colors resize-none text-sm"
              />
              {requirements.length > REQUIREMENTS_MAX - 100 && (
                <p className="mt-1 text-xs text-slate-500 text-right">
                  {requirements.length}/{REQUIREMENTS_MAX}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
