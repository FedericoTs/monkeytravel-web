import type { GrowthStats } from "@/lib/admin/growth/types";

// ============================================
// RETENTION METRICS COMPONENT
// ============================================
export function RetentionMetrics({
  retention,
  meta,
}: {
  retention: GrowthStats["retention"];
  meta: GrowthStats["meta"];
}) {
  const metrics = [
    {
      label: "D1 Retention",
      value: retention.d1,
      change: retention.d1Change,
      sample: retention.sampleSizes.d1Eligible,
      description: "Came back within 1 day",
      benchmark: 40,
    },
    {
      label: "D7 Retention",
      value: retention.d7,
      change: retention.d7Change,
      sample: retention.sampleSizes.d7Eligible,
      description: "Came back within 7 days",
      benchmark: 20,
    },
    {
      label: "D30 Retention",
      value: retention.d30,
      change: retention.d30Change,
      sample: retention.sampleSizes.d30Eligible,
      description: "Came back within 30 days",
      benchmark: 10,
    },
  ];

  return (
    <div>
      {meta.retentionMethod === "activity_proxy" && (
        <p className="text-xs text-amber-600 mb-2">
          <strong>Activity-based</strong> — sign-in tracking isn&apos;t wired yet, so &quot;came back&quot;
          counts users who created another trip, used the assistant, or earned bananas after signup.
          Directional proxy until <code className="bg-amber-50 px-1 rounded">last_seen_at</code> lands.
        </p>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {metrics.map((metric) => (
          <div
            key={metric.label}
            className="bg-white rounded-2xl border border-slate-200 p-6 relative overflow-hidden"
          >
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-slate-100">
              <div
                className={`h-full transition-all duration-500 ${
                  metric.value >= metric.benchmark ? "bg-green-500" : "bg-amber-500"
                }`}
                style={{ width: `${Math.min(metric.value, 100)}%` }}
              />
            </div>

            <div className="flex items-start justify-between mb-2">
              <span className="text-sm font-medium text-slate-500">{metric.label}</span>
              {metric.change !== 0 && (
                <span
                  className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                    metric.change > 0
                      ? "bg-green-100 text-green-700"
                      : "bg-red-100 text-red-700"
                  }`}
                >
                  {metric.change > 0 ? "+" : ""}
                  {metric.change}%
                </span>
              )}
            </div>

            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-bold text-[var(--foreground)]">{metric.value}%</span>
              <span className="text-sm text-slate-500">vs {metric.benchmark}% benchmark</span>
            </div>

            <p className="text-xs text-slate-500 mt-2">
              {metric.description} (n={metric.sample})
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
