import type { AdminStats } from "@/app/api/admin/stats/route";

// ===========================================================================
// Cohort retention — kept (now at the bottom), with empty-state polish
// ===========================================================================

export function CohortRetentionCard({
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
                          <div className="mx-auto w-10 sm:w-12 h-7 sm:h-8 rounded bg-slate-100 flex items-center justify-center text-slate-500 text-[10px] sm:text-xs">
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
        <div className="text-center py-10 text-slate-500">
          <p>Not enough data for cohort analysis yet</p>
          <p className="text-xs mt-1">Matrix fills in as more users sign up</p>
        </div>
      )}
    </div>
  );
}

function getRetentionColor(percentage: number): string {
  if (percentage >= 80) return "#22c55e";
  if (percentage >= 60) return "#84cc16";
  if (percentage >= 40) return "#eab308";
  if (percentage >= 20) return "#f97316";
  return "#ef4444";
}
