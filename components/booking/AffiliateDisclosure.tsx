"use client";

import { useTranslations } from "next-intl";

interface AffiliateDisclosureProps {
  className?: string;
  variant?: "default" | "minimal";
}

/**
 * Affiliate disclosure component for legal compliance.
 *
 * FTC requires disclosure of affiliate relationships.
 * This appears near booking links to inform users.
 */
export default function AffiliateDisclosure({
  className = "",
  variant = "default",
}: AffiliateDisclosureProps) {
  const t = useTranslations("common.booking");

  if (variant === "minimal") {
    return (
      <span className={`text-xs text-slate-400 ${className}`}>
        {t("affiliateShort")}
      </span>
    );
  }

  return (
    <p className={`text-xs text-slate-500 ${className}`}>
      {t("affiliateDisclosure")}
    </p>
  );
}
