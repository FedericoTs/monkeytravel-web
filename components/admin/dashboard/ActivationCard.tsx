import type { AdminStats } from "@/lib/admin/stats/types";
import ActivationFunnelPanel from "@/components/admin/ActivationFunnelPanel";

// ===========================================================================
// ActivationCard — replaces "User Metrics" + "Churn Analysis"
//
// Tells the story:
//   - Of your users, how many activated (created their first trip)?
//   - Of activated, how many came back for a 2nd trip?
//   - How fast does the median user reach activation?
//   - How many users are at risk (dormant 7d+ AND no trip)?
// ===========================================================================

export function ActivationCard({
  activation,
  engagement,
  users,
  funnel,
}: {
  activation: AdminStats["activation"];
  engagement: AdminStats["engagement"];
  users: AdminStats["users"];
  funnel?: AdminStats["activationFunnel"];
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
          color="bg-[var(--primary)]/5 border-[var(--primary)]/20 text-[var(--primary-ink)]"
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
      {funnel && <ActivationFunnelPanel funnel={funnel} />}
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
    primary: "text-[var(--primary-ink)]",
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

function formatHours(hours: number): string {
  if (hours <= 0) return "—";
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 24) return `${Math.round(hours * 10) / 10}h`;
  return `${Math.round(hours / 24)}d`;
}
