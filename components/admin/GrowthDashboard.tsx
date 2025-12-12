"use client";

import { useEffect, useState, useCallback } from "react";
import type { GrowthStats } from "@/app/api/admin/growth/route";

// ============================================
// RETENTION METRICS COMPONENT
// ============================================
function RetentionMetrics({ retention }: { retention: GrowthStats["retention"] }) {
  const metrics = [
    {
      label: "D1 Retention",
      value: retention.d1,
      change: retention.d1Change,
      sample: retention.sampleSizes.d1Eligible,
      description: "Users who returned within 1 day",
      benchmark: 40, // Industry benchmark
    },
    {
      label: "D7 Retention",
      value: retention.d7,
      change: retention.d7Change,
      sample: retention.sampleSizes.d7Eligible,
      description: "Users who returned within 7 days",
      benchmark: 20,
    },
    {
      label: "D30 Retention",
      value: retention.d30,
      change: retention.d30Change,
      sample: retention.sampleSizes.d30Eligible,
      description: "Users who returned within 30 days",
      benchmark: 10,
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      {metrics.map((metric) => (
        <div
          key={metric.label}
          className="bg-white rounded-2xl border border-slate-200 p-6 relative overflow-hidden"
        >
          {/* Background progress indicator */}
          <div
            className="absolute bottom-0 left-0 right-0 h-1 bg-slate-100"
          >
            <div
              className={`h-full transition-all duration-500 ${
                metric.value >= metric.benchmark ? "bg-green-500" : "bg-amber-500"
              }`}
              style={{ width: `${Math.min(metric.value, 100)}%` }}
            />
          </div>

          <div className="flex items-start justify-between mb-2">
            <span className="text-sm font-medium text-slate-500">{metric.label}</span>
            {metric.change !== 0 && (
              <span
                className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                  metric.change > 0
                    ? "bg-green-100 text-green-700"
                    : "bg-red-100 text-red-700"
                }`}
              >
                {metric.change > 0 ? "+" : ""}{metric.change}%
              </span>
            )}
          </div>

          <div className="flex items-baseline gap-2">
            <span className="text-4xl font-bold text-[var(--foreground)]">
              {metric.value}%
            </span>
            <span className="text-sm text-slate-400">
              vs {metric.benchmark}% benchmark
            </span>
          </div>

          <p className="text-xs text-slate-400 mt-2">
            {metric.description} (n={metric.sample})
          </p>
        </div>
      ))}
    </div>
  );
}

// ============================================
// AARRR FUNNEL COMPONENT
// ============================================
function AARRRFunnel({ funnel }: { funnel: GrowthStats["funnel"] }) {
  const stages = [
    { key: "acquisition", label: "Acquisition", color: "bg-blue-500", description: "Total signups" },
    { key: "activation", label: "Activation", color: "bg-green-500", description: "Completed onboarding" },
    { key: "retention", label: "Retention", color: "bg-purple-500", description: "Returned after D1" },
    { key: "referral", label: "Referral", color: "bg-amber-500", description: "Referred others" },
    { key: "revenue", label: "Revenue", color: "bg-red-500", description: "Paying customers" },
  ] as const;

  const maxCount = funnel.acquisition.count || 1;

  // Calculate drop-offs for each stage
  const getDropOff = (index: number) => {
    if (index === 0) return 0;
    const prevData = funnel[stages[index - 1].key];
    const currData = funnel[stages[index].key];
    if (!prevData.count) return 0;
    return Math.round(((prevData.count - currData.count) / prevData.count) * 100);
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-6">
      <h3 className="text-lg font-semibold text-[var(--foreground)] mb-6">
        AARRR Funnel (Pirate Metrics)
      </h3>

      <div className="space-y-1">
        {stages.map((stage, index) => {
          const data = funnel[stage.key];
          const dropOff = getDropOff(index);

          return (
            <div key={stage.key}>
              {/* Drop-off indicator - shown BETWEEN rows as its own element */}
              {index > 0 && dropOff > 0 && (
                <div className="flex items-center justify-center py-1">
                  <div className="flex items-center gap-2">
                    <div className="h-px w-8 bg-red-200" />
                    <span className="text-xs text-red-600 font-semibold bg-red-100 px-2.5 py-1 rounded-full border border-red-200 shadow-sm">
                      -{dropOff}% drop
                    </span>
                    <div className="h-px w-8 bg-red-200" />
                  </div>
                </div>
              )}

              <div className="flex items-center gap-4 py-1">
                {/* Label */}
                <div className="w-24 flex-shrink-0">
                  <span className="text-sm font-medium text-slate-700">{stage.label}</span>
                </div>

                {/* Bar */}
                <div className="flex-1 h-10 bg-slate-100 rounded-lg overflow-hidden relative">
                  <div
                    className={`h-full ${stage.color} transition-all duration-700 ease-out flex items-center justify-end pr-3`}
                    style={{ width: `${Math.max((data.count / maxCount) * 100, 5)}%` }}
                  >
                    {data.percentage >= 10 && (
                      <span className="text-white text-sm font-semibold">
                        {data.percentage}%
                      </span>
                    )}
                  </div>
                  {data.percentage < 10 && (
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-600 text-sm font-semibold">
                      {data.percentage}%
                    </span>
                  )}
                </div>

                {/* Count */}
                <div className="w-20 text-right flex-shrink-0">
                  <span className="text-sm font-semibold text-slate-700">
                    {data.count.toLocaleString()}
                  </span>
                </div>
              </div>

              <p className="text-xs text-slate-400 ml-28 mt-1">{stage.description}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================
// USER LIFECYCLE COMPONENT
// ============================================
function UserLifecycle({ lifecycle }: { lifecycle: GrowthStats["lifecycle"] }) {
  const total = lifecycle.new + lifecycle.activated + lifecycle.engaged + lifecycle.powerUser;

  const stages = [
    {
      label: "New",
      value: lifecycle.new,
      color: "bg-slate-400",
      description: "0 trips",
    },
    {
      label: "Activated",
      value: lifecycle.activated,
      color: "bg-blue-500",
      description: "1 trip",
    },
    {
      label: "Engaged",
      value: lifecycle.engaged,
      color: "bg-purple-500",
      description: "2-4 trips",
    },
    {
      label: "Power User",
      value: lifecycle.powerUser,
      color: "bg-green-500",
      description: "5+ trips",
    },
  ];

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-6">
      <h3 className="text-lg font-semibold text-[var(--foreground)] mb-4">
        User Lifecycle Stages
      </h3>

      {/* Stacked bar */}
      <div className="h-8 rounded-lg overflow-hidden flex mb-6">
        {stages.map((stage) => {
          const percentage = total > 0 ? (stage.value / total) * 100 : 0;
          if (percentage === 0) return null;
          return (
            <div
              key={stage.label}
              className={`${stage.color} relative group transition-all hover:opacity-90`}
              style={{ width: `${percentage}%` }}
              title={`${stage.label}: ${stage.value} users (${Math.round(percentage)}%)`}
            >
              {percentage >= 15 && (
                <span className="absolute inset-0 flex items-center justify-center text-white text-xs font-semibold">
                  {Math.round(percentage)}%
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {stages.map((stage) => {
          const percentage = total > 0 ? Math.round((stage.value / total) * 100) : 0;
          return (
            <div key={stage.label} className="flex items-center gap-2">
              <div className={`w-3 h-3 rounded-full ${stage.color}`} />
              <div>
                <p className="text-sm font-medium text-slate-700">{stage.label}</p>
                <p className="text-xs text-slate-500">
                  {stage.value} ({percentage}%)
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================
// REFERRAL ANALYTICS COMPONENT (Sean Ellis)
// ============================================
function ReferralAnalytics({ referral }: { referral: GrowthStats["referral"] }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-6">
      <h3 className="text-lg font-semibold text-[var(--foreground)] mb-4">
        Sharing & Virality
      </h3>

      {/* K-Factor + Shares Per User - Hero metrics */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-gradient-to-r from-amber-50 to-amber-100 rounded-xl p-4">
          <p className="text-sm text-amber-700 font-medium">K-Factor</p>
          <p className="text-3xl font-bold text-amber-800">{referral.kFactor.toFixed(2)}</p>
          <p className="text-xs text-amber-600 mt-1">
            {referral.kFactor >= 1 ? "Viral!" : referral.kFactor >= 0.5 ? "Growing" : "Build sharing"}
          </p>
        </div>
        <div className="bg-gradient-to-r from-blue-50 to-blue-100 rounded-xl p-4">
          <p className="text-sm text-blue-700 font-medium">Shares/User</p>
          <p className="text-3xl font-bold text-blue-800">{referral.sharesPerUser.toFixed(2)}</p>
          <p className="text-xs text-blue-600 mt-1">
            Target: 2.0+ for growth
          </p>
        </div>
      </div>

      {/* Share Actions - The user ACTION */}
      <div className="mb-6">
        <p className="text-sm font-medium text-slate-600 mb-3">Share Actions</p>
        <div className="grid grid-cols-3 gap-3">
          <div className="text-center p-3 bg-emerald-50 rounded-lg border border-emerald-100">
            <p className="text-2xl font-bold text-emerald-700">{referral.totalTripShares}</p>
            <p className="text-xs text-emerald-600">Trips Shared</p>
          </div>
          <div className="text-center p-3 bg-emerald-50 rounded-lg border border-emerald-100">
            <p className="text-2xl font-bold text-emerald-700">{referral.usersWhoShared}</p>
            <p className="text-xs text-emerald-600">Sharers</p>
          </div>
          <div className="text-center p-3 bg-emerald-50 rounded-lg border border-emerald-100">
            <p className="text-2xl font-bold text-emerald-700">{referral.shareRate}%</p>
            <p className="text-xs text-emerald-600">Share Rate</p>
          </div>
        </div>
      </div>

      {/* Share Funnel: Shares → Views → Signups */}
      <div className="mb-6">
        <p className="text-sm font-medium text-slate-600 mb-3">Share Funnel</p>
        <div className="space-y-2">
          {[
            { label: "Trips Shared", value: referral.totalTripShares, color: "bg-emerald-500" },
            { label: "Share Views", value: referral.totalShareViews, color: "bg-blue-500" },
            { label: "Referral Clicks", value: referral.totalReferralClicks, color: "bg-purple-500" },
            { label: "Referred Signups", value: referral.referredSignups, color: "bg-amber-500" },
          ].map((item) => {
            const max = Math.max(referral.totalTripShares, 1);
            const width = (item.value / max) * 100;
            return (
              <div key={item.label} className="flex items-center gap-3">
                <span className="w-28 text-xs text-slate-500">{item.label}</span>
                <div className="flex-1 h-6 bg-slate-100 rounded overflow-hidden">
                  <div
                    className={`h-full ${item.color} flex items-center justify-end pr-2 transition-all duration-500`}
                    style={{ width: `${Math.max(width, 3)}%` }}
                  >
                    {width >= 20 && (
                      <span className="text-white text-xs font-medium">{item.value}</span>
                    )}
                  </div>
                </div>
                {width < 20 && (
                  <span className="text-xs text-slate-600 font-medium w-8">{item.value}</span>
                )}
              </div>
            );
          })}
        </div>
        {referral.conversionRate > 0 && (
          <p className="text-xs text-slate-500 mt-2 text-right">
            {referral.conversionRate}% click-to-signup conversion
          </p>
        )}
      </div>

      {/* Top Sharers */}
      {referral.topReferrers.length > 0 && (
        <div className="pt-4 border-t border-slate-100">
          <p className="text-sm font-medium text-slate-600 mb-3">Top Sharers</p>
          <div className="space-y-2">
            {referral.topReferrers.map((ref, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <span className="text-slate-600">
                  #{i + 1} {ref.name}
                </span>
                <div className="flex gap-3">
                  <span className="text-emerald-600 text-xs">{ref.shares} shares</span>
                  {ref.signups > 0 && (
                    <span className="text-amber-600 text-xs font-medium">{ref.signups} signups</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {referral.totalTripShares === 0 && (
        <div className="text-center py-6 text-slate-400">
          <p className="text-sm">No shares yet</p>
          <p className="text-xs mt-1">Encourage users to share their trips!</p>
        </div>
      )}
    </div>
  );
}

// ============================================
// AHA MOMENT TABLE COMPONENT
// ============================================
function AhaMomentTable({ ahaMoments }: { ahaMoments: GrowthStats["ahaMoments"] }) {
  const actions = [
    { key: "generatedItinerary", label: "Generated a Trip", icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" },
    { key: "sharedTrip", label: "Shared a Trip", icon: "M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" },
    { key: "completedOnboarding", label: "Completed Onboarding", icon: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" },
    { key: "usedAssistant", label: "Used AI Assistant", icon: "M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" },
  ] as const;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-[var(--foreground)]">
          Aha Moment Analysis
        </h3>
        <span className="text-xs text-slate-400 bg-slate-100 px-2 py-1 rounded-full">
          D7 Retention Correlation
        </span>
      </div>

      <p className="text-sm text-slate-500 mb-6">
        Compare D7 retention for users who took each action vs those who did not.
        Higher retention lift indicates a potential &quot;aha moment&quot;.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="text-left text-xs text-slate-500 border-b border-slate-100">
              <th className="pb-3 font-medium">Action</th>
              <th className="pb-3 font-medium text-center">Did It</th>
              <th className="pb-3 font-medium text-center">Didn&apos;t Do It</th>
              <th className="pb-3 font-medium text-right">Retention Lift</th>
            </tr>
          </thead>
          <tbody>
            {actions.map((action) => {
              const data = ahaMoments[action.key];
              const isPositive = data.retentionLift > 0;
              const isStrong = Math.abs(data.retentionLift) >= 50;

              return (
                <tr key={action.key} className="border-b border-slate-50 last:border-0">
                  <td className="py-4">
                    <div className="flex items-center gap-2">
                      <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={action.icon} />
                      </svg>
                      <span className="text-sm font-medium text-slate-700">{action.label}</span>
                    </div>
                  </td>
                  <td className="py-4 text-center">
                    <span className="text-sm font-semibold text-green-600">{data.didIt}%</span>
                  </td>
                  <td className="py-4 text-center">
                    <span className="text-sm font-semibold text-slate-500">{data.didntDoIt}%</span>
                  </td>
                  <td className="py-4 text-right">
                    <span
                      className={`inline-flex items-center gap-1 text-sm font-bold px-2 py-1 rounded-full ${
                        isPositive
                          ? isStrong
                            ? "bg-green-100 text-green-700"
                            : "bg-green-50 text-green-600"
                          : "bg-red-50 text-red-600"
                      }`}
                    >
                      {isPositive ? "+" : ""}{data.retentionLift}%
                      {isStrong && isPositive && (
                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M12.395 2.553a1 1 0 00-1.45-.385c-.345.23-.614.558-.822.88-.214.33-.403.713-.57 1.116-.334.804-.614 1.768-.84 2.734a31.365 31.365 0 00-.613 3.58 2.64 2.64 0 01-.945-1.067c-.328-.68-.398-1.534-.398-2.654A1 1 0 005.05 6.05 6.981 6.981 0 003 11a7 7 0 1011.95-4.95c-.592-.591-.98-.985-1.348-1.467-.363-.476-.724-1.063-1.207-2.03zM12.12 15.12A3 3 0 017 13s.879.5 2.5.5c0-1 .5-4 1.25-4.5.5 1 .786 1.293 1.371 1.879A2.99 2.99 0 0113 13a2.99 2.99 0 01-.879 2.121z" clipRule="evenodd" />
                        </svg>
                      )}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-4 p-3 bg-blue-50 rounded-lg">
        <p className="text-xs text-blue-700">
          <strong>Tip:</strong> Actions with 50%+ retention lift are strong candidates for your &quot;aha moment&quot;.
          Focus product development on getting users to complete these actions quickly.
        </p>
      </div>
    </div>
  );
}

// ============================================
// MAIN GROWTH DASHBOARD COMPONENT
// ============================================
export default function GrowthDashboard() {
  const [stats, setStats] = useState<GrowthStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/admin/growth");
      if (!response.ok) {
        throw new Error("Failed to fetch growth stats");
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

  // Empty state
  if (!stats && !loading && !error) {
    return (
      <div className="min-h-[400px] bg-white rounded-2xl border border-slate-200 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-[var(--foreground)] mb-2">Growth Metrics</h3>
          <p className="text-slate-500 mb-6 max-w-xs">
            Sean Ellis framework metrics: retention, AARRR funnel, referrals, and aha moments.
          </p>
          <button
            onClick={fetchStats}
            disabled={loading}
            className="px-6 py-3 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 transition font-medium disabled:opacity-50 flex items-center gap-2 mx-auto"
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
                Load Growth Metrics
              </>
            )}
          </button>
        </div>
      </div>
    );
  }

  // Error state
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

  // Loading state
  if (loading && !stats) {
    return (
      <div className="min-h-[400px] bg-white rounded-2xl border border-slate-200 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-emerald-200 border-t-emerald-600 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-500">Loading growth metrics...</p>
        </div>
      </div>
    );
  }

  if (!stats) return null;

  return (
    <div className="space-y-6">
      {/* Header */}
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

      {/* Retention Metrics - Hero Section */}
      <RetentionMetrics retention={stats.retention} />

      {/* Two Column Layout for Funnel and Lifecycle */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <AARRRFunnel funnel={stats.funnel} />
        <UserLifecycle lifecycle={stats.lifecycle} />
      </div>

      {/* Referral Analytics */}
      <ReferralAnalytics referral={stats.referral} />

      {/* Aha Moment Analysis */}
      <AhaMomentTable ahaMoments={stats.ahaMoments} />

      {/* Data Quality Notice */}
      <div className="bg-slate-50 rounded-xl p-4 text-center">
        <p className="text-xs text-slate-500">
          <strong>Note:</strong> Retention metrics require sufficient sample size for statistical significance.
          D1 needs 50+ eligible users, D7 needs 100+, D30 needs 500+ for reliable insights.
          Current samples: D1={stats.retention.sampleSizes.d1Eligible}, D7={stats.retention.sampleSizes.d7Eligible}, D30={stats.retention.sampleSizes.d30Eligible}
        </p>
      </div>
    </div>
  );
}
