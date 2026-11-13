"use client";

import { useId, useState, type ReactNode } from "react";

export interface TripStripItem {
  id: string;
  /** The chip's words. */
  label: string;
  /** A count or state read after the label ("2 going", "1 of 3 booked"). */
  detail?: string | null;
  /** The card the chip opens. */
  content: ReactNode;
  /**
   * Keeps the card mounted while closed, for one that holds its own state or
   * reports a count to its chip. Others mount when opened.
   */
  keepMounted?: boolean;
}

/**
 * What sits beside the plan on the saved trip page (who is going, confirming,
 * getting ready, booking ahead), as one row of chips under the header. A chip
 * opens its card below the row; one card is open at a time and none at first,
 * so the plan starts right after the row.
 */
export default function TripStrip({ label, items, className = "" }: { label: string; items: TripStripItem[]; className?: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const base = useId();
  if (items.length === 0) return null;

  return (
    <section aria-label={label} data-testid="trip-strip" className={className}>
      {/* One line that scrolls sideways on a phone, as the day picker does. */}
      <div className="scrollbar-hide -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
        {items.map((item) => {
          const isOpen = open === item.id;
          return (
            <button
              key={item.id}
              type="button"
              data-testid={`trip-strip-${item.id}`}
              aria-expanded={isOpen}
              aria-controls={`${base}-${item.id}`}
              onClick={() => setOpen(isOpen ? null : item.id)}
              className={`inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
                isOpen
                  ? "border-[var(--foreground)] bg-[var(--foreground)] text-white"
                  : "border-slate-200 bg-white text-[var(--foreground)] hover:border-slate-300"
              }`}
            >
              <span>{item.label}</span>
              {item.detail && <span className={`font-normal ${isOpen ? "text-white/80" : "text-[var(--foreground-muted)]"}`}>{item.detail}</span>}
              <svg
                className={`h-4 w-4 transition-transform ${isOpen ? "rotate-180" : ""}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          );
        })}
      </div>
      {items.map((item) => {
        const isOpen = open === item.id;
        if (!isOpen && !item.keepMounted) return null;
        return (
          <div key={item.id} id={`${base}-${item.id}`} hidden={!isOpen} className="mt-3">
            {item.content}
          </div>
        );
      })}
    </section>
  );
}
