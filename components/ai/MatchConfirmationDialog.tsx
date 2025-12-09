"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { Activity } from "@/types";

interface MatchOption {
  activity: Activity;
  dayNumber: number;
  confidence: number;
  reason?: string;
}

interface MatchConfirmationDialogProps {
  query: string;
  matches: MatchOption[];
  onSelect: (activity: Activity, dayNumber: number) => void;
  onCancel: () => void;
  onTypeMore?: () => void;
}

export default function MatchConfirmationDialog({
  query,
  matches,
  onSelect,
  onCancel,
  onTypeMore,
}: MatchConfirmationDialogProps) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  // Sort matches by confidence
  const sortedMatches = [...matches].sort((a, b) => b.confidence - a.confidence);

  const handleSelect = (match: MatchOption, index: number) => {
    setSelectedIndex(index);
    // Small delay for visual feedback
    setTimeout(() => {
      onSelect(match.activity, match.dayNumber);
    }, 200);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm"
    >
      {/* Header */}
      <div className="px-4 py-3 bg-gradient-to-r from-amber-500/10 to-orange-500/10 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center">
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div className="flex-1">
            <span className="text-sm font-semibold text-slate-800">Which one did you mean?</span>
          </div>
        </div>
      </div>

      {/* Query context */}
      <div className="px-4 py-3 bg-slate-50 border-b border-slate-100">
        <p className="text-xs text-slate-600">
          You mentioned: <span className="font-medium text-slate-800">&ldquo;{query}&rdquo;</span>
        </p>
      </div>

      {/* Matches */}
      <div className="p-3 space-y-2">
        <AnimatePresence>
          {sortedMatches.map((match, index) => (
            <motion.button
              key={`${match.activity.id}-${match.dayNumber}`}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.1 }}
              onClick={() => handleSelect(match, index)}
              className={`
                w-full text-left p-3 rounded-xl border-2 transition-all duration-200
                ${selectedIndex === index
                  ? "border-emerald-400 bg-emerald-50 ring-2 ring-emerald-200"
                  : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                }
              `}
            >
              <div className="flex items-start gap-3">
                {/* Selection indicator */}
                <div
                  className={`
                    w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5
                    transition-all duration-200
                    ${selectedIndex === index
                      ? "border-emerald-500 bg-emerald-500"
                      : "border-slate-300 bg-white"
                    }
                  `}
                >
                  {selectedIndex === index && (
                    <motion.svg
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      className="w-3 h-3 text-white"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </motion.svg>
                  )}
                </div>

                {/* Activity info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h4 className="font-semibold text-sm text-slate-900 truncate">
                      {match.activity.name}
                    </h4>
                    {index === 0 && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium">
                        Best match
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs text-slate-500">Day {match.dayNumber}</span>
                    {match.activity.start_time && (
                      <>
                        <span className="text-slate-300">•</span>
                        <span className="text-xs text-slate-500">{match.activity.start_time}</span>
                      </>
                    )}
                    {match.activity.type && (
                      <>
                        <span className="text-slate-300">•</span>
                        <span className="text-xs text-slate-500 capitalize">{match.activity.type}</span>
                      </>
                    )}
                  </div>
                  {match.reason && (
                    <p className="text-[11px] text-slate-500 mt-1 italic">{match.reason}</p>
                  )}
                </div>

                {/* Confidence score */}
                <div className="flex-shrink-0">
                  <div
                    className={`
                      text-[10px] px-1.5 py-0.5 rounded font-medium
                      ${match.confidence >= 80 ? "bg-emerald-100 text-emerald-700" :
                        match.confidence >= 60 ? "bg-amber-100 text-amber-700" :
                        "bg-slate-100 text-slate-600"}
                    `}
                  >
                    {match.confidence}%
                  </div>
                </div>
              </div>
            </motion.button>
          ))}
        </AnimatePresence>
      </div>

      {/* Footer actions */}
      <div className="px-4 pb-4 space-y-2">
        {/* Type more option */}
        {onTypeMore && (
          <button
            onClick={onTypeMore}
            className="w-full text-sm text-slate-500 hover:text-slate-700 py-2 transition-colors"
          >
            Or type more details to help me find it...
          </button>
        )}

        {/* Cancel */}
        <button
          onClick={onCancel}
          className="w-full py-2 text-sm text-slate-500 hover:text-slate-700 hover:bg-slate-50 rounded-lg transition-colors"
        >
          Cancel
        </button>
      </div>
    </motion.div>
  );
}

// Export types
export type { MatchOption, MatchConfirmationDialogProps };
