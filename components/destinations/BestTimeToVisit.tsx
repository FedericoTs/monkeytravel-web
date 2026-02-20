import type { Destination, Locale, MonthClimate } from "@/lib/destinations/types";

interface BestTimeToVisitProps {
  destination: Destination;
  locale: Locale;
  t: (key: string, values?: Record<string, string | number>) => string;
}

const SEASONS = ["spring", "summer", "autumn", "winter"] as const;

function getMonthSeason(month: number, isSouthern: boolean): string {
  const m = month;
  if (isSouthern) {
    if (m >= 9 && m <= 11) return "spring";
    if (m === 12 || m <= 2) return "summer";
    if (m >= 3 && m <= 5) return "autumn";
    return "winter";
  }
  if (m >= 3 && m <= 5) return "spring";
  if (m >= 6 && m <= 8) return "summer";
  if (m >= 9 && m <= 11) return "autumn";
  return "winter";
}

function getMonthStatus(
  month: number,
  bestMonths: number[]
): "best" | "good" | "off" {
  if (bestMonths.includes(month)) return "best";
  // Adjacent months to best months are "good"
  const adjacent = bestMonths.some(
    (bm) =>
      Math.abs(bm - month) === 1 ||
      (bm === 1 && month === 12) ||
      (bm === 12 && month === 1)
  );
  if (adjacent) return "good";
  return "off";
}

const statusColors = {
  best: "bg-emerald-500 text-white",
  good: "bg-amber-400 text-slate-900",
  off: "bg-slate-200 text-slate-500",
};

const crowdLabels: Record<number, string> = {
  1: "low",
  2: "moderate",
  3: "high",
};

const crowdDots: Record<number, string> = {
  1: "bg-emerald-400",
  2: "bg-amber-400",
  3: "bg-red-400",
};

const SOUTHERN_CONTINENTS = new Set(["oceania"]);
const SOUTHERN_SLUGS = new Set([
  "buenos-aires",
  "cape-town",
  "bali",
  "melbourne",
]);

export default function BestTimeToVisit({
  destination,
  locale,
  t,
}: BestTimeToVisitProps) {
  const { stats, climate, seasonNotes, continent, slug } = destination;
  const cityName = destination.name[locale];
  const isSouthern =
    SOUTHERN_CONTINENTS.has(continent) || SOUTHERN_SLUGS.has(slug);

  return (
    <section className="py-16 bg-[var(--background-alt)]">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <h2 className="text-3xl font-bold text-[var(--foreground)] mb-2 text-center">
          {t("bestTime.title", { city: cityName })}
        </h2>
        <p className="text-[var(--foreground-muted)] text-center mb-10 max-w-xl mx-auto">
          {t("bestTime.subtitle", { city: cityName })}
        </p>

        {/* Month grid */}
        <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-12 gap-2 mb-10">
          {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => {
            const status = getMonthStatus(month, stats.bestMonths);
            const mc: MonthClimate | undefined = climate?.[month];

            return (
              <div
                key={month}
                className={`rounded-xl p-2.5 text-center transition-all ${statusColors[status]}`}
              >
                <div className="text-xs font-bold mb-1">
                  {t(`months.${month}`)}
                </div>
                {mc && (
                  <>
                    <div className="text-lg font-bold leading-none">
                      {mc.high}°
                    </div>
                    <div className="text-[10px] opacity-70">{mc.low}°</div>
                    <div className="mt-1 flex justify-center">
                      <span
                        className={`w-2 h-2 rounded-full ${crowdDots[mc.crowd]}`}
                      />
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div className="flex flex-wrap justify-center gap-4 sm:gap-6 mb-10 text-sm">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-sm bg-emerald-500" />
            <span className="text-[var(--foreground-muted)]">
              {t("bestTime.best")}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-sm bg-amber-400" />
            <span className="text-[var(--foreground-muted)]">
              {t("bestTime.good")}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-sm bg-slate-200" />
            <span className="text-[var(--foreground-muted)]">
              {t("bestTime.offSeason")}
            </span>
          </div>
          <span className="text-[var(--foreground-muted)]/50">|</span>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <span className="text-[var(--foreground-muted)]">
              {t("bestTime.crowds")}: {t("bestTime.low")}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-amber-400" />
            <span className="text-[var(--foreground-muted)]">
              {t("bestTime.moderate")}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-red-400" />
            <span className="text-[var(--foreground-muted)]">
              {t("bestTime.high")}
            </span>
          </div>
        </div>

        {/* Season cards */}
        {seasonNotes && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {SEASONS.map((season) => {
              const note = seasonNotes[season];
              if (!note) return null;

              const seasonIcons = {
                spring: "🌸",
                summer: "☀️",
                autumn: "🍂",
                winter: "❄️",
              };

              return (
                <div
                  key={season}
                  className="rounded-xl border border-gray-100 bg-white p-5"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xl">{seasonIcons[season]}</span>
                    <h3 className="font-semibold text-[var(--foreground)]">
                      {t(`bestTime.${season}`)}
                    </h3>
                  </div>
                  <p className="text-sm text-[var(--foreground-muted)] leading-relaxed">
                    {note[locale]}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
