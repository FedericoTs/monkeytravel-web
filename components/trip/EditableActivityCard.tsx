"use client";

import { useState, memo } from "react";
import type { Activity, VoteType, ActivityVote, ConsensusResult, ActivityVotingStatus } from "@/types";
import VotingSection from "../collaboration/VotingSection";
import { useTranslations } from "next-intl";
import { useActivityTypeLabel } from "@/lib/i18n/activity-type";
import { useActivityPrice } from "@/lib/i18n/activity-price";
import { getActivityTypeColors } from "@/lib/constants/activityColors";
import { proxyImageUrl } from "@/lib/img/proxyUrl";
import { PhotoCredit } from "../ui/PhotoCredit";
import { CalendarDays, Pencil, Sparkles, Trash2 } from "lucide-react";
import TripActionsMenu, { TripActionsMenuItem } from "./TripActionsMenu";
import MoveToDaySheet, { type MoveToDayOption } from "./MoveToDaySheet";
import UnverifiedNote from "./UnverifiedNote";
import { normalizeActivityType } from "@/lib/trip/activity-type";
import { ActivityCardDetails, ActivityKindIcon } from "./ActivityCardParts";
import { Spinner } from "@/components/ui/Spinner";
import { formatDuration } from "@/lib/datetime/duration";
import { placeMapsUrl, placeSearchUrl } from "@/lib/trips/maps-links";

export interface EditableActivityCardProps {
  activity: Activity;
  index: number;
  currency?: string;
  showGallery?: boolean;
  isEditMode: boolean;
  onDelete: () => void;
  onUpdate: (updates: Partial<Activity>) => void;
  onMoveToDay: (dayIndex: number) => void;
  onRegenerate: () => void;
  availableDays: number[];
  currentDayIndex: number;
  /**
   * Days as the "Move to another day" sheet shows them (date, city, how
   * many activities). Falls back to bare day numbers from `availableDays`.
   */
  dayOptions?: MoveToDayOption[];
  isRegenerating?: boolean;
  /**
   * When true, photos will NOT be fetched automatically.
   * User can still trigger fetch via "Load Photos" button.
   * Used for saved trips to prevent automatic API costs.
   */
  disableAutoFetch?: boolean;
  /**
   * Callback fired when a Places API photo is captured.
   * Use this to persist the photo URL to the activity.
   */
  onPhotoCapture?: (activityId: string, photoUrl: string) => void;
  // Voting props (optional - only passed when collaboration is enabled)
  votingEnabled?: boolean;
  votes?: ActivityVote[];
  consensus?: ConsensusResult | null;
  activityStatus?: ActivityVotingStatus;
  currentUserVote?: VoteType | null;
  canVote?: boolean;
  totalVoters?: number;
  onVote?: (voteType: VoteType, comment?: string) => Promise<void>;
  onRemoveVote?: () => Promise<void>;
}

/** The editor's fields, from the stop as it is. */
function editValuesOf(activity: Activity) {
  return {
    start_time: activity.start_time,
    duration_minutes: activity.duration_minutes,
    name: activity.name,
    description: activity.description,
  };
}

/** A name, a clock time, and a duration from 5 minutes to a day. */
function canSaveEdit(values: ReturnType<typeof editValuesOf>): boolean {
  return (
    values.name.trim() !== "" &&
    /^([01]\d|2[0-3]):[0-5]\d$/.test(values.start_time ?? "") &&
    Number.isFinite(values.duration_minutes) &&
    values.duration_minutes >= 5 &&
    values.duration_minutes <= 24 * 60
  );
}

function EditableActivityCard({
  activity,
  index,
  currency = "USD",
  showGallery = true,
  isEditMode,
  onDelete,
  onUpdate,
  onMoveToDay,
  onRegenerate,
  availableDays,
  currentDayIndex,
  dayOptions,
  isRegenerating = false,
  disableAutoFetch = false,
  onPhotoCapture,
  // Voting props
  votingEnabled = false,
  votes = [],
  consensus = null,
  activityStatus = "confirmed",
  currentUserVote = null,
  canVote = false,
  totalVoters = 0,
  onVote,
  onRemoveVote,
}: EditableActivityCardProps) {
  const t = useTranslations('trips');
  const tc = useTranslations('common');
  const priceOf = useActivityPrice();
  const price = priceOf(activity, currency);
  const typeLabel = useActivityTypeLabel();
  const [expanded, setExpanded] = useState(false);
  const [showMoveSheet, setShowMoveSheet] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editValues, setEditValues] = useState(() => editValuesOf(activity));
  const canSave = canSaveEdit(editValues);

  // Handle photo capture from PlaceGallery
  const handlePhotoCapture = (photoUrl: string) => {
    if (activity.id && onPhotoCapture) {
      onPhotoCapture(activity.id, photoUrl);
    }
  };

  // Generate URLs
  const googleMapsUrl = placeMapsUrl(activity);
  const googleSearchUrl = placeSearchUrl(activity);

  // Trips saved before types were normalised still say "foodie" for a dinner.
  const kind = normalizeActivityType(activity.type, activity.name);
  const colors = getActivityTypeColors(kind);

  // The editor opens on the stop as it is now: a reorder, a regenerate or an
  // undo changes it while this card stays mounted.
  const startEditing = () => {
    setEditValues(editValuesOf(activity));
    setIsEditing(true);
  };

  // Tapping the stop itself opens its editor, as the page's hint says. Its
  // buttons, links and fields keep their own jobs, and the pencil stays the
  // way in from a keyboard.
  const handleCardTap = (e: React.MouseEvent) => {
    if (!isEditMode || isEditing) return;
    if ((e.target as HTMLElement).closest("button, a, input, textarea, select, [role='button'], [role='menuitem']")) return;
    startEditing();
  };

  const handleSaveEdit = () => {
    onUpdate({ ...editValues, name: editValues.name.trim() });
    setIsEditing(false);
  };

  const handleCancelEdit = () => {
    setEditValues(editValuesOf(activity));
    setIsEditing(false);
  };

  // Regenerating skeleton
  if (isRegenerating) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm animate-pulse">
        <div className="p-4">
          <div className="flex gap-4">
            <div className="hidden sm:flex flex-col w-16">
              <div className="h-6 bg-slate-200 rounded w-12 mx-auto" />
              <div className="h-4 bg-slate-200 rounded w-10 mx-auto mt-2" />
            </div>
            <div className="flex-1 space-y-3">
              <div className="h-6 bg-slate-200 rounded w-3/4" />
              <div className="h-4 bg-slate-200 rounded w-full" />
              <div className="h-4 bg-slate-200 rounded w-2/3" />
            </div>
          </div>
        </div>
        <div className="border-t border-slate-100 px-4 py-2 bg-amber-50">
          <div className="flex items-center gap-2 text-sm text-amber-700">
            <Spinner className="w-4 h-4" />
            <span>{t('editActivity.regenerating')}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`bg-white border transition-all duration-300 relative ${
        expanded ? "shadow-lg border-slate-300" : "shadow-sm border-slate-200 hover:shadow-md"
      } ${isEditMode
          ? "rounded-r-xl rounded-l-none border-l-0" // Integrate with drag handle
          : "rounded-xl"
      }`}
    >
      {/*
        Edit-mode actions — Edit plus a ⋯ menu holding Move to another day /
        Regenerate / Delete. Both triggers are 44px (DESIGN.md touch minimum)
        and sit INSIDE the card: the old bar floated at -top-2/-right-2 as four
        32px icon-only circles, which the sortable wrapper's overflow clipped
        and which had no label on touch screens — "Move to day" was the
        ambiguous ⇄ glyph nobody found.
      */}
      {isEditMode && !isEditing && (
        <div className="absolute top-2 right-2 z-10 flex items-center gap-1.5" data-testid="activity-actions">
          <button
            type="button"
            onClick={startEditing}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-slate-700 shadow-md transition-colors hover:bg-slate-50"
            title={t('editActivity.editActivity')}
            aria-label={t('editActivity.editActivity')}
          >
            <Pencil className="h-4 w-4" aria-hidden="true" />
          </button>
          <TripActionsMenu label={t('editActivity.moreActions')} iconOnly closeOnItemClick>
            <TripActionsMenuItem onClick={() => setShowMoveSheet(true)} icon={<CalendarDays className="h-4 w-4" aria-hidden="true" />}>
              {t('editActivity.moveToAnotherDay')}
            </TripActionsMenuItem>
            <TripActionsMenuItem onClick={onRegenerate} icon={<Sparkles className="h-4 w-4" aria-hidden="true" />}>
              {t('editActivity.regenerateWithAI')}
            </TripActionsMenuItem>
            <TripActionsMenuItem
              onClick={onDelete}
              icon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
              tone="danger"
            >
              {t('editActivity.deleteActivity')}
            </TripActionsMenuItem>
          </TripActionsMenu>
        </div>
      )}

      {/* "Move to another day" picker — portalled, so it can live here safely */}
      <MoveToDaySheet
        isOpen={showMoveSheet}
        onClose={() => setShowMoveSheet(false)}
        activityName={activity.name}
        days={dayOptions ?? availableDays.map((dayNumber) => ({ dayNumber }))}
        currentDayNumber={availableDays[currentDayIndex] ?? currentDayIndex + 1}
        onPick={(dayNumber) => {
          setShowMoveSheet(false);
          const idx = availableDays.indexOf(dayNumber);
          onMoveToDay(idx === -1 ? dayNumber - 1 : idx);
        }}
      />

      {/* Image Thumbnail - matches ActivityCard design */}
      {activity.image_url && (
        <div className={`relative h-32 sm:h-40 w-full overflow-hidden ${
          isEditMode ? "rounded-tr-xl" : "rounded-t-xl"
        }`}>
          <img
            src={proxyImageUrl(activity.image_url) || activity.image_url}
            alt={activity.name}
            className="w-full h-full object-cover"
            loading="lazy"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
          <div className="absolute bottom-2 left-2">
            <span className={`text-xs px-2 py-1 rounded-full backdrop-blur-sm bg-white/90 ${colors.text} border ${colors.border}`}>
              {typeLabel(kind)}
            </span>
          </div>
          <PhotoCredit src={activity.image_url} />
        </div>
      )}

      {/* Main Content */}
      <div className={`p-3 sm:p-4 ${isEditMode && !isEditing ? "cursor-pointer" : ""}`} onClick={handleCardTap}>
        <div className="flex gap-3 sm:gap-4">
          {/* Time Column - hidden on mobile */}
          <div className="hidden sm:flex flex-shrink-0 text-center w-16 flex-col">
            {isEditing ? (
              <input
                aria-label={tc("activity.startTime")}
                type="time"
                value={editValues.start_time}
                onChange={(e) => setEditValues({ ...editValues, start_time: e.target.value })}
                className="w-full text-sm border border-slate-200 rounded px-1 py-1"
              />
            ) : (
              <div className="text-lg font-semibold text-slate-900">
                {activity.start_time}
              </div>
            )}
            {isEditing ? (
              <input
                aria-label={tc("addActivity.duration")}
                type="number"
                value={editValues.duration_minutes}
                onChange={(e) => setEditValues({ ...editValues, duration_minutes: parseInt(e.target.value) || 0 })}
                className="w-full text-xs border border-slate-200 rounded px-1 py-1 mt-1"
                min="15"
                step="15"
              />
            ) : (
              <div className="text-xs text-slate-500">
                {formatDuration(activity.duration_minutes)}
              </div>
            )}
            <div
              className={`mt-2 w-8 h-8 mx-auto rounded-full ${colors.bg} ${colors.text} flex items-center justify-center`}
            >
              <ActivityKindIcon kind={kind} className="w-4 h-4" />
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            {/* Mobile time/type indicator */}
            <div className="flex sm:hidden items-center gap-2 mb-2 text-sm">
              <div
                className={`w-6 h-6 rounded-full ${colors.bg} ${colors.text} flex items-center justify-center flex-shrink-0`}
              >
                <ActivityKindIcon kind={kind} className="w-3 h-3" />
              </div>
              {isEditing ? (
                <>
                  <input
                    aria-label={tc("activity.startTime")}
                    type="time"
                    value={editValues.start_time}
                    onChange={(e) => setEditValues({ ...editValues, start_time: e.target.value })}
                    className="text-sm border border-slate-200 rounded px-2 py-1 w-24"
                  />
                  <span className="text-slate-500">·</span>
                  <input
                    aria-label={tc("addActivity.duration")}
                    type="number"
                    value={editValues.duration_minutes}
                    onChange={(e) => setEditValues({ ...editValues, duration_minutes: parseInt(e.target.value) || 0 })}
                    className="text-sm border border-slate-200 rounded px-2 py-1 w-16"
                    min="15"
                    step="15"
                  />
                  <span className="text-slate-500 text-xs">min</span>
                </>
              ) : (
                <>
                  <span className="font-medium text-slate-900">{activity.start_time}</span>
                  <span className="text-slate-500">·</span>
                  <span className="text-slate-500">{formatDuration(activity.duration_minutes)}</span>
                </>
              )}
            </div>

            {/* Reserve room for the Edit/⋯ cluster when it sits over text (no image to float over) */}
            <div
              className={`flex flex-col sm:flex-row sm:items-start justify-between gap-2 sm:gap-4 ${
                isEditMode && !isEditing && !activity.image_url ? "pr-[6.5rem]" : ""
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  {isEditing ? (
                    <input
                      aria-label={tc("addActivity.activityName")}
                      type="text"
                      value={editValues.name}
                      onChange={(e) => setEditValues({ ...editValues, name: e.target.value })}
                      className="font-semibold text-slate-900 text-base sm:text-lg border border-slate-200 rounded px-2 py-1 w-full"
                    />
                  ) : (
                    <h4 className="font-semibold text-slate-900 text-base sm:text-lg">
                      {activity.locked && (
                        <span className="mr-1" title={tc("lockedActivity")} aria-label={tc("lockedActivity")}>
                          📌
                        </span>
                      )}
                      {activity.name}
                    </h4>
                  )}
                  {!isEditing && (
                    <>
                      <span
                        className={`hidden sm:inline text-xs px-2 py-0.5 rounded-full ${colors.bg} ${colors.text} ${colors.border} border`}
                      >
                        {typeLabel(kind)}
                      </span>
                      {activity.booking_required && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                          {t('activity.booking')}
                        </span>
                      )}
                    </>
                  )}
                </div>

                {isEditing ? (
                  <textarea
                    aria-label={tc("addActivity.descriptionOptional")}
                    value={editValues.description}
                    onChange={(e) => setEditValues({ ...editValues, description: e.target.value })}
                    className="text-slate-600 mt-1 text-sm border border-slate-200 rounded px-2 py-1 w-full resize-none"
                    rows={2}
                  />
                ) : (
                  <p className="text-slate-600 mt-1 text-sm line-clamp-2">
                    {activity.description}
                  </p>
                )}
                <UnverifiedNote activity={activity} />

                {/* Location */}
                <div className="flex items-start gap-2 mt-2 text-sm text-slate-500">
                  <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  <span className="line-clamp-1">{activity.address || activity.location}</span>
                </div>
              </div>

              {/* Price, in the viewer's currency, when there is an estimate */}
              {!isEditing && price != null && (
                <div className="sm:text-right flex-shrink-0 mt-1 sm:mt-0">
                  <div className="text-base sm:text-lg font-semibold text-slate-900 inline-flex items-center gap-1.5">
                    <span className="text-slate-500 font-normal text-xs sm:text-sm">~</span>
                    {price}
                  </div>
                  <div className="text-[10px] text-slate-500 hidden sm:block">{t('activity.aiEstimate')}</div>
                </div>
              )}
            </div>

            {/* Edit Mode Save/Cancel buttons */}
            {isEditing && (
              <div className="flex items-center gap-2 mt-3">
                <button
                  onClick={handleCancelEdit}
                  className="px-3 py-1.5 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
                >
                  {tc('buttons.cancel')}
                </button>
                <button
                  onClick={handleSaveEdit}
                  disabled={!canSave}
                  className="px-3 py-1.5 text-sm font-medium text-white bg-[var(--primary)] hover:bg-[var(--primary)]/90 rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {t('detail.saveChanges')}
                </button>
              </div>
            )}

            {/* Quick Actions */}
            {!isEditing && (
              <div className="flex flex-wrap gap-2 mt-3">
                <a
                  href={googleMapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium rounded-lg transition-colors"
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" />
                  </svg>
                  {tc('buttons.maps')}
                </a>
                <a
                  href={googleSearchUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium rounded-lg transition-colors"
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
                  </svg>
                  {tc('buttons.verify')}
                </a>
                {activity.official_website && (
                  <a
                    href={activity.official_website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[var(--primary)]/10 hover:bg-[var(--primary)]/20 text-[var(--primary-ink)] text-xs font-medium rounded-lg transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                    {tc('buttons.website')}
                  </a>
                )}
                <button
                  onClick={() => setExpanded(!expanded)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium rounded-lg transition-colors ml-auto"
                >
                  {expanded ? (
                    <>
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                      </svg>
                      {tc('buttons.less')}
                    </>
                  ) : (
                    <>
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                      {tc('buttons.more')}
                    </>
                  )}
                </button>
              </div>
            )}

            {/* Voting Section (only when collaboration is enabled and not editing) */}
            {votingEnabled && !isEditing && onVote && onRemoveVote && (
              <VotingSection
                activityId={activity.id || `activity-${index}`}
                votes={votes}
                consensus={consensus}
                status={activityStatus}
                currentUserVote={currentUserVote}
                canVote={canVote}
                totalVoters={totalVoters}
                onVote={onVote}
                onRemoveVote={onRemoveVote}
                className="mt-3"
              />
            )}
          </div>
        </div>
      </div>

      {/* Expanded Content */}
      {expanded && !isEditing && (
        <ActivityCardDetails
          activity={activity}
          showGallery={showGallery}
          disableAutoFetch={disableAutoFetch}
          onPhotoCapture={handlePhotoCapture}
          tipsLabel={t('activity.insiderTips')}
        />
      )}
    </div>
  );
}

// Memoize to prevent re-renders during editing, especially during drag operations
// Only re-render when activity data or edit state changes
export default memo(EditableActivityCard, (prevProps, nextProps) => {
  // Quick identity checks
  if (prevProps.activity.id !== nextProps.activity.id) return false;
  if (prevProps.index !== nextProps.index) return false;
  if (prevProps.isEditMode !== nextProps.isEditMode) return false;
  if (prevProps.isRegenerating !== nextProps.isRegenerating) return false;
  if (prevProps.currentDayIndex !== nextProps.currentDayIndex) return false;
  // Memoized upstream on the itinerary, so identity changes only when a day's
  // contents change — exactly when the move sheet's counts would go stale.
  if (prevProps.dayOptions !== nextProps.dayOptions) return false;
  if (prevProps.currency !== nextProps.currency) return false;

  // Check key activity properties that affect rendering
  const prev = prevProps.activity;
  const next = nextProps.activity;
  if (prev.name !== next.name) return false;
  if (prev.start_time !== next.start_time) return false;
  if (prev.duration_minutes !== next.duration_minutes) return false;
  if (prev.image_url !== next.image_url) return false;
  if (prev.type !== next.type) return false;
  if (prev.description !== next.description) return false;
  if (prev.locked !== next.locked) return false;

  // Voting props
  if (prevProps.votingEnabled !== nextProps.votingEnabled) return false;
  if (prevProps.currentUserVote !== nextProps.currentUserVote) return false;
  if (prevProps.activityStatus !== nextProps.activityStatus) return false;
  if (prevProps.votes?.length !== nextProps.votes?.length) return false;
  if (prevProps.totalVoters !== nextProps.totalVoters) return false;

  return true;
});
