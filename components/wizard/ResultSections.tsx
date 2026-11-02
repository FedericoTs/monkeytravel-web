"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useActivityTypeLabel } from "@/lib/i18n/activity-type";
import { usePaceLabel } from "@/lib/i18n/pace";
import { useCurrency } from "@/lib/locale";
import type { Activity, BookingLink, GeneratedItinerary } from "@/types";

// Sections of the wizard's result view that only render the generated
// itinerary.

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="text-sm text-slate-500">{label}</div>
      <div className="font-semibold text-xl text-slate-900">{children}</div>
    </div>
  );
}

/** The trip's length, estimated budget, activity count and pace. */
export function ResultStats({ itinerary, pace }: { itinerary: GeneratedItinerary; pace: string }) {
  const t = useTranslations("trips");
  const paceLabel = usePaceLabel();
  const { convert } = useCurrency();
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
      <Stat label={t("wizard.result.duration")}>{t("wizard.result.days", { count: itinerary.days.length })}</Stat>
      <Stat label={t("wizard.result.estBudget")}>
        {convert(itinerary.trip_summary.total_estimated_cost, itinerary.trip_summary.currency).formatted}
      </Stat>
      <Stat label={t("wizard.result.activities")}>
        {itinerary.days.reduce((acc, day) => acc + day.activities.length, 0)}
      </Stat>
      <Stat label={t("wizard.result.pace")}>{paceLabel(pace)}</Stat>
    </div>
  );
}

function LinkColumn({ title, links, label }: { title: string; links: BookingLink[]; label: (link: BookingLink) => string }) {
  return (
    <div>
      <div className="text-sm font-medium text-amber-800 mb-3">{title}</div>
      <div className="flex flex-wrap gap-2">
        {links.map((link) => (
          <a
            key={link.url}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2 bg-white border border-amber-200 rounded-lg text-sm text-amber-900 hover:bg-amber-50 hover:border-amber-300 transition-colors shadow-sm"
          >
            {label(link)} ↗
          </a>
        ))}
      </div>
    </div>
  );
}

/** Where to book the trip's flights and hotels; a hotel names its city on a multi-city trip. */
export function ResultBookingLinks({ links }: { links: NonNullable<GeneratedItinerary["booking_links"]> }) {
  const t = useTranslations("trips");
  return (
    <div className="bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-xl p-6 mb-8">
      <h3 className="font-semibold text-amber-900 mb-4 flex items-center gap-2">
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        {t("wizard.result.bookYourTravel")}
      </h3>
      <div className="grid md:grid-cols-2 gap-6">
        <LinkColumn title={t("wizard.result.flights")} links={links.flights} label={(link) => link.provider} />
        <LinkColumn
          title={t("wizard.result.hotels")}
          links={links.hotels}
          label={(link) => (link.city ? `${link.provider} · ${link.city}` : link.provider)}
        />
      </div>
    </div>
  );
}

/**
 * A day's activities as a compact rail of time, name, place and price: no
 * images, so it skims faster than the cards. Each row carries the activity's
 * DOM id, which a map pin's "View details" scrolls to.
 */
export function ResultTimeline({ activities, currency }: { activities: Activity[]; currency: string }) {
  const t = useTranslations("trips");
  const typeLabel = useActivityTypeLabel();
  const { convert } = useCurrency();
  return (
    <div className="relative pl-8 border-l-2 border-slate-200 space-y-2">
      {activities.map((activity, idx) => {
        const activityDomId = activity.id
          ? `activity-${activity.id}`
          : `activity-${(activity.name || "unknown")
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "-")
              .slice(0, 60)}`;
        return (
          <div key={activity.id || idx} id={activityDomId} className="relative scroll-mt-24">
            <div className="absolute -left-[25px] w-4 h-4 rounded-full bg-[var(--primary)] border-4 border-white shadow" />
            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 text-sm text-slate-500 mb-1">
                    <span className="font-medium">{activity.start_time}</span>
                    {activity.duration_minutes && (
                      <>
                        <span>·</span>
                        <span>{activity.duration_minutes} min</span>
                      </>
                    )}
                  </div>
                  <h4 className="font-semibold text-slate-900">
                    {activity.locked && (
                      <span className="mr-1" title={t("wizard.anchors.lockedBadge")} aria-label={t("wizard.anchors.lockedBadge")}>
                        📌
                      </span>
                    )}
                    {activity.name}
                  </h4>
                  {activity.description && <p className="text-sm text-slate-600 mt-1 line-clamp-2">{activity.description}</p>}
                  {(activity.address || activity.location) && (
                    <div className="flex items-center gap-1.5 mt-2 text-xs text-slate-500">
                      <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
                        />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      <span className="truncate">{activity.address || activity.location}</span>
                    </div>
                  )}
                </div>
                {activity.estimated_cost?.amount != null && (
                  <div className="text-right shrink-0">
                    <div className="font-medium text-slate-900 text-sm">
                      {convert(activity.estimated_cost.amount, activity.estimated_cost.currency || currency).formatted}
                    </div>
                    <span className="text-xs text-slate-500 capitalize">{typeLabel(activity.type)}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** What the plan suggests packing. */
export function ResultPacking({ items }: { items: string[] }) {
  const t = useTranslations("trips");
  return (
    <div className="mt-10 bg-slate-50 rounded-xl p-6">
      <h3 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
        </svg>
        {t("wizard.result.packingSuggestions")}
      </h3>
      <div className="flex flex-wrap gap-2">
        {items.map((item) => (
          <span key={item} className="px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-700 shadow-sm">
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}
