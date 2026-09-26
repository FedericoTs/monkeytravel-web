"use client";

/**
 * Change a generated trip's dates without starting over
 * (lib/trips/change-dates.ts). The summary line says, before anything
 * happens, what the new dates do to the plan: it moves, days are cut from the
 * end, or the assistant plans the extra days.
 */
import { useState } from "react";
import { useTranslations } from "next-intl";
import BaseModal from "@/components/ui/BaseModal";
import { planDateChange } from "@/lib/trips/change-dates";

interface ChangeDatesModalProps {
  isOpen: boolean;
  onClose: () => void;
  startDate: string;
  endDate: string;
  currentDays: number;
  maxDays: number;
  /** Earliest start (today). */
  minDate: string;
  /** Latest start the wizard accepts. */
  maxStartDate: string;
  onConfirm: (start: string, end: string) => void;
}

export default function ChangeDatesModal(props: ChangeDatesModalProps) {
  const t = useTranslations("trips.wizard.changeDates");
  return (
    // Portal + z-100: above the wizard's sticky result bar (z-50).
    <BaseModal isOpen={props.isOpen} onClose={props.onClose} title={t("title")} usePortal zIndex={100}>
      {/* BaseModal renders nothing while closed, so the form mounts afresh on
          each opening and starts from the trip's current dates. */}
      <DatesForm {...props} />
    </BaseModal>
  );
}

function DatesForm({
  onClose,
  startDate,
  endDate,
  currentDays,
  maxDays,
  minDate,
  maxStartDate,
  onConfirm,
}: ChangeDatesModalProps) {
  const t = useTranslations("trips.wizard.changeDates");
  const [start, setStart] = useState(startDate);
  const [end, setEnd] = useState(endDate);

  const change = planDateChange(currentDays, start, end, maxDays);
  const unchanged = start === startDate && end === endDate;
  const summary =
    change.kind === "invalid"
      ? change.reason === "order"
        ? t("endBeforeStart")
        : change.reason === "tooLong"
          ? t("tooLong", { max: maxDays })
          : t("pickBoth")
      : unchanged
        ? t("unchanged")
        : change.kind === "same"
          ? t("same")
          : change.kind === "shorter"
            ? t("shorter", { count: change.length })
            : t("longer", { count: change.length, from: change.addedFrom });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (change.kind !== "invalid" && !unchanged) onConfirm(start, end);
      }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block text-sm font-medium text-slate-800">
          {t("start")}
          <input
            type="date"
            value={start}
            min={minDate}
            max={maxStartDate}
            onChange={(e) => setStart(e.target.value)}
            className="mt-1.5 block w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-[var(--primary)] focus:outline-none"
          />
        </label>
        <label className="block text-sm font-medium text-slate-800">
          {t("end")}
          <input
            type="date"
            value={end}
            min={start || minDate}
            onChange={(e) => setEnd(e.target.value)}
            className="mt-1.5 block w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-[var(--primary)] focus:outline-none"
          />
        </label>
      </div>
      <p aria-live="polite" className={`mt-3 text-sm ${change.kind === "invalid" ? "text-rose-700" : "text-slate-600"}`}>
        {summary}
      </p>
      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={onClose}
          className="rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100"
        >
          {t("cancel")}
        </button>
        <button
          type="submit"
          disabled={change.kind === "invalid" || unchanged}
          className="rounded-xl bg-[var(--primary)] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[var(--primary-light)] disabled:opacity-50"
        >
          {t("confirm")}
        </button>
      </div>
    </form>
  );
}
