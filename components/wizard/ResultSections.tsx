"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { usePaceLabel } from "@/lib/i18n/pace";
import { useCurrency } from "@/lib/locale";
import { inPlanCurrency, planCosts } from "@/lib/ai/assistant/plan-costs";
import type { BookingLink, GeneratedItinerary } from "@/types";

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
  const { convert, exchangeRates } = useCurrency();
  // The plan's own stops, per person, as the trip page shows them: each in
  // the plan's currency first, at the page's rates.
  const sameCurrency = inPlanCurrency(itinerary.days, exchangeRates, itinerary.trip_summary.currency || "USD");
  const total = sameCurrency ? planCosts(sameCurrency) : null;
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
      <Stat label={t("wizard.result.duration")}>{t("wizard.result.days", { count: itinerary.days.length })}</Stat>
      {total && <Stat label={t("wizard.result.estBudget")}>{convert(total.total, total.currency).formatted}</Stat>}
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
