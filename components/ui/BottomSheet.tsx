"use client";

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
            className="
              fixed inset-0 z-[100]
              bg-black/50 backdrop-blur-sm
            "
          />

          {/* Sheet */}
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
            drag="y"
            dragControls={dragControls}
            dragConstraints={{ top: 0 }}
            dragElastic={{ top: 0, bottom: 0.5 }}
            onDragEnd={handleDragEnd}
            className="
              fixed bottom-0 left-0 right-0 z-[101]
              bg-white rounded-t-3xl
              max-h-[90vh] overflow-hidden
              shadow-2xl
              flex flex-col
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
                <h2 className="text-lg font-semibold text-slate-900">
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
