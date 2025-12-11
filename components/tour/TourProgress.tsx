"use client";

import { motion } from "framer-motion";

interface TourProgressProps {
  currentSlide: number;
  totalSlides: number;
  onDotClick: (index: number) => void;
  className?: string;
}

export default function TourProgress({
  currentSlide,
  totalSlides,
  onDotClick,
  className = "",
}: TourProgressProps) {
  return (
    <div className={`flex items-center justify-center ${className}`}>
      {/* Progress Dots - iOS ultra-compact */}
      <div className="flex items-center gap-1 md:gap-1.5">
        {Array.from({ length: totalSlides }).map((_, index) => (
          <motion.button
            key={index}
            onClick={() => onDotClick(index)}
            className={`
              rounded-full transition-all duration-300 cursor-pointer
              ${currentSlide === index
                ? "w-4 md:w-5 h-1 md:h-1.5 bg-white shadow-sm"
                : "w-1 md:w-1.5 h-1 md:h-1.5 bg-white/30 hover:bg-white/50"
              }
            `}
            whileHover={{ scale: 1.2 }}
            whileTap={{ scale: 0.9 }}
            aria-label={`Go to slide ${index + 1}`}
          />
        ))}
      </div>
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
