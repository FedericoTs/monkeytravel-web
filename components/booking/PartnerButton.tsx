"use client";

import type { MouseEvent, ReactNode } from "react";
import { PARTNERS, type PartnerKey, type PartnerCategory } from "@/lib/affiliates";
import { openExternal } from "@/lib/native/external-link";
import { capture } from "@/lib/posthog";
import { ExternalLink } from "lucide-react";

/**
 * Canonical affiliate/partner CTA button.
 *
 * One event, one DOM shape, every surface — replaces the 6 divergent
 * affiliate CTA implementations that previously each fired their own
 * PostHog event name (booking_partner_click vs affiliate_link_click vs
 * activity_booking_click vs post_confirmation_service_click vs
 * backpacker_hostel_cta_clicked vs no event at all). A single
 * `booking_partner_click` event is now emitted from every surface, so a
 * trip-viewed → partner-clicked funnel is finally answerable in PostHog.
 *
 * Renders a real <a href target="_blank" rel="sponsored noopener nofollow">
 * — mirrors ExternalLinkButton (`components/tools/ExternalLinkButton.tsx`):
 *   - Google sees the rel attribute on every affiliate link (manual-action
 *     defence for `sponsored`/`nofollow`). The old `data-rel` attribute
 *     was invisible to crawlers.
 *   - Middle-click / cmd-click / ctrl-click / "open in new tab" /
 *     "copy link" all work as users expect.
 *   - Screen readers announce it as a link.
 *
 * The onClick handler:
 *   1. Fires the PostHog event FIRST (before navigation) so the event
 *      ships even if the browser is slow to open the new tab.
 *   2. Bails out for modifier-clicks / non-primary buttons so the browser
 *      default fires (new tab/window, download, etc.).
 *   3. Inside the Capacitor mobile shell intercepts the navigation and
 *      routes through openExternal() — target="_blank" is silently
 *      swallowed by the iOS WKWebView. In a regular browser we let the
 *      native <a> navigate so middle-click/modifier-click semantics keep
 *      working.
 */

type PartnerSurface =
  | "trip_detail_panel"
  | "activity_card"
  | "confirmation_banner"
  | "provider_tiles"
  | "visa_checker"
  | "backpacker_landing"
  | "legacy_panel"
  | "other";

interface PartnerButtonProps {
  /** PartnerKey from PARTNERS registry, or "other" for one-off providers
   * (e.g. Gemini-generated Google Flights / Skyscanner tiles). */
  partner: PartnerKey | "other";
  href: string;
  tripId?: string;
  destination?: string;
  activityName?: string;
  activityId?: string;
  /** Where this CTA renders — used in PostHog for funnel break-downs. */
  surface?: PartnerSurface;
  /** Override the partner name (required when partner="other"). */
  partnerName?: string;
  /** Override the partner category (defaults to PARTNERS[partner].category). */
  category?: PartnerCategory | "post_confirmation" | "legacy_panel" | string;
  /** For the EnhancedBookingPanel's primary/secondary highlight. */
  isPrimary?: boolean;
  variant?: "primary" | "secondary" | "outline" | "ghost" | "accent" | "custom";
  size?: "sm" | "md" | "lg";
  showIcon?: boolean;
  showExternal?: boolean;
  /** Override the rel attribute. Defaults to "sponsored noopener nofollow"
   * — the canonical Google-visible disclosure for affiliate outbound. */
  rel?: string;
  /** Override the aria-label. Defaults to `${partner_name} (opens external site)`. */
  ariaLabel?: string;
  className?: string;
  children?: ReactNode;
  /** Optional extra props merged into the PostHog payload. */
  extraEventProps?: Record<string, unknown>;
  /** Optional side-effect run BEFORE PostHog capture + navigation.
   * Use for first-party click logs (e.g. /api/affiliates/hostelworld/click)
   * that need to fire alongside the unified PostHog event. Must be
   * fire-and-forget — return value is ignored, exceptions are swallowed
   * so instrumentation never blocks navigation. */
  onBeforeNavigate?: () => void;
}

export default function PartnerButton({
  partner,
  href,
  tripId,
  destination,
  activityName,
  activityId,
  surface,
  partnerName,
  category,
  isPrimary,
  variant = "secondary",
  size = "md",
  showIcon = true,
  showExternal = true,
  rel,
  ariaLabel,
  className = "",
  children,
  extraEventProps,
  onBeforeNavigate,
}: PartnerButtonProps) {
  // Look up registered partner config when available. Unknown providers
  // (TripBookingLinks tiles emitted by Gemini) pass partner="other" and
  // must supply partnerName + category explicitly.
  const config = partner !== "other" ? PARTNERS[partner] : undefined;
  const resolvedName = partnerName ?? config?.name ?? partner;
  const resolvedCategory = category ?? config?.category ?? "unknown";
  const resolvedIcon = config?.icon;

  const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
    // Caller-supplied side-effect (e.g. first-party server click log).
    // Swallow exceptions so a logging failure never blocks navigation.
    if (onBeforeNavigate) {
      try {
        onBeforeNavigate();
      } catch {
        // best-effort
      }
    }

    // Fire analytics first — same order as ExternalLinkButton. Swallow
    // any PostHog error; never let instrumentation block the navigation.
    try {
      void capture("booking_partner_click", {
        partner,
        partner_name: resolvedName,
        category: resolvedCategory,
        destination: destination ?? "unknown",
        activity_name: activityName,
        activity_id: activityId,
        trip_id: tripId ?? "unknown",
        url: href,
        surface,
        is_primary: isPrimary,
        ...extraEventProps,
      });
    } catch {
      // best-effort
    }

    // Defer to the browser default for modifier-clicks / non-primary
    // buttons so users can middle-click into a new tab, etc.
    if (
      e.defaultPrevented ||
      e.button !== 0 ||
      e.metaKey ||
      e.ctrlKey ||
      e.shiftKey ||
      e.altKey
    ) {
      return;
    }

    // Only intercept the navigation inside the Capacitor mobile shell,
    // where target="_blank" is silently swallowed by the iOS WKWebView.
    const cap = (
      window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }
    ).Capacitor;

    if (cap?.isNativePlatform?.()) {
      e.preventDefault();
      void openExternal(href);
    }
    // Otherwise: do nothing, let the <a target="_blank"> navigate.
  };

  // Variant styles. `custom` skips all variant styling so callers can
  // pass arbitrary classes via className (used by PostConfirmationBanner
  // for its per-partner brand-color buttons).
  const variantClasses: Record<NonNullable<PartnerButtonProps["variant"]>, string> = {
    primary:
      "bg-[var(--primary)] text-white hover:bg-[var(--primary)]/90 shadow-sm",
    secondary: "bg-slate-100 text-slate-700 hover:bg-slate-200",
    outline: "border border-slate-300 text-slate-700 hover:bg-slate-50",
    ghost: "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
    accent: "bg-[var(--accent)] text-slate-900 hover:bg-[var(--accent)]/90",
    custom: "",
  };

  const sizeClasses: Record<NonNullable<PartnerButtonProps["size"]>, string> = {
    sm: "px-3 py-1.5 text-sm gap-1.5",
    md: "px-4 py-2 text-sm gap-2",
    lg: "px-5 py-2.5 text-base gap-2",
  };

  // Common base classes — only applied when not in "custom" mode so the
  // caller can override layout/colour wholesale.
  const baseClasses =
    variant === "custom"
      ? className
      : `inline-flex items-center justify-center rounded-lg font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[var(--primary)] ${variantClasses[variant]} ${sizeClasses[size]} ${className}`;

  return (
    <a
      href={href}
      target="_blank"
      rel={rel ?? "sponsored noopener nofollow"}
      onClick={handleClick}
      data-partner={partner}
      data-partner-href={href}
      aria-label={ariaLabel ?? `${resolvedName} (opens external site)`}
      className={baseClasses}
    >
      {showIcon && resolvedIcon && <span className="text-base">{resolvedIcon}</span>}
      <span>{children ?? resolvedName}</span>
      {showExternal && <ExternalLink className="w-3.5 h-3.5 opacity-60" />}
    </a>
  );
}
