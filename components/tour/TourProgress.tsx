"use client";

import { motion } from "framer-motion";
import { PREMIUM_EASE } from "./animations";

interface TourProgressProps {
  currentSlide: number;
  totalSlides: number;
  onDotClick: (index: number) => void;
  onSkip: () => void;
  className?: string;
}

export default function TourProgress({
  currentSlide,
  totalSlides,
  onDotClick,
  onSkip,
  className = "",
}: TourProgressProps) {
  return (
    <div className={`flex items-center justify-between ${className}`}>
      {/* Progress Dots - iOS style: tiny, elegant */}
      <div className="flex items-center gap-1.5 md:gap-2">
        {Array.from({ length: totalSlides }).map((_, index) => (
          <motion.button
            key={index}
            onClick={() => onDotClick(index)}
            className={`
              rounded-full transition-all duration-300 cursor-pointer
              ${currentSlide === index
                ? "w-5 md:w-6 h-1.5 md:h-2 bg-white shadow-sm"
                : "w-1.5 md:w-2 h-1.5 md:h-2 bg-white/30 hover:bg-white/50"
              }
            `}
            whileHover={{ scale: 1.2 }}
            whileTap={{ scale: 0.9 }}
            aria-label={`Go to slide ${index + 1}`}
          />
        ))}
      </div>

      {/* Skip Button - iOS minimal style */}
      <motion.button
        onClick={onSkip}
        initial={{ opacity: 0, x: 10 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.3, ease: PREMIUM_EASE }}
        className="
          flex items-center gap-1.5
          text-white/60 hover:text-white/90
          text-sm font-medium
          transition-all duration-200
          px-3 py-1.5
          rounded-full
          hover:bg-white/10
        "
        style={{ fontFamily: "var(--font-source-sans), system-ui, sans-serif" }}
        whileTap={{ scale: 0.95 }}
      >
        <span>Skip</span>
        <svg
          className="w-3.5 h-3.5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 5l7 7-7 7"
          />
        </svg>
      </motion.button>
    </div>
  );
}

// Auto-advance progress bar (optional)
interface ProgressBarProps {
  progress: number;
  duration: number;
  isActive: boolean;
}

export function AutoAdvanceBar({ progress, duration, isActive }: ProgressBarProps) {
  return (
    <div className="h-0.5 bg-white/20 rounded-full overflow-hidden w-full max-w-[200px]">
      <motion.div
        className="h-full bg-white rounded-full"
        initial={{ width: "0%" }}
        animate={{
          width: isActive ? "100%" : `${progress * 100}%`,
        }}
        transition={{
          duration: isActive ? duration / 1000 : 0.3,
          ease: "linear",
        }}
      />
    </div>
  );
}
