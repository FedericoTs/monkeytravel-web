"use client";

import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence, useDragControls } from "framer-motion";
import { useModalBehavior } from "@/lib/hooks/useModalBehavior";

interface BottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  title?: string;
  showCloseButton?: boolean;
}

export default function BottomSheet({
  isOpen,
  onClose,
  children,
  title,
  showCloseButton = true,
}: BottomSheetProps) {
  const dragControls = useDragControls();

  // Unified modal behavior: escape key + scroll lock
  useModalBehavior({ isOpen, onClose });

  // Stable id pair so we can wire aria-labelledby to the rendered <h2>
  // when the consumer passes a `title`. SSR-safe via React.useId().
  const titleId = useId();
  const sheetTitleId = `${titleId}-bottomsheet-title`;

  // Refs for focus management. We capture the element that had focus when
  // the sheet opened (typically the trigger button) and restore it on
  // close — matches the BaseModal/WAI-ARIA dialog pattern so keyboard
  // users don't get dumped at the top of <body> when the sheet closes.
  const panelRef = useRef<HTMLDivElement>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);

  // Move focus into the sheet on open, restore to the trigger on close.
  useEffect(() => {
    if (!isOpen) return;

    previousActiveElementRef.current =
      typeof document !== "undefined"
        ? (document.activeElement as HTMLElement | null)
        : null;

    // Defer to next frame so framer-motion has mounted the panel.
    const focusFrame = requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel) return;
      // Prefer the first focusable child; fall back to the panel itself
      // (which has tabIndex={-1}) so screen readers land inside the dialog.
      const focusable = panel.querySelector<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      (focusable ?? panel).focus();
    });

    return () => {
      cancelAnimationFrame(focusFrame);
      const previous = previousActiveElementRef.current;
      // Only restore focus if the previously focused element is still
      // mounted and focusable — guards against the trigger having been
      // unmounted (e.g. TripCard remounted by router.refresh after action).
      if (previous && typeof previous.focus === "function" && document.body.contains(previous)) {
        previous.focus();
      }
    };
  }, [isOpen]);

  // Focus trap — keep Tab cycling within the sheet so keyboard users
  // can't tab into the page beneath. Mirrors BaseModal's implementation.
  useEffect(() => {
    if (!isOpen) return;

    const handleTab = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !panelRef.current) return;

      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleTab);
    return () => document.removeEventListener("keydown", handleTab);
  }, [isOpen]);

  const handleDragEnd = (_: unknown, info: { offset: { y: number }; velocity: { y: number } }) => {
    if (info.offset.y > 100 || info.velocity.y > 500) {
      onClose();
    }
  };

  const content = (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            aria-hidden="true"
            className="
              fixed inset-0 z-[100]
              bg-black/50 backdrop-blur-sm
            "
          />

          {/* Sheet */}
          <motion.div
            ref={panelRef}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
            drag="y"
            dragControls={dragControls}
            dragConstraints={{ top: 0 }}
            dragElastic={{ top: 0, bottom: 0.5 }}
            onDragEnd={handleDragEnd}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? sheetTitleId : undefined}
            tabIndex={-1}
            className="
              fixed bottom-0 left-0 right-0 z-[101]
              bg-white rounded-t-3xl
              max-h-[90vh] overflow-hidden
              shadow-2xl
              flex flex-col
              focus:outline-none
            "
            style={{ touchAction: "none" }}
          >
            {/* Drag Handle */}
            <div
              onPointerDown={(e) => dragControls.start(e)}
              className="flex justify-center pt-3 pb-2 cursor-grab active:cursor-grabbing flex-shrink-0"
            >
              <div className="w-10 h-1 rounded-full bg-slate-300" />
            </div>

            {/* Title */}
            {title && (
              <div className="px-4 pb-3 border-b border-slate-100 flex items-center justify-between flex-shrink-0">
                <h2 id={sheetTitleId} className="text-lg font-semibold text-slate-900">
                  {title}
                </h2>
                {showCloseButton && (
                  <button
                    onClick={onClose}
                    className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition-colors"
                    aria-label="Close"
                  >
                    <svg className="w-4 h-4 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
            )}

            {/* Content */}
            <div className="overflow-y-auto flex-1 overscroll-contain pb-safe">
              {children}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );

  // Use portal to render at document body level
  if (typeof window !== "undefined") {
    return createPortal(content, document.body);
  }

  return null;
}
