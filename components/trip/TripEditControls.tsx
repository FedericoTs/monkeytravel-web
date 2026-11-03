"use client";

import { useTranslations } from "next-intl";
import { Undo2, Redo2 } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import type { ItinerarySaveStatus } from "@/hooks/useItinerarySync";

/**
 * The trip page's editing controls. Ambient (solo) owners edit inline with
 * auto-save: no mode toggle, just undo/redo and a status pill that turns into
 * a retry when a save failed. Other editors use the explicit edit mode: Edit,
 * then Discard or Save. Voters and viewers get nothing, since PATCH admits the
 * owner and editors only.
 */
export default function TripEditControls({
  ambientEdit,
  undo,
  redo,
  canUndo,
  canRedo,
  saveStatus,
  onRetrySave,
  isEditMode,
  canEdit,
  handleEnterEditMode,
  handleDiscardChanges,
  handleSaveChanges,
  isSaving,
  itineraryWritesInFlight,
  hasChanges,
}: {
  ambientEdit: boolean;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  saveStatus: ItinerarySaveStatus;
  /** Saves again after a failed save. */
  onRetrySave: () => void;
  isEditMode: boolean;
  canEdit: boolean;
  handleEnterEditMode: () => void;
  handleDiscardChanges: () => void;
  handleSaveChanges: () => void;
  isSaving: boolean;
  /** Writes to the itinerary still on their way (Save waits for them). */
  itineraryWritesInFlight: number;
  hasChanges: boolean;
}) {
  const t = useTranslations("trips");
  return ambientEdit ? (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={undo}
        disabled={!canUndo}
        aria-label={t('detail.undo')}
        title={t('detail.undo')}
        className="p-2 rounded-lg text-slate-600 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        <Undo2 className="w-4 h-4" />
      </button>
      <button
        type="button"
        onClick={redo}
        disabled={!canRedo}
        aria-label={t('detail.redo')}
        title={t('detail.redo')}
        className="p-2 rounded-lg text-slate-600 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        <Redo2 className="w-4 h-4" />
      </button>
      {/* Auto-save status pill. On error it becomes a retry button —
          clearing the failed-payload guard and nudging editedItinerary
          re-triggers the debounced save effect. */}
      <button
        type="button"
        onClick={saveStatus === "error" ? onRetrySave : undefined}
        disabled={saveStatus !== "error"}
        aria-live="polite"
        title={saveStatus === "error" ? t('detail.saveFailed') : undefined}
        className={`hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
          saveStatus === "error"
            ? "bg-red-50 text-red-700 hover:bg-red-100 cursor-pointer"
            : saveStatus === "conflict"
              ? "bg-amber-50 text-amber-800"
              : saveStatus === "saving"
                ? "bg-slate-100 text-slate-500"
                : "bg-emerald-50 text-emerald-700"
        }`}
      >
        {saveStatus === "conflict" ? (
          // The choice itself is in the conflict banner.
          <>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M5.07 19h13.86a2 2 0 001.71-3l-6.93-12a2 2 0 00-3.42 0l-6.93 12a2 2 0 001.71 3z" />
            </svg>
            <span>{t('detail.conflictPill')}</span>
          </>
        ) : saveStatus === "saving" ? (
          <>
            <Spinner className="w-3.5 h-3.5" />
            <span>{t('detail.saving')}</span>
          </>
        ) : saveStatus === "error" ? (
          <>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M5.07 19h13.86a2 2 0 001.71-3l-6.93-12a2 2 0 00-3.42 0l-6.93 12a2 2 0 001.71 3z" />
            </svg>
            <span>{t('detail.saveFailed')}</span>
          </>
        ) : (
          <>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span>{t('detail.allChangesSaved')}</span>
          </>
        )}
      </button>
    </div>
  ) : !isEditMode && !canEdit ? (
    // Voters and viewers get no edit entry point: PATCH admits the
    // owner and editors only, so their Save would be refused.
    null
  ) : !isEditMode ? (
    <button
      onClick={handleEnterEditMode}
      className="flex items-center gap-2 p-2 sm:px-3 sm:py-2 rounded-lg text-sm font-medium bg-[var(--accent)] text-slate-900 hover:bg-[var(--accent)]/90 transition-colors"
      title={t('detail.editTrip')}
    >
      <svg className="w-5 h-5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
      </svg>
      <span className="hidden sm:inline">{t('detail.editTrip')}</span>
    </button>
  ) : (
    <div className="flex items-center gap-2">
      {/* Cancel/Discard button */}
      <button
        onClick={handleDiscardChanges}
        disabled={isSaving}
        className="flex items-center gap-1.5 p-2 sm:px-3 sm:py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-50"
        title={t('detail.discardChanges')}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
        <span className="hidden sm:inline">{t('detail.cancel')}</span>
      </button>
      {/* Save & Close button - Primary action */}
      <button
        onClick={handleSaveChanges}
        disabled={isSaving || itineraryWritesInFlight > 0}
        className={`flex items-center gap-2 p-2 sm:px-4 sm:py-2 rounded-lg text-sm font-medium transition-all ${
          hasChanges
            ? 'bg-green-600 text-white hover:bg-green-700 shadow-lg shadow-green-600/25 animate-pulse-subtle'
            : 'bg-green-600 text-white hover:bg-green-700'
        } disabled:opacity-50`}
        title={hasChanges ? t('detail.saveChanges') : t('detail.doneEditing')}
      >
        {isSaving ? (
          <>
            <Spinner className="w-4 h-4" />
            <span className="hidden sm:inline">{t('detail.saving')}</span>
          </>
        ) : (
          <>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span className="hidden sm:inline">
              {hasChanges ? t('detail.saveChanges') : t('detail.doneEditing')}
            </span>
          </>
        )}
      </button>
    </div>
  );
}
