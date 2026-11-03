"use client";

import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";

const BaseModal = dynamic(() => import("@/components/ui/BaseModal"), { ssr: false });

/** Asks before a full regenerate replaces the assistant's edits to the plan. */
export default function RegenerateConfirmModal({
  isOpen,
  onClose,
  onRegenerate,
}: {
  isOpen: boolean;
  /** Keeps the plan as it is. */
  onClose: () => void;
  onRegenerate: () => void;
}) {
  const t = useTranslations("trips");
  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      // Above the sticky result bar (also z-50, later in the page), which
      // would otherwise cover the dialog and swallow clicks on its buttons.
      usePortal
      zIndex={100}
      title={t("wizard.regenerateConfirm.title")}
    >
      <p className="text-sm text-slate-600">{t("wizard.regenerateConfirm.body")}</p>
      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={onClose}
          className="rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100"
        >
          {t("wizard.regenerateConfirm.keep")}
        </button>
        <button
          type="button"
          onClick={onRegenerate}
          className="rounded-xl bg-[var(--primary)] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[var(--primary-light)]"
        >
          {t("wizard.regenerateConfirm.regenerate")}
        </button>
      </div>
    </BaseModal>
  );
}
