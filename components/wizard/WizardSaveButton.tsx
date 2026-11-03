"use client";

import { useTranslations } from "next-intl";
import { Spinner } from "@/components/ui/Spinner";
import type { AutoSaveStatus } from "@/hooks/useAutoSaveTrip";
import { Link } from "@/lib/i18n/routing";
import { cn } from "@/lib/utils";

/** Size and hover styles per place: the desktop sticky header, or the full-width phone bar. */
const PLACEMENT = {
  header: {
    shape: "px-6 py-2.5 rounded-xl font-medium flex items-center gap-2",
    icon: "w-4 h-4",
    savedHover: "hover:bg-emerald-600",
    saveHover: "hover:bg-[var(--secondary-ink)]/90",
  },
  bar: {
    shape: "flex-1 py-3 rounded-xl font-semibold flex items-center justify-center gap-2",
    icon: "w-5 h-5",
    savedHover: "",
    saveHover: "",
  },
} as const;

/**
 * The result view's main action. With auto-save on it follows that save:
 * View trip once the trip is stored, Saving while it is, Retry when it
 * failed. Otherwise (auto-save off, or nothing stored yet, as for a signed-out
 * planner) it is the manual Save.
 */
export default function WizardSaveButton({
  placement,
  autoSave,
  onSave,
  saving,
}: {
  placement: keyof typeof PLACEMENT;
  /** The auto-save arm's state; null when that arm is off. */
  autoSave: { savedTripId: string | null; status: AutoSaveStatus; retry: () => void } | null;
  onSave: () => void;
  /** The manual save is under way. */
  saving: boolean;
}) {
  const t = useTranslations("trips");
  const { shape, icon, savedHover, saveHover } = PLACEMENT[placement];

  if (autoSave?.savedTripId && autoSave.status !== "saving") {
    return (
      <Link
        href={`/trips/${autoSave.savedTripId}`}
        className={cn(shape, "bg-emerald-500 text-white", savedHover, "transition-colors shadow-lg shadow-emerald-500/25")}
      >
        {t("result.savedViewTrip")}
        <svg className={icon} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
        </svg>
      </Link>
    );
  }
  if (autoSave?.status === "saving") {
    return (
      <button
        type="button"
        disabled
        className={cn(shape, "bg-[var(--secondary-ink)] text-white opacity-60 shadow-lg shadow-[var(--secondary)]/25")}
      >
        <Spinner className={icon} />
        {t("result.saving")}
      </button>
    );
  }
  if (autoSave?.status === "error") {
    return (
      <button
        type="button"
        onClick={() => autoSave.retry()}
        className={cn(shape, "bg-rose-500 text-white hover:bg-rose-600 transition-colors")}
      >
        {t("result.retrySave")}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onSave()}
      disabled={saving}
      className={cn(shape, "bg-[var(--secondary-ink)] text-white", saveHover, "transition-colors disabled:opacity-50 shadow-lg shadow-[var(--secondary)]/25")}
    >
      {saving ? (
        <>
          <Spinner className={icon} />
          {t("wizard.result.saving")}
        </>
      ) : (
        <>
          {t("wizard.result.saveTrip")}
          <svg className={icon} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </>
      )}
    </button>
  );
}
