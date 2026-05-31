"use client";

import { useTranslations } from "next-intl";
import { Ticket } from "lucide-react";
import {
  generateGetYourGuideLink,
  generateKlookLink,
  generateTiqetsLink,
  getBestActivityPartner,
  PARTNERS,
} from "@/lib/affiliates";
import PartnerButton from "./PartnerButton";

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

/**
 * Activity-card CTA — now a thin wrapper over PartnerButton.
 *
 * Was the 3rd of 6 divergent affiliate-CTA implementations (each firing
 * a different PostHog event). After consolidation every variant fires
 * the unified `booking_partner_click` event with category="activities"
 * and surface="activity_card". Was ~200 LOC of bespoke button styling;
 * is now ~100 LOC of pure layout.
 */
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
  const links: Record<ActivityPartner, string> = {
    getyourguide: generateGetYourGuideLink({ destination, activityName }),
    klook: generateKlookLink({ destination, activityName }),
    tiqets: generateTiqetsLink({ destination, activityName }),
  };
  const bestPartner = getBestActivityPartner(destination);

  // Single button - shows the best partner with the generic "Book now"
  // label (no partner-specific text — surface keeps the original UX).
  if (variant === "single") {
    return (
      <PartnerButton
        partner={bestPartner}
        href={links[bestPartner]}
        tripId={tripId}
        destination={destination}
        activityName={activityName}
        activityId={activityId}
        category="activities"
        surface="activity_card"
        variant="accent"
        size={size}
        showIcon={false}
        className={className}
      >
        <Ticket className={size === "sm" ? "w-3.5 h-3.5 mr-1" : "w-4 h-4 mr-1.5"} />
        {t("bookNow")}
      </PartnerButton>
    );
  }

  // Dual/triple — render N PartnerButton instances. Determine partner
  // order: best partner first, others after.
  const showPartners: ActivityPartner[] =
    variant === "dual"
      ? bestPartner === "getyourguide"
        ? ["getyourguide", "klook"]
        : [bestPartner, "getyourguide"]
      : ["getyourguide", "klook", "tiqets"];

  return (
    <div className={`flex gap-2 ${className}`}>
      {showPartners.map((partner) => {
        const isBest = partner === bestPartner;
        return (
          <PartnerButton
            key={partner}
            partner={partner}
            href={links[partner]}
            tripId={tripId}
            destination={destination}
            activityName={activityName}
            activityId={activityId}
            category="activities"
            surface="activity_card"
            variant={isBest ? "accent" : "secondary"}
            size={size}
            showIcon
            showExternal={false}
          >
            {partner === "getyourguide" ? "GYG" : PARTNERS[partner].name}
          </PartnerButton>
        );
      })}
    </div>
  );
}
