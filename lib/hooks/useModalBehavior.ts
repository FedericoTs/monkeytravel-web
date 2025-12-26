"use client";

import { useEffect, useCallback } from "react";

/**
 * Options for the useModalBehavior hook
 */
export interface UseModalBehaviorOptions {
  /** Whether the modal is currently open */
  isOpen: boolean;
  /** Callback to close the modal */
  onClose: () => void;
  /** Whether pressing Escape should close the modal (default: true) */
  closeOnEscape?: boolean;
  /** Whether to lock body scroll when modal is open (default: true) */
  lockScroll?: boolean;
}

/**
 * useModalBehavior Hook
 *
 * Consolidates common modal behavior patterns:
 * - Escape key handling
 * - Body scroll locking
 *
 * Used by: BottomSheet, BaseModal, ActivityDetailSheet, ImageCarousel,
 *          ShareModal, ReferralModal, StartOverModal, ProductTour
 *
 * @example
 * ```tsx
 * function MyModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
 *   useModalBehavior({ isOpen, onClose });
 *
 *   if (!isOpen) return null;
 *   return <div>Modal content</div>;
 * }
 * ```
 *
 * @example With custom options
 * ```tsx
 * // Only escape key, no scroll lock
 * useModalBehavior({ isOpen, onClose, lockScroll: false });
 *
 * // Only scroll lock, no escape handling
 * useModalBehavior({ isOpen, onClose, closeOnEscape: false });
 * ```
 */
export function useModalBehavior({
  isOpen,
  onClose,
  closeOnEscape = true,
  lockScroll = true,
}: UseModalBehaviorOptions): void {
  // Memoize the escape key handler
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

    // Add escape key listener
    if (closeOnEscape) {
      document.addEventListener("keydown", handleKeyDown);
    }

    // Lock body scroll
    if (lockScroll) {
      document.body.style.overflow = "hidden";
    }

    // Cleanup
    return () => {
      if (closeOnEscape) {
        document.removeEventListener("keydown", handleKeyDown);
      }
      if (lockScroll) {
        document.body.style.overflow = "";
      }
    };
  }, [isOpen, closeOnEscape, lockScroll, handleKeyDown]);
}

export default useModalBehavior;
