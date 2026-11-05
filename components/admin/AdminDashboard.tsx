"use client";

import { useState, useCallback, type ReactNode } from "react";
import type { AdminStats } from "@/app/api/admin/stats/route";
import {
  LazyUserGrowthChart,
  LazyTrafficOverview,
  LazyAcquisitionEngagement,
  LazyCostCommandCenter,
  LazyAccessControl,
  LazyApiControlPanel,
  LazyPromptEditor,
  LazyAccessCodesManager,
  LazyGrowthDashboard,
  preloadAdminTab,
} from "@/lib/lazy";
import { BarsIcon, CodeIcon, CoinIcon, DocIcon, KeyIcon, LockIcon, RefreshIcon, UpRightIcon } from "@/components/admin/dashboard/icons";
import { Ux10xBaselineCard } from "@/components/admin/dashboard/Ux10xBaselineCard";
import { EmptyState, ErrorState, LoadingState } from "@/components/admin/dashboard/states";
import { MetricCard } from "@/components/admin/dashboard/MetricCard";
import { ActivationCard } from "@/components/admin/dashboard/ActivationCard";
import { AIUsageCard } from "@/components/admin/dashboard/AIUsageCard";
import { VisitorAnalyticsCard } from "@/components/admin/dashboard/VisitorAnalyticsCard";
import { TripsCard } from "@/components/admin/dashboard/TripsCard";
import { SubscribersStrip } from "@/components/admin/dashboard/SubscribersStrip";
import { CohortRetentionCard } from "@/components/admin/dashboard/CohortRetentionCard";
import { RecentActivityCard } from "@/components/admin/dashboard/RecentActivityCard";

// ---------------------------------------------------------------------------
// AdminDashboard
//
// Mobile-first: every section must look right at 360px before desktop.
//   * MetricCard shows a week-over-week delta chip ("+12%" / "-4%")
//   * ActivationCard tells the activation story (signup → first trip →
//     repeat → at-risk)
//   * AI usage is a stat strip with a cost-per-trip headline and compact
//     action/model lists
//   * Visitor geo is tabbed (Pages | Countries | Cities) on mobile, 3-up on
//     desktop
//   * Email subscribers are a single horizontal stat strip
//   * The tab bar scrolls horizontally on mobile so all tabs are reachable
//   * Section order: headline KPIs → user growth → activation → traffic
//     → acquisition → AI → visitors → trips → subscribers → cohort → activity
// ---------------------------------------------------------------------------

type TabId = "analytics" | "growth" | "costs" | "apis" | "prompts" | "access" | "codes";

export default function AdminDashboard() {
  const [activeTab, setActiveTab] = useState<TabId>("analytics");
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(false);
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

  return (
    <div className="space-y-6 sm:space-y-8">
      <DashboardHeader activeTab={activeTab} setActiveTab={setActiveTab} />

      {/* Non-analytics tabs render their own root */}
      {activeTab === "growth" && <LazyGrowthDashboard />}
      {activeTab === "costs" && <LazyCostCommandCenter />}
      {activeTab === "apis" && <LazyApiControlPanel />}
      {activeTab === "prompts" && <LazyPromptEditor />}
      {activeTab === "access" && <LazyAccessControl />}
      {activeTab === "codes" && <LazyAccessCodesManager />}

      {/* Analytics tab */}
      {activeTab === "analytics" && (
        <AnalyticsTab
          stats={stats}
          loading={loading}
          error={error}
          lastUpdated={lastUpdated}
          onRefresh={fetchStats}
        />
      )}
    </div>
  );
}

// ===========================================================================
// Header + tab bar
// ===========================================================================

function DashboardHeader({
  activeTab,
  setActiveTab,
}: {
  activeTab: TabId;
  setActiveTab: (t: TabId) => void;
}) {
  // Mobile: tab bar scrolls horizontally so every tab is reachable (the
  // old layout hid APIs+Prompts on small screens). Desktop: same row,
  // no scroll needed.
  const tabs: { id: TabId; label: string; color: string; icon: ReactNode }[] = [
    { id: "analytics", label: "Analytics", color: "text-[var(--primary-ink)]", icon: <BarsIcon /> },
    { id: "growth", label: "Growth", color: "text-emerald-600", icon: <UpRightIcon /> },
    { id: "costs", label: "Costs", color: "text-red-600", icon: <CoinIcon /> },
    { id: "apis", label: "APIs", color: "text-green-600", icon: <CodeIcon /> },
    { id: "prompts", label: "Prompts", color: "text-purple-600", icon: <DocIcon /> },
    { id: "access", label: "Access", color: "text-amber-600", icon: <LockIcon /> },
    { id: "codes", label: "Codes", color: "text-emerald-600", icon: <KeyIcon /> },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold text-[var(--foreground)]">Admin Dashboard</h1>
        <p className="text-slate-500 mt-1 text-sm">Analytics, costs, and access control</p>
      </div>

      <div className="-mx-4 sm:mx-0 px-4 sm:px-0 overflow-x-auto scrollbar-thin">
        <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-xl min-w-max">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                onMouseEnter={() => {
                  // preloadAdminTab only knows about the lazy-loaded tabs
                  if (tab.id !== "analytics") {
                    preloadAdminTab(tab.id as Exclude<TabId, "analytics">);
                  }
                }}
                className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-lg text-sm font-medium transition whitespace-nowrap ${
                  isActive
                    ? `bg-white ${tab.color} shadow-sm`
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <span className="w-4 h-4">{tab.icon}</span>
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// Analytics tab — the meat of the refactor
// ===========================================================================

function AnalyticsTab({
  stats,
  loading,
  error,
  lastUpdated,
  onRefresh,
}: {
  stats: AdminStats | null;
  loading: boolean;
  error: string | null;
  lastUpdated: Date | null;
  onRefresh: () => void;
}) {
  return (
    <div className="space-y-6 sm:space-y-8">
      {/* Refresh bar */}
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-slate-500">
          {lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : "Not loaded yet"}
        </span>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg text-sm text-slate-600 transition disabled:opacity-50"
        >
          <RefreshIcon spinning={loading} />
          Refresh
        </button>
      </div>

      {/* UX10X North Star — loads on its own click, independent of the main
          stats fetch above (kept at the very top: it's the metric that matters). */}
      <Ux10xBaselineCard />

      {!stats && !error && !loading && <EmptyState onLoad={onRefresh} />}
      {error && <ErrorState error={error} onRetry={onRefresh} />}
      {loading && !stats && <LoadingState />}

      {stats && <AnalyticsBody stats={stats} />}
    </div>
  );
}

function AnalyticsBody({ stats }: { stats: AdminStats }) {
  return (
    <>
      {/* 1. Headline KPI grid — KEPT (with new WoW delta chip) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <MetricCard
          title="Total Users"
          value={stats.users.total}
          weekValue={stats.users.newLast7Days}
          deltaPct={stats.users.deltaPctWoW}
          icon="users"
          color="primary"
        />
        <MetricCard
          title="Total Trips"
          value={stats.trips.total}
          weekValue={stats.trips.last7Days}
          deltaPct={stats.trips.deltaPctWoW}
          icon="map"
          color="secondary"
        />
        <MetricCard
          title="AI Requests"
          value={stats.ai.totalRequests}
          weekValue={stats.ai.last7Days}
          deltaPct={stats.ai.deltaPctWoW}
          icon="sparkles"
          color="accent"
        />
        <MetricCard
          title="Page Views"
          value={stats.geo.totalPageViews}
          weekValue={stats.geo.last7Days}
          deltaPct={stats.geo.deltaPctWoW}
          icon="eye"
          color="navy"
        />
      </div>

      {/* 2. User Growth Trend — KEPT */}
      <LazyUserGrowthChart data={stats.userTrend} />

      {/* 3. NEW Activation card — replaces User Metrics + Churn Analysis */}
      <ActivationCard
        activation={stats.activation}
        engagement={stats.engagement}
        users={stats.users}
        funnel={stats.activationFunnel}
      />

      {/* 4. Traffic Overview (chart + section + funnel) — kept, mobile-tuned by component */}
      {stats.geo.traffic && <LazyTrafficOverview data={stats.geo.traffic} />}

      {/* 5. Acquisition & Engagement — kept */}
      <LazyAcquisitionEngagement acquisition={stats.acquisition} engagement={stats.engagement} />

      {/* 6. AI Usage — compact mobile strip */}
      <AIUsageCard ai={stats.ai} />

      {/* 7. Visitor Analytics — tabbed on mobile, 3-up on desktop */}
      <VisitorAnalyticsCard geo={stats.geo} />

      {/* 8. Trips: status + top destinations — tighter layout */}
      <TripsCard trips={stats.trips} topDestinations={stats.topDestinations} />

      {/* 9. Email Subscribers — single strip */}
      <SubscribersStrip subscribers={stats.subscribers} />

      {/* 10. Cohort retention matrix — at the bottom (needs scale to be useful) */}
      <CohortRetentionCard cohortRetention={stats.churn.cohortRetention} />

      {/* 11. Recent Activity — KEPT */}
      <RecentActivityCard activities={stats.recentActivity} />
    </>
  );
}
