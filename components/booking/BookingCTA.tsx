"use client";

import { useTranslations } from "next-intl";
import { capture } from "@/lib/posthog";

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

  const handleClick = () => {
    capture("affiliate_link_click", {
      type,
      destination: destination || "unknown",
      trip_id: tripId || "unknown",
      url: href,
    });
  };

  const variantClasses = {
    primary:
      "bg-[var(--primary)] text-white hover:bg-[var(--primary)]/90 shadow-sm",
    secondary:
      "bg-slate-100 text-slate-700 hover:bg-slate-200",
    outline:
      "border border-slate-300 text-slate-700 hover:bg-slate-50",
  };

  const sizeClasses = {
    sm: "px-3 py-1.5 text-sm gap-1.5",
    md: "px-4 py-2 text-sm gap-2",
    lg: "px-5 py-2.5 text-base gap-2",
  };

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer sponsored"
      onClick={handleClick}
      className={`
        inline-flex items-center justify-center rounded-lg font-medium
        transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2
        focus:ring-[var(--primary)]
        ${variantClasses[variant]}
        ${sizeClasses[size]}
        ${className}
      `}
    >
      {ICONS[type]}
      <span>{t(labelKeys[type])}</span>
    </a>
  );
}
