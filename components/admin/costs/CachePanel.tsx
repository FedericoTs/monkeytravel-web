import type { EnhancedCostAnalytics } from "@/lib/admin/costs/types";

export function CachePanel({ cache }: { cache: EnhancedCostAnalytics["cache"] }) {
  const circumference = 2 * Math.PI * 40;
  const strokeDashoffset = circumference - (cache.hitRate / 100) * circumference;

  return (
    <div className="bg-white rounded-2xl border border-[var(--foreground-light)]/20 p-6">
      <h3 className="text-sm font-semibold text-[var(--foreground)] mb-4">
        Cache Performance
      </h3>
      <div className="flex items-center gap-6">
        {/* Gauge */}
        <div className="relative">
          <svg className="w-24 h-24 transform -rotate-90">
            <circle
              cx="48"
              cy="48"
              r="40"
              stroke="currentColor"
              strokeWidth="8"
              fill="none"
              className="text-[var(--foreground-light)]/30"
            />
            <circle
              cx="48"
              cy="48"
              r="40"
              stroke="currentColor"
              strokeWidth="8"
              fill="none"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              className={`transition-all duration-1000 ${
                cache.hitRate >= 80 ? "text-[var(--success)]" :
                cache.hitRate >= 50 ? "text-[var(--warning)]" :
                "text-[var(--error)]"
              }`}
              strokeLinecap="round"
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className={`text-xl font-bold ${
              cache.hitRate >= 80 ? "text-[var(--success)]" :
              cache.hitRate >= 50 ? "text-orange-500" :
              "text-[var(--error)]"
            }`}>
              {cache.hitRate.toFixed(0)}%
            </span>
          </div>
        </div>

        {/* Stats */}
        <div className="flex-1 space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-xs text-[var(--foreground-muted)]">Hits</span>
            <span className="text-[var(--success)] font-semibold">{cache.totalHits.toLocaleString()}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-xs text-[var(--foreground-muted)]">Misses</span>
            <span className="text-[var(--error)] font-semibold">{cache.totalMisses.toLocaleString()}</span>
          </div>
          <div className="flex justify-between items-center pt-2 border-t border-[var(--foreground-light)]/20">
            <span className="text-xs text-[var(--foreground-muted)]">Saved</span>
            <span className="text-[var(--success)] font-bold">
              ${cache.estimatedSavingsUsd.toFixed(2)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
