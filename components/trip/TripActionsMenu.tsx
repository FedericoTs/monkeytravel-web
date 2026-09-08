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
  /**
   * A round, icon-only 44px trigger (DESIGN.md touch minimum) for compact
   * hosts such as an activity card, where the text label has no room.
   */
  iconOnly?: boolean;
  /**
   * Close the panel when a `role="menuitem"` row is clicked. Off by default
   * because the trip bar hosts ExportMenu, whose own submenu lives inside
   * this panel; on for simple menus whose rows open a sheet or act at once.
   */
  closeOnItemClick?: boolean;
}

export default function TripActionsMenu({
  label,
  children,
  className = "",
  iconOnly = false,
  closeOnItemClick = false,
}: TripActionsMenuProps) {
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
        className={
          iconOnly
            ? `flex h-11 w-11 items-center justify-center rounded-full shadow-md transition-colors ${
                open ? "bg-slate-200 text-slate-800" : "bg-white text-slate-700 hover:bg-slate-50"
              }`
            : `flex items-center gap-2 p-2 sm:px-3 sm:py-2 rounded-lg text-sm font-medium transition-colors ${
                open ? "bg-slate-200 text-slate-800" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`
        }
      >
        <svg className="w-5 h-5 sm:w-4 sm:h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="5" cy="12" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="19" cy="12" r="2" />
        </svg>
        {!iconOnly && <span className="hidden sm:inline">{label}</span>}
      </button>

      {open ? (
        <div
          role="menu"
          aria-label={label}
          // By default no auto-close on inner click: in the trip bar one of the
          // rows is ExportMenu, whose own submenu renders inside this panel, so
          // collapsing on click would fight it. Outside-click and Escape close
          // the menu. Simple menus opt into closeOnItemClick.
          onClick={(e) => {
            if (closeOnItemClick && (e.target as HTMLElement).closest('[role="menuitem"]')) setOpen(false);
          }}
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
  tone = "default",
}: {
  onClick: () => void;
  icon?: ReactNode;
  children: ReactNode;
  /** `danger` for destructive rows (delete) — red text, red hover. */
  tone?: "default" | "danger";
}) {
  const toneClasses =
    tone === "danger" ? "text-red-600 hover:bg-red-50" : "text-slate-700 hover:bg-slate-50";
  const iconClasses = tone === "danger" ? "text-red-500" : "text-slate-500";
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`flex w-full min-h-11 items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium ${toneClasses}`}
    >
      {icon ? <span className={`flex h-5 w-5 shrink-0 items-center justify-center ${iconClasses}`}>{icon}</span> : null}
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
