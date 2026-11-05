import type { GrowthStats } from "@/lib/admin/growth/types";

// ============================================
// VIRALITY PLAYBOOK COMPONENT (actionable levers)
// ============================================
export function ViralityPlaybook({
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
