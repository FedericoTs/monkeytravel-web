"use client";

import { useEffect, useState, useCallback } from "react";
import type { EnhancedCostAnalytics } from "@/lib/admin/costs/types";
import { MetricCard } from "@/components/admin/costs/MetricCard";
import { GeminiCreditPanel } from "@/components/admin/costs/GeminiCreditPanel";
import { CircuitBreakerPanel } from "@/components/admin/costs/CircuitBreakerPanel";
import { PerformancePanel } from "@/components/admin/costs/PerformancePanel";
import { CachePanel } from "@/components/admin/costs/CachePanel";
import { DailyTrendChart, HourlyTrendChart } from "@/components/admin/costs/TrendCharts";
import { ApiBreakdownTable, TopEndpointsTable } from "@/components/admin/costs/BreakdownTables";
import { ActivityFeed } from "@/components/admin/costs/ActivityFeed";

/**
 * Cost Command Center
 *
 * API cost monitoring dashboard matching the Fresh Voyager theme
 * Light mode with Coral/Teal/Gold accent colors
 */

export default function CostCommandCenter() {
  const [data, setData] = useState<EnhancedCostAnalytics | null>(null);
  const [loading, setLoading] = useState(false); // Start false - no auto-load
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false); // Default OFF to save CPU

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

  // No auto-fetch on mount - only manual refresh to save costs
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchData, 5 * 60_000);
    return () => clearInterval(interval);
  }, [fetchData, autoRefresh]);

  if (loading && !data) {
    return (
      <div className="min-h-[600px] bg-white rounded-2xl border border-[var(--primary)]/10 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <div className="w-16 h-16 border-4 border-[var(--primary)]/20 rounded-full animate-spin" />
            <div className="absolute inset-0 w-16 h-16 border-4 border-transparent border-t-[var(--primary)] rounded-full animate-spin" />
          </div>
          <span className="text-[var(--foreground-muted)] text-sm">Loading cost analytics...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-[400px] bg-white rounded-2xl border border-red-200 p-8 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-[var(--error)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <p className="text-[var(--error)] font-medium mb-4">Error: {error}</p>
          <button
            onClick={fetchData}
            className="px-4 py-2 bg-red-50 text-[var(--error)] rounded-xl hover:bg-red-100 transition text-sm"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // Show prompt to load data manually
  if (!data) {
    return (
      <div className="min-h-[400px] bg-white rounded-2xl border border-[var(--primary)]/10 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 rounded-full bg-[var(--primary)]/10 flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-[var(--primary-ink)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-[var(--foreground)] mb-2">Cost Analytics</h3>
          <p className="text-[var(--foreground-muted)] mb-6 max-w-xs">Click the button below to load cost data. Data is not auto-loaded to minimize API usage.</p>
          <button
            onClick={fetchData}
            disabled={loading}
            className="px-6 py-3 bg-[var(--primary)] text-white rounded-xl hover:bg-[var(--primary-dark)] transition font-medium disabled:opacity-50 flex items-center gap-2 mx-auto"
          >
            {loading ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Loading...
              </>
            ) : (
              <>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Load Cost Data
              </>
            )}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Estimate Disclaimer */}
      <div className="flex items-center gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl">
        <svg className="w-5 h-5 text-amber-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p data-testid="costs-list-price-note" className="text-sm text-amber-700">
          What our logs add up to at list price, before Google&apos;s free allowances, except this month&apos;s estimate,
          which takes them off. Vercel and our own test runs aren&apos;t counted. What you actually pay is in Google Cloud,
          under Billing → Reports.
        </p>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[var(--primary)] to-[var(--primary-dark)] flex items-center justify-center">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <h2 className="text-lg font-semibold text-[var(--foreground)]">API Cost Center</h2>
            <p className="text-sm text-[var(--foreground-muted)]">Real-time spending & performance</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {autoRefresh && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-[var(--success)]/10 rounded-full">
              <div className="w-2 h-2 rounded-full bg-[var(--success)] animate-pulse" />
              <span className="text-[var(--success)] text-xs font-medium">LIVE</span>
            </div>
          )}
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-medium transition ${
              autoRefresh
                ? "bg-[var(--secondary)]/10 text-[var(--secondary-ink)]"
                : "bg-[var(--foreground-light)]/20 text-[var(--foreground-muted)]"
            }`}
          >
            <svg className={`w-4 h-4 ${autoRefresh ? "animate-spin" : ""}`} style={{ animationDuration: "3s" }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Auto: {autoRefresh ? "ON" : "OFF"}
          </button>
          <button
            onClick={fetchData}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-1.5 bg-[var(--background-warm)] text-[var(--foreground-muted)] rounded-xl hover:bg-[var(--primary)]/10 transition text-xs font-medium disabled:opacity-50"
          >
            Refresh
          </button>
          <span className="text-[var(--foreground-light)] text-xs">
            {new Date(data.generatedAt).toLocaleTimeString()}
          </span>
        </div>
      </div>

      {/* Primary Metrics Row */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <MetricCard
          label="Total logged"
          value={`$${data.summary.totalCostUsd.toFixed(2)}`}
          subtitle={`${data.summary.totalRequests.toLocaleString()} requests`}
          color="primary"
        />
        <MetricCard
          label="Today"
          value={`$${data.summary.todayCostUsd.toFixed(2)}`}
          subtitle={`${data.summary.todayRequests} requests`}
          color="secondary"
        />
        <MetricCard
          label="Last 7 Days"
          value={`$${data.summary.last7DaysCostUsd.toFixed(2)}`}
          subtitle="logged, at list price"
          color="accent"
        />
        <MetricCard
          label="This month, estimated"
          value={`$${data.summary.projectedMonthlyCost.toFixed(2)}`}
          subtitle={`after free calls · last month $${data.summary.lastMonthCostUsd.toFixed(2)}`}
          color="warning"
        />
        <MetricCard
          label="Avg / Request"
          value={`$${data.summary.avgCostPerRequest.toFixed(4)}`}
          subtitle="per API call"
          color="success"
        />
      </div>

      <GeminiCreditPanel credit={data.credit} onSaved={fetchData} />

      {/* System Health & Performance Row */}
      <div className="grid lg:grid-cols-3 gap-6">
        <CircuitBreakerPanel breakers={data.circuitBreakers} />
        <PerformancePanel performance={data.performance} />
        <CachePanel cache={data.cache} />
      </div>

      {/* Cost Trends */}
      <div className="grid lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-2xl border border-[var(--foreground-light)]/20 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-[var(--foreground)]">
              30-Day Cost Trend
            </h3>
            <span className="text-xs text-[var(--foreground-muted)]">
              ${data.dailyTrend.reduce((sum, d) => sum + d.cost, 0).toFixed(2)} total
            </span>
          </div>
          <DailyTrendChart data={data.dailyTrend} />
        </div>

        <div className="bg-white rounded-2xl border border-[var(--foreground-light)]/20 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-[var(--foreground)]">
              24-Hour Activity
            </h3>
            <span className="text-xs text-[var(--foreground-muted)]">
              {data.hourlyTrend.reduce((sum, h) => sum + h.requests, 0)} requests
            </span>
          </div>
          <HourlyTrendChart data={data.hourlyTrend} />
        </div>
      </div>

      {/* API Breakdown & Top Endpoints */}
      <div className="grid lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-2xl border border-[var(--foreground-light)]/20 p-6">
          <h3 className="text-sm font-semibold text-[var(--foreground)] mb-4">
            Cost by API Service
          </h3>
          <ApiBreakdownTable apis={data.byApi} />
        </div>

        <div className="bg-white rounded-2xl border border-[var(--foreground-light)]/20 p-6">
          <h3 className="text-sm font-semibold text-[var(--foreground)] mb-4">
            Top Expensive Endpoints
          </h3>
          <TopEndpointsTable endpoints={data.topEndpoints} />
        </div>
      </div>

      {/* Activity Feed */}
      <div className="bg-white rounded-2xl border border-[var(--foreground-light)]/20 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-[var(--foreground)]">
            Recent Activity
          </h3>
          <span className="text-xs text-[var(--foreground-muted)]">
            Last {data.recentActivity.length} requests
          </span>
        </div>
        <ActivityFeed activities={data.recentActivity} />
      </div>
    </div>
  );
}
