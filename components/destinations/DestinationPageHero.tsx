import Image from "next/image";
import type { Destination, Locale } from "@/lib/destinations/types";

interface DestinationPageHeroProps {
  destination: Destination;
  locale: Locale;
  t: (key: string, values?: Record<string, string | number>) => string;
}

const budgetDots: Record<number, string> = {
  1: "$",
  2: "$$",
  3: "$$$",
};

export default function DestinationPageHero({
  destination,
  locale,
  t,
}: DestinationPageHeroProps) {
  const { name, country, countryCode, stats, content } = destination;
  const bestMonthNames = stats.bestMonths
    .map((m) => t(`months.${m}`))
    .join(", ");

  return (
    <section className="relative pt-20 pb-16 overflow-hidden">
      {/* Background image with overlay */}
      <div className="absolute inset-0">
        <Image
          src={`/images/destinations/${destination.slug}.jpg`}
          alt={name[locale]}
          fill
          className="object-cover"
          priority
          sizes="100vw"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/50 to-black/70" />
      </div>

      {/* Fallback gradient if no image */}
      <div className="absolute inset-0 -z-10 bg-gradient-to-br from-[var(--primary)] to-[var(--primary-dark)]" />

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-12 pb-4">
        {/* Country + flag */}
        <div className="flex items-center gap-2 mb-4">
          <Image
            src={`https://flagcdn.com/24x18/${countryCode.toLowerCase()}.png`}
            alt={country[locale]}
            width={24}
            height={18}
            className="rounded-sm"
          />
          <span className="text-white/80 text-sm font-medium">
            {country[locale]}
          </span>
        </div>

        {/* City name */}
        <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-white mb-4 tracking-tight">
          {name[locale]}
        </h1>

        {/* Tagline */}
        <p className="text-lg sm:text-xl text-white/80 max-w-2xl mb-8 leading-relaxed">
          {content.tagline[locale]}
        </p>

        {/* Stat chips */}
        <div className="flex flex-wrap gap-3">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 backdrop-blur-sm border border-white/20 text-white text-sm">
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
            {t("stats.avgStay", { days: stats.avgStayDays })}
          </div>

          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 backdrop-blur-sm border border-white/20 text-white text-sm">
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707"
              />
            </svg>
            {t("stats.bestMonths")}: {bestMonthNames}
          </div>

          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 backdrop-blur-sm border border-white/20 text-white text-sm">
            <span className="font-medium">
              {budgetDots[stats.budgetLevel]}
            </span>
            {t(`budgetLabels.${stats.budgetLevel}`)}
          </div>
        </div>
      </div>
    </section>
  );
}
