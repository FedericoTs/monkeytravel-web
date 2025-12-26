"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";
import type { ReferralTierLevel } from "@/types/bananas";
import { TIER_BADGE_IMAGES } from "@/lib/bananas/config";

interface TierBadgeProps {
  tier: ReferralTierLevel;
  unlocked?: boolean;
  showName?: boolean;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}

const sizeConfig = {
  sm: { image: 24, container: "w-6 h-6" },
  md: { image: 36, container: "w-9 h-9" },
  lg: { image: 48, container: "w-12 h-12" },
  xl: { image: 64, container: "w-16 h-16" },
};

// Map tier level to translation key
const TIER_NAME_KEYS: Record<ReferralTierLevel, string> = {
  0: "tierNames.traveler",
  1: "tierNames.explorer",
  2: "tierNames.ambassador",
  3: "tierNames.champion",
};

export default function TierBadge({
  tier,
  unlocked = true,
  showName = false,
  size = "md",
  className = "",
}: TierBadgeProps) {
  const t = useTranslations("bananas");

  // Tier 0 has no badge
  if (tier === 0) {
    return null;
  }

  const badgeImage = TIER_BADGE_IMAGES[tier];
  const config = sizeConfig[size];
  const tierName = t(TIER_NAME_KEYS[tier]);

  if (!badgeImage) {
    return null;
  }

  return (
    <div className={`inline-flex flex-col items-center gap-1 ${className}`}>
      <div
        className={`
          relative ${config.container} rounded-full overflow-hidden
          ${!unlocked ? "grayscale opacity-50" : ""}
          transition-all duration-300
          ${unlocked ? "hover:scale-110" : ""}
        `}
      >
        <Image
          src={badgeImage}
          alt={tierName}
          width={config.image}
          height={config.image}
          className="object-contain"
        />
        {!unlocked && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-900/30">
            <svg className="w-1/3 h-1/3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
        )}
      </div>
      {showName && (
        <span className={`text-xs font-medium ${unlocked ? "text-slate-700" : "text-slate-400"}`}>
          {tierName}
        </span>
      )}
    </div>
  );
}
