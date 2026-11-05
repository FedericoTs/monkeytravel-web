import { IconComponent } from "./icons";

// ===========================================================================
// MetricCard — keeps the look you liked, adds WoW chip
// ===========================================================================

export function MetricCard({
  title,
  value,
  weekValue,
  deltaPct,
  icon,
  color,
}: {
  title: string;
  value: number;
  weekValue: number;
  deltaPct: number;
  icon: string;
  color: "primary" | "secondary" | "accent" | "navy";
}) {
  const colorClasses = {
    primary: "bg-[var(--primary)]/10 text-[var(--primary-ink)]",
    secondary: "bg-[var(--secondary)]/10 text-[var(--secondary-ink)]",
    accent: "bg-[var(--accent)]/20 text-amber-600",
    navy: "bg-slate-100 text-slate-600",
  };

  const deltaPositive = deltaPct > 0;
  const deltaNeutral = deltaPct === 0;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5">
      <div className="flex items-start justify-between mb-2 sm:mb-3">
        <div
          className={`w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center ${colorClasses[color]}`}
        >
          <IconComponent name={icon} />
        </div>
        {!deltaNeutral && (
          <span
            className={`text-[10px] sm:text-xs font-semibold px-2 py-0.5 rounded-full ${
              deltaPositive ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
            }`}
          >
            {deltaPositive ? "▲" : "▼"} {Math.abs(deltaPct)}%
          </span>
        )}
      </div>
      <div className="text-xl sm:text-2xl font-bold text-[var(--foreground)] leading-tight">
        {value.toLocaleString()}
      </div>
      <div className="text-xs sm:text-sm text-slate-500 mt-0.5">{title}</div>
      <div className="text-[11px] sm:text-xs text-slate-500 mt-1">
        +{weekValue.toLocaleString()} this week
      </div>
    </div>
  );
}
