"use client";

/**
 * The dnd-kit side of cross-day drag-and-drop on /trips/[id]:
 *
 *   - `makeItineraryCollisionDetection` — which droppable a drag is "over":
 *     a day header wins outright, then the card under the pointer, then a
 *     day's empty space (= the end of that day), then the nearest rectangle
 *     when the pointer sits in a gap between days.
 *   - `DayDropHeader` — wraps a day's header so it is a drop target while a
 *     drag is in progress, with a dashed outline and a "drop here" cue.
 *   - `DayDropList` — wraps a day's card list so empty days accept drops and
 *     every day has a landing strip at its end.
 *   - `ActivityDragGhost` — the compact card that follows the pointer.
 *
 * The pure move logic lives in lib/trip/itinerary-dnd.ts.
 */
import type { ReactNode } from "react";
import {
  closestCenter,
  getFirstCollision,
  pointerWithin,
  rectIntersection,
  useDroppable,
  type CollisionDetection,
} from "@dnd-kit/core";
import { useTranslations } from "next-intl";
import type { Activity, ItineraryDay } from "@/types";
import { DAY_DROP_PREFIX, DAY_HEADER_PREFIX, dayDropId, dayHeaderId } from "@/lib/trip/itinerary-dnd";

const isHeader = (id: string | number) => String(id).startsWith(DAY_HEADER_PREFIX);
const isDayList = (id: string | number) => String(id).startsWith(DAY_DROP_PREFIX);
const isCard = (id: string | number) => !isHeader(id) && !isDayList(id);

export function makeItineraryCollisionDetection(): CollisionDetection {
  return (args) => {
    const underPointer = pointerWithin(args);

    const header = underPointer.find((c) => isHeader(c.id));
    if (header) return [header];

    const card = underPointer.find((c) => isCard(c.id));
    if (card) return [card];

    // Inside a day but not over any card: the day's empty space → its end.
    const dayList = underPointer.find((c) => isDayList(c.id));
    if (dayList) return [dayList];

    // In a gap or margin: the nearest overlapping rectangle, preferring cards
    // so a drop between two days still lands somewhere sensible.
    const overlapping = rectIntersection(args);
    const overlappingCard = overlapping.find((c) => isCard(c.id));
    if (overlappingCard) return [overlappingCard];
    const first = getFirstCollision(overlapping, "id");
    if (first != null) return [{ id: first }];

    // Nothing overlaps (fast fling): fall back to the closest card centre.
    return closestCenter({
      ...args,
      droppableContainers: args.droppableContainers.filter((c) => isCard(c.id)),
    });
  };
}

interface DayDropHeaderProps {
  dayNumber: number;
  /** True while any activity is being dragged. */
  dragging: boolean;
  children: ReactNode;
}

export function DayDropHeader({ dayNumber, dragging, children }: DayDropHeaderProps) {
  const t = useTranslations("trips");
  // Always registered: dnd-kit measures droppable rects when a drag STARTS,
  // so a droppable that is disabled until then has no rect and can never be
  // "over". Collisions only run during a drag, so there is nothing to gate;
  // `dragging` drives the visual cues only.
  const { setNodeRef, isOver } = useDroppable({ id: dayHeaderId(dayNumber) });

  return (
    <div
      ref={setNodeRef}
      data-testid={`day-drop-header-${dayNumber}`}
      data-drop-over={isOver ? "true" : undefined}
      className={`relative rounded-2xl transition-all duration-150 ${
        dragging
          ? `outline-2 outline-dashed outline-offset-8 ${
              isOver ? "outline-[var(--primary)] bg-[var(--primary)]/5" : "outline-slate-300"
            }`
          : ""
      }`}
    >
      {children}
      {dragging && (
        <div
          aria-hidden="true"
          className={`pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 rounded-full px-3 py-1 text-xs font-semibold shadow-sm transition-opacity ${
            isOver ? "bg-[var(--primary)] text-white opacity-100" : "bg-white text-slate-500 opacity-80"
          }`}
        >
          {t("editActivity.dropHere", { day: dayNumber })}
        </div>
      )}
    </div>
  );
}

interface DayDropListProps {
  dayNumber: number;
  dragging: boolean;
  isEmpty: boolean;
  children: ReactNode;
}

export function DayDropList({ dayNumber, dragging, isEmpty, children }: DayDropListProps) {
  const t = useTranslations("trips");
  const { setNodeRef, isOver } = useDroppable({ id: dayDropId(dayNumber) }); // see DayDropHeader

  return (
    <div
      ref={setNodeRef}
      data-testid={`day-drop-list-${dayNumber}`}
      data-drop-over={isOver ? "true" : undefined}
      className="relative"
    >
      {children}
      {dragging && (
        <div
          aria-hidden="true"
          className={`mt-2 flex items-center justify-center rounded-xl border-2 border-dashed text-sm font-medium transition-colors ${
            isEmpty ? "min-h-24" : "min-h-12"
          } ${
            isOver
              ? "border-[var(--primary)] bg-[var(--primary)]/5 text-[var(--primary-ink)]"
              : "border-slate-200 text-slate-400"
          }`}
        >
          {isEmpty ? t("editActivity.dropIntoEmptyDay") : t("editActivity.dropAtEnd")}
        </div>
      )}
    </div>
  );
}

/** What follows the pointer while dragging: name and time, nothing heavy. */
export function ActivityDragGhost({ activity }: { activity: Activity | null }) {
  if (!activity) return null;
  return (
    <div className="w-[min(88vw,26rem)] rotate-[1.5deg] rounded-xl bg-white px-4 py-3 shadow-2xl ring-2 ring-[var(--primary)] cursor-grabbing">
      {activity.start_time && <div className="text-xs font-medium text-slate-500">{activity.start_time}</div>}
      <div className="truncate font-semibold text-slate-900">{activity.name}</div>
    </div>
  );
}

/** Days as the sheet needs them: number, date, city, how many activities. */
export function dayOptionsOf(itinerary: ItineraryDay[]) {
  return itinerary.map((d) => ({
    dayNumber: d.day_number,
    date: d.date,
    city: d.city,
    count: d.activities.length,
  }));
}
