import type { EnhancedCostAnalytics } from "@/app/api/admin/costs/route";

export function DailyTrendChart({ data }: { data: EnhancedCostAnalytics["dailyTrend"] }) {
  const maxCost = Math.max(...data.map(d => d.cost), 0.01);

  return (
    <div className="h-40 flex items-end gap-1">
      {data.map((day, i) => {
        const costHeight = (day.cost / maxCost) * 100;
        const isToday = i === data.length - 1;
        const hasErrors = day.errors > 0;

        return (
          <div
            key={day.date}
            className="flex-1 flex flex-col items-center group relative"
          >
            <div
              className={`w-full rounded-t-sm transition-all ${
                hasErrors
                  ? "bg-gradient-to-t from-[var(--error)] to-[var(--error)]/70"
                  : isToday
                  ? "bg-gradient-to-t from-[var(--primary)] to-[var(--primary-light)]"
                  : "bg-gradient-to-t from-[var(--secondary)]/60 to-[var(--secondary)]/30 hover:from-[var(--secondary)] hover:to-[var(--secondary)]/60"
              }`}
              style={{ height: `${Math.max(costHeight, 3)}%` }}
            />
            {/* Tooltip */}
            <div className="absolute bottom-full mb-2 hidden group-hover:block z-10">
              <div className="bg-[var(--navy)] text-white text-xs rounded-xl px-3 py-2 whitespace-nowrap shadow-lg">
                <div className="text-[var(--foreground-light)] mb-1">{day.date}</div>
                <div className="text-[var(--accent)]">${day.cost.toFixed(3)}</div>
                <div>{day.requests} requests</div>
                {day.errors > 0 && (
                  <div className="text-[var(--error)]">{day.errors} errors</div>
                )}
                {day.cacheHits > 0 && (
                  <div className="text-[var(--success)]">{day.cacheHits} cache hits</div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function HourlyTrendChart({ data }: { data: EnhancedCostAnalytics["hourlyTrend"] }) {
  const maxRequests = Math.max(...data.map(h => h.requests), 1);

  return (
    <div className="h-40 flex items-end gap-1">
      {data.map((hour, i) => {
        const height = (hour.requests / maxRequests) * 100;
        const isNow = i === data.length - 1;

        return (
          <div
            key={hour.hour}
            className="flex-1 flex flex-col items-center group relative"
          >
            <div
              className={`w-full rounded-t-sm transition-all ${
                isNow
                  ? "bg-gradient-to-t from-[var(--accent-dark)] to-[var(--accent)]"
                  : "bg-gradient-to-t from-[var(--primary)]/40 to-[var(--primary)]/20 hover:from-[var(--primary)] hover:to-[var(--primary)]/60"
              }`}
              style={{ height: `${Math.max(height, 3)}%` }}
            />
            {/* Tooltip */}
            <div className="absolute bottom-full mb-2 hidden group-hover:block z-10">
              <div className="bg-[var(--navy)] text-white text-xs rounded-xl px-3 py-2 whitespace-nowrap shadow-lg">
                <div className="text-[var(--foreground-light)] mb-1">
                  {new Date(hour.hour + ":00").toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
                <div className="text-[var(--accent)]">{hour.requests} requests</div>
                <div>${hour.cost.toFixed(3)}</div>
                {hour.avgLatency > 0 && (
                  <div className="text-orange-300">{hour.avgLatency}ms avg</div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
