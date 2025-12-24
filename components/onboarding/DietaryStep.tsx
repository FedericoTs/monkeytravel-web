"use client";

import { useTranslations } from "next-intl";

interface DietaryStepProps {
  selected: string[];
  onChange: (diets: string[]) => void;
}

const DIETARY_OPTIONS = [
  { id: "none", labelKey: "options.none.label", descriptionKey: "options.none.description", icon: "M5 13l4 4L19 7" },
  { id: "vegetarian", labelKey: "options.vegetarian.label", descriptionKey: "options.vegetarian.description", icon: "M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" },
  { id: "vegan", labelKey: "options.vegan.label", descriptionKey: "options.vegan.description", icon: "M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" },
  { id: "halal", labelKey: "options.halal.label", descriptionKey: "options.halal.description", icon: "M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" },
  { id: "kosher", labelKey: "options.kosher.label", descriptionKey: "options.kosher.description", icon: "M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" },
  { id: "gluten-free", labelKey: "options.glutenFree.label", descriptionKey: "options.glutenFree.description", icon: "M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-5 0a4 4 0 11-8 0 4 4 0 018 0z" },
];

export default function DietaryStep({ selected, onChange }: DietaryStepProps) {
  const t = useTranslations("common.onboarding.dietary");

  const toggleDiet = (dietId: string) => {
    // "None" is exclusive - clear others when selected
    if (dietId === "none") {
      onChange(selected.includes("none") ? [] : ["none"]);
      return;
    }

    // Remove "none" if selecting another option
    const withoutNone = selected.filter(s => s !== "none");

    if (selected.includes(dietId)) {
      onChange(withoutNone.filter(s => s !== dietId));
    } else {
      onChange([...withoutNone, dietId]);
    }
  };

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-slate-900 mb-2">
          {t("title")}
        </h1>
        <p className="text-slate-600">
          {t("subtitle")}
        </p>
      </div>

      <div className="space-y-3">
        {DIETARY_OPTIONS.map((diet) => {
          const isSelected = selected.includes(diet.id);
          return (
            <button
              key={diet.id}
              onClick={() => toggleDiet(diet.id)}
              className={`w-full p-4 rounded-xl border-2 text-left transition-all flex items-center gap-4 ${
                isSelected
                  ? "border-[var(--primary)] bg-[var(--primary)]/5"
                  : "border-slate-200 hover:border-slate-300"
              }`}
            >
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                isSelected ? "bg-[var(--primary)] text-white" : "bg-slate-100 text-slate-600"
              }`}>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={diet.icon} />
                </svg>
              </div>
              <div>
                <div className="font-medium text-slate-900">{t(diet.labelKey)}</div>
                <div className="text-sm text-slate-500">{t(diet.descriptionKey)}</div>
              </div>
              {isSelected && (
                <svg className="w-5 h-5 text-[var(--primary)] ml-auto" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
