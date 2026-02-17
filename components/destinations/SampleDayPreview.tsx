import type { SampleActivity, Locale } from "@/lib/destinations/types";

interface SampleDayPreviewProps {
  cityName: string;
  activities: SampleActivity[];
  locale: Locale;
  t: (key: string, values?: Record<string, string | number>) => string;
}

const typeIcons: Record<string, string> = {
  breakfast: "☕",
  lunch: "🍽️",
  dinner: "🌙",
  sightseeing: "📸",
  museum: "🏛️",
  walk: "🚶",
  shopping: "🛍️",
  nightlife: "🎶",
  transport: "🚆",
  activity: "⚡",
};

export default function SampleDayPreview({
  cityName,
  activities,
  locale,
  t,
}: SampleDayPreviewProps) {
  return (
    <section className="py-16 bg-[var(--background-alt)]">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <h2 className="text-3xl sm:text-4xl font-bold text-[var(--foreground)] mb-4 tracking-tight text-center">
          {t("sections.sampleDay", { city: cityName })}
        </h2>
        <p className="text-center text-[var(--foreground-muted)] mb-12 max-w-xl mx-auto">
          {t("sections.sampleDayNote")}
        </p>

        {/* Timeline */}
        <div className="relative">
          {/* Vertical line */}
          <div className="absolute left-[39px] top-0 bottom-0 w-0.5 bg-gray-200 hidden sm:block" />

          <div className="space-y-6">
            {activities.map((activity, index) => (
              <div key={index} className="flex gap-4 sm:gap-6">
                {/* Time + dot */}
                <div className="flex flex-col items-center shrink-0">
                  <span className="text-sm font-mono font-medium text-[var(--primary)] w-[50px] text-right">
                    {activity.time}
                  </span>
                  <div className="hidden sm:block w-3 h-3 rounded-full bg-[var(--accent)] border-2 border-white shadow-sm mt-1 relative z-10" />
                </div>

                {/* Card */}
                <div className="flex-1 p-4 rounded-xl bg-white border border-gray-100 shadow-sm">
                  <div className="flex items-start gap-3">
                    <span className="text-xl shrink-0">
                      {typeIcons[activity.type] || "📍"}
                    </span>
                    <div>
                      <h3 className="font-semibold text-[var(--foreground)]">
                        {activity.title[locale]}
                      </h3>
                      <p className="text-sm text-[var(--foreground-muted)] mt-1">
                        {activity.description[locale]}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
