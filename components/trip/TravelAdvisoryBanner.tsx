"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, ExternalLink, Info, ShieldAlert } from "lucide-react";
import { openExternal } from "@/lib/native/external-link";

/**
 * Per-trip advisory banner.
 *
 * Fetches the FCDO travel advisory for the trip's destination country
 * once on mount, then renders a color-coded callout. Hides itself entirely
 * when:
 *   - The country isn't tracked by the source (FCDO unknown slug)
 *   - The fetch errors
 *   - Level is "low" (no alerts) — the banner only shows when there's
 *     something the traveler needs to read
 *
 * Why client-fetched instead of pre-rendered? Two reasons:
 *   - Keeps the trip-page payload small and the LCP fast — the advisory
 *     is informational, not blocking content.
 *   - Lets the Vercel CDN serve the /api/advisories response shared
 *     across all viewers of a popular destination, instead of bundling
 *     it into the per-user trip page render.
 *
 * Privacy: the country name is the only thing we send to the API route.
 * No trip id, no user id, no PII.
 */
interface TravelAdvisoryBannerProps {
  /** Destination country name as stored on the trip. */
  country: string;
  /** Optional className for layout integration. */
  className?: string;
}

interface AdvisoryShape {
  source: "fcdo";
  sourceCountry: "GB";
  countryName: string;
  level: "low" | "advisory" | "high" | "extreme";
  summary: string;
  url: string;
  updatedAt: string;
}

export default function TravelAdvisoryBanner({
  country,
  className = "",
}: TravelAdvisoryBannerProps) {
  const t = useTranslations("common.advisory");
  const [advisory, setAdvisory] = useState<AdvisoryShape | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    const cleaned = country.trim();
    if (!cleaned) {
      setLoaded(true);
      return;
    }
    fetch(`/api/advisories/${encodeURIComponent(cleaned)}`, {
      signal: ctrl.signal,
    })
      .then((r) => (r.ok ? r.json() : { advisory: null }))
      .then((data: { advisory: AdvisoryShape | null }) => {
        setAdvisory(data.advisory);
        setLoaded(true);
      })
      .catch((err) => {
        // AbortError is expected on cleanup — swallow it.
        if (err instanceof Error && err.name !== "AbortError") {
          console.warn("[TravelAdvisoryBanner] fetch failed", err.message);
        }
        setLoaded(true);
      });
    return () => ctrl.abort();
  }, [country]);

  // Hide entirely when:
  //   - Still loading (don't flash empty banner)
  //   - No advisory available
  //   - level === "low" (no actionable warning — banner would be noise)
  if (!loaded || !advisory || advisory.level === "low") return null;

  const config = LEVEL_CONFIG[advisory.level];
  const Icon = config.icon;

  return (
    <div
      role="alert"
      className={`flex items-start gap-3 rounded-xl border ${config.border} ${config.bg} p-4 ${className}`}
    >
      <Icon
        className={`w-5 h-5 flex-shrink-0 ${config.iconColor} mt-0.5`}
        aria-hidden="true"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center flex-wrap gap-2 mb-1">
          <h3 className={`text-sm font-semibold ${config.title}`}>
            {t(`level.${advisory.level}`)}
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
              date: formatDate(advisory.updatedAt),
            })}
          </span>
        </div>
      </div>
    </div>
  );
}

const LEVEL_CONFIG: Record<
  Exclude<AdvisoryShape["level"], "low">,
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

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}
