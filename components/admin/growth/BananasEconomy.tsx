import type { GrowthStats } from "@/lib/admin/growth/types";

// ============================================
// BANANAS ECONOMY COMPONENT
// ============================================
export function BananasEconomy({ bananas }: { bananas: GrowthStats["bananasEconomy"] }) {
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
            <p className="text-xs text-slate-500">No earnings yet</p>
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
