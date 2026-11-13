"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";

/**
 * The way to the trip assistant: a floating button, bigger and accented, that
 * pulses for a planner who hasn't opened the assistant yet; in edit mode a
 * compact one sits above the edit bar instead. On a phone the floating button
 * covers the plan under it, so it stays away while the controls bar's own
 * assistant button is on screen (`barButtonInView`).
 */
export default function TripAssistantButton({
  isEditMode,
  hasSeenAssistant,
  barButtonInView = false,
  onOpen,
}: {
  isEditMode: boolean;
  hasSeenAssistant: boolean;
  barButtonInView?: boolean;
  onOpen: () => void;
}) {
  const t = useTranslations("trips");
  return !isEditMode ? (
    <button
      onClick={onOpen}
      className={`fixed bottom-24 sm:bottom-6 left-6 lg:bottom-8 lg:left-8 z-40 group ${barButtonInView ? "max-sm:hidden" : ""} ${!hasSeenAssistant ? "animate-pulse" : ""}`}
      title={t('detail.aiTripAssistant')}
    >
      <div className="flex items-center gap-3 px-4 py-3 sm:px-5 sm:py-3.5 rounded-2xl bg-gradient-to-br from-[var(--primary)] to-[var(--primary-dark)] text-white shadow-xl shadow-[var(--primary)]/30 hover:shadow-2xl hover:scale-[1.04] transition-all duration-300 ring-2 ring-white">
        {/* AI Agent Image with ring on white background for contrast */}
        <div className="relative w-11 h-11 sm:w-12 sm:h-12 rounded-xl overflow-hidden shadow-md bg-white">
          <Image
            src="/images/ai-agent.png"
            alt={t("detail.aiAssistant")}
            fill
            className="object-cover"
          />
        </div>
        {/* Label - hidden on very small screens */}
        <div className="hidden sm:flex flex-col items-start leading-none">
          <span className="text-sm font-bold text-white">{t('detail.aiAssistant')}</span>
          <span className="text-[12px] text-white/85">{t('detail.customizeTrip')}</span>
        </div>
        {/* Arrow indicator */}
        <svg className="w-4 h-4 text-white/80 group-hover:translate-x-0.5 transition-all hidden sm:block" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
        </svg>
      </div>
      {/* First-time visual nudge — small dot like a notification badge */}
      {!hasSeenAssistant && (
        <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[var(--accent)] ring-2 ring-white animate-ping" />
      )}
    </button>
  ) : (
    <button
      onClick={onOpen}
      className="fixed bottom-24 left-6 z-40 group"
      title={t('detail.aiTripAssistant')}
    >
      <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/95 backdrop-blur-xl border border-slate-200/80 shadow-lg shadow-slate-900/10 hover:shadow-xl hover:bg-white transition-all duration-300">
        <div className="relative w-9 h-9 rounded-lg overflow-hidden shadow-sm">
          <Image
            src="/images/ai-agent.png"
            alt={t("detail.aiAssistant")}
            fill
            className="object-cover"
          />
        </div>
        <span className="text-sm font-medium text-slate-700 hidden sm:inline">{t('detail.aiHelp')}</span>
      </div>
    </button>
  );
}
