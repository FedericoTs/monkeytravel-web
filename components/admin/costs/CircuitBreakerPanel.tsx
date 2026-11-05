import type { EnhancedCostAnalytics } from "@/app/api/admin/costs/route";
import { formatApiName } from "./format";

export function CircuitBreakerPanel({ breakers }: { breakers: EnhancedCostAnalytics["circuitBreakers"] }) {
  const sortedBreakers = [...breakers].sort((a, b) => {
    const priority = { OPEN: 0, HALF_OPEN: 1, CLOSED: 2 };
    return priority[a.state] - priority[b.state];
  });

  const openCount = breakers.filter(b => b.state === "OPEN").length;
  const halfOpenCount = breakers.filter(b => b.state === "HALF_OPEN").length;

  return (
    <div className="bg-white rounded-2xl border border-[var(--foreground-light)]/20 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-[var(--foreground)]">
          Circuit Breakers
        </h3>
        <div className="flex items-center gap-2">
          {openCount > 0 && (
            <span className="px-2 py-0.5 bg-[var(--error)]/10 text-[var(--error)] rounded-full text-xs font-medium">
              {openCount} Open
            </span>
          )}
          {halfOpenCount > 0 && (
            <span className="px-2 py-0.5 bg-[var(--warning)]/20 text-orange-600 rounded-full text-xs font-medium">
              {halfOpenCount} Recovering
            </span>
          )}
          {openCount === 0 && halfOpenCount === 0 && (
            <span className="px-2 py-0.5 bg-[var(--success)]/10 text-[var(--success)] rounded-full text-xs font-medium">
              All Healthy
            </span>
          )}
        </div>
      </div>
      <div className="space-y-2 max-h-[200px] overflow-y-auto">
        {sortedBreakers.slice(0, 8).map((breaker) => (
          <div
            key={breaker.apiName}
            className={`flex items-center justify-between p-3 rounded-xl transition ${
              breaker.state === "OPEN"
                ? "bg-[var(--error)]/5 border border-[var(--error)]/20"
                : breaker.state === "HALF_OPEN"
                ? "bg-[var(--warning)]/10 border border-[var(--warning)]/30"
                : "bg-[var(--background-warm)] border border-transparent"
            }`}
          >
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${
                breaker.state === "CLOSED" ? "bg-[var(--success)]" :
                breaker.state === "HALF_OPEN" ? "bg-[var(--warning)] animate-pulse" :
                "bg-[var(--error)] animate-pulse"
              }`} />
              <span className="text-sm text-[var(--foreground)]">
                {formatApiName(breaker.apiName)}
              </span>
            </div>
            <div className="flex items-center gap-3">
              {breaker.failureCount > 0 && (
                <span className="text-xs text-[var(--error)]">
                  {breaker.failureCount} fails
                </span>
              )}
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                breaker.state === "CLOSED" ? "bg-[var(--success)]/10 text-[var(--success)]" :
                breaker.state === "HALF_OPEN" ? "bg-[var(--warning)]/20 text-orange-600" :
                "bg-[var(--error)]/10 text-[var(--error)]"
              }`}>
                {breaker.state === "HALF_OPEN" ? "HALF" : breaker.state}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
