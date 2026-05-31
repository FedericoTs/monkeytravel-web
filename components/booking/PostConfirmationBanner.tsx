"use client";

import { useTranslations } from "next-intl";
import { X, Smartphone, Plane, Shield, Ticket } from "lucide-react";
import { useState } from "react";
import {
  generateYesimLink,
  generateSailyLink,
  generateAirHelpLink,
  generateGetYourGuideLink,
} from "@/lib/affiliates";
import { capture } from "@/lib/posthog";
import PartnerButton from "./PartnerButton";

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
  const getYourGuideLink = generateGetYourGuideLink({ destination });

  const handleDismiss = () => {
    setIsDismissed(true);
    capture("post_confirmation_banner_dismissed", { trip_id: tripId });
  };

  // Per-partner brand colours preserved from the original design — passed
  // through the PartnerButton `variant="custom"` escape hatch so analytics
  // still unify under booking_partner_click while the look stays the same.
  const ctaBase =
    "inline-flex items-center justify-center w-full text-center px-3 py-2 text-sm font-medium rounded-lg transition-colors";

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
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* Activities Card - GetYourGuide */}
        <div className="bg-white rounded-lg p-3 border border-slate-200">
          <div className="flex items-center gap-2 mb-2">
            <Ticket className="w-5 h-5 text-purple-600" />
            <span className="font-medium text-slate-900">{t("activitiesTitle")}</span>
          </div>
          <p className="text-sm text-slate-600 mb-3">{t("activitiesDescription")}</p>
          <PartnerButton
            partner="getyourguide"
            href={getYourGuideLink}
            tripId={tripId}
            destination={destination}
            category="post_confirmation"
            surface="confirmation_banner"
            variant="custom"
            showIcon={false}
            showExternal={false}
            className={`${ctaBase} bg-purple-600 text-white hover:bg-purple-700`}
          >
            GetYourGuide
          </PartnerButton>
        </div>

        {/* eSIM Card */}
        <div className="bg-white rounded-lg p-3 border border-slate-200">
          <div className="flex items-center gap-2 mb-2">
            <Smartphone className="w-5 h-5 text-blue-600" />
            <span className="font-medium text-slate-900">{t("esimTitle")}</span>
          </div>
          <p className="text-sm text-slate-600 mb-3">{t("esimDescription")}</p>
          <div className="flex gap-2">
            <PartnerButton
              partner="yesim"
              href={yesimLink}
              tripId={tripId}
              destination={destination}
              category="post_confirmation"
              surface="confirmation_banner"
              variant="custom"
              showIcon={false}
              showExternal={false}
              className={`${ctaBase} flex-1 bg-blue-600 text-white hover:bg-blue-700`}
            >
              Yesim
            </PartnerButton>
            <PartnerButton
              partner="saily"
              href={sailyLink}
              tripId={tripId}
              destination={destination}
              category="post_confirmation"
              surface="confirmation_banner"
              variant="custom"
              showIcon={false}
              showExternal={false}
              className={`${ctaBase} flex-1 bg-slate-100 text-slate-700 hover:bg-slate-200`}
            >
              Saily
            </PartnerButton>
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
          <PartnerButton
            partner="airhelp"
            href={airHelpLink}
            tripId={tripId}
            destination={destination}
            category="post_confirmation"
            surface="confirmation_banner"
            variant="custom"
            showIcon={false}
            showExternal={false}
            className={`${ctaBase} bg-orange-100 text-orange-700 hover:bg-orange-200`}
          >
            {t("checkAirHelp")}
          </PartnerButton>
        </div>
      </div>

      {/* Disclosure */}
      <p className="text-xs text-slate-500 mt-3 text-center">
        {t("affiliateDisclosure")}
      </p>
    </div>
  );
}
