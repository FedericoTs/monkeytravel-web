"use client";

import { useEffect, useEffectEvent, useRef } from "react";

export interface UseModalBehaviorOptions {
  /** Whether the modal is currently open */
  isOpen: boolean;
  /** Callback to close the modal */
  onClose: () => void;
  /** Whether pressing Escape should close the modal (default: true) */
  closeOnEscape?: boolean;
  /** Whether to lock body scroll when modal is open (default: true) */
  lockScroll?: boolean;
  /**
   * Where focus goes on open: the panel itself, so a screen reader announces
   * the dialog first (default), or its first control.
   */
  initialFocus?: "panel" | "first";
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Open dialogs, innermost last: only the innermost one answers the keyboard.
const openDialogs: symbol[] = [];
// Dialogs holding the page's scroll lock: it lifts when the last one closes.
let scrollLocks = 0;
let overflowBeforeLock = "";

/**
 * What every dialog does while open: Escape closes it, Tab stays inside it,
 * the page behind it doesn't scroll, and focus moves in on open and back to
 * where it was on close. The focus parts need `panelRef` on the dialog's
 * panel (with tabIndex={-1}); without it, Escape and the scroll lock still
 * apply.
 *
 * @example
 * ```tsx
 * const { panelRef } = useModalBehavior({ isOpen, onClose });
 * if (!isOpen) return null;
 * return <div ref={panelRef} role="dialog" aria-modal="true" tabIndex={-1}>…</div>;
 * ```
 */
export function useModalBehavior({
  isOpen,
  onClose,
  closeOnEscape = true,
  lockScroll = true,
  initialFocus = "panel",
}: UseModalBehaviorOptions) {
  const panelRef = useRef<HTMLDivElement>(null);
  const close = useEffectEvent(() => onClose());

  useEffect(() => {
    if (!isOpen) return;
    const dialog = Symbol("dialog");
    openDialogs.push(dialog);

    const onKeyDown = (e: KeyboardEvent) => {
      if (openDialogs[openDialogs.length - 1] !== dialog) return;
      if (e.key === "Escape" && closeOnEscape) close();
      else if (e.key === "Tab" && panelRef.current) keepTabInside(e, panelRef.current);
    };
    document.addEventListener("keydown", onKeyDown);

    if (lockScroll && scrollLocks++ === 0) {
      overflowBeforeLock = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }

    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Next frame: a portal or an animation may still be mounting the panel.
    const frame = requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const first = initialFocus === "first" ? panel.querySelector<HTMLElement>(FOCUSABLE) : null;
      (first ?? panel).focus();
    });

    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      openDialogs.splice(openDialogs.indexOf(dialog), 1);
      if (lockScroll && --scrollLocks === 0) document.body.style.overflow = overflowBeforeLock;
      // Back to the control that opened it, if that is still on the page.
      if (previous && document.contains(previous)) previous.focus();
    };
  }, [isOpen, closeOnEscape, lockScroll, initialFocus]);

  return { panelRef };
}

function keepTabInside(e: KeyboardEvent, panel: HTMLElement) {
  const controls = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
  if (controls.length === 0) {
    e.preventDefault();
    return;
  }
  // -1: focus is on the panel itself, or somehow outside it.
  const at = controls.indexOf(document.activeElement as HTMLElement);
  if (e.shiftKey && at <= 0) {
    e.preventDefault();
    controls[controls.length - 1].focus();
  } else if (!e.shiftKey && (at === -1 || at === controls.length - 1)) {
    e.preventDefault();
    controls[0].focus();
  }
}

export default useModalBehavior;
