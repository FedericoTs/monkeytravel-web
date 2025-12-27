"use client";

import { useTranslations } from "next-intl";
import { Ticket, ExternalLink } from "lucide-react";
import {
  generateGetYourGuideLink,
  generateKlookLink,
  generateTiqetsLink,
  getBestActivityPartner,
  PARTNERS,
} from "@/lib/affiliates";
import { capture } from "@/lib/posthog";

interface ActivityBookingCTAProps {
  activityName: string;
  destination: string;
  tripId: string;
  activityId?: string;
  /** Show single button or all activity partners */
  variant?: "single" | "dual" | "triple";
  /** Button size */
  size?: "sm" | "md";
  className?: string;
}

type ActivityPartner = "getyourguide" | "klook" | "tiqets";

export default function ActivityBookingCTA({
  activityName,
  destination,
  tripId,
  activityId,
  variant = "single",
  size = "sm",
  className = "",
}: ActivityBookingCTAProps) {
  const t = useTranslations("common.booking");

  // Generate links
  const getYourGuideLink = generateGetYourGuideLink({ destination, activityName });
  const klookLink = generateKlookLink({ destination, activityName });
  const tiqetsLink = generateTiqetsLink({ destination, activityName });
  const bestPartner = getBestActivityPartner(destination);

  const handleClick = (partner: ActivityPartner, url: string) => {
    capture("activity_booking_click", {
      partner,
      partner_name: PARTNERS[partner].name,
      activity_name: activityName,
      activity_id: activityId,
      destination,
      trip_id: tripId,
    });
  };

  const getPartnerLink = (partner: ActivityPartner): string => {
    switch (partner) {
      case "getyourguide":
        return getYourGuideLink;
      case "klook":
        return klookLink;
      case "tiqets":
        return tiqetsLink;
    }
  };

  const sizeClasses = {
    sm: "px-2.5 py-1.5 text-xs gap-1",
    md: "px-3 py-2 text-sm gap-1.5",
  };

  // Single button - shows the best partner
  if (variant === "single") {
    const link = getPartnerLink(bestPartner);
    const partner = bestPartner;

    return (
      <a
        href={link}
        target="_blank"
        rel="noopener noreferrer sponsored"
        onClick={() => handleClick(partner, link)}
        className={`
          inline-flex items-center justify-center rounded-lg font-medium
          bg-[var(--accent)] text-slate-900 hover:bg-[var(--accent)]/90
          transition-colors
          ${sizeClasses[size]}
          ${className}
        `}
      >
        <Ticket className={size === "sm" ? "w-3.5 h-3.5" : "w-4 h-4"} />
        <span>{t("bookNow")}</span>
        <ExternalLink className={size === "sm" ? "w-3 h-3" : "w-3.5 h-3.5"} />
      </a>
    );
  }

  // Dual buttons - show best partner + one alternative
  if (variant === "dual") {
    // For dual, show GetYourGuide and one regional partner (Klook for Asia, Tiqets for Europe)
    const secondaryPartner: ActivityPartner = bestPartner === "klook" ? "klook" : "getyourguide";
    const tertiaryPartner: ActivityPartner = bestPartner === "tiqets" ? "tiqets" : "getyourguide";

    // If best is getyourguide, show klook as secondary
    const showPartners: ActivityPartner[] = bestPartner === "getyourguide"
      ? ["getyourguide", "klook"]
      : [bestPartner, "getyourguide"];

    return (
      <div className={`flex gap-2 ${className}`}>
        {showPartners.map((partner, index) => (
          <a
            key={partner}
            href={getPartnerLink(partner)}
            target="_blank"
            rel="noopener noreferrer sponsored"
            onClick={() => handleClick(partner, getPartnerLink(partner))}
            className={`
              inline-flex items-center justify-center rounded-lg font-medium
              transition-colors
              ${index === 0
                ? "bg-[var(--accent)] text-slate-900 hover:bg-[var(--accent)]/90"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }
              ${sizeClasses[size]}
            `}
          >
            <span>{PARTNERS[partner].icon}</span>
            <span>{partner === "getyourguide" ? "GYG" : PARTNERS[partner].name}</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        ))}
      </div>
    );
  }

  // Triple buttons - show all three partners
  return (
    <div className={`flex gap-2 ${className}`}>
      <a
        href={getYourGuideLink}
        target="_blank"
        rel="noopener noreferrer sponsored"
        onClick={() => handleClick("getyourguide", getYourGuideLink)}
        className={`
          inline-flex items-center justify-center rounded-lg font-medium
          transition-colors
          ${bestPartner === "getyourguide"
            ? "bg-[var(--accent)] text-slate-900 hover:bg-[var(--accent)]/90"
            : "bg-slate-100 text-slate-700 hover:bg-slate-200"
          }
          ${sizeClasses[size]}
        `}
      >
        <span>{PARTNERS.getyourguide.icon}</span>
        <span>GYG</span>
        <ExternalLink className="w-3 h-3" />
      </a>

      <a
        href={klookLink}
        target="_blank"
        rel="noopener noreferrer sponsored"
        onClick={() => handleClick("klook", klookLink)}
        className={`
          inline-flex items-center justify-center rounded-lg font-medium
          transition-colors
          ${bestPartner === "klook"
            ? "bg-[var(--accent)] text-slate-900 hover:bg-[var(--accent)]/90"
            : "bg-slate-100 text-slate-700 hover:bg-slate-200"
          }
          ${sizeClasses[size]}
        `}
      >
        <span>{PARTNERS.klook.icon}</span>
        <span>Klook</span>
        <ExternalLink className="w-3 h-3" />
      </a>

      <a
        href={tiqetsLink}
        target="_blank"
        rel="noopener noreferrer sponsored"
        onClick={() => handleClick("tiqets", tiqetsLink)}
        className={`
          inline-flex items-center justify-center rounded-lg font-medium
          transition-colors
          ${bestPartner === "tiqets"
            ? "bg-[var(--accent)] text-slate-900 hover:bg-[var(--accent)]/90"
            : "bg-slate-100 text-slate-700 hover:bg-slate-200"
          }
          ${sizeClasses[size]}
        `}
      >
        <span>{PARTNERS.tiqets.icon}</span>
        <span>Tiqets</span>
        <ExternalLink className="w-3 h-3" />
      </a>
    </div>
  );
}
