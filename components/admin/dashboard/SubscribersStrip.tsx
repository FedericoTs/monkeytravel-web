import type { AdminStats } from "@/lib/admin/stats/types";

// ===========================================================================
// Subscribers — single horizontal strip (was: 4-card grid)
// ===========================================================================

export function SubscribersStrip({ subscribers }: { subscribers: AdminStats["subscribers"] }) {
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
