"use client";

import { useLocale, useTranslations } from "next-intl";
import { AlertTriangle, ExternalLink, Info, ShieldAlert } from "lucide-react";
import { openExternal } from "@/lib/native/external-link";
import type { TravelAdvisory } from "@/lib/advisories/fcdo";

/**
 * The UK's travel advice for the trip's country (FCDO, read through
 * /api/advisories by useTravelAdvisory): what it advises, in its own terms,
 * and the way to the full advice. It is the card of the trip page's "Travel
 * advice" chip, or, for advice that covers the whole country, a card above the
 * plan (`urgent`), the one place it is an alert.
 */
export default function TravelAdvisoryBanner({
  advisory,
  urgent = false,
  className = "",
}: {
  advisory: TravelAdvisory;
  urgent?: boolean;
  className?: string;
}) {
  const t = useTranslations("common.advisory");
  const locale = useLocale();

  if (advisory.level === "low") return null;

  const config = LEVEL_CONFIG[advisory.level];
  const Icon = config.icon;

  return (
    <div
      role={urgent ? "alert" : undefined}
      className={`flex items-start gap-3 rounded-xl border ${config.border} ${config.bg} p-4 ${className}`}
    >
      <Icon
        className={`w-5 h-5 flex-shrink-0 ${config.iconColor} mt-0.5`}
        aria-hidden="true"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center flex-wrap gap-2 mb-1">
          <h3 className={`text-sm font-semibold ${config.title}`}>
            {t(`advice.${advisory.advice ?? "other"}`)}
          </h3>
          <span
            className={`text-xs ${config.subtitle}`}
            title={t("sourceLabel", { source: "FCDO" })}
          >
            · {t("sourceLabel", { source: "UK FCDO" })}
          </span>
        </div>
        <p className={`text-sm ${config.body} leading-relaxed`}>
          {advisory.summary}
        </p>
        <div className="mt-2 flex items-center gap-3 text-xs">
          <button
            type="button"
            onClick={() => openExternal(advisory.url)}
            className={`inline-flex items-center gap-1 font-medium ${config.link} hover:underline`}
          >
            {t("readFullAdvisory")}
            <ExternalLink className="w-3 h-3" aria-hidden="true" />
          </button>
          <span className={`${config.subtitle}`}>
            {t("lastUpdated", {
              date: formatDate(advisory.updatedAt, locale),
            })}
          </span>
        </div>
      </div>
    </div>
  );
}

const LEVEL_CONFIG: Record<
  Exclude<TravelAdvisory["level"], "low">,
  {
    icon: typeof Info;
    iconColor: string;
    bg: string;
    border: string;
    title: string;
    subtitle: string;
    body: string;
    link: string;
  }
> = {
  advisory: {
    icon: Info,
    iconColor: "text-amber-600",
    bg: "bg-amber-50",
    border: "border-amber-200",
    title: "text-amber-900",
    subtitle: "text-amber-700",
    body: "text-amber-800",
    link: "text-amber-900",
  },
  high: {
    icon: AlertTriangle,
    iconColor: "text-orange-600",
    bg: "bg-orange-50",
    border: "border-orange-200",
    title: "text-orange-900",
    subtitle: "text-orange-700",
    body: "text-orange-800",
    link: "text-orange-900",
  },
  extreme: {
    icon: ShieldAlert,
    iconColor: "text-red-600",
    bg: "bg-red-50",
    border: "border-red-200",
    title: "text-red-900",
    subtitle: "text-red-700",
    body: "text-red-800",
    link: "text-red-900",
  },
};

function formatDate(iso: string, locale: string): string {
  try {
    return new Date(iso).toLocaleDateString(locale, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}
