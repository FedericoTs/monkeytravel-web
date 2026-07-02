"use client";

import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import type { Activity } from "@/types";
import { MiniActivityCard } from "./AssistantCards";

/**
 * The confirm-first "proposed change" shape.
 *
 * Mirrors EXACTLY what `POST /api/ai/assistant` returns in `pendingChange`
 * when `previewMode: true` (see app/api/ai/assistant/route.ts ~1585-1631).
 * Discriminated union on `type` — only these four are ever produced in
 * preview mode (there is no `remove` preview path server-side). Keeping the
 * type here (the card is the primary consumer) avoids a circular import with
 * AIAssistantEnhanced, which imports it from this file.
 */
export type PendingChange =
  | {
      type: "replace";
      oldActivity: Activity;
      newActivity: Activity;
      dayNumber: number;
      reason?: string;
    }
  | {
      type: "add";
      newActivity: Activity;
      dayNumber: number;
      reason?: string;
    }
  | {
      type: "adjust_duration";
      activity: { id: string; name: string; type: string };
      oldDuration: number;
      newDuration: number;
      dayNumber: number;
      reason?: string;
    }
  | {
      type: "reorder";
      dayNumber: number;
      activities: { id: string; name: string; time: string; timeSlot: string }[];
      reason?: string;
    };

interface PreviewChangeCardProps {
  change: PendingChange;
  onApply: () => void;
  onTryDifferent: () => void;
  onCancel: () => void;
  isApplying?: boolean;
}

function formatDuration(mins: number): string {
  if (!Number.isFinite(mins) || mins <= 0) return "—";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

export default function PreviewChangeCard({
  change,
  onApply,
  onTryDifferent,
  onCancel,
  isApplying = false,
}: PreviewChangeCardProps) {
  const t = useTranslations("common.ai.preview");

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="rounded-xl border border-slate-200 bg-gradient-to-br from-white to-slate-50/50 overflow-hidden shadow-sm"
    >
      {/* Header — same for every change type */}
      <div className="px-4 py-3 bg-gradient-to-r from-violet-500/10 to-purple-500/10 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-400 to-purple-500 flex items-center justify-center">
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
            </svg>
          </div>
          <div className="flex-1">
            <span className="text-sm font-semibold text-slate-800">{t("suggestedChange")}</span>
            <span className="text-xs text-slate-500 ml-2">{t("day", { number: change.dayNumber })}</span>
          </div>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">
            {t("previewBadge")}
          </span>
        </div>
      </div>

      {/* Body — rendered per change type */}
      <div className="p-4">
        {/* REPLACE: before (struck-through) → after (highlighted) */}
        {change.type === "replace" && (
          <div className="space-y-3">
            <div className="relative pt-5 sm:pt-0 sm:pl-8">
              <div className="relative opacity-60">
                <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
                  <div className="w-full h-0.5 bg-gradient-to-r from-transparent via-red-400 to-transparent" />
                </div>
                <MiniActivityCard activity={change.oldActivity} />
              </div>
              <div className="absolute left-0 sm:-left-2 top-0 sm:top-1/2 sm:-translate-y-1/2 text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-600 font-medium">
                {t("before")}
              </div>
            </div>

            <div className="flex justify-center py-1">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-400 to-green-500 flex items-center justify-center shadow-md">
                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                </svg>
              </div>
            </div>

            <div className="relative pt-5 sm:pt-0 sm:pl-8">
              <div className="ring-2 ring-emerald-400/30 rounded-xl">
                <MiniActivityCard activity={change.newActivity} isNew />
              </div>
              <div className="absolute left-0 sm:-left-2 top-0 sm:top-1/2 sm:-translate-y-1/2 text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-600 font-medium">
                {t("after")}
              </div>
            </div>
          </div>
        )}

        {/* ADD: just the new activity, highlighted — no before/strikethrough */}
        {change.type === "add" && (
          <div className="ring-2 ring-emerald-400/30 rounded-xl">
            <MiniActivityCard activity={change.newActivity} isNew />
          </div>
        )}

        {/* ADJUST_DURATION: compact before → after duration pill */}
        {change.type === "adjust_duration" && (
          <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3">
            <div className="w-8 h-8 rounded-lg bg-violet-100 flex items-center justify-center flex-shrink-0">
              <svg className="w-4 h-4 text-violet-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-slate-800 truncate">{change.activity.name}</div>
              <div className="mt-0.5 flex items-center gap-2 text-xs">
                <span className="text-slate-400 line-through">{formatDuration(change.oldDuration)}</span>
                <svg className="w-3 h-3 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
                <span className="font-semibold text-emerald-600">{formatDuration(change.newDuration)}</span>
              </div>
            </div>
          </div>
        )}

        {/* REORDER: the new ordered list of activities for the day */}
        {change.type === "reorder" && (
          <ol className="space-y-1.5">
            {change.activities.map((a, i) => (
              <li
                key={a.id || `${a.name}-${i}`}
                className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2"
              >
                <span className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-700 text-[11px] font-semibold flex items-center justify-center flex-shrink-0">
                  {i + 1}
                </span>
                {a.time && (
                  <span className="text-xs font-mono text-slate-400 flex-shrink-0">{a.time}</span>
                )}
                <span className="text-sm text-slate-700 truncate">{a.name}</span>
              </li>
            ))}
          </ol>
        )}

        {/* Reason — common to all types */}
        {change.reason && (
          <div className="mt-4 p-3 bg-gradient-to-r from-slate-50 to-white rounded-lg border border-slate-100">
            <div className="flex items-start gap-2">
              <div className="w-5 h-5 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                <svg className="w-3 h-3 text-amber-600" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" />
                </svg>
              </div>
              <div>
                <span className="text-[11px] font-semibold text-slate-700">{t("whyThisChange")}</span>
                <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">{change.reason}</p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="px-4 pb-4">
        <div className="flex items-center gap-2">
          {/* Apply */}
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

          {/* Try different */}
          <button
            onClick={onTryDifferent}
            disabled={isApplying}
            className="px-4 py-2.5 bg-slate-100 text-slate-700 text-sm font-medium rounded-xl hover:bg-slate-200 transition-colors disabled:opacity-50"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>

          {/* Cancel */}
          <button
            onClick={onCancel}
            disabled={isApplying}
            className="px-4 py-2.5 text-slate-500 text-sm font-medium rounded-xl hover:bg-slate-100 transition-colors disabled:opacity-50"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Helper text */}
        <p className="text-[10px] text-slate-400 text-center mt-2">{t("helperText")}</p>
      </div>
    </motion.div>
  );
}
