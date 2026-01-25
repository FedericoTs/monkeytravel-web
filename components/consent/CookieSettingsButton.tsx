"use client";

/**
 * Cookie Settings Button
 *
 * Small button for the footer that opens the cookie settings modal.
 * Allows users to change their consent preferences at any time.
 */

import { useTranslations } from "next-intl";
import { useConsent } from "@/lib/consent";

interface CookieSettingsButtonProps {
  className?: string;
}

export function CookieSettingsButton({ className = "" }: CookieSettingsButtonProps) {
  const t = useTranslations("consent");
  const { openSettings } = useConsent();

  return (
    <button
      onClick={openSettings}
      className={`text-white/50 hover:text-[var(--accent)] transition-colors text-sm ${className}`}
    >
      {t("footer.cookieSettings")}
    </button>
  );
}

export default CookieSettingsButton;
