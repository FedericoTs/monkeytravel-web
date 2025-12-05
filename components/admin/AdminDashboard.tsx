"use client";

import { useEffect, useState, useCallback } from "react";
import type { AdminStats } from "@/app/api/admin/stats/route";
import UserGrowthChart from "./UserGrowthChart";
import CostDashboard from "./CostDashboard";
import AccessControl from "./AccessControl";

export default function AdminDashboard() {
  const [activeTab, setActiveTab] = useState<"analytics" | "costs" | "access">("analytics");
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/admin/stats");
      if (!response.ok) {
        throw new Error("Failed to fetch stats");
      }
      const data = await response.json();
      setStats(data);
      setLastUpdated(new Date());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
    // Auto-refresh every 5 minutes
    const interval = setInterval(fetchStats, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchStats]);

  if (loading && !stats) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-3 border-[var(--primary)] border-t-transparent rounded-full animate-spin" />
          <p className="text-slate-500">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
        <p className="text-red-600 font-medium">Error: {error}</p>
        <button
          onClick={fetchStats}
          className="mt-3 px-4 py-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!stats) return null;

  return (
    <div className="space-y-8">
      {/* Header with Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--foreground)]">
            Admin Dashboard
          </h1>
          <p className="text-slate-500 mt-1">
            Analytics, costs, and access control
          </p>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl">
          <button
            onClick={() => setActiveTab("analytics")}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition ${
              activeTab === "analytics"
                ? "bg-white text-[var(--primary)] shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            Analytics
          </button>
          <button
            onClick={() => setActiveTab("costs")}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition ${
              activeTab === "costs"
                ? "bg-white text-red-600 shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Costs
          </button>
          <button
            onClick={() => setActiveTab("access")}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition ${
              activeTab === "access"
                ? "bg-white text-amber-600 shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            Access
          </button>
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === "costs" && <CostDashboard />}
      {activeTab === "access" && <AccessControl />}

      {/* Analytics Tab Content */}
      {activeTab === "analytics" && (
        <>
          {/* Sub-header with refresh */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {lastUpdated && (
                <span className="text-xs text-slate-400">
                  Updated {lastUpdated.toLocaleTimeString()}
                </span>
              )}
            </div>
            <button
              onClick={fetchStats}
              disabled={loading}
              className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg text-sm text-slate-600 transition disabled:opacity-50"
            >
              <svg
                className={`w-4 h-4 ${loading ? "animate-spin" : ""}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              Refresh
            </button>
          </div>

      {/* Key Metrics Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard
          title="Total Users"
          value={stats.users.total}
          subtitle={`+${stats.users.newLast7Days} this week`}
          icon="users"
          color="primary"
        />
        <MetricCard
          title="Total Trips"
          value={stats.trips.total}
          subtitle={`+${stats.trips.last7Days} this week`}
          icon="map"
          color="secondary"
        />
        <MetricCard
          title="AI Requests"
          value={stats.ai.totalRequests}
          subtitle={`+${stats.ai.last7Days} this week`}
          icon="sparkles"
          color="accent"
        />
        <MetricCard
          title="Subscribers"
          value={stats.subscribers.total}
          subtitle={`+${stats.subscribers.last7Days} this week`}
          icon="mail"
          color="navy"
        />
      </div>

      {/* User Growth Trend Chart */}
      <UserGrowthChart data={stats.userTrend} />

      {/* User & Churn Section */}
      <div className="grid md:grid-cols-2 gap-6">
        {/* User Breakdown */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6">
          <h2 className="text-lg font-semibold text-[var(--foreground)] mb-4">
            User Metrics
          </h2>
          <div className="space-y-3">
            <StatRow label="Total Users" value={stats.users.total} />
            <StatRow label="New (7 days)" value={stats.users.newLast7Days} highlight />
            <StatRow label="New (30 days)" value={stats.users.newLast30Days} />
            <StatRow label="Active (30 days)" value={stats.users.activeLast30Days} />
            <StatRow label="With Trips" value={stats.users.withTrips} />
            <StatRow label="Without Trips" value={stats.users.withoutTrips} warning={stats.users.withoutTrips > 0} />
          </div>
        </div>

        {/* Churn Analysis */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6">
          <h2 className="text-lg font-semibold text-[var(--foreground)] mb-4">
            Churn Analysis
          </h2>
          <div className="space-y-4">
            <div className="text-center p-4 bg-slate-50 rounded-xl">
              <div className="text-3xl font-bold text-[var(--primary)]">
                {stats.churn.retentionRate}%
              </div>
              <div className="text-sm text-slate-500 mt-1">Retention Rate</div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="text-center p-3 bg-amber-50 rounded-lg">
                <div className="text-xl font-semibold text-amber-700">
                  {stats.churn.neverCreatedTrip}
                </div>
                <div className="text-xs text-amber-600">Never Created Trip</div>
              </div>
              <div className="text-center p-3 bg-red-50 rounded-lg">
                <div className="text-xl font-semibold text-red-700">
                  {stats.churn.inactiveLast30Days}
                </div>
                <div className="text-xs text-red-600">Inactive 30+ Days</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Cohort Retention Matrix */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-[var(--foreground)]">
              Weekly Cohort Retention Matrix
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              User retention by signup week (% still active in each subsequent week)
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-slate-500">Low</span>
            <div className="flex">
              <div className="w-4 h-4 bg-red-500 rounded-l" />
              <div className="w-4 h-4 bg-orange-400" />
              <div className="w-4 h-4 bg-yellow-400" />
              <div className="w-4 h-4 bg-lime-400" />
              <div className="w-4 h-4 bg-green-500 rounded-r" />
            </div>
            <span className="text-slate-500">High</span>
          </div>
        </div>

        {stats.churn.cohortRetention && stats.churn.cohortRetention.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left py-2 px-3 font-medium text-slate-600 bg-slate-50 rounded-tl-lg">
                    Cohort
                  </th>
                  <th className="text-center py-2 px-3 font-medium text-slate-600 bg-slate-50">
                    Users
                  </th>
                  {Array.from({ length: 8 }).map((_, i) => (
                    <th key={i} className={`text-center py-2 px-3 font-medium text-slate-600 bg-slate-50 ${i === 7 ? 'rounded-tr-lg' : ''}`}>
                      W{i}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {stats.churn.cohortRetention.map((cohort, cohortIndex) => (
                  <tr key={cohort.cohort} className={cohortIndex % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}>
                    <td className="py-2 px-3 font-medium text-slate-700">
                      {cohort.cohort}
                    </td>
                    <td className="py-2 px-3 text-center text-slate-600">
                      {cohort.cohortSize}
                    </td>
                    {Array.from({ length: 8 }).map((_, weekIndex) => {
                      const retention = cohort.retention[weekIndex];
                      const hasData = retention !== undefined;

                      return (
                        <td key={weekIndex} className="py-2 px-1 text-center">
                          {hasData ? (
                            <div
                              className="mx-auto w-12 h-8 rounded flex items-center justify-center text-xs font-semibold"
                              style={{
                                backgroundColor: getRetentionColor(retention),
                                color: retention > 50 ? '#fff' : '#374151',
                              }}
                            >
                              {retention}%
                            </div>
                          ) : (
                            <div className="mx-auto w-12 h-8 rounded bg-slate-100 flex items-center justify-center text-slate-400 text-xs">
                              -
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-12 text-slate-400">
            <svg className="w-12 h-12 mx-auto mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            <p>Not enough data for cohort analysis yet</p>
            <p className="text-sm mt-1">Retention matrix will appear as more users sign up</p>
          </div>
        )}
      </div>

      {/* Trips Section */}
      <div className="grid md:grid-cols-2 gap-6">
        {/* Trip Status */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6">
          <h2 className="text-lg font-semibold text-[var(--foreground)] mb-4">
            Trips by Status
          </h2>
          <div className="space-y-3">
            {Object.entries(stats.trips.byStatus).map(([status, count]) => (
              <div key={status} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <StatusBadge status={status} />
                  <span className="text-slate-600 capitalize">{status}</span>
                </div>
                <span className="font-semibold">{count}</span>
              </div>
            ))}
            <div className="pt-3 border-t border-slate-100">
              <StatRow label="Shared Trips" value={stats.trips.sharedTrips} />
              <StatRow label="Avg per User" value={stats.trips.averagePerUser} />
            </div>
          </div>
        </div>

        {/* Top Destinations */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6">
          <h2 className="text-lg font-semibold text-[var(--foreground)] mb-4">
            Top Destinations
          </h2>
          {stats.topDestinations.length === 0 ? (
            <p className="text-slate-400 text-center py-8">No trips yet</p>
          ) : (
            <div className="space-y-2">
              {stats.topDestinations.slice(0, 8).map((dest, i) => (
                <div
                  key={dest.destination}
                  className="flex items-center gap-3"
                >
                  <span className="w-6 h-6 flex items-center justify-center rounded-full bg-slate-100 text-xs font-medium text-slate-500">
                    {i + 1}
                  </span>
                  <span className="flex-1 text-slate-700">{dest.destination}</span>
                  <span className="text-sm font-medium text-slate-500">
                    {dest.count} {dest.count === 1 ? "trip" : "trips"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* AI Usage Section */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <h2 className="text-lg font-semibold text-[var(--foreground)] mb-4">
          AI Agent Usage
        </h2>
        <div className="grid md:grid-cols-3 gap-6">
          {/* By Action */}
          <div>
            <h3 className="text-sm font-medium text-slate-500 mb-3">By Action</h3>
            <div className="space-y-2">
              {Object.entries(stats.ai.byAction).map(([action, count]) => (
                <div key={action} className="flex items-center justify-between text-sm">
                  <span className="text-slate-600">{formatAction(action)}</span>
                  <span className="font-medium">{count}</span>
                </div>
              ))}
            </div>
          </div>

          {/* By Model */}
          <div>
            <h3 className="text-sm font-medium text-slate-500 mb-3">By Model</h3>
            <div className="space-y-2">
              {Object.entries(stats.ai.byModel).map(([model, count]) => (
                <div key={model} className="flex items-center justify-between text-sm">
                  <span className="text-slate-600">{formatModel(model)}</span>
                  <span className="font-medium">{count}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Token Usage & Costs */}
          <div>
            <h3 className="text-sm font-medium text-slate-500 mb-3">Usage & Costs</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-600">Input Tokens</span>
                <span className="font-medium">{stats.ai.totalTokens.input.toLocaleString()}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-600">Output Tokens</span>
                <span className="font-medium">{stats.ai.totalTokens.output.toLocaleString()}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-600">Conversations</span>
                <span className="font-medium">{stats.ai.conversationCount}</span>
              </div>
              <div className="pt-2 border-t border-slate-100 space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-500">Assistant Cost</span>
                  <span className="text-slate-600">${(stats.ai.totalCostCents / 100).toFixed(3)}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-500">
                    Generation ({stats.ai.generationCosts?.tripGenerations || 0} trips)
                  </span>
                  <span className="text-slate-600">${(stats.ai.generationCosts?.totalUsd || 0).toFixed(3)}</span>
                </div>
                <div className="flex items-center justify-between text-sm pt-2 border-t border-slate-100">
                  <span className="text-slate-700 font-medium">Total AI Cost</span>
                  <span className="font-bold text-[var(--primary)] text-base">
                    ${(stats.ai.totalCostUsd || 0).toFixed(2)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Geo Analytics - Visitors by Country */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-[var(--foreground)]">
              Visitor Analytics
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              Geographic distribution of page views
            </p>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[var(--primary)]"></span>
              <span className="text-slate-500">{stats.geo.totalPageViews.toLocaleString()} total views</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[var(--secondary)]"></span>
              <span className="text-slate-500">{stats.geo.uniqueVisitors.toLocaleString()} unique</span>
            </div>
          </div>
        </div>

        {stats.geo.totalPageViews === 0 ? (
          <div className="text-center py-12 text-slate-400">
            <svg className="w-12 h-12 mx-auto mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p>No page view data yet</p>
            <p className="text-sm mt-1">Visitor data will appear once deployed to Vercel</p>
          </div>
        ) : (
          <div className="grid md:grid-cols-3 gap-6">
            {/* By Country */}
            <div>
              <h3 className="text-sm font-medium text-slate-500 mb-3 flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                By Country
              </h3>
              <div className="space-y-2">
                {stats.geo.byCountry.length === 0 ? (
                  <p className="text-sm text-slate-400">No country data</p>
                ) : (
                  stats.geo.byCountry.slice(0, 8).map((item, i) => (
                    <div key={item.countryCode || item.country} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <span className="w-5 h-5 flex items-center justify-center rounded bg-slate-100 text-xs font-medium text-slate-500">
                          {i + 1}
                        </span>
                        <span className="text-slate-600">
                          {getCountryFlag(item.countryCode)} {item.country}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{item.count}</span>
                        <span className="text-xs text-slate-400">({item.percentage}%)</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* By City */}
            <div>
              <h3 className="text-sm font-medium text-slate-500 mb-3 flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Top Cities
              </h3>
              <div className="space-y-2">
                {stats.geo.byCity.length === 0 ? (
                  <p className="text-sm text-slate-400">No city data</p>
                ) : (
                  stats.geo.byCity.slice(0, 8).map((item, i) => (
                    <div key={`${item.city}-${item.country}`} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <span className="w-5 h-5 flex items-center justify-center rounded bg-slate-100 text-xs font-medium text-slate-500">
                          {i + 1}
                        </span>
                        <span className="text-slate-600">{item.city}</span>
                        <span className="text-xs text-slate-400">{item.country}</span>
                      </div>
                      <span className="font-medium">{item.count}</span>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Top Pages */}
            <div>
              <h3 className="text-sm font-medium text-slate-500 mb-3 flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Top Pages
              </h3>
              <div className="space-y-2">
                {stats.geo.topPages.length === 0 ? (
                  <p className="text-sm text-slate-400">No page data</p>
                ) : (
                  stats.geo.topPages.slice(0, 8).map((item, i) => (
                    <div key={item.path} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2 overflow-hidden">
                        <span className="w-5 h-5 flex items-center justify-center rounded bg-slate-100 text-xs font-medium text-slate-500 flex-shrink-0">
                          {i + 1}
                        </span>
                        <span className="text-slate-600 truncate" title={item.path}>
                          {item.path === "/" ? "Home" : item.path}
                        </span>
                      </div>
                      <span className="font-medium flex-shrink-0">{item.count}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* Time-based stats */}
        {stats.geo.totalPageViews > 0 && (
          <div className="grid grid-cols-3 gap-4 mt-6 pt-6 border-t border-slate-100">
            <div className="text-center">
              <div className="text-2xl font-bold text-[var(--foreground)]">
                {stats.geo.totalPageViews.toLocaleString()}
              </div>
              <div className="text-sm text-slate-500">Total Page Views</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600">
                {stats.geo.last7Days.toLocaleString()}
              </div>
              <div className="text-sm text-green-600">Last 7 Days</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600">
                {stats.geo.last30Days.toLocaleString()}
              </div>
              <div className="text-sm text-blue-600">Last 30 Days</div>
            </div>
          </div>
        )}
      </div>

      {/* Recent Activity */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <h2 className="text-lg font-semibold text-[var(--foreground)] mb-4">
          Recent Activity
        </h2>
        <div className="space-y-3">
          {stats.recentActivity.map((activity, i) => (
            <div
              key={`${activity.timestamp}-${i}`}
              className="flex items-center gap-3 text-sm"
            >
              <ActivityIcon type={activity.type} />
              <span className="flex-1 text-slate-600">{activity.description}</span>
              <span className="text-xs text-slate-400">
                {formatTimestamp(activity.timestamp)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Email Subscribers */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <h2 className="text-lg font-semibold text-[var(--foreground)] mb-4">
          Email Subscribers (Waitlist)
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="text-center p-4 bg-slate-50 rounded-xl">
            <div className="text-2xl font-bold text-[var(--foreground)]">
              {stats.subscribers.total}
            </div>
            <div className="text-sm text-slate-500">Total</div>
          </div>
          <div className="text-center p-4 bg-green-50 rounded-xl">
            <div className="text-2xl font-bold text-green-600">
              {stats.subscribers.last7Days}
            </div>
            <div className="text-sm text-green-600">This Week</div>
          </div>
          <div className="text-center p-4 bg-blue-50 rounded-xl">
            <div className="text-2xl font-bold text-blue-600">
              {stats.subscribers.verified}
            </div>
            <div className="text-sm text-blue-600">Verified</div>
          </div>
          <div className="text-center p-4 bg-red-50 rounded-xl">
            <div className="text-2xl font-bold text-red-600">
              {stats.subscribers.unsubscribed}
            </div>
            <div className="text-sm text-red-600">Unsubscribed</div>
          </div>
        </div>
      </div>
        </>
      )}
    </div>
  );
}

// Helper Components
function MetricCard({
  title,
  value,
  subtitle,
  icon,
  color,
}: {
  title: string;
  value: number;
  subtitle: string;
  icon: string;
  color: "primary" | "secondary" | "accent" | "navy";
}) {
  const colorClasses = {
    primary: "bg-[var(--primary)]/10 text-[var(--primary)]",
    secondary: "bg-[var(--secondary)]/10 text-[var(--secondary)]",
    accent: "bg-[var(--accent)]/20 text-amber-600",
    navy: "bg-slate-100 text-slate-600",
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5">
      <div className="flex items-start justify-between mb-3">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${colorClasses[color]}`}>
          <IconComponent name={icon} />
        </div>
      </div>
      <div className="text-2xl font-bold text-[var(--foreground)]">{value}</div>
      <div className="text-sm text-slate-500 mt-1">{title}</div>
      <div className="text-xs text-green-600 mt-2">{subtitle}</div>
    </div>
  );
}

function StatRow({
  label,
  value,
  highlight,
  warning,
}: {
  label: string;
  value: number | string;
  highlight?: boolean;
  warning?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-600">{label}</span>
      <span
        className={`font-semibold ${
          warning ? "text-amber-600" : highlight ? "text-green-600" : ""
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    planning: "bg-blue-100 text-blue-700",
    confirmed: "bg-green-100 text-green-700",
    active: "bg-purple-100 text-purple-700",
    completed: "bg-slate-100 text-slate-700",
    cancelled: "bg-red-100 text-red-700",
  };

  return (
    <span className={`w-2 h-2 rounded-full ${colors[status]?.split(" ")[0] || "bg-slate-300"}`} />
  );
}

function ActivityIcon({ type }: { type: string }) {
  const icons: Record<string, { bg: string; icon: string }> = {
    user: { bg: "bg-blue-100", icon: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" },
    trip: { bg: "bg-green-100", icon: "M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" },
    ai: { bg: "bg-purple-100", icon: "M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" },
    subscriber: { bg: "bg-amber-100", icon: "M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" },
  };

  const config = icons[type] || icons.user;

  return (
    <div className={`w-8 h-8 rounded-lg ${config.bg} flex items-center justify-center`}>
      <svg className="w-4 h-4 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={config.icon} />
      </svg>
    </div>
  );
}

function IconComponent({ name }: { name: string }) {
  const icons: Record<string, string> = {
    users: "M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z",
    map: "M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7",
    sparkles: "M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z",
    mail: "M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z",
  };

  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={icons[name]} />
    </svg>
  );
}

function formatAction(action: string): string {
  return action
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatModel(model: string): string {
  return model.replace("gemini-", "").replace("-", " ");
}

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

// Heat map color for retention percentage
function getRetentionColor(percentage: number): string {
  // Red (0%) -> Orange (25%) -> Yellow (50%) -> Lime (75%) -> Green (100%)
  if (percentage >= 80) return "#22c55e"; // green-500
  if (percentage >= 60) return "#84cc16"; // lime-500
  if (percentage >= 40) return "#eab308"; // yellow-500
  if (percentage >= 20) return "#f97316"; // orange-500
  return "#ef4444"; // red-500
}

// Convert country code to flag emoji
function getCountryFlag(countryCode: string | undefined): string {
  if (!countryCode || countryCode.length !== 2) return "🌍";

  const codePoints = countryCode
    .toUpperCase()
    .split("")
    .map((char) => 127397 + char.charCodeAt(0));

  return String.fromCodePoint(...codePoints);
}
