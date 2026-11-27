"use client";

import type { MouseEvent } from "react";

/** Brings a part of the page to the top, at once for a reader who asked for less motion. */
function goTo(id: string) {
  const still = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.getElementById(id)?.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "start" });
}

const CHIP =
  "inline-flex min-h-[44px] items-center gap-1.5 whitespace-nowrap rounded-full border border-slate-200 bg-white px-4 text-sm font-semibold text-[var(--foreground)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--foreground)]";

/**
 * A plan's days in one row on a phone, each a way to that day, and the map after them: how long the plan is at a
 * glance, and the way around it. The row scrolls sideways when the days outrun the screen.
 */
export default function DayJump({
  days,
  dayId,
  dayLabel,
  label,
  map,
}: {
  /** The plan's day numbers, in order. */
  days: number[];
  /** The id of a day's part of the page. */
  dayId: (day: number) => string;
  dayLabel: (day: number) => string;
  /** What the row is, for a screen reader. */
  label: string;
  /** The way to the map, when the page has one. */
  map?: { id: string; label: string; onOpen: () => void };
}) {
  const jump = (id: string, before?: () => void) => (event: MouseEvent) => {
    event.preventDefault();
    before?.();
    // After the map has been asked to show, so the page is as long as it will be.
    requestAnimationFrame(() => goTo(id));
  };
  return (
    <nav aria-label={label} className="-mx-4 mb-5 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <ul className="flex w-max gap-2 py-1">
        {days.map((day) => (
          <li key={day}>
            <a href={`#${dayId(day)}`} onClick={jump(dayId(day))} className={CHIP}>
              {dayLabel(day)}
            </a>
          </li>
        ))}
        {map && (
          <li>
            <a href={`#${map.id}`} onClick={jump(map.id, map.onOpen)} className={CHIP}>
              <svg className="h-4 w-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"
                />
              </svg>
              {map.label}
            </a>
          </li>
        )}
      </ul>
    </nav>
  );
}
