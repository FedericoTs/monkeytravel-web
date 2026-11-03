"use client";

import { useTranslations } from "next-intl";
import { failureWording, type ValidationFix } from "@/lib/wizard/generation-failure";

/**
 * Why the plan couldn't be made, in words the traveller can act on, and the
 * way on: the detail a refused request names, or another try.
 */
export default function GenerationErrorNotice({
  error,
  errorFix,
  effectiveMaxTripDays,
  onAction,
}: {
  error: string;
  /** What a refused request asks the traveller to change. */
  errorFix: ValidationFix | null;
  effectiveMaxTripDays: number;
  /** Takes the traveller to the detail to change, or tries again. */
  onAction: () => void;
}) {
  const t = useTranslations("trips");
  const wording = failureWording(error);
  return (
    <div className="bg-red-50 border border-red-200 rounded-xl mb-6 p-4">
      <div className="flex items-start gap-3">
        <svg className="w-5 h-5 text-red-500 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
        </svg>
        <div className="flex-1">
          <p className="text-red-700 font-medium">
            {errorFix
              ? t(`generation.fix.${errorFix}`, {
                  days: Number(error.match(/(\d+)\s*days/i)?.[1]) || effectiveMaxTripDays,
                })
              : wording
              ? t(`generation.${wording}`)
              : error}
          </p>
          <button
            onClick={onAction}
            className="mt-3 inline-flex items-center gap-2 px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 transition-colors"
          >
            {!errorFix && (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            )}
            {errorFix ? t("generation.editDetails") : t("generation.retry")}
          </button>
        </div>
      </div>
    </div>
  );
}
