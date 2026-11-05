import type { GrowthStats } from "@/lib/admin/growth/types";

// ============================================
// SHARING & VIRALITY COMPONENT
// ============================================
export function ReferralAnalytics({
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
          <p className="text-xs text-slate-500 mt-3">
            These are your word-of-mouth engine. Reach out, reward them, ask what made them share.
          </p>
        </div>
      ) : (
        <div className="text-center py-6 text-slate-500 border-t border-slate-100">
          <p className="text-sm">No sharing or invites yet</p>
          <p className="text-xs mt-1">The playbook below has levers to kick-start the loop.</p>
        </div>
      )}
    </div>
  );
}
