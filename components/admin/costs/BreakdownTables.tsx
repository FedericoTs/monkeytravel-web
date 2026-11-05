import type { EnhancedCostAnalytics } from "@/lib/admin/costs/types";

export function ApiBreakdownTable({ apis }: { apis: EnhancedCostAnalytics["byApi"] }) {
  if (apis.length === 0) {
    return (
      <div className="text-center py-8 text-[var(--foreground-muted)] text-sm">
        No API data yet
      </div>
    );
  }

  return (
    <div className="space-y-2 max-h-[300px] overflow-y-auto">
      {apis.map((api) => (
        <div
          key={api.apiName}
          className="flex items-center gap-3 p-3 bg-[var(--background-warm)] rounded-xl hover:bg-[var(--background-cream)] transition"
        >
          <div
            className="w-3 h-3 rounded-full flex-shrink-0"
            style={{ backgroundColor: api.color }}
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-[var(--foreground)] truncate">
                {api.displayName}
              </span>
              <span className="text-[var(--primary-ink)] font-bold text-sm">
                ${api.totalCost.toFixed(3)}
              </span>
            </div>
            <div className="flex items-center gap-3 mt-1 text-xs">
              <span className="text-[var(--foreground-muted)]">
                {api.requestCount} req
              </span>
              {api.cacheHits > 0 && (
                <span className="text-[var(--success)]">
                  {api.cacheHits} hits
                </span>
              )}
              {api.errorCount > 0 && (
                <span className="text-[var(--error)]">
                  {api.errorCount} err ({api.errorRate}%)
                </span>
              )}
              {api.avgResponseTimeMs > 0 && (
                <span className="text-orange-500">
                  {api.avgResponseTimeMs}ms
                </span>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function TopEndpointsTable({ endpoints }: { endpoints: EnhancedCostAnalytics["topEndpoints"] }) {
  if (endpoints.length === 0) {
    return (
      <div className="text-center py-8 text-[var(--foreground-muted)] text-sm">
        No endpoint data yet
      </div>
    );
  }

  return (
    <div className="space-y-2 max-h-[300px] overflow-y-auto">
      {endpoints.map((endpoint, i) => (
        <div
          key={endpoint.endpoint}
          className="flex items-center gap-3 p-2 hover:bg-[var(--background-warm)] rounded-xl transition"
        >
          <span className="w-6 h-6 rounded-lg bg-[var(--primary)]/10 flex items-center justify-center text-xs font-medium text-[var(--primary-ink)]">
            {i + 1}
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-sm text-[var(--foreground)] truncate" title={endpoint.endpoint}>
              {endpoint.endpoint}
            </div>
            <div className="flex items-center gap-3 text-xs text-[var(--foreground-muted)] mt-0.5">
              <span>{endpoint.count}x</span>
              {endpoint.avgLatency > 0 && <span>{endpoint.avgLatency}ms</span>}
            </div>
          </div>
          <span className="text-[var(--secondary-ink)] font-bold text-sm">
            ${endpoint.cost.toFixed(3)}
          </span>
        </div>
      ))}
    </div>
  );
}
