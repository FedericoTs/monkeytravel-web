"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import dynamic from "next/dynamic";

// Dynamically import ProductTour to avoid SSR issues
const ProductTour = dynamic(() => import("./ProductTour"), {
  ssr: false,
  loading: () => null,
});

const TOUR_COMPLETED_KEY = "monkeytravel_tour_completed";

interface TourTriggerProps {
  variant?: "button" | "link" | "text";
  className?: string;
  children?: React.ReactNode;
}

export default function TourTrigger({
  variant = "button",
  className = "",
  children,
}: TourTriggerProps) {
  const [isTourOpen, setIsTourOpen] = useState(false);
  const [hasSeenTour, setHasSeenTour] = useState(true); // Default true to avoid flash

  useEffect(() => {
    if (typeof window !== "undefined") {
      const completed = localStorage.getItem(TOUR_COMPLETED_KEY) === "true";
      setHasSeenTour(completed);
    }
  }, []);

  const handleOpenTour = () => {
    setIsTourOpen(true);
  };

  const handleCloseTour = () => {
    setIsTourOpen(false);
    setHasSeenTour(true);
  };

  // Default content based on variant
  const defaultContent = (
    <>
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <span>See How It Works</span>
    </>
  );

  const baseStyles = {
    button: `
      inline-flex items-center justify-center gap-2
      px-6 py-3 rounded-xl
      bg-white/90 backdrop-blur-sm
      text-[var(--foreground)] font-semibold
      border border-gray-200
      hover:border-[var(--primary)] hover:text-[var(--primary)]
      transition-all shadow-sm
      cursor-pointer
    `,
    link: `
      inline-flex items-center gap-2
      text-[var(--foreground-muted)]
      hover:text-[var(--primary)]
      transition-colors cursor-pointer
    `,
    text: `
      inline-flex items-center gap-1.5
      text-sm text-[var(--foreground-muted)]
      hover:text-[var(--primary)]
      underline underline-offset-2
      transition-colors cursor-pointer
    `,
  };

  return (
    <>
      <motion.button
        onClick={handleOpenTour}
        className={`${baseStyles[variant]} ${className}`}
        whileHover={{ scale: variant === "button" ? 1.02 : 1 }}
        whileTap={{ scale: 0.98 }}
      >
        {children || defaultContent}

        {/* "New" badge for users who haven't seen the tour */}
        {!hasSeenTour && variant === "button" && (
          <motion.span
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="absolute -top-2 -right-2 px-2 py-0.5 bg-[var(--primary)] text-white text-xs font-bold rounded-full"
          >
            New
          </motion.span>
        )}
      </motion.button>

      <ProductTour isOpen={isTourOpen} onClose={handleCloseTour} />
    </>
  );
}

// Simple hook to check if tour should auto-show
export function useTourAutoShow(): [boolean, () => void] {
  const [shouldShow, setShouldShow] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const completed = localStorage.getItem(TOUR_COMPLETED_KEY) === "true";
      // Auto-show on first visit after a short delay
      if (!completed) {
        const timer = setTimeout(() => {
          setShouldShow(true);
        }, 3000); // Show after 3 seconds
        return () => clearTimeout(timer);
      }
    }
  }, []);

  const dismiss = () => setShouldShow(false);

  return [shouldShow, dismiss];
}
