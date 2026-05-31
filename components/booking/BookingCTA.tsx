"use client";

import { useTranslations } from "next-intl";
import PartnerButton from "./PartnerButton";

export type BookingType =
  | "flight"
  | "hotel"
  | "car"
  | "activity"
  | "train"
  | "transfer";

interface BookingCTAProps {
  type: BookingType;
  href: string;
  destination?: string;
  tripId?: string;
  className?: string;
  variant?: "primary" | "secondary" | "outline";
  size?: "sm" | "md" | "lg";
}

const ICONS: Record<BookingType, React.ReactNode> = {
  flight: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
      />
    </svg>
  ),
  hotel: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
      />
    </svg>
  ),
  car: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M8 7h8m-4 0v10m-8-5h16M5 17h14a2 2 0 002-2V9a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2z"
      />
    </svg>
  ),
  activity: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z"
      />
    </svg>
  ),
  train: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
      />
    </svg>
  ),
  transfer: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
      />
    </svg>
  ),
};

// Map the legacy "type" prop onto unified category / partner-name slots
// so the legacy BookingPanel (behind FLAG_ENHANCED_BOOKING) still fires
// the same booking_partner_click event as every other surface. Once the
// flag is fully rolled out this whole file can be deleted.
const TYPE_TO_CATEGORY: Record<BookingType, string> = {
  flight: "flights",
  hotel: "hotels",
  car: "car_rental",
  activity: "activities",
  train: "transport",
  transfer: "transport",
};

const TYPE_TO_PARTNER_NAME: Record<BookingType, string> = {
  flight: "Flights (legacy panel)",
  hotel: "Hotels (legacy panel)",
  car: "Car rental (legacy panel)",
  activity: "Activities (legacy panel)",
  train: "Trains (legacy panel)",
  transfer: "Transfers (legacy panel)",
};

/**
 * Legacy BookingPanel CTA — now a thin wrapper over PartnerButton so the
 * pre-FLAG_ENHANCED_BOOKING surface fires the same unified
 * `booking_partner_click` event as the post-flag surface. Previously
 * fired `affiliate_link_click` (orphan event name) and lost partner
 * identity entirely. Delete this component when BookingPanel is retired
 * with the flag.
 */
export default function BookingCTA({
  type,
  href,
  destination,
  tripId,
  className = "",
  variant = "primary",
  size = "md",
}: BookingCTAProps) {
  const t = useTranslations("common.booking");

  const labelKeys: Record<BookingType, string> = {
    flight: "bookFlight",
    hotel: "bookHotel",
    car: "bookCar",
    activity: "bookActivity",
    train: "bookTrain",
    transfer: "bookTransfer",
  };

  return (
    <PartnerButton
      partner="other"
      href={href}
      tripId={tripId}
      destination={destination}
      partnerName={TYPE_TO_PARTNER_NAME[type]}
      category={TYPE_TO_CATEGORY[type]}
      surface="legacy_panel"
      variant={variant}
      size={size}
      showIcon={false}
      showExternal={false}
      className={className}
      extraEventProps={{ legacy_type: type }}
    >
      {ICONS[type]}
      <span className="ml-2">{t(labelKeys[type])}</span>
    </PartnerButton>
  );
}
