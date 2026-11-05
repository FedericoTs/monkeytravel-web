"use client";

import { useEffect, useState, useCallback } from "react";
import type { GrowthStats } from "@/lib/admin/growth/types";
import { RetentionMetrics } from "@/components/admin/growth/RetentionMetrics";
import { AARRRFunnel } from "@/components/admin/growth/AARRRFunnel";
import { UserLifecycle } from "@/components/admin/growth/UserLifecycle";
import { ReferralAnalytics } from "@/components/admin/growth/ReferralAnalytics";
import { ViralityPlaybook } from "@/components/admin/growth/ViralityPlaybook";
import { AhaMomentTable } from "@/components/admin/growth/AhaMomentTable";
import { Collapsible } from "@/components/admin/growth/Collapsible";
import { CollaborationAnalytics } from "@/components/admin/growth/CollaborationAnalytics";
import { BananasEconomy } from "@/components/admin/growth/BananasEconomy";

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

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

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

  const collabHasData = stats.collaboration.totalCollaborators > 0 || stats.collaboration.totalProposals > 0;
  const bananasHasData = stats.bananasEconomy.overview.totalEarned > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-500">
          {lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : ""}
        </span>
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

      {/* Data warnings (only if a query actually errored) */}
      {stats.meta.dataWarnings.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3">
          <p className="text-xs text-red-700">
            <strong>Data warning:</strong> some metrics may be wrong — {stats.meta.dataWarnings.join("; ")}
          </p>
        </div>
      )}

      {/* Retention */}
      <RetentionMetrics retention={stats.retention} meta={stats.meta} />

      {/* Funnel + Lifecycle */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <AARRRFunnel funnel={stats.funnel} />
        <UserLifecycle lifecycle={stats.lifecycle} />
      </div>

      {/* Sharing & Virality — the headline section */}
      <ReferralAnalytics
        referral={stats.referral}
        collaboration={stats.collaboration}
        meta={stats.meta}
      />

      {/* Virality Playbook — what to DO */}
      <ViralityPlaybook
        referral={stats.referral}
        collaboration={stats.collaboration}
        meta={stats.meta}
      />

      {/* Aha Moments */}
      <AhaMomentTable ahaMoments={stats.ahaMoments} meta={stats.meta} />

      {/* Collaboration — collapsed by default when low data */}
      <Collapsible
        title="Collaboration Analytics"
        badge={collabHasData ? undefined : "Low data"}
        defaultOpen={collabHasData}
      >
        <CollaborationAnalytics collaboration={stats.collaboration} />
      </Collapsible>

      {/* Bananas Economy — collapsed by default when low data */}
      <Collapsible
        title="Bananas Economy"
        badge={bananasHasData ? undefined : "Low data"}
        defaultOpen={bananasHasData}
      >
        <BananasEconomy bananas={stats.bananasEconomy} />
      </Collapsible>

      {/* Honest data-quality footnote */}
      <div className="bg-slate-50 rounded-xl p-4">
        <p className="text-xs text-slate-500">
          <strong>Method:</strong>{" "}
          {stats.meta.retentionMethod === "activity_proxy"
            ? "Retention is activity-based (sign-in tracking not wired) — directional, not exact."
            : "Retention uses real sign-in timestamps."}{" "}
          Reach = distinct anonymous engagers on shared trips.{" "}
          {!stats.meta.referralAttributionWired &&
            "K-Factor is n/a until referral attribution is wired (referred signups aren't recorded yet). "}
          Samples: D1={stats.retention.sampleSizes.d1Eligible}, D7=
          {stats.retention.sampleSizes.d7Eligible}, D30={stats.retention.sampleSizes.d30Eligible}.
        </p>
      </div>
    </div>
  );
}
