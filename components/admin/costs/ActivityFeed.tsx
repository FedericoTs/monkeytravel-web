import type { EnhancedCostAnalytics } from "@/lib/admin/costs/types";
import { formatApiName } from "./format";

export function ActivityFeed({ activities }: { activities: EnhancedCostAnalytics["recentActivity"] }) {
  if (activities.length === 0) {
    return (
      <div className="text-center py-8 text-[var(--foreground-muted)] text-sm">
        No recent activity
      </div>
    );
  }

  return (
    <div className="space-y-1 max-h-[300px] overflow-y-auto text-xs">
      <div className="grid grid-cols-12 gap-2 px-3 py-2 bg-[var(--background-warm)] rounded-xl text-[var(--foreground-muted)] font-medium sticky top-0">
        <span className="col-span-2">Time</span>
        <span className="col-span-2">API</span>
        <span className="col-span-4">Endpoint</span>
        <span className="col-span-1 text-center">Status</span>
        <span className="col-span-1 text-right">Latency</span>
        <span className="col-span-1 text-right">Cost</span>
        <span className="col-span-1 text-center">Cache</span>
      </div>
      {activities.map((activity) => (
        <div
          key={activity.id}
          className={`grid grid-cols-12 gap-2 px-3 py-2 rounded-xl hover:bg-[var(--background-warm)] transition ${
            activity.error ? "bg-[var(--error)]/5" : ""
          }`}
        >
          <span className="col-span-2 text-[var(--foreground-muted)]">
            {new Date(activity.timestamp).toLocaleTimeString()}
          </span>
          <span className="col-span-2 text-[var(--foreground)] truncate">
            {formatApiName(activity.apiName)}
          </span>
          <span className="col-span-4 text-[var(--foreground-muted)] truncate" title={activity.endpoint}>
            {activity.endpoint}
          </span>
          <span className={`col-span-1 text-center font-medium ${
            activity.status >= 400 ? "text-[var(--error)]" :
            activity.status >= 300 ? "text-orange-500" :
            "text-[var(--success)]"
          }`}>
            {activity.status || "-"}
          </span>
          <span className="col-span-1 text-right text-orange-500">
            {activity.responseTimeMs > 0 ? `${activity.responseTimeMs}ms` : "-"}
          </span>
          <span className="col-span-1 text-right text-[var(--secondary-ink)]">
            ${activity.costUsd.toFixed(4)}
          </span>
          <span className="col-span-1 text-center">
            {activity.cacheHit ? (
              <span className="text-[var(--success)] font-medium">HIT</span>
            ) : (
              <span className="text-[var(--foreground-light)]">-</span>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}
