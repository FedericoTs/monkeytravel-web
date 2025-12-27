"use client";

import { useTranslations } from "next-intl";
import { Ticket, ExternalLink } from "lucide-react";
import {
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
  /** Show single button or both Klook and Tiqets */
  variant?: "single" | "dual";
  /** Button size */
  size?: "sm" | "md";
  className?: string;
}

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
  const klookLink = generateKlookLink({ destination, activityName });
  const tiqetsLink = generateTiqetsLink({ destination, activityName });
  const bestPartner = getBestActivityPartner(destination);

  const handleClick = (partner: "klook" | "tiqets", url: string) => {
    capture("activity_booking_click", {
      partner,
      partner_name: PARTNERS[partner].name,
      activity_name: activityName,
      activity_id: activityId,
      destination,
      trip_id: tripId,
    });
  };

  const sizeClasses = {
    sm: "px-2.5 py-1.5 text-xs gap-1",
    md: "px-3 py-2 text-sm gap-1.5",
  };

  // Single button - shows the best partner
  if (variant === "single") {
    const link = bestPartner === "klook" ? klookLink : tiqetsLink;
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

  // Dual buttons - show both Klook and Tiqets
  return (
    <div className={`flex gap-2 ${className}`}>
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
