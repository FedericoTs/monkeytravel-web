"use client";

import { useEffect, useState, useCallback } from "react";
import type { CostAnalytics } from "@/app/api/admin/costs/route";
import GoogleMetricsDashboard from "./GoogleMetricsDashboard";

export default function CostDashboard() {
  const [data, setData] = useState<CostAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/admin/costs");
      if (!response.ok) throw new Error("Failed to fetch cost data");
      const result = await response.json();
      setData(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading && !data) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin" />
          <span className="text-slate-500">Loading cost analytics...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-2xl p-6">
        <p className="text-red-600">Error: {error}</p>
        <button
          onClick={fetchData}
          className="mt-2 text-sm text-red-700 underline"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-6">
      {/* Section Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center">
            <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <h2 className="text-lg font-semibold text-[var(--foreground)]">
              API Cost Monitoring
            </h2>
            <p className="text-sm text-slate-500">
              Track spending and cache performance
            </p>
          </div>
        </div>
        <button
          onClick={fetchData}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition disabled:opacity-50"
        >
          <svg className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Refresh
        </button>
      </div>

      {/* Cost Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <CostCard
          label="Total Spent"
          value={`$${data.summary.totalCostUsd.toFixed(2)}`}
          subtitle={`${data.summary.totalRequests} requests`}
          color="slate"
        />
        <CostCard
          label="Today"
          value={`$${data.summary.todayCostUsd.toFixed(2)}`}
          subtitle={`${data.summary.todayRequests} requests`}
          color="blue"
        />
        <CostCard
          label="Last 7 Days"
          value={`$${data.summary.last7DaysCostUsd.toFixed(2)}`}
          subtitle="This week"
          color="green"
        />
        <CostCard
          label="Last 30 Days"
          value={`$${data.summary.last30DaysCostUsd.toFixed(2)}`}
          subtitle="This month"
          color="purple"
        />
      </div>

      {/* Cache Performance & Savings */}
      <div className="grid md:grid-cols-2 gap-6">
        {/* Cache Performance */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6">
          <h3 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
            <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
            Cache Performance
          </h3>

          {/* Hit Rate Gauge */}
          <div className="text-center mb-4">
            <div className="relative inline-flex items-center justify-center w-32 h-32">
              <svg className="w-32 h-32 transform -rotate-90">
                <circle
                  cx="64"
                  cy="64"
                  r="56"
                  stroke="currentColor"
                  strokeWidth="12"
                  fill="none"
                  className="text-slate-200"
                />
                <circle
                  cx="64"
                  cy="64"
                  r="56"
                  stroke="currentColor"
                  strokeWidth="12"
                  fill="none"
                  strokeDasharray={`${(data.cache.hitRate / 100) * 352} 352`}
                  className="text-green-500"
                  strokeLinecap="round"
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-2xl font-bold text-slate-900">
                  {data.cache.hitRate.toFixed(1)}%
                </span>
              </div>
            </div>
            <p className="text-sm text-slate-500 mt-2">Cache Hit Rate</p>
          </div>

          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="text-center p-3 bg-green-50 rounded-lg">
              <div className="text-lg font-bold text-green-700">{data.cache.totalHits}</div>
              <div className="text-xs text-green-600">Cache Hits</div>
            </div>
            <div className="text-center p-3 bg-red-50 rounded-lg">
              <div className="text-lg font-bold text-red-700">{data.cache.totalMisses}</div>
              <div className="text-xs text-red-600">Cache Misses</div>
            </div>
          </div>
        </div>

        {/* Savings & Cache Entries */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6">
          <h3 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
            <svg className="w-4 h-4 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
            Estimated Savings
          </h3>

          <div className="text-center mb-4 p-4 bg-gradient-to-br from-green-50 to-emerald-50 rounded-xl">
            <div className="text-3xl font-bold text-green-700">
              ${data.cache.estimatedSavingsUsd.toFixed(2)}
            </div>
            <p className="text-sm text-green-600 mt-1">Saved by caching</p>
          </div>

          <div className="space-y-3">
            <h4 className="text-xs font-medium text-slate-500 uppercase">Cache Entries</h4>
            <CacheEntryRow
              label="Geocoding"
              entries={data.cache.byType.geocode.entries}
              hits={data.cache.byType.geocode.hits}
            />
            <CacheEntryRow
              label="Distance Matrix"
              entries={data.cache.byType.distance.entries}
              hits={data.cache.byType.distance.hits}
            />
            <CacheEntryRow
              label="Google Places"
              entries={data.cache.byType.places.entries}
              hits={data.cache.byType.places.hits}
            />
          </div>
        </div>
      </div>

      {/* API Breakdown & Top Endpoints */}
      <div className="grid md:grid-cols-2 gap-6">
        {/* Cost by API */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">Cost by API Service</h3>
          <div className="space-y-3">
            {data.byApi.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-4">No API usage yet</p>
            ) : (
              data.byApi.map((api) => (
                <div key={api.apiName} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ApiIcon name={api.apiName} />
                    <span className="text-sm text-slate-700">{formatApiName(api.apiName)}</span>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold text-slate-900">${api.totalCost.toFixed(3)}</div>
                    <div className="text-xs text-slate-400">{api.requestCount} requests</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Top Endpoints */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">Top Expensive Endpoints</h3>
          <div className="space-y-2 max-h-[240px] overflow-y-auto">
            {data.topEndpoints.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-4">No data yet</p>
            ) : (
              data.topEndpoints.slice(0, 8).map((endpoint, i) => (
                <div key={endpoint.endpoint} className="flex items-center gap-2 text-sm">
                  <span className="w-5 h-5 rounded bg-slate-100 flex items-center justify-center text-xs font-medium text-slate-500">
                    {i + 1}
                  </span>
                  <span className="flex-1 text-slate-600 truncate text-xs" title={endpoint.endpoint}>
                    {endpoint.endpoint}
                  </span>
                  <span className="text-xs text-slate-400">{endpoint.count}x</span>
                  <span className="font-medium text-slate-900">${endpoint.cost.toFixed(3)}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Daily Cost Trend (Simple Bar Chart) */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <h3 className="text-sm font-semibold text-slate-700 mb-4">Daily Cost Trend (Last 30 Days)</h3>
        <div className="h-40 flex items-end gap-1">
          {data.dailyTrend.slice(-30).map((day, i) => {
            const maxCost = Math.max(...data.dailyTrend.map(d => d.cost), 0.01);
            const height = (day.cost / maxCost) * 100;
            const isToday = i === data.dailyTrend.length - 1;

            return (
              <div
                key={day.date}
                className="flex-1 flex flex-col items-center group relative"
              >
                <div
                  className={`w-full rounded-t transition-all ${
                    isToday ? "bg-[var(--primary)]" : "bg-slate-300 hover:bg-slate-400"
                  }`}
                  style={{ height: `${Math.max(height, 2)}%` }}
                />
                {/* Tooltip */}
                <div className="absolute bottom-full mb-2 hidden group-hover:block z-10">
                  <div className="bg-slate-900 text-white text-xs rounded px-2 py-1 whitespace-nowrap">
                    {day.date}: ${day.cost.toFixed(3)} ({day.requests} req)
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex justify-between text-xs text-slate-400 mt-2">
          <span>{data.dailyTrend[0]?.date}</span>
          <span>Today</span>
        </div>
      </div>

      {/* Google Cloud Real Metrics */}
      <GoogleMetricsDashboard />
    </div>
  );
}

// Helper Components
function CostCard({
  label,
  value,
  subtitle,
  color,
}: {
  label: string;
  value: string;
  subtitle: string;
  color: "slate" | "blue" | "green" | "purple";
}) {
  const colors = {
    slate: "bg-slate-50 border-slate-200",
    blue: "bg-blue-50 border-blue-200",
    green: "bg-green-50 border-green-200",
    purple: "bg-purple-50 border-purple-200",
  };

  const textColors = {
    slate: "text-slate-900",
    blue: "text-blue-900",
    green: "text-green-900",
    purple: "text-purple-900",
  };

  return (
    <div className={`rounded-xl border p-4 ${colors[color]}`}>
      <p className="text-xs font-medium text-slate-500 uppercase">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${textColors[color]}`}>{value}</p>
      <p className="text-xs text-slate-500 mt-1">{subtitle}</p>
    </div>
  );
}

function CacheEntryRow({
  label,
  entries,
  hits,
}: {
  label: string;
  entries: number;
  hits: number;
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-slate-600">{label}</span>
      <div className="flex items-center gap-3">
        <span className="text-slate-400">{entries} entries</span>
        <span className="font-medium text-green-600">{hits} hits</span>
      </div>
    </div>
  );
}

function ApiIcon({ name }: { name: string }) {
  const colors: Record<string, string> = {
    google_places: "bg-blue-100 text-blue-600",
    google_geocoding: "bg-green-100 text-green-600",
    google_distance: "bg-amber-100 text-amber-600",
    gemini: "bg-purple-100 text-purple-600",
  };

  return (
    <div className={`w-6 h-6 rounded flex items-center justify-center text-xs font-bold ${colors[name] || "bg-slate-100 text-slate-600"}`}>
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

function formatApiName(name: string): string {
  return name
    .replace(/_/g, " ")
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
