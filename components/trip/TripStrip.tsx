"use client";

import { useId, useState, type ReactNode } from "react";

interface Chip {
  id: string;
  /** The chip's words. */
  label: string;
}

/** A chip that opens its card under the row. */
interface CardChip extends Chip {
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

/** A chip that does one thing on a tap, such as opening the window that sends the plan. It has no card. */
interface ActionChip extends Chip {
  onPress: () => void;
}

export type TripStripItem = CardChip | ActionChip;

const isAction = (item: TripStripItem): item is ActionChip => "onPress" in item;

function SendIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M8.684 13.342a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"
      />
    </svg>
  );
}

/**
 * What sits beside the plan on the saved trip page (who is going, confirming,
 * getting ready, booking ahead), as one row of chips under the header. A chip
 * opens its card below the row; one card is open at a time and none at first,
 * so the plan starts right after the row, unless a link names one (`initialOpen`,
 * the owner's email about must-dos opens "who"). A chip that acts (sending the
 * plan) is filled, to be told from the ones that open.
 */
export default function TripStrip({
  label,
  items,
  className = "",
  initialOpen = null,
}: {
  label: string;
  items: TripStripItem[];
  className?: string;
  initialOpen?: string | null;
}) {
  const [open, setOpen] = useState<string | null>(initialOpen);
  const base = useId();
  if (items.length === 0) return null;

  return (
    <section aria-label={label} data-testid="trip-strip" className={className}>
      {/* One line that scrolls sideways on a phone, as the day picker does. */}
      <div className="scrollbar-hide -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
        {items.map((item) => {
          if (isAction(item)) {
            return (
              <button
                key={item.id}
                type="button"
                data-testid={`trip-strip-${item.id}`}
                onClick={item.onPress}
                className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border border-[var(--secondary-ink)] bg-[var(--secondary-ink)] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[var(--secondary-ink)]/90"
              >
                <SendIcon />
                <span>{item.label}</span>
              </button>
            );
          }
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
        if (isAction(item)) return null;
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
