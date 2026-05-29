"use client";

import { PARTNERS, type PartnerKey } from "@/lib/affiliates";
import { openExternal } from "@/lib/native/external-link";
import { capture } from "@/lib/posthog";
import { ExternalLink } from "lucide-react";

interface PartnerButtonProps {
  partner: PartnerKey;
  href: string;
  tripId?: string;
  destination?: string;
  activityName?: string;
  variant?: "primary" | "secondary" | "outline" | "ghost";
  size?: "sm" | "md" | "lg";
  showIcon?: boolean;
  showExternal?: boolean;
  className?: string;
  children?: React.ReactNode;
}

export default function PartnerButton({
  partner,
  href,
  tripId,
  destination,
  activityName,
  variant = "secondary",
  size = "md",
  showIcon = true,
  showExternal = true,
  className = "",
  children,
}: PartnerButtonProps) {
  const config = PARTNERS[partner];

  // Switched from <a target="_blank"> to <button> + openExternal() so
  // the CTA actually opens inside the Capacitor WebView (target="_blank"
  // is silently swallowed on iOS). Tracking still fires first — same
  // order as the old anchor onClick — and the data-* attrs preserve
  // the rel="sponsored" / aria signal for downstream tooling.
  const handleClick = () => {
    capture("booking_partner_click", {
      partner,
      partner_name: config.name,
      category: config.category,
      destination: destination || "unknown",
      activity_name: activityName,
      trip_id: tripId || "unknown",
      url: href,
    });
    openExternal(href);
  };

  const variantClasses = {
    primary:
      "bg-[var(--primary)] text-white hover:bg-[var(--primary)]/90 shadow-sm",
    secondary: "bg-slate-100 text-slate-700 hover:bg-slate-200",
    outline: "border border-slate-300 text-slate-700 hover:bg-slate-50",
    ghost: "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
  };

  const sizeClasses = {
    sm: "px-3 py-1.5 text-sm gap-1.5",
    md: "px-4 py-2 text-sm gap-2",
    lg: "px-5 py-2.5 text-base gap-2",
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      data-partner={partner}
      data-partner-href={href}
      data-rel="sponsored noopener noreferrer"
      aria-label={`${config.name} (opens external site)`}
      className={`
        inline-flex items-center justify-center rounded-lg font-medium
        transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2
        focus:ring-[var(--primary)]
        ${variantClasses[variant]}
        ${sizeClasses[size]}
        ${className}
      `}
    >
      {showIcon && <span className="text-base">{config.icon}</span>}
      <span>{children || config.name}</span>
      {showExternal && <ExternalLink className="w-3.5 h-3.5 opacity-60" />}
    </button>
  );
}
