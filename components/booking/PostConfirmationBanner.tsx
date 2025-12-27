"use client";

import { useTranslations } from "next-intl";
import { X, Smartphone, Plane, Shield } from "lucide-react";
import { useState } from "react";
import { generateYesimLink, generateSailyLink, generateAirHelpLink } from "@/lib/affiliates";
import { capture } from "@/lib/posthog";

interface PostConfirmationBannerProps {
  tripId: string;
  destination: string;
  tripStatus: "planning" | "confirmed" | "active" | "completed";
  className?: string;
}

export default function PostConfirmationBanner({
  tripId,
  destination,
  tripStatus,
  className = "",
}: PostConfirmationBannerProps) {
  const t = useTranslations("common.booking");
  const [isDismissed, setIsDismissed] = useState(false);

  // Only show for confirmed trips
  if (tripStatus !== "confirmed" || isDismissed) {
    return null;
  }

  const yesimLink = generateYesimLink(destination);
  const sailyLink = generateSailyLink(destination);
  const airHelpLink = generateAirHelpLink();

  const handleDismiss = () => {
    setIsDismissed(true);
    capture("post_confirmation_banner_dismissed", { trip_id: tripId });
  };

  const handleServiceClick = (service: string, url: string) => {
    capture("post_confirmation_service_click", {
      service,
      destination,
      trip_id: tripId,
      url,
    });
  };

  return (
    <div
      className={`relative bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-200 rounded-xl p-4 ${className}`}
    >
      {/* Dismiss button */}
      <button
        onClick={handleDismiss}
        className="absolute top-3 right-3 p-1 text-slate-400 hover:text-slate-600 rounded-full hover:bg-white/50"
        aria-label={t("dismiss")}
      >
        <X className="w-4 h-4" />
      </button>

      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center">
          <Shield className="w-4 h-4 text-emerald-600" />
        </div>
        <div>
          <h3 className="font-semibold text-slate-900">
            {t("tripConfirmedTitle")}
          </h3>
          <p className="text-sm text-slate-600">{t("tripConfirmedSubtitle")}</p>
        </div>
      </div>

      {/* Service Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* eSIM Card */}
        <div className="bg-white rounded-lg p-3 border border-slate-200">
          <div className="flex items-center gap-2 mb-2">
            <Smartphone className="w-5 h-5 text-blue-600" />
            <span className="font-medium text-slate-900">{t("esimTitle")}</span>
          </div>
          <p className="text-sm text-slate-600 mb-3">{t("esimDescription")}</p>
          <div className="flex gap-2">
            <a
              href={yesimLink}
              target="_blank"
              rel="noopener noreferrer sponsored"
              onClick={() => handleServiceClick("yesim", yesimLink)}
              className="flex-1 text-center px-3 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
            >
              Yesim
            </a>
            <a
              href={sailyLink}
              target="_blank"
              rel="noopener noreferrer sponsored"
              onClick={() => handleServiceClick("saily", sailyLink)}
              className="flex-1 text-center px-3 py-2 bg-slate-100 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-200 transition-colors"
            >
              Saily
            </a>
          </div>
        </div>

        {/* Flight Compensation Card */}
        <div className="bg-white rounded-lg p-3 border border-slate-200">
          <div className="flex items-center gap-2 mb-2">
            <Plane className="w-5 h-5 text-orange-600" />
            <span className="font-medium text-slate-900">
              {t("flightIssuesTitle")}
            </span>
          </div>
          <p className="text-sm text-slate-600 mb-3">
            {t("flightIssuesDescription")}
          </p>
          <a
            href={airHelpLink}
            target="_blank"
            rel="noopener noreferrer sponsored"
            onClick={() => handleServiceClick("airhelp", airHelpLink)}
            className="block text-center px-3 py-2 bg-orange-100 text-orange-700 text-sm font-medium rounded-lg hover:bg-orange-200 transition-colors"
          >
            {t("checkAirHelp")}
          </a>
        </div>
      </div>

      {/* Disclosure */}
      <p className="text-xs text-slate-500 mt-3 text-center">
        {t("affiliateDisclosure")}
      </p>
    </div>
  );
}
