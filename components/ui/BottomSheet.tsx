"use client";

import { useId } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence, useDragControls } from "framer-motion";
import { useModalBehavior } from "@/lib/hooks/useModalBehavior";

interface BottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  title?: string;
  showCloseButton?: boolean;
  /**
   * On `sm+` render as a centered floating panel (max-w-md, lifted off the
   * bottom edge, fully rounded) instead of a full-width sheet — for short
   * pickers that would look stretched across a desktop viewport. Mobile is
   * unchanged. Centering uses margins, not transforms, so it doesn't fight
   * framer-motion's `y` animation.
   */
  desktopCentered?: boolean;
}

export default function BottomSheet({
  isOpen,
  onClose,
  children,
  title,
  showCloseButton = true,
  desktopCentered = false,
}: BottomSheetProps) {
  const dragControls = useDragControls();

  // Escape, scroll lock, focus in and back out, Tab kept inside. Focus goes
  // to the sheet's first control, or the sheet itself when it has none.
  const { panelRef } = useModalBehavior({ isOpen, onClose, initialFocus: "first" });

  // Stable id pair so we can wire aria-labelledby to the rendered <h2>
  // when the consumer passes a `title`. SSR-safe via React.useId().
  const titleId = useId();
  const sheetTitleId = `${titleId}-bottomsheet-title`;

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
            className={`
              fixed bottom-0 left-0 right-0 z-[101]
              bg-white rounded-t-3xl
              max-h-[90vh] overflow-hidden
              shadow-2xl
              flex flex-col
              focus:outline-none
              ${desktopCentered ? "sm:bottom-8 sm:mx-auto sm:w-full sm:max-w-md sm:rounded-3xl" : ""}
            `}
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
