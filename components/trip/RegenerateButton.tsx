"use client";

import { useTranslations } from "next-intl";

interface RegenerateButtonProps {
  onRegenerate: () => void;
  isRegenerating: boolean;
  disabled?: boolean;
  variant?: "default" | "compact" | "icon-only";
  className?: string;
}

export default function RegenerateButton({
  onRegenerate,
  isRegenerating,
  disabled = false,
  variant = "default",
  className = "",
}: RegenerateButtonProps) {
  const t = useTranslations("common.regenerate");
  const isDisabled = disabled || isRegenerating;

  // Refresh/regenerate icon with rotation animation when loading
  const RefreshIcon = () => (
    <svg
      className={`w-5 h-5 ${isRegenerating ? "animate-spin" : ""}`}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
      />
    </svg>
  );

  // Sparkles icon for the magic feel
  const SparkleIcon = () => (
    <svg
      className="w-4 h-4"
      fill="currentColor"
      viewBox="0 0 20 20"
    >
      <path d="M5 2a1 1 0 011 1v1h1a1 1 0 010 2H6v1a1 1 0 01-2 0V6H3a1 1 0 010-2h1V3a1 1 0 011-1zm0 10a1 1 0 011 1v1h1a1 1 0 110 2H6v1a1 1 0 11-2 0v-1H3a1 1 0 110-2h1v-1a1 1 0 011-1zM12 2a1 1 0 01.967.744l.52 2.078 2.078.52a1 1 0 010 1.936l-2.078.52-.52 2.078a1 1 0 01-1.936 0l-.52-2.078-2.078-.52a1 1 0 010-1.936l2.078-.52.52-2.078A1 1 0 0112 2z" />
    </svg>
  );

  if (variant === "icon-only") {
    return (
      <button
        onClick={onRegenerate}
        disabled={isDisabled}
        className={`
          w-10 h-10 rounded-full flex items-center justify-center
          bg-white border border-slate-200 text-slate-600
          hover:bg-[var(--primary)]/5 hover:border-[var(--primary)]/30 hover:text-[var(--primary)]
          disabled:opacity-50 disabled:cursor-not-allowed
          transition-all duration-200
          ${className}
        `}
        title={isRegenerating ? t("generating") : t("tryDifferent")}
      >
        <RefreshIcon />
      </button>
    );
  }

  if (variant === "compact") {
    return (
      <button
        onClick={onRegenerate}
        disabled={isDisabled}
        className={`
          inline-flex items-center gap-2 px-4 py-2
          bg-white border border-slate-200 text-slate-700 text-sm font-medium
          rounded-lg
          hover:bg-[var(--primary)]/5 hover:border-[var(--primary)]/30 hover:text-[var(--primary)]
          disabled:opacity-50 disabled:cursor-not-allowed
          transition-all duration-200
          ${className}
        `}
      >
        <RefreshIcon />
        <span className="hidden sm:inline">
          {isRegenerating ? t("generating") : t("regenerate")}
        </span>
      </button>
    );
  }

  // Default variant - full button with premium styling
  return (
    <button
      onClick={onRegenerate}
      disabled={isDisabled}
      className={`
        group relative inline-flex items-center gap-2.5 px-5 py-2.5
        bg-gradient-to-r from-slate-50 to-white
        border border-slate-200 text-slate-700 font-medium
        rounded-xl overflow-hidden
        hover:border-[var(--primary)]/40 hover:shadow-lg hover:shadow-[var(--primary)]/10
        disabled:opacity-50 disabled:cursor-not-allowed
        transition-all duration-300
        ${className}
      `}
    >
      {/* Shimmer effect on hover */}
      <div className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-700 bg-gradient-to-r from-transparent via-white/50 to-transparent" />

      <div className="relative flex items-center gap-2.5">
        <div className={`
          w-8 h-8 rounded-lg flex items-center justify-center
          bg-[var(--primary)]/10 text-[var(--primary)]
          group-hover:bg-[var(--primary)] group-hover:text-white
          transition-colors duration-200
        `}>
          <RefreshIcon />
        </div>

        <div className="text-left">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-semibold text-slate-900 group-hover:text-[var(--primary)] transition-colors">
              {isRegenerating ? t("generating") : t("tryDifferent")}
            </span>
            {!isRegenerating && (
              <SparkleIcon />
            )}
          </div>
          <span className="text-xs text-slate-500">
            {t("samePreferences")}
          </span>
        </div>
      </div>
    </button>
  );
}
