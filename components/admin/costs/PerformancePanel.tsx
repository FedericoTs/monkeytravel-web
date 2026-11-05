import type { EnhancedCostAnalytics } from "@/app/api/admin/costs/route";

export function PerformancePanel({ performance }: { performance: EnhancedCostAnalytics["performance"] }) {
  return (
    <div className="bg-white rounded-2xl border border-[var(--foreground-light)]/20 p-6">
      <h3 className="text-sm font-semibold text-[var(--foreground)] mb-4">
        Performance Metrics
      </h3>
      <div className="space-y-4">
        {/* Latency Percentiles */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-[var(--foreground-muted)]">Latency (ms)</span>
          </div>
          <div className="grid grid-cols-4 gap-2">
            <LatencyBadge label="AVG" value={performance.avgResponseTimeMs} />
            <LatencyBadge label="P50" value={performance.p50ResponseTimeMs} />
            <LatencyBadge label="P95" value={performance.p95ResponseTimeMs} color="warning" />
            <LatencyBadge label="P99" value={performance.p99ResponseTimeMs} color="error" />
          </div>
        </div>

        {/* Error Rate */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-[var(--foreground-muted)]">Error Rate</span>
            <span className={`text-xs font-medium ${
              performance.errorRate > 5 ? "text-[var(--error)]" :
              performance.errorRate > 1 ? "text-orange-500" :
              "text-[var(--success)]"
            }`}>
              {performance.totalErrors} errors
            </span>
          </div>
          <div className="h-2 bg-[var(--foreground-light)]/20 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all rounded-full ${
                performance.errorRate > 5 ? "bg-[var(--error)]" :
                performance.errorRate > 1 ? "bg-orange-500" :
                "bg-[var(--success)]"
              }`}
              style={{ width: `${Math.min(performance.errorRate, 100)}%` }}
            />
          </div>
          <div className="flex justify-between mt-2">
            <span className={`text-lg font-bold ${
              performance.errorRate > 5 ? "text-[var(--error)]" :
              performance.errorRate > 1 ? "text-orange-500" :
              "text-[var(--success)]"
            }`}>
              {performance.errorRate.toFixed(1)}%
            </span>
            <span className="text-sm text-[var(--success)]">
              {performance.successRate.toFixed(1)}% success
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function LatencyBadge({
  label,
  value,
  color = "secondary"
}: {
  label: string;
  value: number;
  color?: "secondary" | "warning" | "error";
}) {
  const colors = {
    secondary: "bg-[var(--secondary)]/10 text-[var(--secondary-ink)] border-[var(--secondary)]/20",
    warning: "bg-orange-50 text-orange-600 border-orange-200",
    error: "bg-[var(--error)]/10 text-[var(--error)] border-[var(--error)]/20",
  };

  return (
    <div className={`text-center p-2 rounded-xl border ${colors[color]}`}>
      <div className="text-xs text-[var(--foreground-muted)]">{label}</div>
      <div className="text-lg font-bold">{value || "-"}</div>
    </div>
  );
}
