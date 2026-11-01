"use client";

import { useCallback, useId, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import { useModalBehavior } from "@/hooks/useModalBehavior";
import { useIsClient } from "@/hooks/useIsClient";

export interface BaseModalProps {
  /** Whether the modal is visible */
  isOpen: boolean;
  /** Callback when modal should close */
  onClose: () => void;
  /** Modal content */
  children: ReactNode;
  /** Optional title for header */
  title?: string;
  /** Optional subtitle */
  subtitle?: string;
  /** Whether to use portal rendering (renders at document.body level) */
  usePortal?: boolean;
  /** Whether pressing Escape closes the modal */
  closeOnEscape?: boolean;
  /** Whether clicking backdrop closes the modal */
  closeOnBackdrop?: boolean;
  /** Whether to lock body scroll when open */
  lockScroll?: boolean;
  /** Whether to show close button */
  showCloseButton?: boolean;
  /** z-index for the modal (default: 50) */
  zIndex?: number | string;
  /** Maximum width class (default: max-w-md) */
  maxWidth?: string;
  /** Optional custom header component (replaces default title) */
  header?: ReactNode;
  /** Whether backdrop click is disabled (e.g., during loading) */
  disableBackdropClick?: boolean;
  /** Additional className for the modal container */
  className?: string;
  /** Animation style: 'scale' | 'slide' | 'fade' | 'none' */
  animation?: "scale" | "slide" | "fade" | "none";
  /** When true, drops BaseModal's default p-6 padding wrappers so children
   *  can render edge-to-edge (e.g. full-bleed gradient headers). */
  noPadding?: boolean;
  /** Optional aria-label for the dialog itself (used when no title is
   *  rendered but the modal still needs an accessible name). */
  ariaLabel?: string;
}

/**
 * BaseModal - A flexible modal component that consolidates common modal patterns
 *
 * Features:
 * - Optional portal rendering for z-index escape hatch
 * - Configurable escape key and backdrop click handling
 * - Body scroll lock
 * - Multiple animation styles
 * - Accessible with aria attributes
 *
 * Usage:
 * ```tsx
 * <BaseModal
 *   isOpen={isOpen}
 *   onClose={() => setIsOpen(false)}
 *   title="My Modal"
 *   usePortal
 *   closeOnEscape
 * >
 *   <p>Modal content here</p>
 * </BaseModal>
 * ```
 */
export default function BaseModal({
  isOpen,
  onClose,
  children,
  title,
  subtitle,
  usePortal = false,
  closeOnEscape = true,
  closeOnBackdrop = true,
  lockScroll = true,
  showCloseButton = true,
  zIndex = 50,
  maxWidth = "max-w-md",
  header,
  disableBackdropClick = false,
  className = "",
  animation = "scale",
  noPadding = false,
  ariaLabel,
}: BaseModalProps) {
  const t = useTranslations("common.buttons");
  // A portal needs document.body, so it renders in the browser only.
  const mounted = useIsClient();
  const titleId = useId();
  // Escape, scroll lock, focus in and back out, Tab kept inside. Focus goes
  // to the panel itself, so screen readers announce the dialog's name first.
  const { panelRef } = useModalBehavior({ isOpen, onClose, closeOnEscape, lockScroll });

  // Handle backdrop click
  const handleBackdropClick = useCallback(() => {
    if (closeOnBackdrop && !disableBackdropClick) {
      onClose();
    }
  }, [closeOnBackdrop, disableBackdropClick, onClose]);

  // Don't render if not open or not mounted (for portal)
  if (!isOpen) return null;
  if (usePortal && !mounted) return null;

  // Animation classes based on animation prop
  const animationClasses = {
    scale: "animate-in fade-in zoom-in-95 duration-200",
    slide: "animate-in fade-in slide-in-from-bottom-4 duration-200",
    fade: "animate-in fade-in duration-200",
    none: "",
  };

  // z-index style
  const zIndexValue = typeof zIndex === "number" ? zIndex : undefined;
  const zIndexClass = typeof zIndex === "string" ? zIndex : `z-${zIndex}`;

  const modalContent = (
    <div
      className={`fixed inset-0 overflow-y-auto ${zIndexClass}`}
      style={zIndexValue ? { zIndex: zIndexValue } : undefined}
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? titleId : undefined}
      aria-label={!title && ariaLabel ? ariaLabel : undefined}
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm transition-opacity"
        onClick={handleBackdropClick}
        aria-hidden="true"
      />

      {/* Modal positioning container. It sits ON TOP of the backdrop in
          DOM order, so it takes the backdrop's onClick for clicks in the
          dark area; the panel's stopPropagation guard below keeps inner
          clicks from reaching it.

          `min-h-dvh` (the dynamic viewport, without the browser's bars)
          plus safe-area padding keeps the panel's bottom, and its main
          button, on screen; `min-h-screen` (100vh) would include iOS
          Safari's URL bar and home indicator. It stays as the fallback
          where dvh isn't supported. */}
      <div
        className="relative min-h-screen min-h-dvh flex items-center justify-center p-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))]"
        onClick={handleBackdropClick}
      >
        {/* Modal panel */}
        <div
          ref={panelRef}
          tabIndex={-1}
          className={`
            relative bg-white rounded-2xl shadow-xl w-full ${maxWidth}
            overflow-hidden outline-none ${animationClasses[animation]} ${className}
          `}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Close button */}
          {showCloseButton && (
            <button
              onClick={onClose}
              className="absolute top-4 right-4 p-2 rounded-full hover:bg-slate-100 text-slate-500 hover:text-slate-600 transition-colors z-10"
              aria-label={t("closeModal")}
            >
              <X className="w-5 h-5" />
            </button>
          )}

          {/* Header */}
          {(header || title) && (
            <div className={noPadding ? "" : "p-6 pb-0"}>
              {header || (
                <div>
                  {title && (
                    <h2
                      id={titleId}
                      className="text-xl font-bold text-slate-900 pr-8"
                    >
                      {title}
                    </h2>
                  )}
                  {subtitle && (
                    <p className="text-sm text-slate-600 mt-1">{subtitle}</p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Content */}
          <div className={noPadding ? "" : "p-6"}>{children}</div>
        </div>
      </div>
    </div>
  );

  // Render with or without portal
  if (usePortal && typeof window !== "undefined") {
    return createPortal(modalContent, document.body);
  }

  return modalContent;
}

/**
 * Hook for modal state management
 */
export function useModal(initialState = false) {
  const [isOpen, setIsOpen] = useState(initialState);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen((prev) => !prev), []);

  return { isOpen, open, close, toggle, setIsOpen };
}
