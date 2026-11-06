"use client";

import { useTranslations } from "next-intl";
import { capture } from "@/lib/posthog";
import { dayRouteMapsUrl } from "@/lib/trips/maps-links";

/**
 * Opens a day's stops as directions in Google Maps, where people already
 * navigate. Nothing shows for a day with fewer than two stops.
 */
export function DayRouteLink({
  activities,
  surface,
  className = "",
}: {
  activities: Parameters<typeof dayRouteMapsUrl>[0];
  /** Which page it's on, for the click's event. */
  surface: "result" | "trip" | "shared" | "today" | "day";
  className?: string;
}) {
  const t = useTranslations("trips");
  const url = dayRouteMapsUrl(activities);
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => void capture("day_route_opened", { surface })}
      className={`inline-flex min-h-[44px] items-center gap-1.5 text-sm font-medium text-[var(--secondary-ink)] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--secondary-ink)] ${className}`}
    >
      <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
      </svg>
      {t("day.route")}
    </a>
  );
}
