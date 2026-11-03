"use client";

import { useTranslations } from "next-intl";
import { Undo2, Redo2 } from "lucide-react";

/**
 * The bar fixed to the foot of the trip page in edit mode: undo and redo, the
 * unsaved-changes badge and a failed save's message, with the keyboard
 * shortcuts beside them.
 */
export default function TripEditBar({
  undo,
  redo,
  canUndo,
  canRedo,
  hasChanges,
  saveError,
}: {
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  hasChanges: boolean;
  saveError: string | null;
}) {
  const t = useTranslations("trips");
  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-sm border-t border-slate-200 z-50">
      <div className="max-w-6xl mx-auto px-4 py-3">
        <div className="flex items-center justify-between">
          {/* Left: Undo/Redo and status */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <button
                onClick={undo}
                disabled={!canUndo}
                className="p-2 rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                title={`${t("detail.undo")} (Cmd+Z)`}
              >
                <Undo2 className="w-4 h-4 text-slate-600" />
              </button>
              <button
                onClick={redo}
                disabled={!canRedo}
                className="p-2 rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                title={`${t("detail.redo")} (Cmd+Shift+Z)`}
              >
                <Redo2 className="w-4 h-4 text-slate-600" />
              </button>
            </div>
            {hasChanges && (
              <span className="px-2.5 py-1 bg-amber-100 text-amber-800 text-xs font-medium rounded-full animate-pulse">
                {t('detail.unsavedChanges')}
              </span>
            )}
            {saveError && (
              <span className="text-sm text-red-600">{saveError}</span>
            )}
          </div>
          {/* Right: Keyboard hint */}
          <div className="hidden sm:flex items-center gap-2 text-xs text-slate-500">
            <kbd className="px-1.5 py-0.5 bg-slate-100 rounded text-slate-500">⌘Z</kbd>
            <span>{t("detail.undo")}</span>
            <span className="mx-1">•</span>
            <kbd className="px-1.5 py-0.5 bg-slate-100 rounded text-slate-500">⌘⇧Z</kbd>
            <span>{t("detail.redo")}</span>
            <span className="mx-1">•</span>
            <kbd className="px-1.5 py-0.5 bg-slate-100 rounded text-slate-500">Esc</kbd>
            <span>{t("detail.exitEditing")}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
