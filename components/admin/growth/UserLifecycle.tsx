import type { GrowthStats } from "@/lib/admin/growth/types";

// ============================================
// USER LIFECYCLE COMPONENT
// ============================================
export function UserLifecycle({ lifecycle }: { lifecycle: GrowthStats["lifecycle"] }) {
  const total = lifecycle.new + lifecycle.activated + lifecycle.engaged + lifecycle.powerUser;

  const stages = [
    { label: "New", value: lifecycle.new, color: "bg-slate-400", description: "0 trips" },
    { label: "Activated", value: lifecycle.activated, color: "bg-blue-500", description: "1 trip" },
    { label: "Engaged", value: lifecycle.engaged, color: "bg-purple-500", description: "2-4 trips" },
    { label: "Power User", value: lifecycle.powerUser, color: "bg-green-500", description: "5+ trips" },
  ];

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-6">
      <h3 className="text-lg font-semibold text-[var(--foreground)] mb-4">User Lifecycle Stages</h3>

      <div className="h-8 rounded-lg overflow-hidden flex mb-6">
        {stages.map((stage) => {
          const percentage = total > 0 ? (stage.value / total) * 100 : 0;
          if (percentage === 0) return null;
          return (
            <div
              key={stage.label}
              className={`${stage.color} relative group transition-all hover:opacity-90`}
              style={{ width: `${percentage}%` }}
              title={`${stage.label}: ${stage.value} users (${Math.round(percentage)}%)`}
            >
              {percentage >= 15 && (
                <span className="absolute inset-0 flex items-center justify-center text-white text-xs font-semibold">
                  {Math.round(percentage)}%
                </span>
              )}
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {stages.map((stage) => {
          const percentage = total > 0 ? Math.round((stage.value / total) * 100) : 0;
          return (
            <div key={stage.label} className="flex items-center gap-2">
              <div className={`w-3 h-3 rounded-full ${stage.color}`} />
              <div>
                <p className="text-sm font-medium text-slate-700">{stage.label}</p>
                <p className="text-xs text-slate-500">
                  {stage.value} ({percentage}%)
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
