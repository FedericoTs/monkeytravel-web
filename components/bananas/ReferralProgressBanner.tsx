"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import {
  TIER_THRESHOLDS,
  TIER_BENEFITS,
  TIER_BADGE_IMAGES,
  getTierForConversions,
  getTierProgress,
  getConversionsToNextTier,
} from "@/lib/bananas/config";
import type { ReferralTierLevel } from "@/types/bananas";

// Map tier level to translation key
const TIER_NAME_KEYS: Record<ReferralTierLevel, string> = {
  0: "tierNames.traveler",
  1: "tierNames.explorer",
  2: "tierNames.ambassador",
  3: "tierNames.champion",
};

interface ReferralProgressBannerProps {
  lifetimeConversions: number;
  className?: string;
  onInvite?: () => void;
}

const STORAGE_KEY = "referral_banner_dismissed";

export default function ReferralProgressBanner({
  lifetimeConversions,
  className = "",
  onInvite,
}: ReferralProgressBannerProps) {
  const t = useTranslations("bananas");
  const [isDismissed, setIsDismissed] = useState(true); // Start hidden to prevent flash

  // Get translated tier name
  const getTierName = (tier: ReferralTierLevel): string => {
    return t(TIER_NAME_KEYS[tier]);
  };

  const currentTier = getTierForConversions(lifetimeConversions);
  const progress = getTierProgress(lifetimeConversions);
  const conversionsToNext = getConversionsToNextTier(lifetimeConversions);
  const nextTier = currentTier < 3 ? ((currentTier + 1) as ReferralTierLevel) : null;

  // Check localStorage on mount
  useEffect(() => {
    const dismissed = localStorage.getItem(STORAGE_KEY);
    setIsDismissed(dismissed === "true");
  }, []);

  // Don't show if dismissed or max tier reached
  if (isDismissed || currentTier === 3) return null;

  const handleDismiss = () => {
    localStorage.setItem(STORAGE_KEY, "true");
    setIsDismissed(true);
  };

  const nextTierBonus = nextTier ? TIER_BENEFITS[nextTier].aiGenerationsBonus : 0;

  return (
    <div
      className={`bg-gradient-to-r from-amber-50 via-yellow-50 to-amber-50 rounded-xl border border-amber-200/60 p-3 sm:p-4 relative overflow-hidden ${className}`}
    >
      {/* Dismiss button */}
      <button
        onClick={handleDismiss}
        className="absolute top-2 right-2 p-1 rounded-full text-amber-400 hover:text-amber-600 hover:bg-amber-100 transition-colors"
        aria-label="Dismiss"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      </button>

      <div className="flex items-center gap-3 sm:gap-4">
        {/* Tier badge */}
        <div className="flex-shrink-0 w-10 h-10 sm:w-12 sm:h-12 relative">
          {nextTier && TIER_BADGE_IMAGES[nextTier] ? (
            <Image
              src={TIER_BADGE_IMAGES[nextTier]!}
              alt={getTierName(nextTier)}
              fill
              className="object-contain"
            />
          ) : (
            <div className="w-full h-full rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-xl sm:text-2xl shadow-md">
              👑
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0 pr-6">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <p className="font-semibold text-amber-900 text-sm sm:text-base truncate">
              {t("banner.title")}
            </p>
            {nextTier && (
              <span className="text-xs px-2 py-0.5 bg-amber-200/60 rounded-full text-amber-800 font-medium whitespace-nowrap">
                {t("banner.benefit", { bonus: nextTierBonus })}
              </span>
            )}
          </div>

          {/* Progress bar */}
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="flex-1 h-2 bg-amber-200/50 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-amber-400 to-orange-500 rounded-full transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="text-xs text-amber-700 font-medium whitespace-nowrap">
              {lifetimeConversions}/{nextTier ? TIER_THRESHOLDS[nextTier] : TIER_THRESHOLDS[3]}
            </span>
          </div>

          {/* Progress text */}
          <p className="text-xs text-amber-600 mt-1 hidden sm:block">
            {conversionsToNext > 0
              ? t("banner.progress", {
                  current: lifetimeConversions,
                  target: nextTier ? TIER_THRESHOLDS[nextTier] : TIER_THRESHOLDS[3],
                  tier: nextTier ? getTierName(nextTier) : getTierName(3),
                })
              : t("banner.maxTier")}
          </p>
        </div>

        {/* CTA Button */}
        <button
          onClick={onInvite}
          className="flex-shrink-0 bg-gradient-to-r from-amber-500 to-orange-500 text-white px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-medium hover:from-amber-600 hover:to-orange-600 transition-all shadow-md hover:shadow-lg whitespace-nowrap"
        >
          {t("banner.cta")}
        </button>
      </div>
    </div>
  );
}
