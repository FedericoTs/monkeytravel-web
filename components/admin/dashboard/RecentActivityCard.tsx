import type { AdminStats } from "@/app/api/admin/stats/route";

// ===========================================================================
// Recent Activity — KEPT (the user explicitly liked this)
// ===========================================================================

export function RecentActivityCard({
  activities,
}: {
  activities: AdminStats["recentActivity"];
}) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6">
      <h2 className="text-base sm:text-lg font-semibold text-[var(--foreground)] mb-4">
        Recent Activity
      </h2>
      {activities.length === 0 ? (
        <p className="text-sm text-slate-500">No activity yet</p>
      ) : (
        <div className="space-y-2.5">
          {activities.map((activity, i) => (
            <div
              key={`${activity.timestamp}-${i}`}
              className="flex items-center gap-3 text-xs sm:text-sm"
            >
              <ActivityIcon type={activity.type} />
              <span className="flex-1 text-slate-600 truncate" title={activity.description}>
                {activity.description}
              </span>
              <span className="text-[10px] sm:text-xs text-slate-500 flex-shrink-0">
                {formatTimestamp(activity.timestamp)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ActivityIcon({ type }: { type: string }) {
  const icons: Record<string, { bg: string; icon: string }> = {
    user: {
      bg: "bg-blue-100",
      icon: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z",
    },
    trip: {
      bg: "bg-green-100",
      icon: "M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7",
    },
    ai: {
      bg: "bg-purple-100",
      icon: "M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z",
    },
    subscriber: {
      bg: "bg-amber-100",
      icon: "M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z",
    },
  };
  const config = icons[type] || icons.user;
  return (
    <div
      className={`w-7 h-7 sm:w-8 sm:h-8 rounded-lg ${config.bg} flex items-center justify-center flex-shrink-0`}
    >
      <svg
        className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-slate-600"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d={config.icon}
        />
      </svg>
    </div>
  );
}

// --- Formatters ----------------------------------------------------------

export function formatAction(action: string): string {
  return action
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}
