"use client";

import { useState, useCallback, type ReactNode } from "react";
import type { AdminStats } from "@/app/api/admin/stats/route";
import type { Ux10xBaseline } from "@/app/api/admin/ux10x-baseline/route";
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

// ---------------------------------------------------------------------------
// AdminDashboard — 2026-05-28 refactor
//
// The user's brief:
//   - KEEP what works: the 4 KPI cards, the user-growth chart, recent activity
//   - IMPROVE everything else — many panels were "not telling much"
//   - MOBILE-FIRST — every section must look right at 360px before desktop
//   - No DB schema changes
//
// What changed vs the prior version:
//   * MetricCard now shows a week-over-week delta chip ("+12%" / "-4%")
//   * "User Metrics" + "Churn Analysis" → one ActivationCard that tells the
//     real activation story (signup → first trip → repeat → at-risk)
//   * "AI Agent Usage" 3-column grid → a mobile-friendly stat strip with a
//     cost-per-trip headline and compact action/model lists
//   * "Visitor Analytics" 3-column geo block → tabbed (Pages | Countries |
//     Cities) on mobile, 3-up on desktop
//   * "Email Subscribers" 4-card grid → single horizontal stat strip
//   * Tab bar now horizontally scrolls on mobile so all tabs are reachable
//   * Sections reordered: headline KPIs → user growth → activation → traffic
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
    { id: "analytics", label: "Analytics", color: "text-[var(--primary)]", icon: <BarsIcon /> },
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
        <span className="text-xs text-slate-400">
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

// ===========================================================================
// Ux10xBaselineCard — the North Star card (UX10X Master Plan Phase 0.5)
//
// Self-contained: its own fetch to /api/admin/ux10x-baseline, triggered by a
// button so it doesn't add load to the main stats call. Headlines Weekly
// Active Crews (the North Star, target >10/wk, today ~0), the pure-wizard
// step1->2 conversion, and a compact trailing-7d strip + 21-day sparkline,
// each shown against the frozen baseline the initiative is measured against.
// ===========================================================================

function Ux10xBaselineCard() {
  const [data, setData] = useState<Ux10xBaseline | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/admin/ux10x-baseline");
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const json = (await res.json()) as Ux10xBaseline;
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  const crews = data?.rates.weeklyActiveCrews ?? 0;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
      {/* Header band */}
      <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3 bg-gradient-to-r from-[var(--primary)]/10 to-transparent border-b border-slate-100">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-[var(--foreground)] flex items-center gap-2">
            <span>🎯</span> UX10X North Star
          </h3>
          <p className="text-[11px] text-slate-500 truncate">
            Weekly Active Crews — trips with ≥2 humans deciding
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="shrink-0 flex items-center gap-2 px-3 py-1.5 bg-[var(--primary)] hover:opacity-90 text-white rounded-lg text-sm transition disabled:opacity-50"
        >
          <RefreshIcon spinning={loading} />
          {data ? "Refresh" : "Load"}
        </button>
      </div>

      <div className="p-4 sm:p-5">
        {!data && !error && !loading && (
          <p className="text-sm text-slate-400 text-center py-4">
            Click “Load” to compute the baseline (a couple of DB queries).
          </p>
        )}
        {loading && !data && (
          <p className="text-sm text-slate-400 text-center py-4 animate-pulse">
            Computing baseline…
          </p>
        )}
        {error && (
          <div className="text-sm text-rose-600 text-center py-4">
            {error}{" "}
            <button onClick={load} className="underline hover:no-underline">
              Retry
            </button>
          </div>
        )}

        {data && (
          <div className="space-y-5">
            {/* North Star headline */}
            <div className="flex items-end justify-between gap-4">
              <div>
                <div className="text-[11px] uppercase tracking-wide text-slate-400 font-medium">
                  Weekly Active Crews
                </div>
                <div className="flex items-baseline gap-2">
                  <span
                    className={`text-4xl font-bold ${
                      crews > 0 ? "text-[var(--primary)]" : "text-slate-300"
                    }`}
                  >
                    {crews}
                  </span>
                  <span className="text-xs text-slate-400">/ target &gt;10</span>
                </div>
              </div>
              <div className="text-right text-[11px] text-slate-400 leading-tight">
                <div>baseline {data.frozenBaseline.weeklyActiveCrews}</div>
                <div>{data.frozenBaseline.label}</div>
              </div>
            </div>

            {/* Rate + trailing-7d strip */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
              <BaselineStat
                label="Step 1→2"
                value={`${data.rates.step1To2Pct}%`}
                baseline={`${data.frozenBaseline.step1To2Pct}%`}
              />
              <BaselineStat
                label="Anon starts 7d"
                value={data.last7d.anonStep1Sessions}
                baseline={`~${Math.round(data.frozenBaseline.anonStep1PerDayMedian * 7)}`}
              />
              <BaselineStat
                label="Saves 7d"
                value={data.last7d.saves}
                baseline={`~${Math.round(data.frozenBaseline.savesPerDay * 7)}`}
              />
              <BaselineStat
                label="Shares 7d"
                value={data.last7d.tripsShared}
              />
              <BaselineStat
                label="AI convos 7d"
                value={data.last7d.aiConversations}
                baseline={`~${Math.round(data.frozenBaseline.aiConversationsPerDay * 7)}`}
              />
            </div>

            {/* 21-day anonymous-starts sparkline */}
            <BaselineSparkline daily={data.daily} />

            <p className="text-[10px] text-slate-400">
              Updated {new Date(data.generatedAt).toLocaleString()}. Crews counts
              a second human voting or joining — passive share-visits excluded.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function BaselineStat({
  label,
  value,
  baseline,
}: {
  label: string;
  value: string | number;
  baseline?: string;
}) {
  return (
    <div className="rounded-xl bg-slate-50 border border-slate-100 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-slate-400 font-medium truncate">
        {label}
      </div>
      <div className="text-lg font-semibold text-[var(--foreground)] leading-tight">
        {value}
      </div>
      {baseline && (
        <div className="text-[10px] text-slate-400">base {baseline}</div>
      )}
    </div>
  );
}

function BaselineSparkline({ daily }: { daily: Ux10xBaseline["daily"] }) {
  // View is day-DESC; take the most recent 21 days and render oldest→newest.
  const rows = daily.slice(0, 21).slice().reverse();
  const max = Math.max(1, ...rows.map((r) => r.anonStep1Sessions));
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] uppercase tracking-wide text-slate-400 font-medium">
          Anon step-1 starts · last {rows.length}d
        </span>
        <span className="text-[10px] text-slate-400">peak {max}</span>
      </div>
      <div className="flex items-end gap-0.5 h-14">
        {rows.map((r) => (
          <div
            key={r.day}
            className="flex-1 bg-[var(--primary)]/70 rounded-sm min-h-[2px]"
            style={{ height: `${Math.round((r.anonStep1Sessions / max) * 100)}%` }}
            title={`${r.day}: ${r.anonStep1Sessions} starts, ${r.saves} saves`}
          />
        ))}
      </div>
    </div>
  );
}

// ===========================================================================
// MetricCard — keeps the look you liked, adds WoW chip
// ===========================================================================

function MetricCard({
  title,
  value,
  weekValue,
  deltaPct,
  icon,
  color,
}: {
  title: string;
  value: number;
  weekValue: number;
  deltaPct: number;
  icon: string;
  color: "primary" | "secondary" | "accent" | "navy";
}) {
  const colorClasses = {
    primary: "bg-[var(--primary)]/10 text-[var(--primary)]",
    secondary: "bg-[var(--secondary)]/10 text-[var(--secondary)]",
    accent: "bg-[var(--accent)]/20 text-amber-600",
    navy: "bg-slate-100 text-slate-600",
  };

  const deltaPositive = deltaPct > 0;
  const deltaNeutral = deltaPct === 0;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5">
      <div className="flex items-start justify-between mb-2 sm:mb-3">
        <div
          className={`w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center ${colorClasses[color]}`}
        >
          <IconComponent name={icon} />
        </div>
        {!deltaNeutral && (
          <span
            className={`text-[10px] sm:text-xs font-semibold px-2 py-0.5 rounded-full ${
              deltaPositive ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
            }`}
          >
            {deltaPositive ? "▲" : "▼"} {Math.abs(deltaPct)}%
          </span>
        )}
      </div>
      <div className="text-xl sm:text-2xl font-bold text-[var(--foreground)] leading-tight">
        {value.toLocaleString()}
      </div>
      <div className="text-xs sm:text-sm text-slate-500 mt-0.5">{title}</div>
      <div className="text-[11px] sm:text-xs text-slate-400 mt-1">
        +{weekValue.toLocaleString()} this week
      </div>
    </div>
  );
}

// ===========================================================================
// ActivationCard — replaces "User Metrics" + "Churn Analysis"
//
// Tells the story:
//   - Of your users, how many activated (created their first trip)?
//   - Of activated, how many came back for a 2nd trip?
//   - How fast does the median user reach activation?
//   - How many users are at risk (dormant 7d+ AND no trip)?
// ===========================================================================

function ActivationCard({
  activation,
  engagement,
  users,
}: {
  activation: AdminStats["activation"];
  engagement: AdminStats["engagement"];
  users: AdminStats["users"];
}) {
  const ttt = engagement.timeToFirstTrip;
  const medianFormatted = formatHours(ttt.medianHours);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6">
      <div className="flex items-center gap-2 mb-4">
        <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center">
          <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </span>
        <div className="min-w-0">
          <h2 className="text-base sm:text-lg font-semibold text-[var(--foreground)]">
            Activation
          </h2>
          <p className="text-[11px] sm:text-xs text-slate-500 truncate">
            Signup → first trip → repeat
          </p>
        </div>
      </div>

      {/* Three-step mini funnel — vertical on mobile, horizontal on desktop */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <FunnelStep
          step={1}
          label="Signed up"
          value={users.total}
          sub={`${users.newLast7Days} this week`}
          color="bg-slate-50 border-slate-200 text-slate-700"
        />
        <FunnelStep
          step={2}
          label="Created a trip"
          value={users.withTrips}
          sub={`${activation.signupToFirstTripPct}% of signups`}
          color="bg-emerald-50 border-emerald-100 text-emerald-700"
          highlight={activation.signupToFirstTripPct}
        />
        <FunnelStep
          step={3}
          label="2+ trips"
          value={activation.multiTripUsers}
          sub={`${activation.multiTripPct}% of activated`}
          color="bg-[var(--primary)]/5 border-[var(--primary)]/20 text-[var(--primary)]"
          highlight={activation.multiTripPct}
        />
      </div>

      {/* Median time to activate + at-risk callout */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 pt-4 border-t border-slate-100">
        <MicroStat label="Median time-to-trip" value={medianFormatted} tone="neutral" />
        <MicroStat label="Within 1h" value={ttt.within1h.toString()} tone="emerald" />
        <MicroStat
          label="Shared trips"
          value={`${activation.sharedTripPct}%`}
          tone="primary"
        />
        <MicroStat
          label="At risk"
          value={activation.atRiskUsers.toString()}
          tone={activation.atRiskUsers > 0 ? "amber" : "neutral"}
          tooltip="Signed up, never made a trip, last seen >7 days ago"
        />
      </div>
    </div>
  );
}

function FunnelStep({
  step,
  label,
  value,
  sub,
  color,
  highlight,
}: {
  step: number;
  label: string;
  value: number;
  sub: string;
  color: string;
  highlight?: number;
}) {
  return (
    <div className={`relative rounded-xl border p-4 ${color}`}>
      <div className="flex items-center gap-2 mb-2">
        <span className="w-5 h-5 rounded-full bg-white/70 text-[10px] font-bold flex items-center justify-center">
          {step}
        </span>
        <span className="text-xs font-medium">{label}</span>
      </div>
      <div className="text-2xl sm:text-3xl font-bold leading-none">
        {value.toLocaleString()}
      </div>
      <div className="text-[11px] mt-1 opacity-80">{sub}</div>
      {highlight !== undefined && (
        <div className="mt-2 h-1 bg-white/50 rounded-full overflow-hidden">
          <div
            className="h-full bg-current rounded-full transition-all duration-700"
            style={{ width: `${Math.min(highlight, 100)}%`, opacity: 0.7 }}
          />
        </div>
      )}
    </div>
  );
}

function MicroStat({
  label,
  value,
  tone,
  tooltip,
}: {
  label: string;
  value: string;
  tone: "neutral" | "emerald" | "primary" | "amber";
  tooltip?: string;
}) {
  const toneClasses = {
    neutral: "text-slate-700",
    emerald: "text-emerald-600",
    primary: "text-[var(--primary)]",
    amber: "text-amber-600",
  };
  return (
    <div className="relative group">
      <div className={`text-base sm:text-lg font-bold ${toneClasses[tone]}`}>{value}</div>
      <div className="text-[10px] sm:text-[11px] text-slate-500 leading-tight">{label}</div>
      {tooltip && (
        <div className="absolute bottom-full left-0 mb-1 px-2 py-1 bg-slate-800 text-white text-[10px] rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition pointer-events-none z-10">
          {tooltip}
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// AI Usage — compact strip + mobile-friendly breakdown
// ===========================================================================

function AIUsageCard({ ai }: { ai: AdminStats["ai"] }) {
  const topActions = Object.entries(ai.byAction)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);
  const topModels = Object.entries(ai.byModel)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);

  const totalRequests = topActions.reduce((sum, [, c]) => sum + c, 0);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
      <div className="p-5 sm:p-6 border-b border-slate-100">
        <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-violet-600 flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 10V3L4 14h7v7l9-11h-7z"
                />
              </svg>
            </span>
            <div>
              <h2 className="text-base sm:text-lg font-semibold text-[var(--foreground)]">
                AI Spend
              </h2>
              <p className="text-[11px] sm:text-xs text-slate-500">
                Generation + assistant combined
              </p>
            </div>
          </div>
          {ai.deltaPctWoW !== 0 && (
            <span
              className={`text-[10px] sm:text-xs font-semibold px-2 py-0.5 rounded-full ${
                ai.deltaPctWoW > 0
                  ? "bg-rose-50 text-rose-700"
                  : "bg-emerald-50 text-emerald-700"
              }`}
              title="Week-over-week change in request volume"
            >
              {ai.deltaPctWoW > 0 ? "▲" : "▼"} {Math.abs(ai.deltaPctWoW)}%
            </span>
          )}
        </div>

        {/* Cost strip — mobile-first 2x2, desktop 4-up */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <CostStat
            label="Total cost"
            value={`$${ai.totalCostUsd.toFixed(2)}`}
            tone="primary"
          />
          <CostStat
            label="Per trip"
            value={ai.costPerTripUsd > 0 ? `$${ai.costPerTripUsd.toFixed(4)}` : "—"}
            tone="emerald"
            sub={`${ai.generationCosts.tripGenerations} gens`}
          />
          <CostStat
            label="Requests"
            value={ai.totalRequests.toLocaleString()}
            tone="neutral"
            sub={`${ai.last7Days} this week`}
          />
          <CostStat
            label="Conversations"
            value={ai.conversationCount.toLocaleString()}
            tone="neutral"
            sub={`${(ai.totalTokens.input + ai.totalTokens.output).toLocaleString()} tokens`}
          />
        </div>
      </div>

      {/* Breakdown — full-width lists, side-by-side on desktop */}
      <div className="grid md:grid-cols-2 gap-0">
        <BreakdownList
          title="By Action"
          rows={topActions.map(([k, v]) => ({
            label: formatAction(k),
            value: v,
            pct: totalRequests > 0 ? (v / totalRequests) * 100 : 0,
          }))}
          accent="#7c3aed"
          className="p-5 sm:p-6 md:border-r border-slate-100"
        />
        <BreakdownList
          title="By Model"
          rows={topModels.map(([k, v]) => ({
            label: formatModel(k),
            value: v,
            pct: totalRequests > 0 ? (v / totalRequests) * 100 : 0,
          }))}
          accent="#0891b2"
          className="p-5 sm:p-6 border-t md:border-t-0 border-slate-100"
        />
      </div>
    </div>
  );
}

function CostStat({
  label,
  value,
  tone,
  sub,
}: {
  label: string;
  value: string;
  tone: "primary" | "emerald" | "neutral";
  sub?: string;
}) {
  const toneClasses = {
    primary: "from-[var(--primary)]/5 to-[var(--primary)]/10 border-[var(--primary)]/20",
    emerald: "from-emerald-50 to-emerald-100/50 border-emerald-100",
    neutral: "from-slate-50 to-slate-100/50 border-slate-100",
  };
  const textClasses = {
    primary: "text-[var(--primary)]",
    emerald: "text-emerald-600",
    neutral: "text-slate-700",
  };
  return (
    <div className={`bg-gradient-to-br rounded-xl p-3 border ${toneClasses[tone]}`}>
      <div className={`text-lg sm:text-xl font-bold ${textClasses[tone]} leading-tight`}>
        {value}
      </div>
      <div className="text-[11px] text-slate-500 mt-0.5">{label}</div>
      {sub && <div className="text-[10px] text-slate-400 mt-0.5">{sub}</div>}
    </div>
  );
}

function BreakdownList({
  title,
  rows,
  accent,
  className,
}: {
  title: string;
  rows: { label: string; value: number; pct: number }[];
  accent: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <h3 className="text-sm font-semibold text-slate-600 mb-3">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-400">No data</p>
      ) : (
        <div className="space-y-2.5">
          {rows.map((row) => (
            <div key={row.label}>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-slate-700 font-medium truncate pr-2">{row.label}</span>
                <span className="text-slate-500 flex-shrink-0">
                  {row.value.toLocaleString()}
                </span>
              </div>
              <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{ width: `${row.pct}%`, backgroundColor: accent, opacity: 0.7 }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// Visitor Analytics — tabbed on mobile, 3-up on desktop
// ===========================================================================

function VisitorAnalyticsCard({ geo }: { geo: AdminStats["geo"] }) {
  const [tab, setTab] = useState<"pages" | "countries" | "cities">("pages");

  if (geo.totalPageViews === 0) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <h2 className="text-base sm:text-lg font-semibold text-[var(--foreground)] mb-2">
          Visitor Analytics
        </h2>
        <div className="text-center py-10 text-slate-400">
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
                    ? "bg-white text-[var(--primary)] shadow-sm"
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
        {tab === "countries" && <GeoList rows={geo.byCountry.map((c) => ({ label: `${getCountryFlag(c.countryCode)} ${c.country}`, value: c.count, extra: `${c.percentage}%` }))} />}
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
          <GeoList rows={geo.byCountry.map((c) => ({ label: `${getCountryFlag(c.countryCode)} ${c.country}`, value: c.count, extra: `${c.percentage}%` }))} />
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
    return <p className="text-sm text-slate-400">No data</p>;
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
            {row.extra && <span className="text-xs text-slate-400">{row.extra}</span>}
            <span className="font-medium">{row.value.toLocaleString()}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ===========================================================================
// Trips card — status + top destinations side-by-side, stacks on mobile
// ===========================================================================

function TripsCard({
  trips,
  topDestinations,
}: {
  trips: AdminStats["trips"];
  topDestinations: AdminStats["topDestinations"];
}) {
  const totalByStatus = Object.values(trips.byStatus).reduce((a, b) => a + b, 0) || 1;

  return (
    <div className="grid md:grid-cols-2 gap-4 sm:gap-6">
      <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6">
        <h2 className="text-base sm:text-lg font-semibold text-[var(--foreground)] mb-1">
          Trips
        </h2>
        <p className="text-[11px] text-slate-500 mb-4">
          {trips.total.toLocaleString()} total · {trips.averagePerUser} avg/user
        </p>
        <div className="space-y-2.5">
          {Object.entries(trips.byStatus).length === 0 ? (
            <p className="text-sm text-slate-400">No trips yet</p>
          ) : (
            Object.entries(trips.byStatus).map(([status, count]) => {
              const pct = (count / totalByStatus) * 100;
              const colors: Record<string, string> = {
                planning: "#3b82f6",
                confirmed: "#10b981",
                active: "#8b5cf6",
                completed: "#64748b",
                cancelled: "#ef4444",
              };
              const color = colors[status] || "#94a3b8";
              return (
                <div key={status}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="text-slate-700 capitalize">{status}</span>
                    <span className="text-slate-500 text-xs">
                      {count.toLocaleString()} ({pct.toFixed(0)}%)
                    </span>
                  </div>
                  <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{ width: `${pct}%`, backgroundColor: color, opacity: 0.8 }}
                    />
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6">
        <h2 className="text-base sm:text-lg font-semibold text-[var(--foreground)] mb-1">
          Top Destinations
        </h2>
        <p className="text-[11px] text-slate-500 mb-4">From trip metadata</p>
        {topDestinations.length === 0 ? (
          <p className="text-slate-400 text-sm">No trips yet</p>
        ) : (
          <div className="space-y-2">
            {topDestinations.slice(0, 8).map((dest, i) => (
              <div key={dest.destination} className="flex items-center gap-3">
                <span className="w-5 h-5 flex-shrink-0 flex items-center justify-center rounded bg-slate-100 text-[10px] font-medium text-slate-500">
                  {i + 1}
                </span>
                <span className="flex-1 text-sm text-slate-700 truncate" title={dest.destination}>
                  {dest.destination}
                </span>
                <span className="text-sm font-medium text-slate-500 flex-shrink-0">
                  {dest.count}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ===========================================================================
// Subscribers — single horizontal strip (was: 4-card grid)
// ===========================================================================

function SubscribersStrip({ subscribers }: { subscribers: AdminStats["subscribers"] }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6">
      <div className="flex items-center gap-2 mb-4">
        <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500 to-amber-600 flex items-center justify-center">
          <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
            />
          </svg>
        </span>
        <h2 className="text-base sm:text-lg font-semibold text-[var(--foreground)]">
          Email Subscribers
        </h2>
      </div>
      <div className="grid grid-cols-4 gap-2 sm:gap-4 divide-x divide-slate-100">
        <SubStat label="Total" value={subscribers.total} tone="slate" />
        <SubStat label="Verified" value={subscribers.verified} tone="blue" />
        <SubStat label="This week" value={subscribers.last7Days} tone="emerald" />
        <SubStat label="Unsubscribed" value={subscribers.unsubscribed} tone="rose" />
      </div>
    </div>
  );
}

function SubStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "slate" | "blue" | "emerald" | "rose";
}) {
  const toneClasses = {
    slate: "text-slate-700",
    blue: "text-blue-600",
    emerald: "text-emerald-600",
    rose: "text-rose-600",
  };
  return (
    <div className="px-2 sm:px-4 text-center first:pl-0 last:pr-0">
      <div className={`text-xl sm:text-2xl font-bold ${toneClasses[tone]}`}>
        {value.toLocaleString()}
      </div>
      <div className="text-[10px] sm:text-xs text-slate-500 mt-0.5">{label}</div>
    </div>
  );
}

// ===========================================================================
// Cohort retention — kept (now at the bottom), with empty-state polish
// ===========================================================================

function CohortRetentionCard({
  cohortRetention,
}: {
  cohortRetention: AdminStats["churn"]["cohortRetention"];
}) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6">
      <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
        <div>
          <h2 className="text-base sm:text-lg font-semibold text-[var(--foreground)]">
            Weekly Cohort Retention
          </h2>
          <p className="text-[11px] sm:text-sm text-slate-500 mt-1">
            % of each signup-week cohort still active in each subsequent week
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-[10px]">
          <span className="text-slate-500">Low</span>
          <div className="flex">
            <div className="w-3.5 h-3.5 bg-red-500 rounded-l" />
            <div className="w-3.5 h-3.5 bg-orange-400" />
            <div className="w-3.5 h-3.5 bg-yellow-400" />
            <div className="w-3.5 h-3.5 bg-lime-400" />
            <div className="w-3.5 h-3.5 bg-green-500 rounded-r" />
          </div>
          <span className="text-slate-500">High</span>
        </div>
      </div>

      {cohortRetention && cohortRetention.length > 0 ? (
        <div className="overflow-x-auto -mx-5 sm:-mx-6 px-5 sm:px-6">
          <table className="w-full text-xs sm:text-sm min-w-[480px]">
            <thead>
              <tr>
                <th className="text-left py-2 px-2 sm:px-3 font-medium text-slate-600 bg-slate-50 rounded-tl-lg">
                  Cohort
                </th>
                <th className="text-center py-2 px-2 sm:px-3 font-medium text-slate-600 bg-slate-50">
                  Users
                </th>
                {Array.from({ length: 8 }).map((_, i) => (
                  <th
                    key={i}
                    className={`text-center py-2 px-1 sm:px-3 font-medium text-slate-600 bg-slate-50 ${
                      i === 7 ? "rounded-tr-lg" : ""
                    }`}
                  >
                    W{i}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cohortRetention.map((cohort, cohortIndex) => (
                <tr
                  key={cohort.cohort}
                  className={cohortIndex % 2 === 0 ? "bg-white" : "bg-slate-50/50"}
                >
                  <td className="py-2 px-2 sm:px-3 font-medium text-slate-700 whitespace-nowrap">
                    {cohort.cohort}
                  </td>
                  <td className="py-2 px-2 sm:px-3 text-center text-slate-600">
                    {cohort.cohortSize}
                  </td>
                  {Array.from({ length: 8 }).map((_, weekIndex) => {
                    const retention = cohort.retention[weekIndex];
                    const hasData = retention !== undefined;
                    return (
                      <td key={weekIndex} className="py-2 px-1 text-center">
                        {hasData ? (
                          <div
                            className="mx-auto w-10 sm:w-12 h-7 sm:h-8 rounded flex items-center justify-center text-[10px] sm:text-xs font-semibold"
                            style={{
                              backgroundColor: getRetentionColor(retention),
                              color: retention > 50 ? "#fff" : "#374151",
                            }}
                          >
                            {retention}%
                          </div>
                        ) : (
                          <div className="mx-auto w-10 sm:w-12 h-7 sm:h-8 rounded bg-slate-100 flex items-center justify-center text-slate-400 text-[10px] sm:text-xs">
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
        <div className="text-center py-10 text-slate-400">
          <p>Not enough data for cohort analysis yet</p>
          <p className="text-xs mt-1">Matrix fills in as more users sign up</p>
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// Recent Activity — KEPT (the user explicitly liked this)
// ===========================================================================

function RecentActivityCard({
  activities,
}: {
  activities: AdminStats["recentActivity"];
}) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6">
      <h2 className="text-base sm:text-lg font-semibold text-[var(--foreground)] mb-4">
        Recent Activity
      </h2>
      {activities.length === 0 ? (
        <p className="text-sm text-slate-400">No activity yet</p>
      ) : (
        <div className="space-y-2.5">
          {activities.map((activity, i) => (
            <div
              key={`${activity.timestamp}-${i}`}
              className="flex items-center gap-3 text-xs sm:text-sm"
            >
              <ActivityIcon type={activity.type} />
              <span className="flex-1 text-slate-600 truncate" title={activity.description}>
                {activity.description}
              </span>
              <span className="text-[10px] sm:text-xs text-slate-400 flex-shrink-0">
                {formatTimestamp(activity.timestamp)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// Shared bits — empty / loading / error / icons / formatters
// ===========================================================================

function EmptyState({ onLoad }: { onLoad: () => void }) {
  return (
    <div className="min-h-[300px] sm:min-h-[400px] bg-white rounded-2xl border border-slate-200 flex items-center justify-center p-6">
      <div className="text-center">
        <div className="w-16 h-16 rounded-full bg-[var(--primary)]/10 flex items-center justify-center mx-auto mb-4">
          <BarsIcon className="w-8 h-8 text-[var(--primary)]" />
        </div>
        <h3 className="text-lg font-semibold text-[var(--foreground)] mb-2">Analytics Data</h3>
        <p className="text-slate-500 mb-6 max-w-xs text-sm">
          Click to load analytics. Data is not auto-loaded to minimize cost.
        </p>
        <button
          onClick={onLoad}
          className="px-6 py-3 bg-[var(--primary)] text-white rounded-xl hover:opacity-90 transition font-medium"
        >
          Load Analytics
        </button>
      </div>
    </div>
  );
}

function ErrorState({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
      <p className="text-red-600 font-medium">Error: {error}</p>
      <button
        onClick={onRetry}
        className="mt-3 px-4 py-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition"
      >
        Retry
      </button>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="min-h-[300px] sm:min-h-[400px] bg-white rounded-2xl border border-slate-200 flex items-center justify-center">
      <div className="text-center">
        <div className="w-12 h-12 border-4 border-[var(--primary)]/20 border-t-[var(--primary)] rounded-full animate-spin mx-auto mb-4" />
        <p className="text-slate-500 text-sm">Loading analytics...</p>
      </div>
    </div>
  );
}

function ActivityIcon({ type }: { type: string }) {
  const icons: Record<string, { bg: string; icon: string }> = {
    user: {
      bg: "bg-blue-100",
      icon: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z",
    },
    trip: {
      bg: "bg-green-100",
      icon: "M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7",
    },
    ai: {
      bg: "bg-purple-100",
      icon: "M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z",
    },
    subscriber: {
      bg: "bg-amber-100",
      icon: "M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z",
    },
  };
  const config = icons[type] || icons.user;
  return (
    <div
      className={`w-7 h-7 sm:w-8 sm:h-8 rounded-lg ${config.bg} flex items-center justify-center flex-shrink-0`}
    >
      <svg
        className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-slate-600"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d={config.icon}
        />
      </svg>
    </div>
  );
}

function IconComponent({ name }: { name: string }) {
  const icons: Record<string, string> = {
    users:
      "M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z",
    map:
      "M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7",
    sparkles:
      "M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z",
    eye:
      "M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z",
  };
  return (
    <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={icons[name]} />
    </svg>
  );
}

// --- Tab-bar icons -------------------------------------------------------
function BarsIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className || "w-4 h-4"} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
      />
    </svg>
  );
}
function UpRightIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
      />
    </svg>
  );
}
function CoinIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  );
}
function CodeIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
      />
    </svg>
  );
}
function DocIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
      />
    </svg>
  );
}
function LockIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
      />
    </svg>
  );
}
function KeyIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
      />
    </svg>
  );
}
function RefreshIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg
      className={`w-4 h-4 ${spinning ? "animate-spin" : ""}`}
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
  );
}

// --- Formatters ----------------------------------------------------------

function formatAction(action: string): string {
  return action
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatModel(model: string): string {
  return model.replace("gemini-", "").replace("-", " ");
}

function formatHours(hours: number): string {
  if (hours <= 0) return "—";
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 24) return `${Math.round(hours * 10) / 10}h`;
  return `${Math.round(hours / 24)}d`;
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

function getRetentionColor(percentage: number): string {
  if (percentage >= 80) return "#22c55e";
  if (percentage >= 60) return "#84cc16";
  if (percentage >= 40) return "#eab308";
  if (percentage >= 20) return "#f97316";
  return "#ef4444";
}

function getCountryFlag(countryCode: string | undefined): string {
  if (!countryCode || countryCode.length !== 2) return "🌍";
  const codePoints = countryCode
    .toUpperCase()
    .split("")
    .map((char) => 127397 + char.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}
