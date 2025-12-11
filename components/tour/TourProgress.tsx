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
      <div className="flex items-center gap-3">
        {Array.from({ length: totalSlides }).map((_, index) => (
          <motion.button
            key={index}
            variants={dotVariants}
            initial="inactive"
            animate={currentSlide === index ? "active" : "inactive"}
            onClick={() => onDotClick(index)}
            className={`
              rounded-full transition-all duration-300 cursor-pointer
              ${currentSlide === index
                ? "w-8 h-3 bg-[var(--accent)] shadow-lg shadow-[var(--accent)]/30"
                : "w-3 h-3 bg-white/30 hover:bg-white/50"
              }
            `}
            whileHover={{ scale: 1.15 }}
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
          flex items-center gap-2 px-5 py-2.5
          text-white/70 hover:text-white
          text-sm font-medium
          transition-all duration-300
          rounded-full
          bg-[var(--navy)]/30 backdrop-blur-sm
          border border-white/10
          hover:bg-[var(--navy)]/50 hover:border-white/20
        "
        style={{ fontFamily: "var(--font-source-sans), system-ui, sans-serif" }}
        whileHover={{ x: 3 }}
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
