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
      {/* Progress Dots - iOS style: tiny pill indicators */}
      <div className="flex items-center gap-[3px]">
        {Array.from({ length: totalSlides }).map((_, index) => (
          <motion.div
            key={index}
            onClick={() => onDotClick(index)}
            className="cursor-pointer"
            whileTap={{ scale: 0.9 }}
          >
            <div
              className={`
                rounded-full transition-all duration-300
                ${currentSlide === index
                  ? "w-[14px] h-[5px] bg-white/90"
                  : "w-[5px] h-[5px] bg-white/40"
                }
              `}
            />
          </motion.div>
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
