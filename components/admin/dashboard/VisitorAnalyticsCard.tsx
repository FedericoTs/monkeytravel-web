"use client";

import { useState } from "react";
import type { AdminStats } from "@/lib/admin/stats/types";
import { flagEmoji } from "@/lib/utils/flag-emoji";

// ===========================================================================
// Visitor Analytics — tabbed on mobile, 3-up on desktop
// ===========================================================================

export function VisitorAnalyticsCard({ geo }: { geo: AdminStats["geo"] }) {
  const [tab, setTab] = useState<"pages" | "countries" | "cities">("pages");

  if (geo.totalPageViews === 0) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <h2 className="text-base sm:text-lg font-semibold text-[var(--foreground)] mb-2">
          Visitor Analytics
        </h2>
        <div className="text-center py-10 text-slate-500">
          <p>No page view data yet</p>
          <p className="text-xs mt-1">Data appears once the site receives traffic</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
      <div className="p-5 sm:p-6 border-b border-slate-100">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-base sm:text-lg font-semibold text-[var(--foreground)]">
              Visitor Analytics
            </h2>
            <p className="text-[11px] sm:text-xs text-slate-500 mt-1">
              {geo.totalPageViews.toLocaleString()} views · {geo.uniqueVisitors.toLocaleString()} unique
            </p>
          </div>
        </div>

        {/* Mobile tabs */}
        <div className="md:hidden mt-4">
          <div className="inline-flex items-center bg-slate-100 rounded-lg p-0.5 w-full">
            {(["pages", "countries", "cities"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition ${
                  tab === t
                    ? "bg-white text-[var(--primary-ink)] shadow-sm"
                    : "text-slate-500"
                }`}
              >
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Mobile: single tab content */}
      <div className="md:hidden p-5">
        {tab === "pages" && <GeoList rows={geo.topPages.map((p) => ({ label: p.path === "/" ? "Home" : p.path, value: p.count }))} />}
        {tab === "countries" && <GeoList rows={geo.byCountry.map((c) => ({ label: `${flagEmoji(c.countryCode)} ${c.country}`, value: c.count, extra: `${c.percentage}%` }))} />}
        {tab === "cities" && <GeoList rows={geo.byCity.map((c) => ({ label: c.city, value: c.count, extra: c.country }))} />}
      </div>

      {/* Desktop: 3-up grid */}
      <div className="hidden md:grid md:grid-cols-3 divide-x divide-slate-100">
        <div className="p-5">
          <h3 className="text-sm font-semibold text-slate-600 mb-3">Top Pages</h3>
          <GeoList rows={geo.topPages.map((p) => ({ label: p.path === "/" ? "Home" : p.path, value: p.count }))} />
        </div>
        <div className="p-5">
          <h3 className="text-sm font-semibold text-slate-600 mb-3">Top Countries</h3>
          <GeoList rows={geo.byCountry.map((c) => ({ label: `${flagEmoji(c.countryCode)} ${c.country}`, value: c.count, extra: `${c.percentage}%` }))} />
        </div>
        <div className="p-5">
          <h3 className="text-sm font-semibold text-slate-600 mb-3">Top Cities</h3>
          <GeoList rows={geo.byCity.map((c) => ({ label: c.city, value: c.count, extra: c.country }))} />
        </div>
      </div>
    </div>
  );
}

function GeoList({
  rows,
}: {
  rows: { label: string; value: number; extra?: string }[];
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-slate-500">No data</p>;
  }
  return (
    <div className="space-y-2">
      {rows.slice(0, 8).map((row, i) => (
        <div key={`${row.label}-${i}`} className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-5 h-5 flex-shrink-0 flex items-center justify-center rounded bg-slate-100 text-[10px] font-medium text-slate-500">
              {i + 1}
            </span>
            <span className="text-slate-600 truncate" title={row.label}>
              {row.label}
            </span>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {row.extra && <span className="text-xs text-slate-500">{row.extra}</span>}
            <span className="font-medium">{row.value.toLocaleString()}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
