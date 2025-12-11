"use client";

import { motion } from "framer-motion";
import { dotVariants, PREMIUM_EASE } from "./animations";

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
      {/* Progress Dots */}
      <div className="flex items-center gap-2">
        {Array.from({ length: totalSlides }).map((_, index) => (
          <motion.button
            key={index}
            variants={dotVariants}
            initial="inactive"
            animate={currentSlide === index ? "active" : "inactive"}
            onClick={() => onDotClick(index)}
            className={`
              w-2.5 h-2.5 rounded-full transition-colors cursor-pointer
              ${currentSlide === index
                ? "bg-white"
                : "bg-white/40 hover:bg-white/60"
              }
            `}
            whileHover={{ scale: 1.2 }}
            whileTap={{ scale: 0.9 }}
            aria-label={`Go to slide ${index + 1}`}
          />
        ))}
      </div>

      {/* Skip Button */}
      <motion.button
        onClick={onSkip}
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.5, ease: PREMIUM_EASE }}
        className="
          flex items-center gap-2 px-4 py-2
          text-white/80 hover:text-white
          text-sm font-medium
          transition-colors
          rounded-full
          hover:bg-white/10
        "
        whileHover={{ x: 5 }}
        whileTap={{ scale: 0.95 }}
      >
        <span>Skip Tour</span>
        <svg
          className="w-4 h-4"
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
