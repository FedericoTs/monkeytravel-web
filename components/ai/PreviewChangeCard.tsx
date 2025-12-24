"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { motion, AnimatePresence } from "framer-motion";
import type { Activity } from "@/types";
import { MiniActivityCard } from "./AssistantCards";

interface PreviewChangeCardProps {
  oldActivity: Activity;
  newActivity: Activity;
  dayNumber: number;
  reason?: string;
  onApply: () => void;
  onTryDifferent: () => void;
  onCancel: () => void;
  isApplying?: boolean;
}

export default function PreviewChangeCard({
  oldActivity,
  newActivity,
  dayNumber,
  reason,
  onApply,
  onTryDifferent,
  onCancel,
  isApplying = false,
}: PreviewChangeCardProps) {
  const t = useTranslations("common.ai.preview");
  const [showComparison, setShowComparison] = useState(true);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="rounded-xl border border-slate-200 bg-gradient-to-br from-white to-slate-50/50 overflow-hidden shadow-sm"
    >
      {/* Header */}
      <div className="px-4 py-3 bg-gradient-to-r from-violet-500/10 to-purple-500/10 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-400 to-purple-500 flex items-center justify-center">
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
            </svg>
          </div>
          <div className="flex-1">
            <span className="text-sm font-semibold text-slate-800">{t("suggestedChange")}</span>
            <span className="text-xs text-slate-500 ml-2">{t("day", { number: dayNumber })}</span>
          </div>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">
            {t("previewBadge")}
          </span>
        </div>
      </div>

      {/* Comparison View */}
      <div className="p-4">
        <AnimatePresence mode="wait">
          {showComparison && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-3"
            >
              {/* Old Activity (fading) */}
              <div className="relative pt-5 sm:pt-0 sm:pl-8">
                <motion.div
                  initial={{ opacity: 1, scale: 1 }}
                  animate={{ opacity: 0.5, scale: 0.98 }}
                  transition={{ duration: 0.5 }}
                  className="relative"
                >
                  {/* Strike-through line */}
                  <motion.div
                    className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.3 }}
                  >
                    <div className="w-full h-0.5 bg-gradient-to-r from-transparent via-red-400 to-transparent" />
                  </motion.div>
                  <div className="opacity-60">
                    <MiniActivityCard activity={oldActivity} />
                  </div>
                </motion.div>
                <div className="absolute left-0 sm:-left-2 top-0 sm:top-1/2 sm:-translate-y-1/2 text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-600 font-medium">
                  {t("before")}
                </div>
              </div>

              {/* Arrow */}
              <div className="flex justify-center py-1">
                <motion.div
                  initial={{ scale: 0, rotate: -45 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ type: "spring", stiffness: 300, delay: 0.2 }}
                  className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-400 to-green-500 flex items-center justify-center shadow-md"
                >
                  <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                  </svg>
                </motion.div>
              </div>

              {/* New Activity (highlighted) */}
              <div className="relative pt-5 sm:pt-0 sm:pl-8">
                <motion.div
                  initial={{ opacity: 0, y: 20, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ type: "spring", stiffness: 300, delay: 0.3 }}
                  className="ring-2 ring-emerald-400/30 rounded-xl"
                >
                  <MiniActivityCard activity={newActivity} isNew />
                </motion.div>
                <div className="absolute left-0 sm:-left-2 top-0 sm:top-1/2 sm:-translate-y-1/2 text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-600 font-medium">
                  {t("after")}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Reason */}
        {reason && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="mt-4 p-3 bg-gradient-to-r from-slate-50 to-white rounded-lg border border-slate-100"
          >
            <div className="flex items-start gap-2">
              <div className="w-5 h-5 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                <svg className="w-3 h-3 text-amber-600" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" />
                </svg>
              </div>
              <div>
                <span className="text-[11px] font-semibold text-slate-700">{t("whyThisChange")}</span>
                <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">{reason}</p>
              </div>
            </div>
          </motion.div>
        )}
      </div>

      {/* Action buttons */}
      <div className="px-4 pb-4">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
          className="flex items-center gap-2"
        >
          {/* Apply button */}
          <button
            onClick={onApply}
            disabled={isApplying}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-emerald-500 to-green-500 text-white text-sm font-semibold rounded-xl shadow-md hover:shadow-lg hover:from-emerald-600 hover:to-green-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isApplying ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                <span>{t("applying")}</span>
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span>{t("applyChange")}</span>
              </>
            )}
          </button>

          {/* Try different button */}
          <button
            onClick={onTryDifferent}
            disabled={isApplying}
            className="px-4 py-2.5 bg-slate-100 text-slate-700 text-sm font-medium rounded-xl hover:bg-slate-200 transition-colors disabled:opacity-50"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>

          {/* Cancel button */}
          <button
            onClick={onCancel}
            disabled={isApplying}
            className="px-4 py-2.5 text-slate-500 text-sm font-medium rounded-xl hover:bg-slate-100 transition-colors disabled:opacity-50"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </motion.div>

        {/* Helper text */}
        <p className="text-[10px] text-slate-400 text-center mt-2">
          {t("helperText")}
        </p>
      </div>
    </motion.div>
  );
}
