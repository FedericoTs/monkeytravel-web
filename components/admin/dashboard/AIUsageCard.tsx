import type { AdminStats } from "@/lib/admin/stats/types";
import { formatAction } from "./RecentActivityCard";

// ===========================================================================
// AI Usage — compact strip + mobile-friendly breakdown
// ===========================================================================

export function AIUsageCard({ ai }: { ai: AdminStats["ai"] }) {
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
    primary: "text-[var(--primary-ink)]",
    emerald: "text-emerald-600",
    neutral: "text-slate-700",
  };
  return (
    <div className={`bg-gradient-to-br rounded-xl p-3 border ${toneClasses[tone]}`}>
      <div className={`text-lg sm:text-xl font-bold ${textClasses[tone]} leading-tight`}>
        {value}
      </div>
      <div className="text-[11px] text-slate-500 mt-0.5">{label}</div>
      {sub && <div className="text-[10px] text-slate-500 mt-0.5">{sub}</div>}
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
        <p className="text-sm text-slate-500">No data</p>
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

function formatModel(model: string): string {
  return model.replace("gemini-", "").replace("-", " ");
}
