"use client";

import { useEffect, useCallback, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

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
}: BaseModalProps) {
  const [mounted, setMounted] = useState(false);

  // Client-side only mounting for portal
  useEffect(() => {
    setMounted(true);
  }, []);

  // Handle escape key
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape" && closeOnEscape) {
        onClose();
      }
    },
    [closeOnEscape, onClose]
  );

  // Handle escape key and scroll lock
  useEffect(() => {
    if (!isOpen) return;

    if (closeOnEscape) {
      document.addEventListener("keydown", handleKeyDown);
    }

    if (lockScroll) {
      document.body.style.overflow = "hidden";
    }

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (lockScroll) {
        document.body.style.overflow = "";
      }
    };
  }, [isOpen, closeOnEscape, lockScroll, handleKeyDown]);

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
      aria-labelledby={title ? "modal-title" : undefined}
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm transition-opacity"
        onClick={handleBackdropClick}
        aria-hidden="true"
      />

      {/* Modal positioning container */}
      <div className="relative min-h-screen flex items-center justify-center p-4">
        {/* Modal panel */}
        <div
          className={`
            relative bg-white rounded-2xl shadow-xl w-full ${maxWidth}
            overflow-hidden ${animationClasses[animation]} ${className}
          `}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Close button */}
          {showCloseButton && (
            <button
              onClick={onClose}
              className="absolute top-4 right-4 p-2 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors z-10"
              aria-label="Close modal"
            >
              <X className="w-5 h-5" />
            </button>
          )}

          {/* Header */}
          {(header || title) && (
            <div className="p-6 pb-0">
              {header || (
                <div>
                  {title && (
                    <h2
                      id="modal-title"
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
          <div className="p-6">{children}</div>
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
