"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import dynamic from "next/dynamic";
import Image from "next/image";

// Dynamically import ProductTour to avoid SSR issues
const ProductTour = dynamic(() => import("./ProductTour"), {
  ssr: false,
  loading: () => null,
});

const TOUR_COMPLETED_KEY = "monkeytravel_tour_completed";

// All tour screenshots - preload on component mount for instant display
const TOUR_SCREENSHOTS = [
  "/screenshots/trip-barcelona-hero.png",
  "/screenshots/trip-barcelona-itinerary.png",
  "/screenshots/templates.png",
  "/screenshots/trip-lisbon-hero.png",
  "/screenshots/trip-porto-hero.png",
];

interface TourTriggerProps {
  variant?: "button" | "link" | "text" | "primary-cta" | "custom";
  className?: string;
  children?: React.ReactNode;
  /** If true, skip tour if already completed and go directly to auth */
  skipToAuthIfCompleted?: boolean;
}

export default function TourTrigger({
  variant = "button",
  className = "",
  children,
  skipToAuthIfCompleted = false,
}: TourTriggerProps) {
  const router = useRouter();
  const [isTourOpen, setIsTourOpen] = useState(false);
  const [hasSeenTour, setHasSeenTour] = useState<boolean | null>(null); // null = not yet checked
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const completed = localStorage.getItem(TOUR_COMPLETED_KEY) === "true";
      setHasSeenTour(completed);
      setIsReady(true);
    }
  }, []);

  const handleOpenTour = () => {
    // Wait for localStorage check to complete
    if (!isReady) {
      // If not ready yet, show tour (safe default)
      setIsTourOpen(true);
      return;
    }

    // If skipToAuthIfCompleted is true and tour was already seen, go straight to auth
    if (skipToAuthIfCompleted && hasSeenTour === true) {
      router.push("/auth/signup");
      return;
    }
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
    "primary-cta": `
      group relative px-8 py-4
      bg-[var(--accent)] text-[var(--primary-dark)]
      font-bold rounded-xl
      hover:bg-[var(--accent-light)]
      transition-all
      shadow-lg shadow-[var(--accent)]/30
      flex items-center justify-center gap-2
      cursor-pointer
    `,
    // Custom variant: no default styles, use className for everything
    custom: "",
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

        {/* "New" badge for users who haven't seen the tour - only for default button variant */}
        {isReady && hasSeenTour === false && variant === "button" && (
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

      {/* Hidden preloader - renders Next.js optimized images off-screen on mount */}
      <div className="sr-only" aria-hidden="true">
        {TOUR_SCREENSHOTS.map((src) => (
          <Image
            key={src}
            src={src}
            alt=""
            width={320}
            height={693}
            priority
            className="absolute opacity-0 pointer-events-none"
          />
        ))}
      </div>
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
