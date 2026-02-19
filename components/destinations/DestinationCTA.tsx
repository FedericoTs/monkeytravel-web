import { Link } from "@/lib/i18n/routing";
import type { Locale } from "@/lib/destinations/types";

interface DestinationCTAProps {
  slug: string;
  ctaText: string;
  cityName: string;
  locale: Locale;
  t: (key: string, values?: Record<string, string | number>) => string;
}

export default function DestinationCTA({
  slug,
  ctaText,
  cityName,
  t,
}: DestinationCTAProps) {
  return (
    <section className="py-20 bg-white">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="relative overflow-hidden rounded-[2rem] mesh-gradient p-10 sm:p-14 text-center">
          <div className="absolute inset-0 bg-grid-pattern opacity-20 pointer-events-none" />
          <div className="absolute top-0 right-0 w-48 h-48 bg-[var(--accent)]/20 rounded-full blur-[80px]" />

          <div className="relative">
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4 tracking-tight">
              {ctaText}
            </h2>
            <p className="text-white/70 mb-8 text-lg">
              {t("cta.freeIn30Seconds")}
            </p>

            <Link
              href={`/trips/new?destination=${slug}`}
              className="inline-flex items-center gap-2 px-8 py-4 bg-[var(--accent)] text-[var(--primary-dark)] font-bold rounded-xl hover:bg-[var(--accent-light)] transition-all shadow-lg shadow-[var(--accent)]/30 text-lg"
              data-ph-capture-attribute-destination-slug={slug}
              data-ph-capture-attribute-destination-city={cityName}
              data-ph-capture-attribute-cta-type="generate_itinerary"
            >
              {t("cta.generateItinerary", { city: cityName })}
              <svg
                className="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 7l5 5m0 0l-5 5m5-5H6"
                />
              </svg>
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
