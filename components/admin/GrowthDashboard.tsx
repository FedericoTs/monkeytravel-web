"use client";

import { useEffect, useState, useCallback, type ReactNode } from "react";
import type { GrowthStats } from "@/app/api/admin/growth/route";

// ============================================
// RETENTION METRICS COMPONENT
// ============================================
function RetentionMetrics({
  retention,
  meta,
}: {
  retention: GrowthStats["retention"];
  meta: GrowthStats["meta"];
}) {
  const metrics = [
    {
      label: "D1 Retention",
      value: retention.d1,
      change: retention.d1Change,
      sample: retention.sampleSizes.d1Eligible,
      description: "Came back within 1 day",
      benchmark: 40,
    },
    {
      label: "D7 Retention",
      value: retention.d7,
      change: retention.d7Change,
      sample: retention.sampleSizes.d7Eligible,
      description: "Came back within 7 days",
      benchmark: 20,
    },
    {
      label: "D30 Retention",
      value: retention.d30,
      change: retention.d30Change,
      sample: retention.sampleSizes.d30Eligible,
      description: "Came back within 30 days",
      benchmark: 10,
    },
  ];

  return (
    <div>
      {meta.retentionMethod === "activity_proxy" && (
        <p className="text-xs text-amber-600 mb-2">
          <strong>Activity-based</strong> — sign-in tracking isn&apos;t wired yet, so &quot;came back&quot;
          counts users who created another trip, used the assistant, or earned bananas after signup.
          Directional proxy until <code className="bg-amber-50 px-1 rounded">last_seen_at</code> lands.
        </p>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {metrics.map((metric) => (
          <div
            key={metric.label}
            className="bg-white rounded-2xl border border-slate-200 p-6 relative overflow-hidden"
          >
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-slate-100">
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
                  {metric.change > 0 ? "+" : ""}
                  {metric.change}%
                </span>
              )}
            </div>

            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-bold text-[var(--foreground)]">{metric.value}%</span>
              <span className="text-sm text-slate-400">vs {metric.benchmark}% benchmark</span>
            </div>

            <p className="text-xs text-slate-400 mt-2">
              {metric.description} (n={metric.sample})
            </p>
          </div>
        ))}
      </div>
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
    { key: "retention", label: "Retention", color: "bg-purple-500", description: "Active after day 1" },
    { key: "referral", label: "Referral", color: "bg-amber-500", description: "Shared or invited others" },
    { key: "revenue", label: "Revenue", color: "bg-red-500", description: "Paying customers" },
  ] as const;

  const maxCount = funnel.acquisition.count || 1;

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
                <div className="w-24 flex-shrink-0">
                  <span className="text-sm font-medium text-slate-700">{stage.label}</span>
                </div>

                <div className="flex-1 h-10 bg-slate-100 rounded-lg overflow-hidden relative">
                  <div
                    className={`h-full ${stage.color} transition-all duration-700 ease-out flex items-center justify-end pr-3`}
                    style={{ width: `${Math.max((data.count / maxCount) * 100, 5)}%` }}
                  >
                    {data.percentage >= 10 && (
                      <span className="text-white text-sm font-semibold">{data.percentage}%</span>
                    )}
                  </div>
                  {data.percentage < 10 && (
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-600 text-sm font-semibold">
                      {data.percentage}%
                    </span>
                  )}
                </div>

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
    { label: "New", value: lifecycle.new, color: "bg-slate-400", description: "0 trips" },
    { label: "Activated", value: lifecycle.activated, color: "bg-blue-500", description: "1 trip" },
    { label: "Engaged", value: lifecycle.engaged, color: "bg-purple-500", description: "2-4 trips" },
    { label: "Power User", value: lifecycle.powerUser, color: "bg-green-500", description: "5+ trips" },
  ];

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-6">
      <h3 className="text-lg font-semibold text-[var(--foreground)] mb-4">User Lifecycle Stages</h3>

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
// SHARING & VIRALITY COMPONENT
// ============================================
function ReferralAnalytics({
  referral,
  collaboration,
  meta,
}: {
  referral: GrowthStats["referral"];
  collaboration: GrowthStats["collaboration"];
  meta: GrowthStats["meta"];
}) {
  const kWired = meta.referralAttributionWired;

  // Share loop: shares -> anonymous reach -> referral clicks -> referred signups.
  const shareLoop = [
    { label: "Trips Shared", value: referral.totalTripShares, color: "bg-emerald-500" },
    { label: "Anon. engagers", value: referral.anonymousEngagers, color: "bg-teal-500" },
    { label: "Referral Clicks", value: referral.totalReferralClicks, color: "bg-blue-500" },
    { label: "Referred Signups", value: referral.referredSignups, color: "bg-amber-500" },
  ];
  const shareMax = Math.max(...shareLoop.map((s) => s.value), 1);

  // Invite loop
  const invitesAccepted = collaboration.funnel.invitesAccepted;
  const inviteLoop = [
    { label: "Invites Sent", value: collaboration.totalInvitesCreated, color: "bg-purple-500" },
    { label: "Accepted", value: invitesAccepted, color: "bg-indigo-500" },
    { label: "New Collaborators", value: collaboration.totalCollaborators, color: "bg-blue-500" },
  ];
  const inviteMax = Math.max(...inviteLoop.map((s) => s.value), 1);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-6">
      <h3 className="text-lg font-semibold text-[var(--foreground)] mb-1">Sharing &amp; Virality</h3>
      <p className="text-sm text-slate-500 mb-5">
        Is the viral loop turning, and where does it leak?
      </p>

      {/* Hero: K-Factor + Shares/User */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-gradient-to-r from-amber-50 to-amber-100 rounded-xl p-4">
          <p className="text-sm text-amber-700 font-medium">K-Factor</p>
          {kWired ? (
            <>
              <p className="text-3xl font-bold text-amber-800">{referral.kFactor.toFixed(2)}</p>
              <p className="text-xs text-amber-600 mt-1">
                {referral.kFactor >= 1 ? "Viral! (K≥1)" : referral.kFactor >= 0.5 ? "Growing" : "Build sharing"}
              </p>
            </>
          ) : (
            <>
              <p className="text-3xl font-bold text-amber-800/50">n/a</p>
              <p className="text-xs text-amber-600 mt-1">
                Referral attribution not wired — referred signups aren&apos;t recorded yet.
              </p>
            </>
          )}
        </div>
        <div className="bg-gradient-to-r from-blue-50 to-blue-100 rounded-xl p-4">
          <p className="text-sm text-blue-700 font-medium">Shares / Sharer</p>
          <p className="text-3xl font-bold text-blue-800">{referral.sharesPerUser.toFixed(2)}</p>
          <p className="text-xs text-blue-600 mt-1">Target: 2.0+ for compounding growth</p>
        </div>
      </div>

      {/* Share actions */}
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
        {referral.anonymousEngagers > 0 && (
          <p className="text-xs text-teal-600 mt-2">
            <strong>{referral.anonymousEngagers}</strong> anonymous people engaged with{" "}
            <strong>{referral.sharedTripsWithEngagement}</strong> shared trip
            {referral.sharedTripsWithEngagement === 1 ? "" : "s"} — your real viral reach today.
          </p>
        )}
      </div>

      {/* Two loops side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Share loop */}
        <div>
          <p className="text-sm font-medium text-slate-600 mb-3">Share loop</p>
          <div className="space-y-2">
            {shareLoop.map((item) => {
              const width = (item.value / shareMax) * 100;
              return (
                <div key={item.label} className="flex items-center gap-3">
                  <span className="w-28 text-xs text-slate-500">{item.label}</span>
                  <div className="flex-1 h-6 bg-slate-100 rounded overflow-hidden">
                    <div
                      className={`h-full ${item.color} flex items-center justify-end pr-2 transition-all duration-500`}
                      style={{ width: `${Math.max(width, 3)}%` }}
                    >
                      {width >= 25 && <span className="text-white text-xs font-medium">{item.value}</span>}
                    </div>
                  </div>
                  {width < 25 && <span className="text-xs text-slate-600 font-medium w-8">{item.value}</span>}
                </div>
              );
            })}
          </div>
        </div>
        {/* Invite loop */}
        <div>
          <p className="text-sm font-medium text-slate-600 mb-3">Invite loop</p>
          <div className="space-y-2">
            {inviteLoop.map((item) => {
              const width = (item.value / inviteMax) * 100;
              return (
                <div key={item.label} className="flex items-center gap-3">
                  <span className="w-32 text-xs text-slate-500">{item.label}</span>
                  <div className="flex-1 h-6 bg-slate-100 rounded overflow-hidden">
                    <div
                      className={`h-full ${item.color} flex items-center justify-end pr-2 transition-all duration-500`}
                      style={{ width: `${Math.max(width, 3)}%` }}
                    >
                      {width >= 25 && <span className="text-white text-xs font-medium">{item.value}</span>}
                    </div>
                  </div>
                  {width < 25 && <span className="text-xs text-slate-600 font-medium w-8">{item.value}</span>}
                </div>
              );
            })}
          </div>
          <p className="text-xs text-slate-500 mt-2">
            Accept rate: <strong>{collaboration.inviteAcceptRate}%</strong>
            {collaboration.totalInvitesCreated > 0 && invitesAccepted === 0 && (
              <span className="text-amber-600"> — verify invite accept increments use_count</span>
            )}
          </p>
        </div>
      </div>

      {/* Champions leaderboard */}
      {referral.topReferrers.length > 0 ? (
        <div className="pt-4 border-t border-slate-100">
          <p className="text-sm font-medium text-slate-600 mb-3">🏆 Top Champions (sharers + inviters)</p>
          <div className="space-y-2">
            {referral.topReferrers.map((ref, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <span className="text-slate-700 font-medium">
                  #{i + 1} {ref.name}
                </span>
                <div className="flex gap-3">
                  {ref.shares > 0 && <span className="text-emerald-600 text-xs">{ref.shares} shares</span>}
                  {ref.invites > 0 && <span className="text-purple-600 text-xs">{ref.invites} invites</span>}
                  {ref.signups > 0 && (
                    <span className="text-amber-600 text-xs font-medium">{ref.signups} signups</span>
                  )}
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-400 mt-3">
            These are your word-of-mouth engine. Reach out, reward them, ask what made them share.
          </p>
        </div>
      ) : (
        <div className="text-center py-6 text-slate-400 border-t border-slate-100">
          <p className="text-sm">No sharing or invites yet</p>
          <p className="text-xs mt-1">The playbook below has levers to kick-start the loop.</p>
        </div>
      )}
    </div>
  );
}

// ============================================
// VIRALITY PLAYBOOK COMPONENT (actionable levers)
// ============================================
function ViralityPlaybook({
  referral,
  collaboration,
  meta,
}: {
  referral: GrowthStats["referral"];
  collaboration: GrowthStats["collaboration"];
  meta: GrowthStats["meta"];
}) {
  const levers = [
    {
      title: "Convert anonymous engagers into accounts",
      why:
        referral.anonymousEngagers > 0
          ? `${referral.anonymousEngagers} people voted on ${referral.sharedTripsWithEngagement} shared trip(s) without signing up. That's warm intent leaking out.`
          : "When people engage with a shared trip without an account, that intent leaks out.",
      do: 'Add a "Create your own trip" / "Save your votes" CTA on the shared-trip page.',
      impact: "High",
      live: referral.anonymousEngagers > 0,
    },
    {
      title: "Reward sharing with Bananas",
      why: "The Bananas economy already has the rails (earn types + balances).",
      do: 'Add a "share → earn bananas" earn type so sharing pays off in-product.',
      impact: "High",
      live: true,
    },
    {
      title: "Fix + lower invite friction",
      why:
        collaboration.totalInvitesCreated > 0 && collaboration.funnel.invitesAccepted === 0
          ? `${collaboration.totalInvitesCreated} invites sent, ~0 accepted — the accept step looks broken.`
          : "Invite acceptance is the highest-intent path into the app.",
      do: "Verify invite-accept increments use_count, then make joining one-click from the link.",
      impact: "High",
      live: collaboration.totalInvitesCreated > 0,
    },
    {
      title: "Wire referral attribution",
      why: meta.referralAttributionWired
        ? "Attribution is wired — keep surfacing referrers' impact."
        : "Referral clicks are tracked but signups aren't attributed, so K-Factor reads n/a.",
      do: 'Persist ?ref through signup; set users.referred_by_code + increment referral_codes.total_signups. Then show referrers "you brought N friends".',
      impact: "Unblocks K",
      live: !meta.referralAttributionWired,
    },
    {
      title: "Nudge a share at the aha-moment",
      why: "The moment a trip is generated is peak excitement — the best time to ask for a share.",
      do: "Trigger a share prompt right after trip generation, not passively later.",
      impact: "Medium",
      live: false,
    },
  ];

  const impactColor = (impact: string) =>
    impact === "High"
      ? "bg-emerald-100 text-emerald-700"
      : impact === "Unblocks K"
      ? "bg-amber-100 text-amber-700"
      : "bg-slate-100 text-slate-600";

  return (
    <div className="bg-gradient-to-br from-emerald-50 to-teal-50 rounded-2xl border border-emerald-100 p-6">
      <h3 className="text-lg font-semibold text-[var(--foreground)] mb-1">📈 Virality Playbook</h3>
      <p className="text-sm text-slate-500 mb-5">
        Concrete levers to lift the loop — ordered by leverage, grounded in your data.
      </p>
      <div className="space-y-3">
        {levers.map((lever, i) => (
          <div key={i} className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="flex items-start justify-between gap-3 mb-1">
              <p className="text-sm font-semibold text-slate-800">
                {i + 1}. {lever.title}
              </p>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${impactColor(lever.impact)}`}>
                {lever.impact}
              </span>
            </div>
            <p className="text-xs text-slate-500 mb-1">{lever.why}</p>
            <p className="text-sm text-slate-700">
              <span className="text-emerald-700 font-medium">Do:</span> {lever.do}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================
// COLLAPSIBLE SECTION WRAPPER
// ============================================
function Collapsible({
  title,
  badge,
  defaultOpen,
  children,
}: {
  title: string;
  badge?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details open={defaultOpen} className="bg-white rounded-2xl border border-slate-200 overflow-hidden group">
      <summary className="cursor-pointer select-none px-6 py-4 flex items-center justify-between hover:bg-slate-50">
        <div className="flex items-center gap-2">
          <span className="text-lg font-semibold text-[var(--foreground)]">{title}</span>
          {badge && (
            <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full font-medium">
              {badge}
            </span>
          )}
        </div>
        <svg
          className="w-5 h-5 text-slate-400 transition-transform group-open:rotate-180"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </summary>
      <div className="px-1 pb-1">{children}</div>
    </details>
  );
}

// ============================================
// COLLABORATION ANALYTICS COMPONENT
// ============================================
function CollaborationAnalytics({ collaboration }: { collaboration: GrowthStats["collaboration"] }) {
  return (
    <div className="p-6 pt-2">
      <div className="mb-6">
        <p className="text-sm font-medium text-slate-600 mb-3">Adoption</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="text-center p-3 bg-purple-50 rounded-lg border border-purple-100">
            <p className="text-2xl font-bold text-purple-700">{collaboration.collaborativeTrips}</p>
            <p className="text-xs text-purple-600">Collaborative Trips</p>
          </div>
          <div className="text-center p-3 bg-purple-50 rounded-lg border border-purple-100">
            <p className="text-2xl font-bold text-purple-700">{collaboration.totalInvitesCreated}</p>
            <p className="text-xs text-purple-600">Invites Created</p>
          </div>
          <div className="text-center p-3 bg-purple-50 rounded-lg border border-purple-100">
            <p className="text-2xl font-bold text-purple-700">{collaboration.inviteAcceptRate}%</p>
            <p className="text-xs text-purple-600">Accept Rate</p>
          </div>
          <div className="text-center p-3 bg-purple-50 rounded-lg border border-purple-100">
            <p className="text-2xl font-bold text-purple-700">{collaboration.avgCollaboratorsPerTrip || 0}</p>
            <p className="text-xs text-purple-600">Avg Team Size</p>
          </div>
        </div>
      </div>

      {collaboration.totalProposals > 0 ? (
        <>
          <div className="mb-6">
            <p className="text-sm font-medium text-slate-600 mb-3">Proposal Pipeline</p>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              {[
                { label: "Pending", value: collaboration.proposalsByStatus.pending, color: "bg-slate-100 text-slate-700" },
                { label: "Voting", value: collaboration.proposalsByStatus.voting, color: "bg-blue-100 text-blue-700" },
                { label: "Approved", value: collaboration.proposalsByStatus.approved, color: "bg-green-100 text-green-700" },
                { label: "Rejected", value: collaboration.proposalsByStatus.rejected, color: "bg-red-100 text-red-700" },
                { label: "Withdrawn", value: collaboration.proposalsByStatus.withdrawn, color: "bg-amber-100 text-amber-700" },
                { label: "Expired", value: collaboration.proposalsByStatus.expired, color: "bg-gray-100 text-gray-700" },
              ].map((status) => (
                <div key={status.label} className={`text-center p-2 rounded-lg ${status.color}`}>
                  <p className="text-lg font-bold">{status.value}</p>
                  <p className="text-xs">{status.label}</p>
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
              <span>
                {collaboration.totalProposals} proposals from {collaboration.proposersCount} users
              </span>
              <span>Approval: {collaboration.proposalApprovalRate}%</span>
            </div>
          </div>

          <div className="mb-2">
            <p className="text-sm font-medium text-slate-600 mb-3">Voting Engagement</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="text-center p-3 bg-indigo-50 rounded-lg border border-indigo-100">
                <p className="text-2xl font-bold text-indigo-700">{collaboration.totalProposalVotes}</p>
                <p className="text-xs text-indigo-600">Total Votes</p>
              </div>
              <div className="text-center p-3 bg-indigo-50 rounded-lg border border-indigo-100">
                <p className="text-2xl font-bold text-indigo-700">{collaboration.uniqueVoters}</p>
                <p className="text-xs text-indigo-600">Unique Voters</p>
              </div>
              <div className="text-center p-3 bg-indigo-50 rounded-lg border border-indigo-100">
                <p className="text-2xl font-bold text-indigo-700">{collaboration.avgVotesPerProposal}</p>
                <p className="text-xs text-indigo-600">Avg Votes/Proposal</p>
              </div>
              <div className="text-center p-3 bg-indigo-50 rounded-lg border border-indigo-100">
                <p className="text-2xl font-bold text-indigo-700">{collaboration.participationRate}%</p>
                <p className="text-xs text-indigo-600">Participation</p>
              </div>
            </div>
          </div>
        </>
      ) : (
        <p className="text-sm text-slate-400 text-center py-4">
          No activity proposals yet — the propose/vote feature hasn&apos;t been used.
        </p>
      )}
    </div>
  );
}

// ============================================
// BANANAS ECONOMY COMPONENT
// ============================================
function BananasEconomy({ bananas }: { bananas: GrowthStats["bananasEconomy"] }) {
  const tierColors = ["bg-slate-400", "bg-amber-400", "bg-orange-500", "bg-purple-600"];
  const tierNames = ["Traveler", "Explorer", "Ambassador", "Champion"];

  return (
    <div className="p-6 pt-2">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <div className="bg-amber-50 rounded-xl p-4 border border-amber-100">
          <span className="text-xs text-amber-600 block mb-1">In Circulation</span>
          <div className="text-2xl font-bold text-amber-700">
            {bananas.overview.totalInCirculation.toLocaleString()}
          </div>
        </div>
        <div className="bg-green-50 rounded-xl p-4 border border-green-100">
          <span className="text-xs text-green-600 block mb-1">Total Earned</span>
          <div className="text-2xl font-bold text-green-700">{bananas.overview.totalEarned.toLocaleString()}</div>
          <div className="text-xs text-green-500 mt-1">
            {bananas.overview.velocity.changePercent > 0 ? "+" : ""}
            {bananas.overview.velocity.changePercent}% vs last week
          </div>
        </div>
        <div className="bg-blue-50 rounded-xl p-4 border border-blue-100">
          <span className="text-xs text-blue-600 block mb-1">Redemption Rate</span>
          <div className="text-2xl font-bold text-blue-700">{bananas.redemptions.redemptionRate}%</div>
          <div className="text-xs text-blue-500 mt-1">{bananas.redemptions.total} redemptions</div>
        </div>
        <div className="bg-purple-50 rounded-xl p-4 border border-purple-100">
          <span className="text-xs text-purple-600 block mb-1">Utilization</span>
          <div className="text-2xl font-bold text-purple-700">{bananas.expiration.utilizationRate}%</div>
          <div className="text-xs text-purple-500 mt-1">earned - expired</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-slate-50 rounded-xl p-4">
          <h4 className="text-sm font-medium text-slate-700 mb-3">Earning Breakdown</h4>
          {Object.keys(bananas.earningBreakdown.byType).length > 0 ? (
            Object.entries(bananas.earningBreakdown.byType)
              .sort((a, b) => b[1] - a[1])
              .map(([type, amount]) => (
                <div
                  key={type}
                  className="flex items-center justify-between py-1.5 border-b border-slate-100 last:border-0"
                >
                  <span className="text-xs text-slate-600 capitalize">{type.replace(/_/g, " ")}</span>
                  <span className="text-xs font-medium text-amber-700">{amount.toLocaleString()} 🍌</span>
                </div>
              ))
          ) : (
            <p className="text-xs text-slate-400">No earnings yet</p>
          )}
        </div>

        <div className="bg-slate-50 rounded-xl p-4">
          <h4 className="text-sm font-medium text-slate-700 mb-3">Tier Distribution</h4>
          <div className="h-4 rounded-full overflow-hidden flex bg-slate-100 mb-2">
            {[0, 1, 2, 3].map((tier) => {
              const tierData = bananas.tierDistribution[
                `tier${tier}` as keyof typeof bananas.tierDistribution
              ] as { count: number; pct: number };
              return (
                <div
                  key={tier}
                  className={`${tierColors[tier]} h-full transition-all`}
                  style={{ width: `${tierData.pct || 0}%` }}
                  title={`${tierNames[tier]}: ${tierData.count}`}
                />
              );
            })}
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-slate-500">
            {[0, 1, 2, 3].map((tier) => {
              const tierData = bananas.tierDistribution[
                `tier${tier}` as keyof typeof bananas.tierDistribution
              ] as { count: number; pct: number };
              return (
                <span key={tier} className="flex items-center gap-1">
                  <span className={`w-2 h-2 rounded-full ${tierColors[tier]}`} />
                  {tierNames[tier]}: {tierData.count}
                </span>
              );
            })}
          </div>
        </div>
      </div>

      {bananas.earningBreakdown.topEarners.length > 0 && (
        <div className="mt-6 bg-gradient-to-r from-amber-50 to-orange-50 rounded-xl p-4 border border-amber-100">
          <h4 className="text-sm font-medium text-amber-800 mb-3">Top Earners</h4>
          <div className="flex flex-wrap gap-3">
            {bananas.earningBreakdown.topEarners.map((earner, i) => (
              <div
                key={i}
                className="bg-white rounded-lg px-3 py-2 border border-amber-200 flex items-center gap-2"
              >
                <span className="text-sm font-medium text-slate-700">{earner.displayName}</span>
                <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">{earner.total} 🍌</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================
// AHA MOMENT TABLE COMPONENT
// ============================================
function AhaMomentTable({
  ahaMoments,
  meta,
}: {
  ahaMoments: GrowthStats["ahaMoments"];
  meta: GrowthStats["meta"];
}) {
  const actions = [
    { key: "generatedItinerary", label: "Generated a Trip" },
    { key: "sharedTrip", label: "Shared a Trip" },
    { key: "completedOnboarding", label: "Completed Onboarding" },
    { key: "usedAssistant", label: "Used AI Assistant" },
    { key: "createdInvite", label: "Created Invite Link" },
    { key: "joinedViaInvite", label: "Joined via Invite" },
    { key: "votedOnProposal", label: "Voted on Proposal" },
    { key: "createdProposal", label: "Created Proposal" },
  ] as const;

  // Only show actions with at least one cohort having a measurable rate.
  const rows = actions
    .map((a) => ({ ...a, data: ahaMoments[a.key] }))
    .filter((r) => r.data.didIt > 0 || r.data.didntDoIt > 0);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-6">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-lg font-semibold text-[var(--foreground)]">Aha Moment Analysis</h3>
        <span className="text-xs text-slate-400 bg-slate-100 px-2 py-1 rounded-full">
          {meta.retentionMethod === "activity_proxy" ? "Activity-based D7 lift" : "D7 retention lift"}
        </span>
      </div>

      <p className="text-sm text-slate-500 mb-6">
        Which actions correlate with users coming back? Higher lift = stronger &quot;aha moment&quot; to push users toward.
      </p>

      {rows.length === 0 ? (
        <p className="text-sm text-slate-400 text-center py-4">
          Not enough activity yet to measure retention lift.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-left text-xs text-slate-500 border-b border-slate-100">
                <th className="pb-3 font-medium">Action</th>
                <th className="pb-3 font-medium text-center">Did It</th>
                <th className="pb-3 font-medium text-center">Didn&apos;t</th>
                <th className="pb-3 font-medium text-right">Retention Lift</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const data = row.data;
                const isPositive = data.retentionLift > 0;
                const isStrong = Math.abs(data.retentionLift) >= 50;
                return (
                  <tr key={row.key} className="border-b border-slate-50 last:border-0">
                    <td className="py-4">
                      <span className="text-sm font-medium text-slate-700">{row.label}</span>
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
                        {isPositive ? "+" : ""}
                        {data.retentionLift}%
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 p-3 bg-blue-50 rounded-lg">
        <p className="text-xs text-blue-700">
          <strong>Tip:</strong> actions with 50%+ lift are your aha-moment candidates — get new users to do them fast.
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
        <span className="text-xs text-slate-400">
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
