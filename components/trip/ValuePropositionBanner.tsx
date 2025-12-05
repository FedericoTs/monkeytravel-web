"use client";

import { useState, useEffect } from "react";

interface ValuePropositionBannerProps {
  onSave: () => void;
  isSaving: boolean;
  variant?: "inline" | "sticky-bottom";
  className?: string;
}

// Features unlocked after saving
const UNLOCKABLE_FEATURES = [
  {
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
      </svg>
    ),
    title: "AI Assistant",
    description: "Get personalized suggestions",
  },
  {
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
      </svg>
    ),
    title: "Full Editing",
    description: "Customize every detail",
  },
  {
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
      </svg>
    ),
    title: "Share & Export",
    description: "PDF, calendar sync",
  },
];

export default function ValuePropositionBanner({
  onSave,
  isSaving,
  variant = "inline",
  className = "",
}: ValuePropositionBannerProps) {
  const [isVisible, setIsVisible] = useState(true);
  const [isDismissed, setIsDismissed] = useState(false);

  // Check if user has dismissed this banner before
  useEffect(() => {
    const dismissed = localStorage.getItem("value-banner-dismissed");
    if (dismissed) {
      setIsDismissed(true);
      setIsVisible(false);
    }
  }, []);

  const handleDismiss = () => {
    setIsVisible(false);
    localStorage.setItem("value-banner-dismissed", "true");
    setIsDismissed(true);
  };

  if (!isVisible || isDismissed) return null;

  // Sticky bottom variant for mobile
  if (variant === "sticky-bottom") {
    return (
      <div className={`fixed bottom-0 left-0 right-0 z-50 safe-area-inset-bottom ${className}`}>
        {/* Gradient fade */}
        <div className="h-8 bg-gradient-to-t from-white to-transparent" />

        <div className="bg-white border-t border-slate-200 px-4 py-4 shadow-[0_-4px_20px_rgba(0,0,0,0.08)]">
          {/* Feature pills */}
          <div className="flex items-center justify-center gap-2 mb-3 overflow-x-auto pb-1 -mx-4 px-4 scrollbar-hide">
            {UNLOCKABLE_FEATURES.map((feature, idx) => (
              <div
                key={idx}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 rounded-full text-xs font-medium text-slate-600 whitespace-nowrap flex-shrink-0"
              >
                <span className="text-[var(--primary)]">{feature.icon}</span>
                <span>{feature.title}</span>
              </div>
            ))}
          </div>

          {/* CTA Button */}
          <button
            onClick={onSave}
            disabled={isSaving}
            className="w-full bg-gradient-to-r from-[var(--secondary)] to-[var(--secondary)]/90 text-white py-3.5 rounded-xl font-semibold text-base shadow-lg shadow-[var(--secondary)]/25 disabled:opacity-50 transition-all duration-200 hover:shadow-xl hover:shadow-[var(--secondary)]/30"
          >
            {isSaving ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Saving...
              </span>
            ) : (
              <span className="flex items-center justify-center gap-2">
                Save Trip & Unlock Features
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </span>
            )}
          </button>

          <p className="text-center text-xs text-slate-400 mt-2">
            Your trip will be saved to your account
          </p>
        </div>
      </div>
    );
  }

  // Inline variant - appears above bottom CTA
  return (
    <div className={`relative ${className}`}>
      {/* Dismiss button */}
      <button
        onClick={handleDismiss}
        className="absolute top-3 right-3 w-6 h-6 rounded-full bg-white/80 flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-white transition-colors z-10"
        aria-label="Dismiss"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      {/* Banner content */}
      <div className="bg-gradient-to-br from-[var(--secondary)]/10 via-[var(--primary)]/5 to-[var(--accent)]/10 border border-[var(--secondary)]/20 rounded-2xl p-6 overflow-hidden relative">
        {/* Decorative elements */}
        <div className="absolute top-0 right-0 w-32 h-32 bg-[var(--accent)]/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
        <div className="absolute bottom-0 left-0 w-24 h-24 bg-[var(--secondary)]/10 rounded-full blur-2xl translate-y-1/2 -translate-x-1/2" />

        <div className="relative">
          {/* Header */}
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-lg bg-[var(--secondary)]/20 flex items-center justify-center">
              <svg className="w-4 h-4 text-[var(--secondary)]" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
              </svg>
            </div>
            <div>
              <h3 className="font-semibold text-slate-900">Save to unlock more</h3>
              <p className="text-xs text-slate-500">Full editing & AI features</p>
            </div>
          </div>

          {/* Features grid */}
          <div className="grid grid-cols-3 gap-3 mb-5">
            {UNLOCKABLE_FEATURES.map((feature, idx) => (
              <div
                key={idx}
                className="bg-white/60 backdrop-blur-sm rounded-xl p-3 text-center border border-white/80"
              >
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[var(--primary)]/10 to-[var(--secondary)]/10 flex items-center justify-center mx-auto mb-2 text-[var(--primary)]">
                  {feature.icon}
                </div>
                <div className="text-sm font-medium text-slate-900">{feature.title}</div>
                <div className="text-xs text-slate-500 mt-0.5">{feature.description}</div>
              </div>
            ))}
          </div>

          {/* CTA */}
          <button
            onClick={onSave}
            disabled={isSaving}
            className="w-full bg-[var(--secondary)] text-white py-3 rounded-xl font-semibold shadow-lg shadow-[var(--secondary)]/25 hover:shadow-xl hover:shadow-[var(--secondary)]/30 disabled:opacity-50 transition-all duration-200 flex items-center justify-center gap-2"
          >
            {isSaving ? (
              <>
                <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Saving Your Trip...
              </>
            ) : (
              <>
                Save & Start Editing
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
