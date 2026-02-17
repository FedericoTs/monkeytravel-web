import type { DestinationHighlight, Locale } from "@/lib/destinations/types";

interface DestinationHighlightsProps {
  cityName: string;
  highlights: DestinationHighlight[];
  locale: Locale;
  t: (key: string, values?: Record<string, string | number>) => string;
}

export default function DestinationHighlights({
  cityName,
  highlights,
  locale,
  t,
}: DestinationHighlightsProps) {
  return (
    <section className="py-16 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <h2 className="text-3xl sm:text-4xl font-bold text-[var(--foreground)] mb-12 tracking-tight text-center">
          {t("sections.whyVisit", { city: cityName })}
        </h2>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          {highlights.map((highlight, index) => (
            <div
              key={index}
              className="group p-6 rounded-2xl bg-[var(--background-alt)] border border-gray-100 hover:border-[var(--accent)]/30 hover:shadow-lg transition-all"
            >
              <div className="text-3xl mb-4">{highlight.icon}</div>
              <h3 className="text-lg font-semibold text-[var(--foreground)] mb-2">
                {highlight.title[locale]}
              </h3>
              <p className="text-sm text-[var(--foreground-muted)] leading-relaxed">
                {highlight.description[locale]}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
