import type { AdminStats } from "@/lib/admin/stats/types";

// ===========================================================================
// Trips card — status + top destinations side-by-side, stacks on mobile
// ===========================================================================

export function TripsCard({
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
            <p className="text-sm text-slate-500">No trips yet</p>
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
          <p className="text-slate-500 text-sm">No trips yet</p>
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
