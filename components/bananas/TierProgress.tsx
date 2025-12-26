"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";
import type { ReferralTierLevel, ReferralTierInfo } from "@/types/bananas";
import { TIER_THRESHOLDS, TIER_BADGE_IMAGES } from "@/lib/bananas/config";
import TierBadge from "./TierBadge";

interface TierProgressProps {
  tierInfo: ReferralTierInfo;
  className?: string;
}

// Map tier level to translation key
const TIER_NAME_KEYS: Record<ReferralTierLevel, string> = {
  0: "tierNames.traveler",
  1: "tierNames.explorer",
  2: "tierNames.ambassador",
  3: "tierNames.champion",
};

// Map tier level to benefit translation key
const TIER_BENEFIT_KEYS: Record<Exclude<ReferralTierLevel, 0>, string> = {
  1: "benefits.explorer",
  2: "benefits.ambassador",
  3: "benefits.champion",
};

export default function TierProgress({ tierInfo, className = "" }: TierProgressProps) {
  const t = useTranslations("bananas");

  // Get translated tier name
  const getTierName = (tier: ReferralTierLevel): string => {
    return t(TIER_NAME_KEYS[tier]);
  };

  const { currentTier, lifetimeConversions, conversionsToNextTier, nextTierAt } = tierInfo;

  // Calculate progress percentage to next tier
  const getProgress = () => {
    if (currentTier === 3) return 100;
    const currentThreshold = TIER_THRESHOLDS[currentTier];
    const nextThreshold = TIER_THRESHOLDS[(currentTier + 1) as ReferralTierLevel];
    const progressInTier = lifetimeConversions - currentThreshold;
    const tierRange = nextThreshold - currentThreshold;
    return Math.round((progressInTier / tierRange) * 100);
  };

  const progress = getProgress();
  const nextTier = currentTier < 3 ? (currentTier + 1) as ReferralTierLevel : null;

  // Get color for progress bar
  const getProgressColor = () => {
    if (currentTier === 0) return "bg-amber-400";
    if (currentTier === 1) return "bg-orange-400";
    if (currentTier === 2) return "bg-purple-400";
    return "bg-purple-500";
  };

  return (
    <div className={`bg-white rounded-2xl border border-slate-200 p-5 ${className}`}>
      {/* Current Tier */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-sm text-slate-500 mb-1">
            {t("tier.currentTier")}
          </p>
          <div className="flex items-center gap-3">
            {currentTier > 0 && TIER_BADGE_IMAGES[currentTier] ? (
              <div className="relative w-12 h-12">
                <Image
                  src={TIER_BADGE_IMAGES[currentTier]!}
                  alt={getTierName(currentTier)}
                  fill
                  className="object-contain"
                />
              </div>
            ) : (
              <span className="text-2xl">🎒</span>
            )}
            <span className="text-xl font-bold text-slate-900">
              {getTierName(currentTier)}
            </span>
          </div>
        </div>
        <div className="text-right">
          <p className="text-sm text-slate-500 mb-1">
            {t("tier.referrals")}
          </p>
          <p className="text-2xl font-bold text-slate-900">
            {lifetimeConversions}
          </p>
        </div>
      </div>

      {/* Progress to Next Tier */}
      {currentTier < 3 && nextTier && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-600">
              {t("tier.progressToNext", { tier: getTierName(nextTier) })}
            </span>
            <span className="font-medium text-slate-900">
              {lifetimeConversions} / {nextTierAt}
            </span>
          </div>

          {/* Progress Bar */}
          <div className="relative h-3 bg-slate-100 rounded-full overflow-hidden">
            <div
              className={`absolute left-0 top-0 h-full rounded-full transition-all duration-500 ${getProgressColor()}`}
              style={{ width: `${progress}%` }}
            />
            {/* Milestone markers */}
            {[1, 2, 3].map((tier) => {
              const threshold = TIER_THRESHOLDS[tier as ReferralTierLevel];
              const maxThreshold = TIER_THRESHOLDS[3];
              const position = (threshold / maxThreshold) * 100;

              if (position > 100) return null;

              return (
                <div
                  key={tier}
                  className="absolute top-0 h-full w-0.5 bg-white"
                  style={{ left: `${position}%` }}
                />
              );
            })}
          </div>

          {/* Remaining */}
          <p className="text-sm text-slate-500">
            {t("tier.remaining", { count: conversionsToNextTier })}
          </p>
        </div>
      )}

      {/* Max Tier Message */}
      {currentTier === 3 && (
        <div className="bg-purple-50 rounded-xl p-4 text-center">
          <div className="relative w-16 h-16 mx-auto mb-2">
            <Image
              src={TIER_BADGE_IMAGES[3]!}
              alt={getTierName(3)}
              fill
              className="object-contain"
            />
          </div>
          <p className="text-purple-700 font-medium mt-1">
            {t("tier.maxTierReached")}
          </p>
          <p className="text-purple-600 text-sm mt-1">
            {t("tier.maxTierDescription")}
          </p>
        </div>
      )}

      {/* Tier Milestones */}
      <div className="mt-5 pt-4 border-t border-slate-100">
        <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-3">
          {t("tier.milestones")}
        </p>
        <div className="flex justify-between">
          {[1, 2, 3].map((tier) => {
            const tierLevel = tier as ReferralTierLevel;
            const isUnlocked = currentTier >= tierLevel;
            const isNext = currentTier + 1 === tierLevel;
            const badgeImage = TIER_BADGE_IMAGES[tierLevel];

            return (
              <div
                key={tier}
                className={`text-center ${isNext ? "opacity-100" : isUnlocked ? "opacity-100" : "opacity-50"}`}
              >
                <div className={`relative w-12 h-12 mx-auto mb-1 ${!isUnlocked ? "grayscale" : ""}`}>
                  {badgeImage && (
                    <Image
                      src={badgeImage}
                      alt={getTierName(tierLevel)}
                      fill
                      className="object-contain"
                    />
                  )}
                  {!isUnlocked && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                      </svg>
                    </div>
                  )}
                </div>
                <p className={`text-xs font-medium ${isUnlocked ? "text-slate-700" : "text-slate-400"}`}>
                  {getTierName(tierLevel)}
                </p>
                <p className={`text-xs ${isUnlocked ? "text-slate-500" : "text-slate-400"}`}>
                  {TIER_THRESHOLDS[tierLevel]} {t("tier.refs")}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Tier Benefits - Show what you unlock at each level */}
      <div className="mt-5 pt-4 border-t border-slate-100">
        <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-3">
          {t("benefits.tierBenefits")}
        </p>
        <div className="space-y-2 text-sm">
          {([1, 2, 3] as const).map((tier) => {
            const tierLevel = tier as Exclude<ReferralTierLevel, 0>;
            const isUnlocked = currentTier >= tier;
            const isNext = currentTier + 1 === tier;
            const badgeImage = TIER_BADGE_IMAGES[tier];
            return (
              <div
                key={tier}
                className={`flex items-center gap-2 p-2 rounded-lg ${
                  isUnlocked ? "bg-green-50 text-green-700" :
                  isNext ? "bg-amber-50 text-amber-700" : "bg-slate-50 text-slate-500"
                }`}
              >
                <div className={`relative w-6 h-6 flex-shrink-0 ${!isUnlocked ? "grayscale opacity-50" : ""}`}>
                  {badgeImage && (
                    <Image
                      src={badgeImage}
                      alt={getTierName(tierLevel)}
                      fill
                      className="object-contain"
                    />
                  )}
                </div>
                <span className="flex-1">
                  {t(TIER_BENEFIT_KEYS[tierLevel])}
                </span>
                {isUnlocked && (
                  <svg className="w-4 h-4 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
