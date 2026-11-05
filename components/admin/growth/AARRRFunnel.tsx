import type { GrowthStats } from "@/lib/admin/growth/types";

// ============================================
// AARRR FUNNEL COMPONENT
// ============================================
export function AARRRFunnel({ funnel }: { funnel: GrowthStats["funnel"] }) {
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

              <p className="text-xs text-slate-500 ml-28 mt-1">{stage.description}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
