"use client";

import { useMemo, type ComponentProps } from "react";
import { useTranslations } from "next-intl";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { InlineProposalCard } from "@/components/collaboration/proposals";
import ActivityRow from "@/components/trip/ActivityRow";
import AddActivityButton from "@/components/trip/AddActivityButton";
import DayActions from "@/components/trip/DayActions";
import DayHeader from "@/components/trip/DayHeader";
import { DayRouteLink } from "@/components/trip/DayRouteLink";
import DaySummary from "@/components/trip/DaySummary";
import { DayTimeline } from "@/components/trip/DayTimeline";
import EditableActivityCard, { type EditableActivityCardProps } from "@/components/trip/EditableActivityCard";
import {
  ActivityDragGhost,
  DayDropHeader,
  DayDropList,
  makeItineraryCollisionDetection,
  type dayOptionsOf,
} from "@/components/trip/ItineraryDnd";
import SortableActivityCard from "@/components/trip/SortableActivityCard";
import { dragAnnouncements } from "@/lib/trip/itinerary-dnd";
import { NoItinerary, RegeneratingDayOverlay, ReorderHint } from "@/components/trip/TripNotices";
import type { FocusedDay } from "@/hooks/useDayFocus";
import type { useItineraryMoves } from "@/hooks/useItineraryMoves";
import { segmentBetween, type useTravelDistances } from "@/hooks/useTravelDistances";
import { useCurrency } from "@/lib/locale";
import type { TimelineItem } from "@/lib/proposals/timeline";
import { dayBudgetLabel, showsDayBudget } from "@/lib/trip/day-budget";
import type { Activity, ItineraryDay } from "@/types";
import { calculateNextTimeSlot, isFixed, overlapMinutes } from "@/lib/utils/activity-id";

type Proposal = ComponentProps<typeof InlineProposalCard>["proposal"];
type VotingProps = Pick<
  EditableActivityCardProps,
  "votingEnabled" | "votes" | "consensus" | "activityStatus" | "currentUserVote" | "canVote" | "totalVoters" | "onVote" | "onRemoveVote"
>;

/** What every day takes from the trip page. */
interface DayContext {
  renderEpoch: number;
  viewMode: "timeline" | "cards";
  isEditMode: boolean;
  /** Editing is on, inline (ambient) or through edit mode. */
  editingActive: boolean;
  destination: string;
  /** The trip's currency, for an estimate that names none. */
  currency: string | undefined;
  pace: ComponentProps<typeof DaySummary>["pace"];
  moves: ReturnType<typeof useItineraryMoves>;
  focusedDay: FocusedDay | null;
  aiUpdatedActivityId: string | null;
  regeneratingDayNumber: number | null;
  regeneratingActivityId: string | null;
  travelData: ReturnType<typeof useTravelDistances>["travelData"];
  travelLoading: boolean;
  crewVotes: ComponentProps<typeof ActivityRow>["crewVotes"];
  availableDays: number[];
  dayOptions: ReturnType<typeof dayOptionsOf>;
  votingProps: (activityId: string | undefined) => VotingProps;
  /** A day's activities with the crew's open proposals among them. */
  timelineOf: (dayNumber: number) => TimelineItem<Proposal>[];
  canVote: boolean;
  voterCount: number;
  onOpenProposal: (proposal: Proposal) => void;
  /** Regenerating a whole day; null for whoever may not. */
  onRegenerateDay: ((dayNumber: number) => void) | null;
  onOptimizeRoute: (dayNumber: number, activities: Activity[]) => void;
  /** Suggesting an activity to the crew; null for whoever may not. */
  onSuggestActivity: ((dayNumber: number) => void) | null;
  onActivityDelete: (activityId: string, name: string) => void;
  onActivityUpdate: (activityId: string, updates: Partial<Activity>) => void;
  onActivityRegenerate: (activityId: string, dayIndex: number) => void;
  onAddActivity: (dayIndex: number, activity: Partial<Activity>) => void;
  onPhotoCapture: (activityId: string, photoUrl: string) => void;
  /** Moves the stops after one that runs into the next. */
  onMakeRoom: (activityId: string) => void;
}

/**
 * The plan's days on the trip page: one drag context around them, and each day
 * with its header and its activities, as cards (sortable while editing, with the
 * crew's proposals among them while viewing) or as a timeline.
 */
export default function TripDayList({
  days,
  selectedDay,
  ...context
}: DayContext & {
  days: ItineraryDay[];
  /** The day the slider picked; null shows them all. */
  selectedDay: number | null;
}) {
  const { moves, renderEpoch } = context;
  const collisionDetection = useMemo(() => makeItineraryCollisionDetection(), []);
  // Re-measure every droppable on each move. dnd-kit measures droppables once
  // when a drag starts and only re-measures sortable ITEMS when a list
  // changes — the day headers and lists are not sortable items, so anything
  // that shifts the page mid-drag (the preview moving a card between days,
  // the map or an image loading) would leave their rects stale and a drop over
  // a header would land somewhere else. ~15 rects per move is negligible.
  const dndMeasuring = useMemo(() => ({ droppable: { strategy: MeasuringStrategy.Always } }), []);

  // What a screen reader hears while a stop moves: its name, its day and its
  // place in that day, in the page's language (dnd-kit's own words are
  // English, with internal ids). Worked out from the plan as the page shows it;
  // a cancelled move goes back to the plan as it was.
  const tDrag = useTranslations("common.drag");
  const shownPlan = moves.preview ?? days;
  const dndAccessibility = useMemo(
    () => ({
      announcements: dragAnnouncements(
        (key, place) => tDrag(key, { ...place }),
        () => shownPlan,
        () => days,
      ),
      screenReaderInstructions: { draggable: tDrag("instructions") },
    }),
    [tDrag, shownPlan, days],
  );

  // Drag-and-drop sensors for reordering activities
  // Optimized for premium iOS-like touch experience
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5, // Reduced for more responsive feel
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 150, // Quick but intentional press (iOS-like)
        tolerance: 8, // Allow slight movement during press
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  if (days.length === 0) return <NoItinerary />;

  return (
    // One drag context for the whole plan, so a card can be dragged from
    // any day to any other (with one context per day, a drag past the
    // day boundary snaps back). Inert when nothing is sortable (view
    // mode / read-only), so it wraps unconditionally.
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      measuring={dndMeasuring}
      accessibility={dndAccessibility}
      onDragStart={moves.onDragStart}
      onDragOver={moves.onDragOver}
      onDragEnd={moves.onDragEnd}
      onDragCancel={moves.onDragCancel}
    >
      <div className="space-y-8" key={`itinerary-v${renderEpoch}`}>
        {(moves.preview ?? days)
          // dayIndex is the day's place in the whole trip, which the edit
          // handlers index by; with a day selected it's the only one shown.
          .map((day, dayIndex) => ({ day, dayIndex }))
          .filter(({ day }) => selectedDay === null || day.day_number === selectedDay)
          .map(({ day, dayIndex }, shownIndex) => (
            <TripDay
              key={`day-${day.day_number}-v${renderEpoch}`}
              day={day}
              dayIndex={dayIndex}
              firstShown={shownIndex === 0}
              {...context}
            />
          ))}
      </div>
      {/* The card that follows the pointer; the source card stays as a faded placeholder. */}
      <DragOverlay dropAnimation={{ duration: 200, easing: "cubic-bezier(0.18, 0.67, 0.6, 1.22)" }}>
        <ActivityDragGhost activity={moves.draggedActivity} />
      </DragOverlay>
    </DndContext>
  );
}

function TripDay({
  day,
  dayIndex,
  firstShown,
  renderEpoch,
  viewMode,
  isEditMode,
  editingActive,
  destination,
  currency,
  pace,
  moves,
  focusedDay,
  aiUpdatedActivityId,
  regeneratingDayNumber,
  regeneratingActivityId,
  travelData,
  travelLoading,
  crewVotes,
  availableDays,
  dayOptions,
  votingProps,
  timelineOf,
  canVote,
  voterCount,
  onOpenProposal,
  onRegenerateDay,
  onOptimizeRoute,
  onSuggestActivity,
  onActivityDelete,
  onActivityUpdate,
  onActivityRegenerate,
  onAddActivity,
  onPhotoCapture,
  onMakeRoom,
}: DayContext & {
  day: ItineraryDay;
  /** The day's place in the whole trip. */
  dayIndex: number;
  /** The first of the days shown, which carries the reorder hint. */
  firstShown: boolean;
}) {
  const t = useTranslations("trips");
  const tCommon = useTranslations("common");
  // Converts source-currency activity costs into the user's preferred currency.
  const { convert, format } = useCurrency();
  const dayTravelData = travelData.get(day.day_number);

  // A stop still on when the next one starts, for whoever is editing: making
  // room moves the later stops, unless the next one is fixed. Not during a
  // drag: a note that comes and goes would move the days under the pointer.
  const overlapOf = (activity: Activity, idx: number) => {
    const next = day.activities[idx + 1];
    const minutes = editingActive && !moves.dragging && next ? overlapMinutes(activity, next) : 0;
    if (minutes === 0 || !next) return null;
    const id = activity.id;
    return { minutes, nextName: next.name, onMakeRoom: id && !isFixed(next) ? () => onMakeRoom(id) : null };
  };

  // What every activity's row and card take, editing or viewing.
  const rowProps = (activity: Activity, idx: number) => ({
    crewVotes,
    activityId: activity.id,
    aiUpdated: aiUpdatedActivityId === activity.id,
    overlap: overlapOf(activity, idx),
    travelTo:
      idx < day.activities.length - 1
        ? {
            segment: segmentBetween(dayTravelData, activity, day.activities[idx + 1]),
            isLoading: travelLoading || dayTravelData?.isLoading,
          }
        : null,
  });
  const cardProps = (activity: Activity, idx: number) => ({
    activity,
    index: idx,
    currency,
    showGallery: true,
    currentDayIndex: dayIndex,
    disableAutoFetch: true,
    onPhotoCapture,
    ...votingProps(activity.id),
  });

  return (
    <div
      // Stable per-day anchor for the assistant's APPLY → SEE loop
      // (scroll target + flash highlight, see handleFocusDayCard).
      id={`trip-day-${day.day_number}`}
      className={`relative scroll-mt-6 ${
        focusedDay?.day === day.day_number
          ? `rounded-2xl ring-2 ring-[var(--primary)] ring-offset-4 transition-all duration-500 ${
              focusedDay.pulse ? "animate-pulse-once" : ""
            }`
          : ""
      }`}
    >
      {/* Loading overlay during per-day regeneration */}
      {regeneratingDayNumber === day.day_number && <RegeneratingDayOverlay dayNumber={day.day_number} />}
      {/* Day Header — a drop target while a card is being dragged (lands at the start of this day) */}
      <DayDropHeader dayNumber={day.day_number} dragging={moves.dragging}>
        <DayHeader
          dayNumber={day.day_number}
          title={t("day.label", { number: day.day_number })}
          theme={day.theme}
          editing={isEditMode}
        >
          <DayActions
            dayNumber={day.day_number}
            regeneratingDayNumber={regeneratingDayNumber}
            onRegenerate={onRegenerateDay && (() => onRegenerateDay(day.day_number))}
            onOptimizeRoute={
              editingActive && day.activities.length >= 3
                ? () => onOptimizeRoute(day.day_number, day.activities)
                : null
            }
            budget={
              showsDayBudget(day)
                ? dayBudgetLabel(day, { convert, format }, tCommon("activity.free"), currency || "USD")
                : null
            }
          />
        </DayHeader>
      </DayDropHeader>
      {!isEditMode && <DayRouteLink activities={day.activities} surface="trip" className="-mt-2 mb-2" />}

      {/* Activities */}
      {viewMode === "cards" ? (
        <>
          {editingActive ? (
            /* Edit Mode with Drag-and-Drop */
            <>
              {/* Edit mode reorder hint - only on the first day shown */}
              {firstShown && <ReorderHint />}
              <DayDropList dayNumber={day.day_number} dragging={moves.dragging} isEmpty={day.activities.length === 0}>
                <SortableContext
                  items={day.activities.map((a) => a.id || `activity-${day.activities.indexOf(a)}`)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="grid gap-0">
                    {day.activities.map((activity, idx) => (
                      <ActivityRow key={`${activity.id || idx}-v${renderEpoch}`} {...rowProps(activity, idx)}>
                        <SortableActivityCard
                          {...cardProps(activity, idx)}
                          isEditMode={true}
                          onDelete={() => onActivityDelete(activity.id!, activity.name)}
                          onUpdate={(updates) => onActivityUpdate(activity.id!, updates)}
                          onMoveToDay={(targetDayIdx) => moves.moveToDay(activity.id!, targetDayIdx)}
                          onRegenerate={() => onActivityRegenerate(activity.id!, dayIndex)}
                          availableDays={availableDays}
                          dayOptions={dayOptions}
                          isRegenerating={regeneratingActivityId === activity.id}
                        />
                      </ActivityRow>
                    ))}
                  </div>
                </SortableContext>
              </DayDropList>
            </>
          ) : (
            /* View Mode - Merged Timeline with Activities and Inline Proposals */
            <div className="grid gap-0">
              {timelineOf(day.day_number).map((item) => {
                if (item.type === "activity") {
                  const activity = item.data;
                  const idx = item.index;
                  return (
                    <ActivityRow key={`activity-${activity.id || idx}-v${renderEpoch}`} {...rowProps(activity, idx)}>
                      <EditableActivityCard
                        {...cardProps(activity, idx)}
                        isEditMode={false}
                        onDelete={() => {}}
                        onUpdate={() => {}}
                        onMoveToDay={() => {}}
                        onRegenerate={() => {}}
                        availableDays={[]}
                      />
                    </ActivityRow>
                  );
                }
                // Inline Proposal Card
                const proposal = item.data;
                return (
                  <div key={`proposal-${proposal.id}`} className="my-2">
                    <InlineProposalCard
                      proposal={proposal}
                      currentUserId={undefined}
                      canVote={canVote}
                      onTapToVote={() => onOpenProposal(proposal)}
                      totalVoters={voterCount}
                    />
                  </div>
                );
              })}
            </div>
          )}
          {/* Add Activity Button - shown whenever editing is active */}
          {editingActive && (
            // The indent lives on a wrapper: on the button itself,
            // ml-6 plus its w-full makes the page wider than a
            // phone screen (it scrolls sideways).
            <div className="mt-4 ml-6">
              <AddActivityButton
                dayIndex={dayIndex}
                destination={destination}
                onAdd={(partialActivity) => onAddActivity(dayIndex, partialActivity)}
                suggestedTime={calculateNextTimeSlot(day)}
              />
            </div>
          )}
          {/* Suggest Activity Button - View Mode Only, Collaborative Trips */}
          {!isEditMode && onSuggestActivity && (
            <button
              onClick={() => onSuggestActivity(day.day_number)}
              className="w-full mt-4 py-3 border-2 border-dashed border-gray-200
                                     rounded-xl text-gray-400 hover:border-blue-300
                                     hover:text-blue-500 transition-colors text-sm font-medium"
            >
              {t("detail.suggestActivity")}
            </button>
          )}
          {/* Day travel + feasibility summary */}
          <DaySummary
            dayNumber={day.day_number}
            segments={dayTravelData?.segments ?? []}
            activities={day.activities}
            pace={pace}
            className="mt-4"
          />
        </>
      ) : (
        /* Timeline View */
        <DayTimeline
          day={day}
          travel={dayTravelData}
          travelLoading={travelLoading}
          pace={pace}
          currency={currency || "USD"}
        />
      )}
    </div>
  );
}
