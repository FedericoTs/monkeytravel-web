import type { ReactNode } from "react";

const BADGE = {
  default:
    "w-12 h-12 rounded-full bg-gradient-to-br from-[var(--primary)] to-[var(--primary)]/80 text-white flex items-center justify-center font-bold text-lg shadow-lg",
  editing:
    "w-12 h-12 rounded-full bg-gradient-to-br from-amber-500 to-amber-600 text-white flex items-center justify-center font-bold text-lg shadow-lg",
};

/**
 * A day's heading in an itinerary: its number in a badge, its title and theme.
 * `children` sit at the right end (the day's budget, a page's own buttons).
 */
export default function DayHeader({
  dayNumber,
  title,
  theme,
  editing = false,
  children,
}: {
  dayNumber: number;
  title: ReactNode;
  theme?: string;
  /** The badge turns amber while the trip is being edited. */
  editing?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-4 mb-4">
      <div className="flex items-center gap-3">
        <div className={editing ? BADGE.editing : BADGE.default}>{dayNumber}</div>
        <div>
          <h2 className="font-bold text-xl text-slate-900">{title}</h2>
          {theme && <p className="text-slate-500 text-sm">{theme}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}

/** The day's "Est. Budget", right-aligned in its header. */
export function DayBudget({
  label,
  value,
  className = "ml-auto text-right",
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="text-sm text-slate-500">{label}</div>
      <div className="font-semibold text-slate-900">{value}</div>
    </div>
  );
}
