"use client";

import { useEffect, useState, useCallback } from "react";
import type { EnhancedCostAnalytics } from "@/app/api/admin/costs/route";

/**
 * Cost Command Center
 *
 * API cost monitoring dashboard matching the Fresh Voyager theme
 * Light mode with Coral/Teal/Gold accent colors
 */

export default function CostCommandCenter() {
  const [data, setData] = useState<EnhancedCostAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false); // Default OFF to save CPU

  const fetchData = useCallback(async () => {
    try {
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
    const interval = autoRefresh ? setInterval(fetchData, 30000) : null;
    return () => {
      if (interval) clearInterval(interval);
    };
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

  if (!data) return null;

  return (
    <div className="space-y-6">
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
                ? "bg-[var(--secondary)]/10 text-[var(--secondary)]"
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
          label="Total Spent"
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
          subtitle="weekly spend"
          color="accent"
        />
        <MetricCard
          label="Projected /mo"
          value={`$${data.summary.projectedMonthlyCost.toFixed(2)}`}
          subtitle="based on 7d avg"
          color="warning"
        />
        <MetricCard
          label="Avg / Request"
          value={`$${data.summary.avgCostPerRequest.toFixed(4)}`}
          subtitle="per API call"
          color="success"
        />
      </div>

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

// ============ Sub-Components ============

function MetricCard({
  label,
  value,
  subtitle,
  color,
}: {
  label: string;
  value: string;
  subtitle: string;
  color: "primary" | "secondary" | "accent" | "warning" | "success";
}) {
  const colorStyles = {
    primary: {
      bg: "bg-gradient-to-br from-[var(--primary)]/10 to-[var(--primary)]/5",
      border: "border-[var(--primary)]/20",
      text: "text-[var(--primary)]",
      icon: "bg-[var(--primary)]/20 text-[var(--primary)]",
    },
    secondary: {
      bg: "bg-gradient-to-br from-[var(--secondary)]/10 to-[var(--secondary)]/5",
      border: "border-[var(--secondary)]/20",
      text: "text-[var(--secondary)]",
      icon: "bg-[var(--secondary)]/20 text-[var(--secondary)]",
    },
    accent: {
      bg: "bg-gradient-to-br from-[var(--accent)]/15 to-[var(--accent)]/5",
      border: "border-[var(--accent-dark)]/20",
      text: "text-[var(--accent-dark)]",
      icon: "bg-[var(--accent)]/30 text-[var(--accent-dark)]",
    },
    warning: {
      bg: "bg-gradient-to-br from-orange-100 to-orange-50",
      border: "border-orange-200",
      text: "text-orange-600",
      icon: "bg-orange-200 text-orange-600",
    },
    success: {
      bg: "bg-gradient-to-br from-[var(--success)]/10 to-[var(--success)]/5",
      border: "border-[var(--success)]/20",
      text: "text-[var(--success)]",
      icon: "bg-[var(--success)]/20 text-[var(--success)]",
    },
  };

  const styles = colorStyles[color];

  return (
    <div className={`${styles.bg} border ${styles.border} rounded-2xl p-4`}>
      <p className="text-xs font-medium text-[var(--foreground-muted)] uppercase tracking-wide mb-1">
        {label}
      </p>
      <p className={`text-2xl font-bold ${styles.text}`}>{value}</p>
      <p className="text-xs text-[var(--foreground-muted)] mt-1">{subtitle}</p>
    </div>
  );
}

function CircuitBreakerPanel({ breakers }: { breakers: EnhancedCostAnalytics["circuitBreakers"] }) {
  const sortedBreakers = [...breakers].sort((a, b) => {
    const priority = { OPEN: 0, HALF_OPEN: 1, CLOSED: 2 };
    return priority[a.state] - priority[b.state];
  });

  const openCount = breakers.filter(b => b.state === "OPEN").length;
  const halfOpenCount = breakers.filter(b => b.state === "HALF_OPEN").length;

  return (
    <div className="bg-white rounded-2xl border border-[var(--foreground-light)]/20 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-[var(--foreground)]">
          Circuit Breakers
        </h3>
        <div className="flex items-center gap-2">
          {openCount > 0 && (
            <span className="px-2 py-0.5 bg-[var(--error)]/10 text-[var(--error)] rounded-full text-xs font-medium">
              {openCount} Open
            </span>
          )}
          {halfOpenCount > 0 && (
            <span className="px-2 py-0.5 bg-[var(--warning)]/20 text-orange-600 rounded-full text-xs font-medium">
              {halfOpenCount} Recovering
            </span>
          )}
          {openCount === 0 && halfOpenCount === 0 && (
            <span className="px-2 py-0.5 bg-[var(--success)]/10 text-[var(--success)] rounded-full text-xs font-medium">
              All Healthy
            </span>
          )}
        </div>
      </div>
      <div className="space-y-2 max-h-[200px] overflow-y-auto">
        {sortedBreakers.slice(0, 8).map((breaker) => (
          <div
            key={breaker.apiName}
            className={`flex items-center justify-between p-3 rounded-xl transition ${
              breaker.state === "OPEN"
                ? "bg-[var(--error)]/5 border border-[var(--error)]/20"
                : breaker.state === "HALF_OPEN"
                ? "bg-[var(--warning)]/10 border border-[var(--warning)]/30"
                : "bg-[var(--background-warm)] border border-transparent"
            }`}
          >
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${
                breaker.state === "CLOSED" ? "bg-[var(--success)]" :
                breaker.state === "HALF_OPEN" ? "bg-[var(--warning)] animate-pulse" :
                "bg-[var(--error)] animate-pulse"
              }`} />
              <span className="text-sm text-[var(--foreground)]">
                {formatApiName(breaker.apiName)}
              </span>
            </div>
            <div className="flex items-center gap-3">
              {breaker.failureCount > 0 && (
                <span className="text-xs text-[var(--error)]">
                  {breaker.failureCount} fails
                </span>
              )}
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                breaker.state === "CLOSED" ? "bg-[var(--success)]/10 text-[var(--success)]" :
                breaker.state === "HALF_OPEN" ? "bg-[var(--warning)]/20 text-orange-600" :
                "bg-[var(--error)]/10 text-[var(--error)]"
              }`}>
                {breaker.state === "HALF_OPEN" ? "HALF" : breaker.state}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PerformancePanel({ performance }: { performance: EnhancedCostAnalytics["performance"] }) {
  return (
    <div className="bg-white rounded-2xl border border-[var(--foreground-light)]/20 p-6">
      <h3 className="text-sm font-semibold text-[var(--foreground)] mb-4">
        Performance Metrics
      </h3>
      <div className="space-y-4">
        {/* Latency Percentiles */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-[var(--foreground-muted)]">Latency (ms)</span>
          </div>
          <div className="grid grid-cols-4 gap-2">
            <LatencyBadge label="AVG" value={performance.avgResponseTimeMs} />
            <LatencyBadge label="P50" value={performance.p50ResponseTimeMs} />
            <LatencyBadge label="P95" value={performance.p95ResponseTimeMs} color="warning" />
            <LatencyBadge label="P99" value={performance.p99ResponseTimeMs} color="error" />
          </div>
        </div>

        {/* Error Rate */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-[var(--foreground-muted)]">Error Rate</span>
            <span className={`text-xs font-medium ${
              performance.errorRate > 5 ? "text-[var(--error)]" :
              performance.errorRate > 1 ? "text-orange-500" :
              "text-[var(--success)]"
            }`}>
              {performance.totalErrors} errors
            </span>
          </div>
          <div className="h-2 bg-[var(--foreground-light)]/20 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all rounded-full ${
                performance.errorRate > 5 ? "bg-[var(--error)]" :
                performance.errorRate > 1 ? "bg-orange-500" :
                "bg-[var(--success)]"
              }`}
              style={{ width: `${Math.min(performance.errorRate, 100)}%` }}
            />
          </div>
          <div className="flex justify-between mt-2">
            <span className={`text-lg font-bold ${
              performance.errorRate > 5 ? "text-[var(--error)]" :
              performance.errorRate > 1 ? "text-orange-500" :
              "text-[var(--success)]"
            }`}>
              {performance.errorRate.toFixed(1)}%
            </span>
            <span className="text-sm text-[var(--success)]">
              {performance.successRate.toFixed(1)}% success
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function LatencyBadge({
  label,
  value,
  color = "secondary"
}: {
  label: string;
  value: number;
  color?: "secondary" | "warning" | "error";
}) {
  const colors = {
    secondary: "bg-[var(--secondary)]/10 text-[var(--secondary)] border-[var(--secondary)]/20",
    warning: "bg-orange-50 text-orange-600 border-orange-200",
    error: "bg-[var(--error)]/10 text-[var(--error)] border-[var(--error)]/20",
  };

  return (
    <div className={`text-center p-2 rounded-xl border ${colors[color]}`}>
      <div className="text-xs text-[var(--foreground-muted)]">{label}</div>
      <div className="text-lg font-bold">{value || "-"}</div>
    </div>
  );
}

function CachePanel({ cache }: { cache: EnhancedCostAnalytics["cache"] }) {
  const circumference = 2 * Math.PI * 40;
  const strokeDashoffset = circumference - (cache.hitRate / 100) * circumference;

  return (
    <div className="bg-white rounded-2xl border border-[var(--foreground-light)]/20 p-6">
      <h3 className="text-sm font-semibold text-[var(--foreground)] mb-4">
        Cache Performance
      </h3>
      <div className="flex items-center gap-6">
        {/* Gauge */}
        <div className="relative">
          <svg className="w-24 h-24 transform -rotate-90">
            <circle
              cx="48"
              cy="48"
              r="40"
              stroke="currentColor"
              strokeWidth="8"
              fill="none"
              className="text-[var(--foreground-light)]/30"
            />
            <circle
              cx="48"
              cy="48"
              r="40"
              stroke="currentColor"
              strokeWidth="8"
              fill="none"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              className={`transition-all duration-1000 ${
                cache.hitRate >= 80 ? "text-[var(--success)]" :
                cache.hitRate >= 50 ? "text-[var(--warning)]" :
                "text-[var(--error)]"
              }`}
              strokeLinecap="round"
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className={`text-xl font-bold ${
              cache.hitRate >= 80 ? "text-[var(--success)]" :
              cache.hitRate >= 50 ? "text-orange-500" :
              "text-[var(--error)]"
            }`}>
              {cache.hitRate.toFixed(0)}%
            </span>
          </div>
        </div>

        {/* Stats */}
        <div className="flex-1 space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-xs text-[var(--foreground-muted)]">Hits</span>
            <span className="text-[var(--success)] font-semibold">{cache.totalHits.toLocaleString()}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-xs text-[var(--foreground-muted)]">Misses</span>
            <span className="text-[var(--error)] font-semibold">{cache.totalMisses.toLocaleString()}</span>
          </div>
          <div className="flex justify-between items-center pt-2 border-t border-[var(--foreground-light)]/20">
            <span className="text-xs text-[var(--foreground-muted)]">Saved</span>
            <span className="text-[var(--success)] font-bold">
              ${cache.estimatedSavingsUsd.toFixed(2)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function DailyTrendChart({ data }: { data: EnhancedCostAnalytics["dailyTrend"] }) {
  const maxCost = Math.max(...data.map(d => d.cost), 0.01);

  return (
    <div className="h-40 flex items-end gap-1">
      {data.map((day, i) => {
        const costHeight = (day.cost / maxCost) * 100;
        const isToday = i === data.length - 1;
        const hasErrors = day.errors > 0;

        return (
          <div
            key={day.date}
            className="flex-1 flex flex-col items-center group relative"
          >
            <div
              className={`w-full rounded-t-sm transition-all ${
                hasErrors
                  ? "bg-gradient-to-t from-[var(--error)] to-[var(--error)]/70"
                  : isToday
                  ? "bg-gradient-to-t from-[var(--primary)] to-[var(--primary-light)]"
                  : "bg-gradient-to-t from-[var(--secondary)]/60 to-[var(--secondary)]/30 hover:from-[var(--secondary)] hover:to-[var(--secondary)]/60"
              }`}
              style={{ height: `${Math.max(costHeight, 3)}%` }}
            />
            {/* Tooltip */}
            <div className="absolute bottom-full mb-2 hidden group-hover:block z-10">
              <div className="bg-[var(--navy)] text-white text-xs rounded-xl px-3 py-2 whitespace-nowrap shadow-lg">
                <div className="text-[var(--foreground-light)] mb-1">{day.date}</div>
                <div className="text-[var(--accent)]">${day.cost.toFixed(3)}</div>
                <div>{day.requests} requests</div>
                {day.errors > 0 && (
                  <div className="text-[var(--error)]">{day.errors} errors</div>
                )}
                {day.cacheHits > 0 && (
                  <div className="text-[var(--success)]">{day.cacheHits} cache hits</div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function HourlyTrendChart({ data }: { data: EnhancedCostAnalytics["hourlyTrend"] }) {
  const maxRequests = Math.max(...data.map(h => h.requests), 1);

  return (
    <div className="h-40 flex items-end gap-1">
      {data.map((hour, i) => {
        const height = (hour.requests / maxRequests) * 100;
        const isNow = i === data.length - 1;

        return (
          <div
            key={hour.hour}
            className="flex-1 flex flex-col items-center group relative"
          >
            <div
              className={`w-full rounded-t-sm transition-all ${
                isNow
                  ? "bg-gradient-to-t from-[var(--accent-dark)] to-[var(--accent)]"
                  : "bg-gradient-to-t from-[var(--primary)]/40 to-[var(--primary)]/20 hover:from-[var(--primary)] hover:to-[var(--primary)]/60"
              }`}
              style={{ height: `${Math.max(height, 3)}%` }}
            />
            {/* Tooltip */}
            <div className="absolute bottom-full mb-2 hidden group-hover:block z-10">
              <div className="bg-[var(--navy)] text-white text-xs rounded-xl px-3 py-2 whitespace-nowrap shadow-lg">
                <div className="text-[var(--foreground-light)] mb-1">
                  {new Date(hour.hour + ":00").toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
                <div className="text-[var(--accent)]">{hour.requests} requests</div>
                <div>${hour.cost.toFixed(3)}</div>
                {hour.avgLatency > 0 && (
                  <div className="text-orange-300">{hour.avgLatency}ms avg</div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ApiBreakdownTable({ apis }: { apis: EnhancedCostAnalytics["byApi"] }) {
  if (apis.length === 0) {
    return (
      <div className="text-center py-8 text-[var(--foreground-muted)] text-sm">
        No API data yet
      </div>
    );
  }

  return (
    <div className="space-y-2 max-h-[300px] overflow-y-auto">
      {apis.map((api) => (
        <div
          key={api.apiName}
          className="flex items-center gap-3 p-3 bg-[var(--background-warm)] rounded-xl hover:bg-[var(--background-cream)] transition"
        >
          <div
            className="w-3 h-3 rounded-full flex-shrink-0"
            style={{ backgroundColor: api.color }}
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-[var(--foreground)] truncate">
                {api.displayName}
              </span>
              <span className="text-[var(--primary)] font-bold text-sm">
                ${api.totalCost.toFixed(3)}
              </span>
            </div>
            <div className="flex items-center gap-3 mt-1 text-xs">
              <span className="text-[var(--foreground-muted)]">
                {api.requestCount} req
              </span>
              {api.cacheHits > 0 && (
                <span className="text-[var(--success)]">
                  {api.cacheHits} hits
                </span>
              )}
              {api.errorCount > 0 && (
                <span className="text-[var(--error)]">
                  {api.errorCount} err ({api.errorRate}%)
                </span>
              )}
              {api.avgResponseTimeMs > 0 && (
                <span className="text-orange-500">
                  {api.avgResponseTimeMs}ms
                </span>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function TopEndpointsTable({ endpoints }: { endpoints: EnhancedCostAnalytics["topEndpoints"] }) {
  if (endpoints.length === 0) {
    return (
      <div className="text-center py-8 text-[var(--foreground-muted)] text-sm">
        No endpoint data yet
      </div>
    );
  }

  return (
    <div className="space-y-2 max-h-[300px] overflow-y-auto">
      {endpoints.map((endpoint, i) => (
        <div
          key={endpoint.endpoint}
          className="flex items-center gap-3 p-2 hover:bg-[var(--background-warm)] rounded-xl transition"
        >
          <span className="w-6 h-6 rounded-lg bg-[var(--primary)]/10 flex items-center justify-center text-xs font-medium text-[var(--primary)]">
            {i + 1}
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-sm text-[var(--foreground)] truncate" title={endpoint.endpoint}>
              {endpoint.endpoint}
            </div>
            <div className="flex items-center gap-3 text-xs text-[var(--foreground-muted)] mt-0.5">
              <span>{endpoint.count}x</span>
              {endpoint.avgLatency > 0 && <span>{endpoint.avgLatency}ms</span>}
            </div>
          </div>
          <span className="text-[var(--secondary)] font-bold text-sm">
            ${endpoint.cost.toFixed(3)}
          </span>
        </div>
      ))}
    </div>
  );
}

function ActivityFeed({ activities }: { activities: EnhancedCostAnalytics["recentActivity"] }) {
  if (activities.length === 0) {
    return (
      <div className="text-center py-8 text-[var(--foreground-muted)] text-sm">
        No recent activity
      </div>
    );
  }

  return (
    <div className="space-y-1 max-h-[300px] overflow-y-auto text-xs">
      <div className="grid grid-cols-12 gap-2 px-3 py-2 bg-[var(--background-warm)] rounded-xl text-[var(--foreground-muted)] font-medium sticky top-0">
        <span className="col-span-2">Time</span>
        <span className="col-span-2">API</span>
        <span className="col-span-4">Endpoint</span>
        <span className="col-span-1 text-center">Status</span>
        <span className="col-span-1 text-right">Latency</span>
        <span className="col-span-1 text-right">Cost</span>
        <span className="col-span-1 text-center">Cache</span>
      </div>
      {activities.map((activity) => (
        <div
          key={activity.id}
          className={`grid grid-cols-12 gap-2 px-3 py-2 rounded-xl hover:bg-[var(--background-warm)] transition ${
            activity.error ? "bg-[var(--error)]/5" : ""
          }`}
        >
          <span className="col-span-2 text-[var(--foreground-muted)]">
            {new Date(activity.timestamp).toLocaleTimeString()}
          </span>
          <span className="col-span-2 text-[var(--foreground)] truncate">
            {formatApiName(activity.apiName)}
          </span>
          <span className="col-span-4 text-[var(--foreground-muted)] truncate" title={activity.endpoint}>
            {activity.endpoint}
          </span>
          <span className={`col-span-1 text-center font-medium ${
            activity.status >= 400 ? "text-[var(--error)]" :
            activity.status >= 300 ? "text-orange-500" :
            "text-[var(--success)]"
          }`}>
            {activity.status || "-"}
          </span>
          <span className="col-span-1 text-right text-orange-500">
            {activity.responseTimeMs > 0 ? `${activity.responseTimeMs}ms` : "-"}
          </span>
          <span className="col-span-1 text-right text-[var(--secondary)]">
            ${activity.costUsd.toFixed(4)}
          </span>
          <span className="col-span-1 text-center">
            {activity.cacheHit ? (
              <span className="text-[var(--success)] font-medium">HIT</span>
            ) : (
              <span className="text-[var(--foreground-light)]">-</span>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

// ============ Helpers ============

function formatApiName(name: string): string {
  return name
    .replace(/google_/g, "G:")
    .replace(/_/g, " ")
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
