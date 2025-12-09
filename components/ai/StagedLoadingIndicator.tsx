"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";

export type LoadingStage =
  | "parsing"
  | "finding"
  | "generating"
  | "applying"
  | "complete";

interface LoadingStageConfig {
  id: LoadingStage;
  label: string;
  icon: string;
}

const LOADING_STAGES: LoadingStageConfig[] = [
  { id: "parsing", label: "Understanding request...", icon: "M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" },
  { id: "finding", label: "Finding activities...", icon: "M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" },
  { id: "generating", label: "Creating alternatives...", icon: "M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" },
  { id: "applying", label: "Updating your trip...", icon: "M5 13l4 4L19 7" },
];

interface StagedLoadingIndicatorProps {
  currentStage: LoadingStage;
  className?: string;
}

export default function StagedLoadingIndicator({
  currentStage,
  className = "",
}: StagedLoadingIndicatorProps) {
  const [progress, setProgress] = useState(0);
  const currentIndex = LOADING_STAGES.findIndex((s) => s.id === currentStage);
  const currentConfig = LOADING_STAGES[currentIndex] || LOADING_STAGES[0];

  // Animate progress based on stage
  useEffect(() => {
    const stageProgress = ((currentIndex + 1) / LOADING_STAGES.length) * 100;
    const timer = setTimeout(() => setProgress(stageProgress), 100);
    return () => clearTimeout(timer);
  }, [currentIndex]);

  return (
    <div className={`bg-white rounded-2xl rounded-bl-md px-4 py-4 shadow-sm border border-slate-100 ${className}`}>
      {/* Stage indicators */}
      <div className="flex items-center justify-between mb-3">
        {LOADING_STAGES.map((stage, idx) => {
          const isCompleted = idx < currentIndex;
          const isCurrent = idx === currentIndex;
          const isPending = idx > currentIndex;

          return (
            <div key={stage.id} className="flex items-center">
              {/* Stage dot/icon */}
              <motion.div
                className={`
                  w-7 h-7 rounded-full flex items-center justify-center
                  ${isCompleted ? "bg-emerald-500" : ""}
                  ${isCurrent ? "bg-[var(--primary)]" : ""}
                  ${isPending ? "bg-slate-200" : ""}
                `}
                initial={{ scale: 0.8 }}
                animate={{
                  scale: isCurrent ? [1, 1.1, 1] : 1,
                }}
                transition={{
                  duration: isCurrent ? 1.5 : 0.3,
                  repeat: isCurrent ? Infinity : 0,
                  ease: "easeInOut"
                }}
              >
                {isCompleted ? (
                  <motion.svg
                    className="w-4 h-4 text-white"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    initial={{ pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ duration: 0.3 }}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </motion.svg>
                ) : isCurrent ? (
                  <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={stage.icon} />
                  </svg>
                ) : (
                  <div className="w-2 h-2 rounded-full bg-slate-400" />
                )}
              </motion.div>

              {/* Connector line */}
              {idx < LOADING_STAGES.length - 1 && (
                <div className="w-6 sm:w-10 h-0.5 mx-1">
                  <motion.div
                    className={`h-full ${idx < currentIndex ? "bg-emerald-500" : "bg-slate-200"}`}
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: 1 }}
                    transition={{ duration: 0.3, delay: idx * 0.1 }}
                    style={{ transformOrigin: "left" }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Current stage label */}
      <AnimatePresence mode="wait">
        <motion.div
          key={currentStage}
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -5 }}
          transition={{ duration: 0.2 }}
          className="flex items-center gap-2 mb-3"
        >
          <motion.div
            className="w-5 h-5 rounded-full bg-[var(--primary)]/10 flex items-center justify-center"
            animate={{ rotate: [0, 360] }}
            transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
          >
            <svg className="w-3 h-3 text-[var(--primary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={currentConfig.icon} />
            </svg>
          </motion.div>
          <span className="text-sm text-slate-600">{currentConfig.label}</span>
        </motion.div>
      </AnimatePresence>

      {/* Progress bar */}
      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <motion.div
          className="h-full bg-gradient-to-r from-[var(--primary)] to-[var(--secondary)] rounded-full"
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.5, ease: "easeOut" }}
        />
      </div>

      {/* Subtle percentage */}
      <div className="flex justify-end mt-1">
        <span className="text-[10px] text-slate-400">{Math.round(progress)}%</span>
      </div>
    </div>
  );
}

// Export types for external use
export { LOADING_STAGES };
export type { LoadingStageConfig };
