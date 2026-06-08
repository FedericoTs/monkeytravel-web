"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import BaseModal from "@/components/ui/BaseModal";

/**
 * Reasons surfaced in the Start Over modal's "why are you discarding?"
 * picker. Must match the CHECK constraint in
 * `supabase/migrations/<ts>_trip_deletion_feedback.sql`. Adding a value
 * here requires updating both.
 *
 * Order in the UI is intentional: most-likely user reasons first, then
 * "made by mistake" (an escape hatch for misclicks), then "other"
 * (long-tail / free-text).
 */
export type StartOverReason =
  | "wrong_destination"
  | "wrong_dates"
  | "didnt_like_suggestions"
  | "too_expensive"
  | "made_by_mistake"
  | "other";

const REASONS: StartOverReason[] = [
  "wrong_destination",
  "wrong_dates",
  "didnt_like_suggestions",
  "too_expensive",
  "made_by_mistake",
  "other",
];

interface StartOverModalProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * Fires AFTER the user picks a reason. Receives the reason + optional
   * free-text so the wizard can post it to /api/trips/[id]/deletion-feedback
   * before the actual discard runs.
   */
  onConfirm: (reason: StartOverReason, customReason: string | null) => void;
  destination: string;
  tripDays: number;
  activitiesCount: number;
  /** When true, surface the fact that confirming will DELETE an
   *  already-auto-saved trip from the user's dashboard. */
  wasAutoSaved?: boolean;
}

export default function StartOverModal({
  isOpen,
  onClose,
  onConfirm,
  destination,
  tripDays,
  activitiesCount,
  wasAutoSaved = false,
}: StartOverModalProps) {
  const t = useTranslations("common.startOver");

  // Reason picker state. Required — confirm is disabled until selected.
  // We DON'T preselect anything so the user actively chooses (no biased
  // default skewing the analytics).
  const [reason, setReason] = useState<StartOverReason | "">("");
  const [customReason, setCustomReason] = useState("");

  // Reset state every time the modal opens so a previous abandonment
  // doesn't pre-fill the next one. (`isOpen` is the open-edge trigger.)
  useEffect(() => {
    if (isOpen) {
      setReason("");
      setCustomReason("");
    }
  }, [isOpen]);

  const handleConfirm = () => {
    if (!reason) return;
    const trimmedCustom = customReason.trim();
    // Only forward custom_reason when it's actually populated AND the
    // reason is "other" (where the textarea matters most) — keeps the
    // dataset cleaner. Power users picking "wrong_dates" with extra
    // detail still get captured via the textarea since we forward when
    // non-empty regardless.
    onConfirm(
      reason,
      trimmedCustom.length > 0 ? trimmedCustom : null,
    );
  };

  const canConfirm = reason !== "";

  // BaseModal handles role="dialog", aria-modal, Esc, focus trap, scroll lock
  // and portal rendering. The previous useModalBehavior hook covered escape
  // + scroll lock only — BaseModal supersedes it.
  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      usePortal
      maxWidth="max-w-md"
      showCloseButton={false}
      noPadding
      animation="scale"
      zIndex="z-[100]"
      ariaLabel={t("title")}
      className="shadow-2xl"
    >
      {/* Header with warning gradient */}
      <div className="bg-gradient-to-r from-amber-50 to-orange-50 px-6 pt-6 pb-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
            <svg
              className="w-6 h-6 text-amber-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-900">
              {t("title")}
            </h2>
            <p className="text-sm text-slate-600">
              {t("warning")}
            </p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="px-6 py-5 space-y-4 max-h-[60vh] overflow-y-auto">
        <p className="text-slate-700">
          {wasAutoSaved
            ? t("discardMessageSaved", { destination })
            : t("discardMessage", { destination })}
        </p>

        {/* What will be lost */}
        <div className="bg-slate-50 rounded-xl p-4 space-y-2">
          <p className="text-sm font-medium text-slate-500 uppercase tracking-wide">
            {t("youllLose")}
          </p>
          <div className="flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-sm text-slate-700">
              <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              {t("daysPlanned", { count: tripDays })}
            </span>
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-sm text-slate-700">
              <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              {t("activities", { count: activitiesCount })}
            </span>
          </div>
        </div>

        {/* Reason picker — required.
            Why this exists: the david-cassoni incident (2026-06-07) showed
            us we had zero visibility into WHY a freshly-generated trip
            got discarded. Knowing whether it's destination vs dates vs
            suggestion quality directly maps to where to invest. */}
        <div>
          <label
            htmlFor="start-over-reason"
            className="block text-sm font-medium text-slate-700 mb-1.5"
          >
            {t("reasonLabel")} <span className="text-rose-500">*</span>
          </label>
          <select
            id="start-over-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value as StartOverReason | "")}
            className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-base focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)] bg-white"
            required
          >
            <option value="" disabled>
              {t("reasonPlaceholder")}
            </option>
            {REASONS.map((r) => (
              <option key={r} value={r}>
                {t(`reasons.${r}`)}
              </option>
            ))}
          </select>
        </div>

        {/* Optional free-text. Always shown — surfacing the textarea only
            when reason==="other" hides the affordance for users who picked
            a structured reason but want to add detail (e.g. "wrong_dates"
            + "I needed the dates 1 day later"). Lightweight 280-char
            cap so long rants get encoded as 1+ short sentences. */}
        <div>
          <label
            htmlFor="start-over-custom-reason"
            className="block text-sm font-medium text-slate-700 mb-1.5"
          >
            {t("customReasonLabel")}{" "}
            <span className="text-slate-400 font-normal">
              ({t("customReasonOptional")})
            </span>
          </label>
          <textarea
            id="start-over-custom-reason"
            value={customReason}
            onChange={(e) => setCustomReason(e.target.value)}
            maxLength={280}
            rows={2}
            placeholder={t("customReasonPlaceholder")}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)] resize-none"
          />
        </div>

        {/* Tip */}
        <p className="text-sm text-slate-500">
          {t("tip")}
        </p>
      </div>

      {/* Actions */}
      <div className="px-6 pb-6 flex flex-col-reverse sm:flex-row gap-3">
        <button
          onClick={onClose}
          className="flex-1 px-6 py-3 bg-[var(--secondary)] text-white font-semibold rounded-xl hover:bg-[var(--secondary)]/90 transition-colors shadow-lg shadow-[var(--secondary)]/25"
        >
          {t("cancel")}
        </button>
        <button
          onClick={handleConfirm}
          disabled={!canConfirm}
          className="flex-1 px-6 py-3 bg-slate-100 text-slate-700 font-semibold rounded-xl hover:bg-slate-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {wasAutoSaved ? t("confirmDeleteSaved") : t("confirm")}
        </button>
      </div>
    </BaseModal>
  );
}
