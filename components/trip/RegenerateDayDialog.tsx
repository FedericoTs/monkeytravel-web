"use client";

import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";

const BaseModal = dynamic(() => import("@/components/ui/BaseModal"), { ssr: false });

/** A day the planner is about to regenerate, and what they want of it. */
export interface DayRegenerationPrompt {
  dayNumber: number;
  /** Optional steer ("boarding the cruise"). */
  text: string;
}

/** Regenerating one day of the trip, optionally steered. */
export default function RegenerateDayDialog({
  prompt,
  onChange,
  onRegenerate,
}: {
  /** The day being asked about; null keeps the dialog closed. */
  prompt: DayRegenerationPrompt | null;
  onChange: (prompt: DayRegenerationPrompt | null) => void;
  onRegenerate: (dayNumber: number, text: string) => void;
}) {
  const t = useTranslations("trips");
  return (
    <BaseModal
      isOpen={prompt !== null}
      onClose={() => onChange(null)}
      usePortal
      zIndex={100}
      title={prompt ? t('detail.regenerateDay.title', { number: prompt.dayNumber }) : ""}
    >
      {prompt && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const { dayNumber, text } = prompt;
            onChange(null);
            onRegenerate(dayNumber, text);
          }}
        >
          <p className="text-sm text-slate-600">{t('detail.regenerateDay.body')}</p>
          <label htmlFor="day-regen-instructions" className="mt-4 block text-sm font-medium text-slate-800">
            {t('detail.regenerateDay.label')}
          </label>
          <textarea
            id="day-regen-instructions"
            value={prompt.text}
            onChange={(e) => onChange({ ...prompt, text: e.target.value })}
            maxLength={500}
            rows={3}
            placeholder={t('detail.regenerateDay.placeholder')}
            className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-[var(--primary)] focus:outline-none"
          />
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => onChange(null)}
              className="rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100"
            >
              {t('detail.regenerateDay.cancel')}
            </button>
            <button
              type="submit"
              className="rounded-xl bg-[var(--primary)] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[var(--primary-light)]"
            >
              {t('detail.regenerateDay.confirm')}
            </button>
          </div>
        </form>
      )}
    </BaseModal>
  );
}
