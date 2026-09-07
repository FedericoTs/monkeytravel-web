"use client";

/**
 * The "More" overflow for the trip-detail owner action bar — Live Trip plan,
 * Phase 5.4 (trip detail diet).
 *
 * The bar had grown to seven controls (view toggle, map, share, export,
 * calendar, add-from-email, edit). This collapses the secondary utilities into
 * one ⋯ menu so the bar reads Share · Edit with AI · More. Deliberately generic
 * (renders whatever rows the caller passes) so the existing Export / Calendar
 * components can live inside it unchanged.
 *
 * No dropdown primitive exists in the app, so this is self-contained: a button
 * that toggles a right-aligned panel, closed on outside-click and Escape, with
 * the usual aria-haspopup/expanded wiring.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";

interface TripActionsMenuProps {
  /** Accessible label for the ⋯ trigger (localized "More"). */
  label: string;
  /** Menu rows — buttons, or self-contained controls like ExportMenu. */
  children: ReactNode;
  className?: string;
}

export default function TripActionsMenu({ label, children, className = "" }: TripActionsMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        className={`flex items-center gap-2 p-2 sm:px-3 sm:py-2 rounded-lg text-sm font-medium transition-colors ${
          open ? "bg-slate-200 text-slate-800" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
        }`}
      >
        <svg className="w-5 h-5 sm:w-4 sm:h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="5" cy="12" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="19" cy="12" r="2" />
        </svg>
        <span className="hidden sm:inline">{label}</span>
      </button>

      {open ? (
        <div
          role="menu"
          aria-label={label}
          // No auto-close on inner click: one of the rows is ExportMenu, whose
          // own submenu renders inside this panel, so collapsing on click would
          // fight it. Outside-click and Escape close the menu; simple rows that
          // open a modal are covered by it and dismissed with the next click.
          className="absolute right-0 z-30 mt-2 min-w-[220px] rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl shadow-slate-900/10"
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

/**
 * A plain menu row for the simple actions this menu owns (map, add-from-email,
 * edit manually). Export / Calendar bring their own control and are placed in a
 * `TripActionsMenuSlot` instead.
 */
export function TripActionsMenuItem({
  onClick,
  icon,
  children,
}: {
  onClick: () => void;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-slate-700 hover:bg-slate-50"
    >
      {icon ? <span className="flex h-5 w-5 shrink-0 items-center justify-center text-slate-500">{icon}</span> : null}
      <span className="min-w-0 flex-1">{children}</span>
    </button>
  );
}

/**
 * A full-width slot for a self-contained control (ExportMenu, DownloadIcsButton)
 * so it sits as a menu row without restyling the component itself.
 */
export function TripActionsMenuSlot({ children }: { children: ReactNode }) {
  return <div className="flex w-full items-center px-1 py-0.5 [&_button]:w-full [&_button]:justify-start">{children}</div>;
}
